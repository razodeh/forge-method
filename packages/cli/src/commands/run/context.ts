/**
 * `buildRunEngineContext` — assembles a real `RunEngineContext` (`@forge/engine/run`) from real
 * project state: `.forge/config.yaml` (`03` §3.3's own written config, C2), a real gate registry
 * (`.forge/checks/`), the real facade constructors `@forge/engine/dispatch` already ships
 * (`createVcsFacade`/`createTelemetryFacade`/`createGateEvaluator`/`createMergeQueueFacade`), and one
 * real, caller-supplied `PlatformAdapter` — no concrete adapter exists anywhere in this codebase yet
 * (the identical gap `@forge/cli/init`'s own `RunInitDeps.candidateAdapters` already documents), so
 * this is injected here for the identical reason, not discovered.
 *
 * @see specs/03 §3.2.4
 * @see PLAN-M5.md P15
 */
import { existsSync } from 'node:fs';
import { access, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError, SYSTEM_CLOCK, renderCause, type Clock } from '@forge/core';
import { pathExists, readTextFile, type AbsolutePath, type ProjectPaths } from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createPromptAssemblyContext,
  createTelemetryFacade,
  createVcsFacade,
} from '@forge/engine/dispatch';
import type { AskPort } from '@forge/engine/dispatch';
import type { RunEngineContext } from '@forge/engine/run';
import type { ConcurrencyLimits } from '@forge/engine/scheduler';
import { parseWorktreeBlocks, resolveRevision } from '@forge/vcs';
import type { ForgeConfig } from '@forge/schemas/config';
import type { ToolGrant } from '@forge/adapter-kit/types';
import { resolveClaimPolicy } from '@forge/kb/adopt';

import { resolvePackageRoot } from '../../init/package-root.ts';
import { loadGateRegistry } from './gates.ts';

export interface BuildRunContextInput {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  readonly runId: string;
  readonly adapter: PlatformAdapter;
  readonly checksRoot: string;
  /** Project-relative directory of materialized agent definitions (`.forge/agents`), which prompt
   * assembly loads the dispatched agent from. Required: every real run dispatches agents. */
  readonly agentsRoot: string;
  readonly clock?: Clock;
  /** Environment overlay for every command step, gate check and merge check the run spawns: a `PATH` whose
   * first entry holds a `forge` that re-launches this CLI (`launcher-shim.ts`). Absent: nothing is added. */
  readonly commandEnv?: Readonly<Record<string, string>> | undefined;
  /** How an `elicit` step gets its answers (`--answers`, a terminal): `ask.ts`. Absent, an `elicit` step fails
   * `RUN-101` (`PLAN-M13.md` P20). */
  readonly ask?: AskPort | undefined;
  /** The run's expression context (its inputs), which names the integration branch: see `integrationBranchFor`.
   * Absent for a command that is not a workflow run. */
  readonly expressionContext?: unknown;
  /** Whether lanes branch from the integration branch (a workflow run: `runWorkflow`, `resumeWorkflow`, whose
   * engine integrates each lane into it, `PLAN-M13.md` P19) or from the trunk. `forge review`, `debug`,
   * `session` and `panel` build a context too, integrate nothing, and want the code as it is on `main`, not on
   * an integration branch that only moves when a run lands lanes: they leave this off. */
  readonly lanesFromIntegration?: boolean;
}

/** The trunk the integration branch is first created from (never an integration branch itself). */
const TRUNK = 'main';

/** A branch name that is safe to hand to git as a ref: letters, digits, `_`, `-`, `.` and `/` between such
 * components, no `..`, no leading or trailing dot or slash, no `.lock`, at most 200 characters. */
function isSafeBranchName(name: string): boolean {
  if (name.length === 0 || name.length > 200 || name.includes('..') || name.endsWith('.lock')) {
    return false;
  }
  return /^[A-Za-z0-9](?:[A-Za-z0-9_-]|\.(?=[A-Za-z0-9_-])|\/(?=[A-Za-z0-9]))*$/.test(name);
}

/** A stage id that is safe as one component of a branch name (`isSafeBranchName`, no `/`), at most 64 chars. */
function isSafeStageId(stageId: string): boolean {
  return stageId.length <= 64 && !stageId.includes('/') && isSafeBranchName(stageId);
}

function contextField(expressionContext: unknown, name: string): unknown {
  if (typeof expressionContext !== 'object' || expressionContext === null) return undefined;
  return (expressionContext as Readonly<Record<string, unknown>>)[name];
}

