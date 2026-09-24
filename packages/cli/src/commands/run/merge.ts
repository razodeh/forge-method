/**
 * `forge merge` — `03` §3.2.4: "Drive the merge queue manually; `--lane`, `--all`, `--abort`."
 *
 * `--abort` is not implemented: `10`/`06`'s own spec text gives no further detail on what "abort"
 * means for a command that (unlike `forge abort [runId]`, a real, unrelated command a few rows above
 * this one in the same table) is not itself killing a process — a merge already has its own real
 * abort-on-conflict/abort-on-failure policy inside `processMergeCandidate` (`@forge/vcs`), applied
 * automatically per candidate, not as a separate manual step this command would drive. Refused
 * (`USR-003`) rather than guessed at. See `SPEC-QUESTIONS.md`.
 *
 * `mergeLane`/`mergeAllReady` land through `landLane` (`@forge/engine/dispatch`, `PLAN-M14.md` P40) with
 * the pre/post checks the run that left the lane `'ready'` would itself have applied: the run's own
 * `merge` step's declared `policy.preChecks`/`postChecks` when the lane is in that step's
 * `mergeLandingScope` (recomputed here from the run's manifest, the identical `workflowId` +
 * `expressionContext` recompilation `resumeWorkflow` does), else `execution.mergeChecks` — never the
 * empty `{}` this command used to hand the queue, which ran no check at all. A `LandLaneDeps` is built
 * directly from the real facades (`createVcsFacade`/`createTelemetryFacade`/`createMergeQueueFacade`),
 * never `buildRunEngineContext`'s wider run-driving shape (an adapter, a gate registry, prompt assembly,
 * ...) this command has no use for — the same real event log, git repository and merge queue a live run
 * uses, so `forge status`/`forge resume` see this landing exactly as they would a run's own merge step's.
 *
 * @see specs/03 §3.2.4
 * @see specs/06 §6.5
 * @see PLAN-M14.md P40
 */
import { ForgeError, SYSTEM_CLOCK, renderCause, type Clock } from '@forge/core';
import { pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';
import {
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
  landLane,
  resolveLaneChecks,
  type LaneHandle,
  type LandLaneDeps,
  type MergeCandidateChecks,
  type MergeOutcome,
  type StepFailureInfo,
} from '@forge/engine/dispatch';
import { compileRunPlan, mergeLandingScope } from '@forge/engine/plan';
import { reconstructRunState } from '@forge/engine/resume';
import { parseWorkflow } from '@forge/engine/workflow';
import type { ForgeConfig } from '@forge/schemas/config';
import { readEvents } from '@forge/telemetry/events';
import { laneBranchName } from '@forge/vcs';

import { readManifest } from './resume.ts';

export interface MergeContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly runId: string;
  readonly integrationPath: string;
  /** `PLAN-M14.md` P40: the run's own configured checks (`execution.mergeChecks`/`execution.testCommands`)
   * and worktree-retention policy — `landLaneDepsFor` below reads these directly, never a second,
   * independently-loaded copy of `.forge/config.yaml`. */
  readonly config: ForgeConfig;
  /** Project-relative directory of compiled workflow sources (`.forge/workflows` for a real project) —
   * where `declaredChecksFor` below reads `manifest.workflowId`'s own source from, the identical root
   * `resumeWorkflow` (`resume.ts`) already reads workflows from. */
  readonly workflowsRoot: string;
  /** Environment overlay for every merge-check command a landed lane's checks spawn (`PLAN-M13.md` P12):
   * the launcher shim's `PATH`, carrying the FORGE run marker (`PLAN-M14.md` P4) — the same environment a
   * real run's own merge step would give the identical check. Absent: nothing is added. */
  readonly commandEnv?: Readonly<Record<string, string>> | undefined;
  readonly clock?: Clock;
}

/** `--pre-checks`/`--post-checks <fast|full|layer|command>`: the identical vocabulary a merge policy's own
 * `preChecks`/`postChecks` already accepts (`merge-checks.ts`), overriding whichever this lane's checks
 * would otherwise resolve to — one side at a time, so `--pre-checks fast` alone leaves `--post-checks` (or
 * whatever it would otherwise have resolved to) untouched. */
