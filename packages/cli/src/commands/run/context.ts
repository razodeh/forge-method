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
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError, SYSTEM_CLOCK, renderCause, type Clock } from '@forge/core';
import { pathExists, type AbsolutePath, type ProjectPaths } from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createPromptAssemblyContext,
  createTelemetryFacade,
  createVcsFacade,
} from '@forge/engine/dispatch';
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
}

/** The fixed grant for sessions that are not agent-step dispatch (`forge debug`'s ad-hoc RCA sessions,
 * `ExecuteStepContext.tools`). Agent steps and participant sessions never read it: they resolve a
 * per-agent grant (`PLAN-M13.md` P4/P5). */
const DEFAULT_TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };

/** The model for the same ad-hoc, non-agent-step sessions (`ExecuteStepContext.model`) -- agent steps
 * resolve theirs from `models.tiers` (`resolveStepModel`), never from here. `RunEngineContext.model`'s own doc comment: "`07` §7.2's own 'resolved from tier'... M5 has no
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
): Promise<string> {
  const target = paths.resolveState(
    `worktrees/integration-${integrationBranch.replace(/\//g, '-')}`,
  );
  if (await pathExists(target)) return target;

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
  const integrationBase = 'main';
  const integrationBranch = input.config.execution.integrationBranch.replace('{stage}', 'current');
  const integrationPath = await ensureIntegrationWorktree(
    input.paths,
    input.projectRoot,
    integrationBranch,
    integrationBase,
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
    runId: input.runId,
    projectRoot: input.projectRoot,
    integrationBase,
    integrationPath,
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