/** The `stageId` an expression context (a run's inputs) carries, if it is a string. */
export function stageIdOfContext(expressionContext: unknown): string | undefined {
  const stageId = contextField(expressionContext, 'stageId');
  return typeof stageId === 'string' ? stageId : undefined;
}

/**
 * The integration branch of a run (`18` §18.3 `execution.integrationBranch`, `06` §6.5): the configured template
 * with `{stage}` replaced by the run's `stageId` when that is a safe identifier, else `current`. The config is the
 * one source of truth, so every workflow of a project integrates into the same branch: a stage workflow's own
 * `vars.integration_branch` (`build-stage`'s `prepare` step switches to it) matches with the default template and
 * a project that customises the template has to customise that var too, or `prepare` changes the integration
 * worktree's branch and the engine refuses it, naming the change. A value that is not a safe identifier never
 * reaches git.
 */
export function integrationBranchFor(config: ForgeConfig, expressionContext?: unknown): string {
  const stageId = stageIdOfContext(expressionContext);
  const stage = stageId !== undefined && isSafeStageId(stageId) ? stageId : 'current';
  return config.execution.integrationBranch.replace('{stage}', stage);
}

/** The integration branch a recorded run used, from its manifest (`forge run` writes `expressionContext` there),
 * so `forge merge` lands a ready lane where the run integrated. A run with no manifest (started by something
 * other than `forge run`) uses the default; a manifest that cannot be read is `RUN-054`, not a guess: merging
 * into the wrong branch would go unnoticed. */
export async function integrationBranchOfRun(
  paths: ProjectPaths,
  config: ForgeConfig,
  runId: string,
): Promise<string> {
  const manifestPath = paths.resolveState(`runs/${runId}/manifest.json`);
  if (!(await pathExists(manifestPath))) return integrationBranchFor(config);
  try {
    const manifest = JSON.parse(await readTextFile(manifestPath)) as {
      readonly expressionContext?: unknown;
    };
    return integrationBranchFor(config, manifest.expressionContext);
  } catch (cause) {
    throw new ForgeError('RUN-054', { runId }, { cause });
  }
}

/** `ExecuteStepContext.tools`, which no production code reads any more: every session (agent steps,
 * participants, and since `PLAN-M13.md` P27 `forge debug`) resolves a per-agent grant. Read-only, so a future
 * reader of the dead field cannot be handed write access by accident. */
const DEFAULT_TOOLS: ToolGrant = { read: true, write: false, exec: false, network: 'none' };

/** `ExecuteStepContext.model`, likewise unread: every session resolves its model from `models.tiers`
 * (`resolveStepModel`), never from here. `RunEngineContext.model`'s own doc comment: "`07` §7.2's own 'resolved from tier'... M5 has no
 * tier/role system at all, so this is one fixed value... supplied by whoever constructs `ctx`" — this
 * is that resolution. With no tier→model mapping built anywhere in this codebase yet
 * (`SPEC-QUESTIONS.md` Q62 part 2), the platform adapter's own real, reported model list is the only
 * source of truth available; the first one it reports is picked (a real, adapter-validated model id,
 * never a bare tier label like `'balanced'` passed straight through — `startSession` rejects any id
 * the adapter did not itself report). */
async function resolveModel(adapter: PlatformAdapter): Promise<string> {
  const models = await adapter.listModels();
  const first = models[0];
  if (first === undefined) {
    throw new ForgeError('RUN-052', undefined);
  }
  return first.id;
}

function concurrencyLimits(config: ForgeConfig): ConcurrencyLimits {
  const global = config.execution.concurrency === 'auto' ? 4 : config.execution.concurrency;
  return { global, perAgent: new Map(), perResourceClass: new Map() };
}

/** Whether `error` is a spawn-level failure (the `git` binary itself could not be found/executed) as
 * opposed to `git` running and failing on its own — `execa` surfaces the former as a Node `ENOENT` on
 * the error object, the same signal `node:child_process` itself uses. Only this case is a genuine
 * "tool not found" situation; a critic round caught the previous code reporting `ENV-004` ("install
 * the tool") for *any* `git` failure at all — a bad base ref, a path/branch collision, disk-full, or
 * real resource exhaustion under heavy parallel load — which is actively misleading when git is
 * installed and working fine but failed for an unrelated reason. */