export interface MergeChecksOverride {
  readonly pre?: string | undefined;
  readonly post?: string | undefined;
}

/** The check-set labels a lane's landing actually ran (or would have run) — never the raw commands
 * themselves (`integrate.ts`'s own `describeChecks` gives the identical "labels, never commands: they may
 * hold secrets" reasoning) — and which layers of a named set had no configured command, so a lane record
 * that ran fewer checks than its set names says so. */
export interface MergeCheckSummary {
  readonly pre: readonly string[];
  readonly post: readonly string[];
  readonly skippedLayers?: { readonly pre: readonly string[]; readonly post: readonly string[] };
}

export interface MergeLaneResult {
  /** What the queue reported; absent when the checks never resolved to a real command at all (nothing was
   * landed), or when the lane had nothing to land and was only removed (`alreadyIntegrated` below). */
  readonly outcome?: MergeOutcome;
  /** Why the lane did not land; absent when it did. */
  readonly failure?: StepFailureInfo;
  readonly alreadyIntegrated?: true;
  readonly checks: MergeCheckSummary;
  /** Set only when this run's own workflow could not be recompiled (deleted, or edited into something that
   * no longer parses or compiles) — `execution.mergeChecks` was used instead of the merge step's own
   * declared policy, and the caller should say so. Never set for the "no manifest at all" fallback: that
   * run never had a real merge step to have used in the first place. */
  readonly warning?: string;
}

interface DeclaredChecks {
  readonly pre: string | undefined;
  readonly post: string | undefined;
  readonly preSource: string;
  readonly postSource: string;
}

/** `execution.mergeChecks` (`18` §18.3): the identical fallback source `integrateLane` already uses for a
 * lane no `merge` step lands at all — reused here verbatim for a lane this run's own recompiled plan
 * cannot place inside any merge step's landing scope, or when there is no plan to recompile at all. */
const FALLBACK_PRE_SOURCE = 'execution.mergeChecks.pre';
const FALLBACK_POST_SOURCE = 'execution.mergeChecks.post';

function fallbackChecks(ctx: MergeContext): DeclaredChecks {
  return {
    pre: ctx.config.execution.mergeChecks?.pre,
    post: ctx.config.execution.mergeChecks?.post,
    preSource: FALLBACK_PRE_SOURCE,
    postSource: FALLBACK_POST_SOURCE,
  };
}

/**
 * The checks the run that left `laneId` ready would itself have applied when landing it (`PLAN-M14.md`
 * P40): the run's manifest names the workflow and inputs it compiled from (`workflowId` +
 * `expressionContext`), recompiled fresh here — never trusted stale from when the run started — the
 * identical way `resumeWorkflow` recompiles it (`resume.ts:70-112`). When `originStepId` falls inside a
 * `merge` step's landing scope (`mergeLandingScope`) of that fresh compile, that step's own declared
 * `policy.preChecks`/`postChecks` is what `runMergeStep` itself would have used. A lane in no merge step's
 * scope, a run with no manifest at all (never started by `forge run`, or one whose manifest was since
 * removed), and a workflow that no longer parses or compiles (edited or deleted since the run started) all
 * fall back to `execution.mergeChecks` instead; only the last of those three carries a `warning` back —
 * the other two never had a real merge step to have used in the first place. A manifest that exists but
 * cannot be read or parsed is not tolerated the same way: `readManifest` throws `RUN-054` for that, and
 * this function lets it propagate rather than guessing which checks a corrupt run intended.
 */
