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
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError, SYSTEM_CLOCK, renderCause, type Clock } from '@forge/core';
import { pathExists, type ProjectPaths } from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '@forge/engine/dispatch';
import type { RunEngineContext } from '@forge/engine/run';
import type { ConcurrencyLimits } from '@forge/engine/scheduler';
import { parseWorktreeBlocks, resolveRevision } from '@forge/vcs';
import type { ForgeConfig } from '@forge/schemas/config';
import type { ToolGrant } from '@forge/adapter-kit/types';

import { loadGateRegistry } from './gates.ts';

export interface BuildRunContextInput {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  readonly runId: string;
  readonly adapter: PlatformAdapter;
  readonly checksRoot: string;
  readonly clock?: Clock;
}

const DEFAULT_TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };

/** `RunEngineContext.model`'s own doc comment: "`07` §7.2's own 'resolved from tier'... M5 has no
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
 * Both sides resolved through a real `realpath` before comparing, not a bare `path.resolve`: `git`
 * itself reports every `worktree` line in `worktree list --porcelain` already canonicalised, but
 * `target` here (built from `ProjectPaths.resolveState`, never realpath'd) is not — confirmed
 * empirically (the same "`os.tmpdir()` itself is a symlink on macOS" fact `@forge/vcs`'s own
 * `resolveCwd` doc comment already names) that comparing the two with plain `path.resolve` alone
 * silently and permanently returns `false` on macOS, `@forge/vcs`'s own established fix for the
 * identical class of mismatch. */
export async function isTargetRegisteredWorktree(
  projectRoot: string,
  target: string,
): Promise<boolean> {
  const listing = await runGitOrThrow(['worktree', 'list', '--porcelain'], projectRoot);
  const resolvedTarget = await realpath(target);
  const paths = await Promise.all(
    parseWorktreeBlocks(listing).map((block) => realpath(block.path).catch(() => block.path)),
  );
  return paths.some((worktreePath) => path.resolve(worktreePath) === resolvedTarget);
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
  } catch (error) {
    // A real, reproducible TOCTOU race the `pathExists(target)` pre-check above cannot fully close:
    // a *different* real process (a killed-and-resumed `forge run` in particular — confirmed directly
    // against `resume.test.ts`'s own real crash-then-resume proof) can create the identical target
    // between this call's own `pathExists` check and this `git worktree add` actually running. Git's
    // own real, stable error text for exactly that race quotes the real target *path* itself —
    // `'<target>' already exists.` — deliberately distinguished from the differently-worded "a branch
    // named '<name>' already exists" (a real, different failure this same call can also hit, which
    // must still propagate: the target directory was never created in that case, so silently
    // returning it here would be a lie the rest of this run believes) by requiring the message to
    // name the real target path, not merely the substring "already exists".
    //
    // The message match alone is not trusted as proof the *other* process's own `git worktree add`
    // actually finished: `git worktree add` creates the target directory before it finishes real
    // registration (writing `.git/worktrees/<name>`), so a losing process could hit this identical
    // text while the winner's own operation is still mid-flight, or a stray directory could be sitting
    // at `target` for an unrelated reason entirely. `isTargetRegisteredWorktree` below re-checks
    // against `git worktree list --porcelain` — the same real source of truth `@forge/vcs`'s own
    // `isRegisteredWorktree` already uses for the identical "is this real, or just a directory that
    // happens to exist" question — before trusting the race is over; a critic round caught the
    // original version of this fix trusting the string match alone.
    if (
      error instanceof Error &&
      error.message.includes(target) &&
      error.message.includes('already exists') &&
      (await isTargetRegisteredWorktree(projectRoot, target))
    ) {
      return target;
    }
    throw error;
  }
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
    gates: createGateEvaluator(gateRegistry),
    gateRegistry,
    mergeQueue: createMergeQueueFacade(integrationPath, undefined),
    runId: input.runId,
    projectRoot: input.projectRoot,
    integrationBase,
    integrationPath,
    model,
    tools: DEFAULT_TOOLS,
    retainLaneWorktrees: input.config.execution.retainLaneWorktrees !== 'never',
    claimPolicy: 'strict',
    signCommits: input.config.vcs.signCommits,
    now,
    laneRegistry: new Map(),
    limits: concurrencyLimits(input.config),
    seed: input.runId,
  };
}