function isSpawnNotFound(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/** Runs a real `git` subcommand, translating a genuine "binary not found" into `ENV-004` and any
 * other real git failure into `RUN-055` — carrying the real underlying message rather than the
 * `ENV-004` template's misleading "install git" remedy for a git that is plainly already working.
 * `LC_ALL`/`LANG` pinned to `C`: `ensureIntegrationWorktree`'s own TOCTOU recovery below matches
 * plain-English substrings against a real git error message, which git localises under a non-English
 * `LANG`/`LC_ALL` — pinning here is what keeps that match reliable regardless of the host's own
 * locale, rather than silently failing to recognise the race on a non-English system. */
async function runGitOrThrow(args: readonly string[], cwd: string): Promise<string> {
  try {
    const result = await execa('git', args, { cwd, env: { LC_ALL: 'C', LANG: 'C' } });
    return result.stdout;
  } catch (cause) {
    if (isSpawnNotFound(cause)) {
      throw new ForgeError('ENV-004', { tool: 'git' }, { cause });
    }
    throw new ForgeError('RUN-055', { detail: renderCause(cause) ?? 'unknown failure' }, { cause });
  }
}

/** Resolves `candidate` to its real, symlink-free path by walking up to its deepest *existing*
 * ancestor and realpath-ing that — `@forge/core/fs`'s own (private) `realpathOfDeepestExistingAncestor`
 * (`paths.ts`) already establishes this exact pattern for the identical "the leaf may not exist yet,
 * but the comparison still needs to be symlink-correct" problem; reimplemented locally (async, over
 * `node:fs/promises`) since that one is not exported. A bare `realpath(candidate).catch(() =>
 * path.resolve(candidate))` fallback — tried first — is *not* enough here: when `candidate` itself is
 * missing, that fallback returns the raw, *unresolved* path, which still silently fails to match a
 * git-reported path through a symlinked ancestor (`os.tmpdir()` itself is a symlink on macOS) —
 * confirmed directly, this is exactly what let a real, deterministic reproduction of `ensureIntegrationWorktree`'s
 * own "missing but already registered" repair path fail even after `isTargetRegisteredWorktree` was
 * already fixed once for the identical class of mismatch on the *existing*-path case. */
async function pathExistsRaw(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function realpathOfDeepestExistingAncestor(candidate: string): Promise<string> {
  let probe = candidate;
  while (!(await pathExistsRaw(probe))) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realAncestor = await realpath(probe);
  const suffix = path.relative(probe, candidate);
  return suffix === '' ? realAncestor : path.join(realAncestor, suffix);
}

/** Whether `target` is genuinely a registered worktree right now — read from `git worktree list
 * --porcelain`, the same real source of truth `@forge/vcs`'s own (private) `isRegisteredWorktree`
 * already uses for the identical "is this real, or just a directory that happens to exist" question,
 * built locally from `@forge/vcs`'s own exported `parseWorktreeBlocks` parser rather than depending on
 * an unexported function. Never a bare filesystem existence check, which cannot tell a genuinely
 * registered worktree from a stray directory, or from a losing process's own `git worktree add` that
 * created the directory but has not finished registering it yet. Exported — not just used locally — so
 * this is directly, deterministically testable against a real repository's own real registered/
 * unregistered state, the identical "exported so this is directly testable" reason `@forge/vcs`'s own
 * `parseWorktreeBlocks` already gives (the real race this backs `ensureIntegrationWorktree`'s own
 * TOCTOU recovery for is not reliably reproducible on demand in a test).
 *
 * Both sides resolved through `realpathOfDeepestExistingAncestor` before comparing, not a bare
 * `path.resolve`: `git` itself reports every `worktree` line in `worktree list --porcelain` already
 * canonicalised, but `target` here (built from `ProjectPaths.resolveState`, never realpath'd) is not —
 * confirmed empirically (the same "`os.tmpdir()` itself is a symlink on macOS" fact `@forge/vcs`'s own
 * `resolveCwd` doc comment already names) that comparing the two with plain `path.resolve` alone
 * silently and permanently returns `false` on macOS. `target` (and, for the "missing but already
 * registered" case, git's own reported path too) may not exist on disk at all, so a bare
 * `realpath` — which requires its full argument to exist — is not enough either; both sides go through
 * `realpathOfDeepestExistingAncestor` instead, which only needs the *deepest existing* ancestor to be
 * real. */
export async function isTargetRegisteredWorktree(
  projectRoot: string,
  target: string,
): Promise<boolean> {
  const listing = await runGitOrThrow(['worktree', 'list', '--porcelain'], projectRoot);
  const resolvedTarget = await realpathOfDeepestExistingAncestor(target);
  for (const block of parseWorktreeBlocks(listing)) {
    const resolvedBlockPath = await realpathOfDeepestExistingAncestor(block.path);
    if (resolvedBlockPath === resolvedTarget) return true;
  }
  return false;
}

/**
 * `git worktree add <path> <base>` (checking out the integration branch itself, creating it from
 * `base` if it does not exist yet) — `ExecuteStepContext.integrationPath`'s own doc comment states
 * "creating/maintaining it across a whole run is out of this module's own scope (a later piece's
 * concern)"; this is that later piece. Idempotent: a second call against an already-checked-out path
 * is a no-op, the same "nothing to do" real state `createLaneWorktree`'s own sibling operations treat
 * as success rather than an error.
 */
export async function ensureIntegrationWorktree(
  paths: ProjectPaths,
  projectRoot: string,
  integrationBranch: string,
  base: string,
  options: { readonly graceMs?: number } = {},
): Promise<string> {
  const target = paths.resolveState(
    `worktrees/integration-${integrationBranch.replace(/\//g, '-')}`,
  );
  if (await pathExists(target)) {
    // A `git worktree add` a killed process started keeps running (killing the parent does not kill git) and
    // finishes a moment later; a healthy tree is what a resume finds if it looks again. Only a tree that stays
    // unusable for the grace period is a crash's leftover.
    if (await becomesUsable(projectRoot, target, options.graceMs ?? UNUSABLE_GRACE_MS)) {
      await repairInterruptedIntegrationWorktree(target, integrationBranch);
      return target;
    }
    // A crash inside `git worktree add` (a run killed while its context was being built) leaves a directory and
    // a registration git marks `locked initializing`, with no checkout behind them. Nothing used to read that
    // tree; now every inline step, gate check and merge does, so it is discarded and made again.
    await discardBrokenWorktree(projectRoot, target);
  }

  const branchListing = await runGitOrThrow(['branch', '--list', integrationBranch], projectRoot);
  const branchExists = branchListing.trim() !== '';

  const args = branchExists
    ? ['worktree', 'add', target, integrationBranch]
    : [
        'worktree',
        'add',
        '-b',
        integrationBranch,
        target,
        await resolveRevision(projectRoot, base),
      ];

  try {
    await runGitOrThrow(args, projectRoot);
    return target;
  } catch (error) {
    return recoverFromWorktreeAddFailure(projectRoot, target, args, error);
  }
}

/** Whether `target` is a checkout of its own that git can work in: its top level is `target` itself (a
 * directory a killed `worktree add` never finished, with no `.git` file, would otherwise resolve to the
 * project's own repository one level up and read as healthy), `HEAD` resolves there, and git lists it as a
 * registered worktree. */
async function isUsableWorktree(projectRoot: string, target: string): Promise<boolean> {
  const top = await execa('git', ['rev-parse', '--show-toplevel'], { cwd: target, reject: false });
  if (top.exitCode !== 0) return false;
  const [resolvedTop, resolvedTarget] = await Promise.all([
    realpath(top.stdout.trim()).catch(() => top.stdout.trim()),
    realpath(target).catch(() => target),
  ]);
  if (resolvedTop !== resolvedTarget) return false;
  const head = await execa('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: target,
    reject: false,
  });
  if (head.exitCode !== 0) return false;
  // `git worktree add` holds a `locked` note (`initializing`) in the worktree's admin directory until its
  // checkout is done: a tree with one is being made (or was, when the process died), not ready to use, and
  // touching it now would make the still-running `git` fail and delete it.
  const adminDir = await execa('git', ['rev-parse', '--absolute-git-dir'], {
    cwd: target,
    reject: false,
  });
  if (adminDir.exitCode !== 0 || existsSync(path.join(adminDir.stdout.trim(), 'locked'))) {
    return false;
  }
  return isTargetRegisteredWorktree(projectRoot, target);
}

/** How long a directory that is not (yet) a usable worktree is given to become one before it is discarded. */
const UNUSABLE_GRACE_MS = 4000;

async function becomesUsable(
  projectRoot: string,
  target: string,
  graceMs: number,
): Promise<boolean> {
  // Counted in polling steps, not read off a clock (R10): `graceMs / POLL_MS` attempts.
  const attempts = Math.ceil(graceMs / POLL_MS);
  for (let attempt = 0; ; attempt += 1) {
    if (await isUsableWorktree(projectRoot, target)) return true;
    if (attempt >= attempts) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const POLL_MS = 100;

/** Puts a usable integration worktree back on its branch and out of a merge a killed process left half done:
 * the merge queue lands lanes in it and an inline step is undone in it, and a process killed in the middle of
 * either leaves the tree on another branch (a step's `git switch`) or in `MERGE_HEAD` state. Merges land on
 * whatever the worktree has checked out, so leaving it on the wrong branch would integrate into the wrong one. */
async function repairInterruptedIntegrationWorktree(
  target: string,
  integrationBranch: string,
): Promise<void> {
  const mergeInProgress = await execa('git', ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'], {
    cwd: target,
    reject: false,
  });
  if (mergeInProgress.exitCode === 0) {
    await execa('git', ['merge', '--abort'], { cwd: target, reject: false });
  }
  const branch = await execa('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: target,
    reject: false,
  });
  if (branch.exitCode !== 0 || branch.stdout.trim() !== integrationBranch) {
    // Retried: a `git worktree add` a killed process started may still be finishing its own checkout here.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await runGitOrThrow(['checkout', '--force', integrationBranch], target);
        break;
      } catch (error) {
        if (attempt >= 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
}

/** Removes a half-made integration worktree: git's own removal first (twice-forced: it is `locked`; git refuses
 * it when the admin directory is as incomplete as a killed `worktree add` leaves it, holding only `gitdir` and
 * `locked`), then the directory, an unlock and a prune for whatever git could not take away. Failures are not
 * fatal here: the `worktree add` that follows either succeeds or reports the real problem. */
async function discardBrokenWorktree(projectRoot: string, target: string): Promise<void> {
  const git = (args: readonly string[]) =>
    execa('git', [...args], { cwd: projectRoot, reject: false });
  await git(['worktree', 'remove', '--force', '--force', target]);
  await rm(target, { recursive: true, force: true });
  await git(['worktree', 'unlock', target]);
  await git(['worktree', 'prune']);
}

/**
 * A real, reproducible TOCTOU race the `pathExists(target)` pre-check in `ensureIntegrationWorktree`
 * cannot fully close — confirmed directly, twice, against `resume.test.ts`'s own real crash-then-
 * resume proof, in two genuinely different real shapes git itself reports with two genuinely
 * different error messages:
 *
 * 1. A *concurrent* process's own `git worktree add` finishes between this call's own `pathExists`
 *    check and this `git worktree add` actually running — the target now genuinely exists as a real,
 *    valid worktree, and git's own error names the real target path directly ("'<target>' already
 *    exists").
 * 2. A *crashed* process's own earlier, incomplete `git worktree add` left a real registration in
 *    `.git/worktrees/<name>` with no real directory behind it — `pathExists(target)` correctly found
 *    nothing (there is nothing there), but git still refuses a fresh `add` at that exact path
 *    ("is a missing but already registered worktree").
 *
 * Both are told apart by real, structural checks — never by matching git's own exact wording (a
 * critic round caught an earlier version of this fix trusting a message substring alone, which a
 * *different*, unrelated failure sharing the same words could also produce) — rather than which of
 * git's own many possible phrasings this particular failure happened to use: case 1 is `pathExists(
 * target) && isTargetRegisteredWorktree(...)` (a real, live, valid worktree — never touched, only
 * confirmed and reused); case 2 is `!pathExists(target) && isTargetRegisteredWorktree(...)` (a stale
 * registration with no real directory to protect — safe to clear via `git worktree remove --force`
 * and retry the original `add` once for real, since nothing valid could be destroyed). Any other
 * shape (not registered at all) is a genuinely different failure and always propagates.
 */
async function recoverFromWorktreeAddFailure(
  projectRoot: string,
  target: AbsolutePath,
  args: readonly string[],
  originalError: unknown,
): Promise<string> {
  const registered = await isTargetRegisteredWorktree(projectRoot, target);
  if (!registered) throw originalError;

  if (await pathExists(target)) {
    // Case 1: a concurrent winner's own real, valid worktree.
    return target;
  }

  // Case 2: a stale registration with nothing real behind it — safe to clear and retry. Real
  // failures here are not swallowed: if `remove`/`prune` themselves fail, that is itself a real,
  // worth-reporting problem, more informative than a confusing retry-`add` failure that follows one.
  await runGitOrThrow(['worktree', 'remove', '--force', target], projectRoot);
  await runGitOrThrow(['worktree', 'prune'], projectRoot);
  await runGitOrThrow(args, projectRoot);
  return target;
}

export async function buildRunEngineContext(
  input: BuildRunContextInput,
): Promise<RunEngineContext> {
  const clock = input.clock ?? SYSTEM_CLOCK;
  const now = () => Date.parse(clock.now());
  // The integration branch starts from the trunk the first time it is created; after that it is the
  // branch every lane branches from (`06` §6.4: "branched from the integration branch") and the one the
  // engine integrates lanes into, so a later step sees an earlier step's work (`PLAN-M13.md` P19, Q221).
  const integrationBranch = integrationBranchFor(input.config, input.expressionContext);
  const integrationPath = await ensureIntegrationWorktree(
    input.paths,
    input.projectRoot,
    integrationBranch,
    TRUNK,
  );
  const gateRegistry = await loadGateRegistry(input.paths, input.checksRoot);
  const model = await resolveModel(input.adapter);

  return {
    adapter: input.adapter,
    vcs: createVcsFacade(input.projectRoot, input.runId),
    telemetry: createTelemetryFacade(input.projectRoot, input.runId, now),
    gates: createGateEvaluator(gateRegistry, { env: input.commandEnv }),
    gateRegistry,
    mergeQueue: createMergeQueueFacade(integrationPath, undefined, { env: input.commandEnv }),
    commandEnv: input.commandEnv,
    ...(input.ask === undefined ? {} : { ask: input.ask }),
    runId: input.runId,
    projectRoot: input.projectRoot,
    integrationBase: input.lanesFromIntegration === true ? integrationBranch : TRUNK,
    integrationPath,
    conflictPolicy: input.config.execution.conflictPolicy,
    // A merge check that names a set (`preChecks: fast`, `10` §10.1) runs the commands of its test layers, and a
    // lane the engine integrates on its own has the configured check set (`PLAN-M13.md` P38, `06` §6.5).
    testCommands: input.config.execution.testCommands,
    mergeChecks: input.config.execution.mergeChecks,
    model,
    tools: DEFAULT_TOOLS,
    assembly: createPromptAssemblyContext({
      paths: input.paths,
      integrationPath,
      agentsRoot: input.agentsRoot,
      config: input.config,
      templatesPackageRoot: resolvePackageRoot('@forge/templates') as AbsolutePath,
    }),
    retainLaneWorktrees: input.config.execution.retainLaneWorktrees !== 'never',
    // `17` §17.4 point 5 / `06` §6.7's own per-autonomy default table, via `resolveClaimPolicy`
    // (`PLAN-M10.md` P20) — this used to be the bare literal `'strict'` unconditionally, silently
    // correct for `autonomous`/`supervised` but wrong for `guided` (`06` §6.7 defaults `guided` to
    // `warn`), and blind to whether the project is a `forge adopt`-adopted brownfield codebase at all.
    claimPolicy: resolveClaimPolicy(input.config.execution.autonomy, input.config.project.adopted),
    signCommits: input.config.vcs.signCommits,
    // `PLAN-M13.md` P7: the output contract check roots each artifact path template (`18` §18.7) under the
    // project's own configured docs directories, so a project that relocated `paths.specs` is checked there.
    docRoots: {
      kb: input.config.paths.kb,
      specs: input.config.paths.specs,
      plans: input.config.paths.plans,
      sessions: input.config.paths.sessions,
      reports: input.config.paths.reports,
    },
    now,
    laneRegistry: new Map(),
    limits: concurrencyLimits(input.config),
    seed: input.runId,
    // `20` §20.10 S9 (`PLAN-M11.md` P11): the real, first-ever production wiring of `.forge/config.
    // yaml`'s own `budget` block into `@forge/engine/run`'s own live admission control
    // (`computeLiveBudgetState`/`canAdmit`) — previously `RunEngineContext.budget` had no caller at
    // all, so a real `forge run` enforced no budget cap regardless of what this config said.
    budget: {
      perRunUsd: input.config.budget.perRunUsd,
      perStepUsdDefault: input.config.budget.perStepUsdDefault,
      dailyUsd: input.config.budget.dailyUsd,
      onBreach: input.config.budget.onBreach,
    },
  };
}