async function declaredChecksFor(
  ctx: MergeContext,
  originStepId: string,
): Promise<{ readonly declared: DeclaredChecks; readonly warning?: string }> {
  const manifestPath = ctx.paths.resolveState(`runs/${ctx.runId}/manifest.json`);
  if (!(await pathExists(manifestPath))) {
    return { declared: fallbackChecks(ctx) };
  }
  const manifest = await readManifest(ctx.paths, ctx.runId);
  try {
    const workflowSource = await readTextFile(
      ctx.paths.resolveWithin(`${ctx.workflowsRoot}/${manifest.workflowId}.workflow.yaml`),
    );
    const parsed = parseWorkflow(workflowSource);
    if (!parsed.success) {
      throw new Error(parsed.issues.map((issue) => issue.message).join('; '));
    }
    const compiled = compileRunPlan(parsed.workflow, manifest.expressionContext);
    if (!compiled.success) {
      throw new Error(compiled.issues.map((issue) => issue.message).join('; '));
    }
    const nodes = new Map(compiled.nodes.map((node) => [node.id, node] as const));
    for (const node of compiled.nodes) {
      if (node.kind !== 'merge') continue;
      if (!mergeLandingScope(nodes, node.id).includes(originStepId)) continue;
      return {
        declared: {
          pre: node.mergePolicy?.preChecks,
          post: node.mergePolicy?.postChecks,
          preSource: `the merge policy preChecks of ${node.id}`,
          postSource: `the merge policy postChecks of ${node.id}`,
        },
      };
    }
    return { declared: fallbackChecks(ctx) };
  } catch (cause) {
    return {
      declared: fallbackChecks(ctx),
      warning:
        `The workflow ${manifest.workflowId} no longer compiles, so forge merge could not recompile ` +
        `this run's own plan; using execution.mergeChecks instead of its merge step's own declared ` +
        `policy (${renderCause(cause) ?? 'unknown error'}).`,
    };
  }
}

function labelsOf(commands: MergeCandidateChecks['preCommands']): readonly string[] {
  return (commands ?? []).map((entry) => entry.label ?? 'literal command');
}

/** `PLAN-M14.md` P40 (`SPEC-QUESTIONS.md` Q232 decision 19): a merge with no configured test layers stays
 * refused, not silently landed — reached only when both `pre`/`post` resolved to zero real commands
 * (`resolveMergeChecks` itself already refuses a *named* set none of whose layers is configured; this is
 * the remaining case, where neither side named anything at all: no merge policy, no `execution.
 * mergeChecks`, no `--pre-checks`/`--post-checks`). */
function noChecksConfiguredFailure(preSource: string, postSource: string): StepFailureInfo {
  return {
    source: 'merge',
    code: 'MERGE-CHECKS-UNCONFIGURED',
    message:
      `Neither ${preSource} nor ${postSource} names a check, so no execution.testCommands.* layer (or ` +
      'literal command) would run, and forge merge never lands a lane with no checks applied. Remedy: ' +
      "set execution.mergeChecks.pre/post in .forge/config.yaml (or the merge step's own policy." +
      'preChecks/postChecks), or pass --pre-checks/--post-checks.',
  };
}

/** The minimal `landLane`/`resolveLaneChecks` context (`@forge/engine/dispatch`'s own `LandLaneDeps`,
 * `PLAN-M14.md` P35/P40) built straight from the real facades — never `buildRunEngineContext`, which needs
 * a real `PlatformAdapter` and gate registry this command has neither reason nor occasion to build. A
 * fresh `laneRegistry` per call is correct, not merely convenient: `landLane` only ever `.delete()`s from
 * it on a successful landing, and this command lands one lane per call, from a project's real, durable
 * lane state (`reconstructRunState`), never anything a shared, run-lifetime registry would need to answer
 * `.get()` against. */
function landLaneDepsFor(ctx: MergeContext): LandLaneDeps {
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const now = () => Date.parse(clock.now());
  return {
    telemetry: createTelemetryFacade(ctx.projectRoot, ctx.runId, now),
    vcs: createVcsFacade(ctx.projectRoot, ctx.runId),
    mergeQueue: createMergeQueueFacade(ctx.integrationPath, undefined, { env: ctx.commandEnv }),
    laneRegistry: new Map(),
    retainLaneWorktrees: ctx.config.execution.retainLaneWorktrees !== 'never',
    runId: ctx.runId,
    testCommands: ctx.config.execution.testCommands,
    mergeChecks: ctx.config.execution.mergeChecks,
  };
}

export async function mergeLane(
  ctx: MergeContext,
  laneId: string,
  overrides: MergeChecksOverride = {},
): Promise<MergeLaneResult> {
  const runState = await reconstructRunState(readEvents(ctx.projectRoot, ctx.runId));
  const origin = runState.laneOrigins.get(laneId);
  if (origin === undefined) {
    throw new ForgeError('RUN-051', { laneId });
  }
  // `laneId` itself (`<runId>-<stepId-slug>`, `@forge/vcs`'s own `lanes.ts`) is not the lane's real git
  // branch name (`forge/<runId>/<stepId-slug>`, from the same module's `laneBranchName`) — a critic-
  // round-shaped bug caught before commit: `lane.branch` is what `processMergeCandidate` itself actually
  // reaches with `git merge`/`git rebase` (`merge-queue.ts`'s own doc comment), so using the bare `laneId`
  // there would target a branch that never exists.
  const lane: LaneHandle = {
    laneId,
    path: ctx.paths.resolveState(`worktrees/${laneId}`),
    branch: laneBranchName(ctx.runId, origin.stepId),
  };

  const { declared, warning } = await declaredChecksFor(ctx, origin.stepId);
  const preSource = overrides.pre !== undefined ? 'the --pre-checks flag' : declared.preSource;
  const postSource = overrides.post !== undefined ? 'the --post-checks flag' : declared.postSource;
  const deps = landLaneDepsFor(ctx);
  const resolved = resolveLaneChecks(deps, {
    pre: overrides.pre ?? declared.pre,
    post: overrides.post ?? declared.post,
    preSource,
    postSource,
  });
  if (!resolved.ok) {
    return {
      failure: resolved.failure,
      checks: { pre: [], post: [] },
      ...(warning === undefined ? {} : { warning }),
    };
  }
  const { checks, skipped } = resolved.value;
  const checksSummary: MergeCheckSummary = {
    pre: labelsOf(checks.preCommands),
    post: labelsOf(checks.postCommands),
    ...(skipped.pre.length + skipped.post.length === 0 ? {} : { skippedLayers: skipped }),
  };
  if ((checks.preCommands?.length ?? 0) === 0 && (checks.postCommands?.length ?? 0) === 0) {
    return {
      failure: noChecksConfiguredFailure(preSource, postSource),
      checks: checksSummary,
      ...(warning === undefined ? {} : { warning }),
    };
  }
  const landed = await landLane(deps, {
    eventStepId: origin.stepId,
    laneStepId: origin.stepId,
    lane,
    conflictPolicy: 'abort',
    checks,
    skippedLayers: skipped,
  });
  return {
    ...(landed.outcome === undefined ? {} : { outcome: landed.outcome }),
    ...(landed.failure === undefined ? {} : { failure: landed.failure }),
    ...(landed.alreadyIntegrated === undefined ? {} : { alreadyIntegrated: landed.alreadyIntegrated }),
    checks: checksSummary,
    ...(warning === undefined ? {} : { warning }),
  };
}

export async function mergeAllReady(
  ctx: MergeContext,
  overrides: MergeChecksOverride = {},
): Promise<readonly { readonly laneId: string; readonly result: MergeLaneResult }[]> {
  const runState = await reconstructRunState(readEvents(ctx.projectRoot, ctx.runId));
  const readyLaneIds = [...runState.laneStatuses.entries()]
    .filter(([, status]) => status === 'ready')
    .map(([laneId]) => laneId);

  const results: { readonly laneId: string; readonly result: MergeLaneResult }[] = [];
  for (const laneId of readyLaneIds) {
    results.push({ laneId, result: await mergeLane(ctx, laneId, overrides) });
  }
  return results;
}

export function mergeAbort(): never {
  throw new ForgeError('USR-003', { feature: 'forge merge --abort' });
}
