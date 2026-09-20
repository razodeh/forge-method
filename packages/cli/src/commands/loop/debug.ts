/**
 * `forge debug <symptom|--from-failure <runId>>` — `03` §3.2.5's autonomous RCA loop, driven directly
 * by `@forge/engine/rca`'s own `runRcaLoop` (`PLAN-M8.md` P8's real, already-built ten-phase control
 * flow) rather than a synthetic `debug.workflow.yaml` — the identical "a real, already-built mechanism
 * exists; call it directly, no synthetic workflow document" precedent `forge review` already set for
 * `dispatchAgentStep` (`PLAN-M6.md` A6, `review.ts`'s own header). `debug.workflow.yaml`'s own
 * `run-rca`/`fix`/`prove-fix`/`record` four-step shape is superseded — real control flow this
 * coarse-grained now lives inside `runRcaLoop` itself — but the workflow file, its own template
 * registration, and its fixture copy are deliberately *not* removed (`SPEC-QUESTIONS.md` Q130 point 9
 * records why: a wider blast radius than this piece's own scope justifies chasing down).
 *
 * Defect scaffolding (`scaffoldDefect`/`findFailedStep`) is unchanged from before this piece — `13`
 * §13's own intake normalisation, already correct.
 *
 * The FIX phase is the one real, writable exception `RcaLoopDeps`'s own doc comment names as this
 * piece's job: a real lane (`@forge/vcs`, `06` §6.4), reset back to its own clean base before *every*
 * session this loop runs — not just a FIX attempt's own next call, `runReadOnlySession`'s own doc
 * comment has the fuller reasoning a fresh critic round's own reproduction forced — with the real diff
 * computed via `git diff` after each FIX session and handed back as `SessionResult.structured.diff`,
 * the exact shape `loop.ts`'s own FIX phase already reads. On a `'recorded'` outcome, the lane is reset
 * once more and that one, exact tracked diff is re-applied immediately before the real commit —
 * `applyDiff`'s own doc comment has the fuller reasoning (PROVE's own real `forge test run` re-check
 * leaves real side effects in the same lane that must never ride along into the committed fix).
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.5
 * @see specs/13 §13
 * @see specs/13 §13.2 F-DEBUG-1
 * @see specs/13 §13.2 F-DEBUG-2
 */
import { execa } from 'execa';
import { ArtifactDocument, writeArtifact } from '@forge/core/artifacts';
import { ForgeError, SYSTEM_CLOCK, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import type {
  PlatformAdapter,
  SessionLimits,
  SessionRequest,
  SessionResult,
} from '@forge/adapter-kit/types';
import type { AgentDefinition } from '@forge/agents/schema';
import { runShellCommand } from '@forge/engine/dispatch';
import type { RunEngineContext } from '@forge/engine/run';
import {
  runRcaLoop,
  type DefectContext,
  type RcaEvidenceBundle,
  type RcaLoopDeps,
  type RcaRecordDraft,
  type RcaSessionRequest,
} from '@forge/engine/rca';
import type { ForgeConfig } from '@forge/schemas/config';
import { renderArtifactPath } from '@forge/schemas/registry';
import { readEvents } from '@forge/telemetry/events';
import {
  commitInLane,
  createLaneWorktree,
  formatCommitMessage,
  removeLaneWorktree,
  resetLaneWorktree,
  resolveRevision,
  type LaneHandle,
} from '@forge/vcs';

import { loadProjectAgent } from './agent-loader.ts';
import { buildRunEngineContext } from '../run/context.ts';
import { getSharedIdAllocator, readArtifactTemplate } from '../shared.ts';

const DIAGNOSTICIAN_AGENT_ID = 'diagnostician';
const DEBUG_LANE_STEP_ID = 'debug-fix';

/** `ad-hoc-step.ts`'s own real, already-established precedent for a standalone command with no
 * workflow YAML of its own to source real limits from — one fixed value every session in a `forge
 * debug` invocation requests, the identical "no tier/role system yet" stub `ExecuteStepContext.model`'s
 * own doc comment already accepts for every other real caller in this codebase. */
const SESSION_LIMITS: SessionLimits = { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 2.0 };

type OutputSchema = NonNullable<SessionRequest['outputSchema']>;

/** One JSON schema per real, structured-output-reading phase (`loop.ts`'s own `stringField`/
 * `stringArrayField` reads, enumerated directly against its source) — `'fix'` has none: that phase's
 * own `SessionResult.structured` is synthesised by `runFixSession` below from a real `git diff`, never
 * asked of the session itself. `Partial`, not a total `Record` narrowed to the non-`'fix'` phases —
 * tried directly, and reverted: `RcaSessionRequest.phase` (a discriminated union re-imported across a
 * real `@forge/engine` → `@forge/cli` project-reference boundary) does not narrow at all under this
 * package's own *standalone* `tsc -p packages/cli/tsconfig.json --noEmit` — the real check `pnpm
 * typecheck`'s own `turbo run typecheck` actually runs, confirmed directly to differ from `tsc --build`'s
 * own, more permissive cross-project inference — regardless of whether the narrowing is written as a
 * ternary or an `if`/`else` statement. `OUTPUT_SCHEMAS[request.phase]` below is still provably always
 * defined at its one real call site (`buildRunSession`'s own routing never reaches `runReadOnlySession`
 * for `'fix'`), just not provable *to the type checker* across this specific boundary — a real,
 * disclosed branch, not a silently-narrowed one. */
const OUTPUT_SCHEMAS: Partial<Record<RcaSessionRequest['phase'], OutputSchema>> = {
  isolate: {
    type: 'object',
    properties: { command: { type: 'string' }, scope: { type: 'string' } },
  },
  hypothesise: {
    type: 'object',
    properties: { claims: { type: 'array', items: { type: 'string' } } },
    required: ['claims'],
  },
  falsify: {
    type: 'object',
    properties: { refuted: { type: 'boolean' }, refutedBy: { type: 'string' } },
  },
  diagnose: {
    type: 'object',
    properties: { why: { type: 'string' }, satisfiesStopRule: { type: 'boolean' } },
  },
  prevent: {
    type: 'object',
    properties: {
      actions: { type: 'array', items: { type: 'string' } },
      // A fresh critic round reproduced directly that `loop.ts:541` reads `kbWrites` from this exact
      // same PREVENT session's own structured output (`kb_writes: stringArrayField(preventStructured,
      // 'kbWrites')`) — omitted here, it silently stayed `[]` in every real RCA record forever.
      kbWrites: { type: 'array', items: { type: 'string' } },
    },
  },
};

/** FIX's own real output schema — unlike every other phase, this session both writes real files *and*
 * reports structured JSON in the same turn (`SessionRequest.tools`/`outputSchema` are independent
 * fields; nothing about granting write tools prevents also requesting a final structured response).
 * `diff` is deliberately absent: `runFixSession` always overwrites it with a real, computed `git diff`,
 * never trusts the session's own self-report of what it changed. A fresh critic round reproduced
 * directly that omitting this schema entirely (the first draft's choice, reasoning the diff was
 * synthesised anyway) meant `loop.ts:439`'s own `description` read and `:493`'s own `blastRadius` read
 * could never see real data — every recorded RCA's own `fix`/`blast_radius` fields silently fell back
 * to `rootCause`/`[]` on every real run, not just a hypothetical one. */
const FIX_OUTPUT_SCHEMA: OutputSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    blastRadius: { type: 'array', items: { type: 'string' } },
  },
};

export interface DebugDeps {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  readonly adapter: PlatformAdapter;
  readonly checksRoot: string;
  readonly agentsRoot: string;
}

export interface DebugOptions {
  readonly clock?: Clock;
  /** `runRcaLoop`'s own optional cost ceiling — omitted means no cost-based escalation, only the real
   * wall-clock bound (`bounds.ts`'s own `WALL_CLOCK_MS`) applies. */
  readonly costBudgetUsd?: number;
}

/** `runRcaLoop`'s own three real outcomes, plus the real ids this piece allocates for a `'recorded'`
 * one — never collapsed into a generic success/failure, matching `RcaLoopResult`'s own doc comment
 * ("the CLI layer decides what to *do* with each outcome... this function only ever reports what
 * happened"). */
export type DebugResult =
  | { readonly outcome: 'recorded'; readonly defectId: string; readonly rcaId: string }
  | {
      readonly outcome: 'needs-more-evidence';
      readonly defectId: string;
      readonly instrumentationPlan: readonly string[];
    }
  | {
      readonly outcome: 'escalated';
      readonly defectId: string;
      readonly reason: string;
      readonly evidence: RcaEvidenceBundle;
    };

// --- Defect scaffolding (unchanged from before this piece) ------------------------------------------

async function scaffoldDefect(
  paths: ProjectPaths,
  reportsRoot: string,
  clock: Clock,
  observed: string,
  affected: readonly string[],
): Promise<ArtifactDocument> {
  const allocator = getSharedIdAllocator(paths, clock);
  const id = await allocator.allocate('Defect');
  const pathResult = renderArtifactPath('Defect', { id });
  if (!pathResult.success) {
    throw new ForgeError('CFG-001', { path: 'Defect', line: 0 });
  }
  // `Defect`'s own registered `pathTemplate` ('reports/defects/{id}.md') names a literal `reports/`
  // top-level segment matching `ForgeConfig.paths.reports`'s own namespace label — the identical
  // "strip the registered top-level label, reroot under the real configured path" `forge adr new`
  // already does for `kb/`.
  const relativePath = `${reportsRoot}/${pathResult.path.replace(/^reports\//, '')}`;

  const templateText = await readArtifactTemplate('Defect');
  const today = clock.now().slice(0, 10);
  const doc = ArtifactDocument.parse(templateText, relativePath);
  doc.set(['id'], id);
  doc.set(['title'], observed.slice(0, 80));
  doc.set(['created'], today);
  doc.set(['updated'], today);
  doc.set(['first_seen'], today);
  doc.set(['observed'], observed);
  if (affected.length > 0) doc.set(['affected'], affected);

  await writeArtifact(paths, doc);
  return doc;
}

/** The real, chronologically *first* `StepFailed` event in the log — not derived from
 * `RunState.stepStatuses`' own map (whose iteration order is scheduling order, not failure order): a
 * critic round caught the original version picking "whichever failed step this run's plan happened to
 * schedule first," an arbitrary, scheduling-order-dependent choice on a run where more than one
 * concurrent step genuinely failed, not necessarily the one that actually failed first or is the real
 * root cause. Scanning the append-only log itself in its own real, durable order (`18` §18.4) is what
 * makes "the first one to fail" an honest claim about what happened, not an accident of plan shape. */
async function findFailedStep(
  projectRoot: string,
  runId: string,
): Promise<{ readonly stepId: string; readonly message: string }> {
  for await (const event of readEvents(projectRoot, runId)) {
    if (event.type !== 'StepFailed' || event.stepId === undefined) continue;
    const payload = event.payload as { readonly message?: unknown } | undefined;
    const message =
      typeof payload?.message === 'string' ? payload.message : `step ${event.stepId} failed`;
    return { stepId: event.stepId, message };
  }
  throw new ForgeError('RUN-057', { runId });
}

// --- real session wiring: read-only for every phase but FIX -----------------------------------------

async function runReadOnlySession(
  ctx: RunEngineContext,
  lane: LaneHandle,
  baseSha: string,
  agent: AgentDefinition,
  request: RcaSessionRequest,
): Promise<SessionResult> {
  // A fresh critic round reproduced this directly: `loop.ts`'s own hash-colliding-FIX-attempt back
  // edge (`if (hashCollision) continue;`) returns straight to a fresh ISOLATE round with *no* reset of
  // its own — only `runFixSession` ever reset the lane, and only at the top of its *own* next call.
  // Every read-only phase of the fresh round then ran against a lane still holding the rejected
  // attempt's own uncommitted changes, contradicting this file's own header doc comment ("ISOLATE/
  // PROVE's own runShell calls see... the lane's *current* real state" was meant to mean "the real,
  // unpolluted state," not "whatever a since-rejected attempt happened to leave behind"). Resetting
  // unconditionally here too — the identical harmless-no-op-when-already-clean call `runFixSession`
  // already makes — is what actually guarantees every phase but an in-progress FIX attempt's own
  // PROVE check always sees a real, pristine lane.
  await resetLaneWorktree(lane, baseSha);
  const abortController = new AbortController();
  const stepId = `debug:${request.phase}`;
  const sessionRequest: SessionRequest = {
    runId: ctx.runId,
    stepId,
    cwd: lane.path,
    systemPrompt: { mode: 'append', text: '' },
    prompt: request.prompt,
    model: ctx.model,
    tools: { ...ctx.tools, write: false },
    permissionMode: 'deny-unlisted',
    limits: SESSION_LIMITS,
    env: {},
    // `exactOptionalPropertyTypes`: an explicit `outputSchema: undefined` is not the same as omitting
    // the key, so this only ever adds the key when a real schema exists for `request.phase`.
    ...(OUTPUT_SCHEMAS[request.phase] === undefined
      ? {}
      : { outputSchema: OUTPUT_SCHEMAS[request.phase] }),
    abortSignal: abortController.signal,
  };
  await ctx.telemetry.emit({
    type: 'SessionStarted',
    stepId,
    agentId: agent.id,
    payload: { phase: request.phase },
  });
  const handle = await ctx.adapter.startSession(sessionRequest);
  const session = await handle.result();
  await ctx.telemetry.emit({
    type: 'SessionEnded',
    stepId,
    agentId: agent.id,
    payload: { phase: request.phase, ok: session.ok },
  });
  return session;
}

/** `git diff <ref>` (one-ref form) alone never reports a genuinely *untracked* file — confirmed
 * directly: a brand-new file a FIX session's own write tool just created is invisible to it until
 * staged, unlike a modification to an already-tracked file. `git add -A` first (the identical staging
 * `commitInLane` already does before its own commit) makes a real, newly-created file show up as a
 * real addition too — staging, never committing, so a rejected attempt's `resetLaneWorktree` (`git
 * reset --hard` + `git clean -fd`) still discards it cleanly either way.
 *
 * The trailing `\n` is restored explicitly — a fresh critic round reproduced directly that
 * `runShellCommand`'s own `stdout` (`execa`'s default behaviour) strips exactly one trailing newline,
 * so the real `git diff` output this reads is missing the newline a well-formed unified-diff patch
 * needs after its own final content line; `applyDiff` below (`git apply`) rejected the un-restored
 * text outright as "corrupt patch," confirmed directly against the real fix-tracking round-trip this
 * function's own result now has to survive that `realDiff`'s original, `commitInLane`-only caller never
 * needed to. A no-op when the diff is empty (nothing to terminate). */
async function realDiff(cwd: string, baseSha: string): Promise<string> {
  await runShellCommand('git add -A', cwd);
  const result = await runShellCommand(`git diff --no-color ${baseSha}`, cwd);
  return result.stdout === '' ? '' : `${result.stdout}\n`;
}

/** Applies `diff` (a real, unified-diff-format `git diff` result — `realDiff`'s own output) to a lane
 * already reset to `baseSha` — real `execa` with `input`, not `runShellCommand`, since a diff is
 * arbitrary, multi-megabyte-capable text no shell-string interpolation should ever carry. The one, real
 * reason this exists at all: PROVE (`loop.ts`'s own FIX-attempt loop) runs `deps.runShell('forge test
 * run', deps.cwd)` *inside the same lane* to verify an accepted fix, and that command's own real,
 * ordinary side effects (`docs/forge/reports/test-results.json`/`flaky.json`, a real vitest cache under
 * `node_modules/.vite/`) are not gitignored by every real target project — a fresh critic round
 * reproduced directly that `commitInLane`'s own unconditional `git add -A` staged all of them alongside
 * the real fix, committing test-harness bookkeeping into what F-DEBUG-1's own "a real fix committed to
 * a real lane" promises is just the fix. Resetting the lane back to `baseSha` and re-applying *only*
 * the one, exact diff `fixState.lastDiff` tracked (`runFixSession`'s own doc comment) — right before
 * the real commit, never before PROVE itself runs — is what makes the final commit contain exactly, and
 * only, the real code change PROVE already verified, discarding every real side effect PROVE's own
 * verification step left behind. */
async function applyDiff(lane: LaneHandle, diff: string): Promise<void> {
  await execa('git', ['apply'], { cwd: lane.path, input: diff });
}

/** The most recent real, non-empty diff a FIX attempt produced — mutated by `runFixSession`, read
 * back once by `runDebugLoop` on a `'recorded'` outcome. Exists because `loop.ts` itself never
 * returns the accepted diff's own text anywhere in `RcaLoopResult` (`RcaRecordDraft` has no `diff`
 * field of its own — it was never meant to carry one, `types.ts`'s own doc comment already establishes
 * it as generic-bookkeeping-minus content only) — this is the one, real place that text still exists
 * by the time `runRcaLoop` returns, and the only way `runDebugLoop` can later re-apply *exactly* that
 * fix (see its own doc comment) rather than committing whatever the lane happens to currently hold. */
interface FixState {
  lastDiff: string | undefined;
}

/** FIX (`13` §13.2 step 7) — the one phase that actually writes real files, into a real lane, per
 * `RcaLoopDeps`'s own doc comment. Every attempt starts by resetting the lane back to `baseSha`
 * (`resetLaneWorktree`) *before* running its own session — a harmless no-op on the first attempt, and
 * exactly what undoes a *rejected* previous attempt's own changes before the next one runs, since
 * `loop.ts` gives this function no separate "please revert" signal of its own: it simply calls
 * `runSession` again for the next attempt. The session both writes real files *and* reports real
 * structured JSON in the same turn (`FIX_OUTPUT_SCHEMA`) — `diff` is never trusted from the session's
 * own self-report; this function always overwrites it with a real, computed `git diff` against
 * `baseSha`, the same `{ diff }` shape `loop.ts`'s own `stringField(structured, 'diff')` already
 * expects, so a fix attempt with no real, non-empty diff degrades to `loop.ts`'s own existing "(no diff
 * proposed)" handling rather than a synthesised lie. `fixState.lastDiff` is updated on every real,
 * non-empty diff — including a later-rejected one, deliberately: by the time `runRcaLoop` finally
 * returns `'recorded'`, the *last* attempt this function ever ran is, by `loop.ts`'s own control flow,
 * necessarily the one that got accepted (a reset always precedes the *next* attempt, so a rejected
 * attempt's own diff is never still the *most recent* one by the time the loop actually stops). */
async function runFixSession(
  ctx: RunEngineContext,
  lane: LaneHandle,
  baseSha: string,
  fixState: FixState,
  agent: AgentDefinition,
  prompt: string,
): Promise<SessionResult> {
  await resetLaneWorktree(lane, baseSha);

  const abortController = new AbortController();
  const stepId = 'debug:fix';
  const sessionRequest: SessionRequest = {
    runId: ctx.runId,
    stepId,
    cwd: lane.path,
    systemPrompt: { mode: 'append', text: '' },
    prompt,
    model: ctx.model,
    tools: { ...ctx.tools, write: true },
    permissionMode: 'accept-edits',
    limits: SESSION_LIMITS,
    env: {},
    outputSchema: FIX_OUTPUT_SCHEMA,
    abortSignal: abortController.signal,
  };
  await ctx.telemetry.emit({
    type: 'SessionStarted',
    stepId,
    agentId: agent.id,
    payload: { phase: 'fix' },
  });
  const handle = await ctx.adapter.startSession(sessionRequest);
  const session = await handle.result();
  await ctx.telemetry.emit({
    type: 'SessionEnded',
    stepId,
    agentId: agent.id,
    payload: { phase: 'fix', ok: session.ok },
  });

  if (!session.ok) return session;
  const diff = await realDiff(lane.path, baseSha);
  if (diff.trim() === '') return { ...session, structured: undefined };
  fixState.lastDiff = diff;
  const reported =
    typeof session.structured === 'object' && session.structured !== null
      ? (session.structured as Readonly<Record<string, unknown>>)
      : {};
  return { ...session, structured: { ...reported, diff } };
}

function buildRunSession(
  ctx: RunEngineContext,
  lane: LaneHandle,
  baseSha: string,
  fixState: FixState,
  agent: AgentDefinition,
): RcaLoopDeps['runSession'] {
  return (request) =>
    request.phase === 'fix'
      ? runFixSession(ctx, lane, baseSha, fixState, agent, request.prompt)
      : runReadOnlySession(ctx, lane, baseSha, agent, request);
}

// --- RECORD (13 §13.2 step 10) and closing the source Defect -----------------------------------------

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'rca'
  );
}

async function recordRca(
  deps: DebugDeps,
  record: RcaRecordDraft,
  agent: AgentDefinition,
  clock: Clock,
): Promise<string> {
  const allocator = getSharedIdAllocator(deps.paths, clock);
  const id = await allocator.allocate('RCA');
  const slug = slugify(record.title);
  const pathResult = renderArtifactPath('RCA', { id, slug });
  if (!pathResult.success) {
    throw new ForgeError('CFG-001', { path: 'RCA', line: 0 });
  }
  const relativePath = `${deps.config.paths.sessions}/${pathResult.path.replace(/^sessions\//, '')}`;

  const templateText = await readArtifactTemplate('RCA');
  const today = clock.now().slice(0, 10);
  const doc = ArtifactDocument.parse(templateText, relativePath);
  doc.set(['id'], id);
  doc.set(['title'], record.title);
  doc.set(['created'], today);
  doc.set(['updated'], today);
  doc.set(['author'], agent.id);
  doc.set(['defect'], record.defect);
  doc.set(['severity'], record.severity);
  doc.set(['symptom'], record.symptom);
  doc.set(['reproduction'], record.reproduction);
  doc.set(['timeline'], record.timeline);
  doc.set(['hypotheses'], record.hypotheses);
  doc.set(['root_cause'], record.root_cause);
  doc.set(['causal_chain'], record.causal_chain);
  doc.set(['fix'], record.fix);
  doc.set(['prevention'], record.prevention);
  doc.set(['blast_radius'], record.blast_radius);
  doc.set(['kb_writes'], record.kb_writes);
  doc.set(['time_to_diagnose_min'], record.time_to_diagnose_min);

  await writeArtifact(deps.paths, doc);
  return id;
}

/** `open-sev1-sev2-defects`/`unresolved-rca` (`validate-rules.ts`) anchor on the one real, confirmed
 * spelling — `'open'` means open, anything else means closed (that file's own doc comment: no enum
 * exists for `Defect.status`, and nothing before this piece ever wrote a real closed value at all,
 * which is exactly the structural gap this call closes, `SPEC-QUESTIONS.md` Q124). */
const CLOSED_DEFECT_STATUS = 'closed';

async function closeDefect(deps: DebugDeps, defect: ArtifactDocument, clock: Clock): Promise<void> {
  const today = clock.now().slice(0, 10);
  defect.set(['status'], CLOSED_DEFECT_STATUS);
  defect.bumpRevision('forge debug', 'Closed: RCA recorded.', today);
  await writeArtifact(deps.paths, defect);
}

// --- the real loop, shared by both public entry points -----------------------------------------------

async function runDebugLoop(
  deps: DebugDeps,
  defect: ArtifactDocument,
  options: DebugOptions,
): Promise<DebugResult> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const defectId = defect.get(['id']) as string;
  const agent = await loadProjectAgent(deps.paths, deps.agentsRoot, DIAGNOSTICIAN_AGENT_ID);

  const runId = `debug-${clock.now().replace(/[^0-9]/g, '')}`;
  const runCtx = await buildRunEngineContext({
    paths: deps.paths,
    projectRoot: deps.projectRoot,
    config: deps.config,
    runId,
    adapter: deps.adapter,
    checksRoot: deps.checksRoot,
    agentsRoot: deps.agentsRoot,
    clock,
  });

  const baseSha = await resolveRevision(deps.projectRoot, runCtx.integrationBase);
  const lane = await createLaneWorktree(deps.projectRoot, {
    runId,
    stepId: DEBUG_LANE_STEP_ID,
    integrationBase: runCtx.integrationBase,
  });

  // `evidence` defaults to `[]` and `expected` defaults to the `Defect.md` template's own placeholder
  // text unless a caller already set them — a bare symptom string (`debugSymptom`) or a failed step's
  // own message (`debugFromFailure`) carries no real "what should have happened instead" of its own,
  // matching `scaffoldDefect`'s own doc comment: every field free text alone cannot supply is left as
  // the template's own authorable placeholder, exactly as `forge adr new` already leaves every ADR
  // field it has no real input for. `13` §13.2 step 1's own INTAKE only refuses on a genuinely *empty*
  // pair, not a placeholder one — a real, disclosed limitation (`SPEC-QUESTIONS.md`), not a silent gap:
  // the ISOLATE-phase session works out real "expected" behaviour from `observed`/`evidence` context,
  // the same way a real diagnostician colleague, handed a bug report with only "what happened," still
  // gets underway.
  // `evidence` is a required, non-optional array in `defectSchema` (never `undefined`) — `defect` only
  // ever reaches here having already passed `ArtifactDocument.parse`'s own eager validation, so no
  // `?? []` fallback is needed (or reachable): a real schema guarantee, not an assumption.
  const defectContext: DefectContext = {
    defectId,
    observed: defect.get(['observed']) as string,
    expected: defect.get(['expected']) as string,
    severity: defect.get(['severity']) as DefectContext['severity'],
    evidence: defect.get(['evidence']) as readonly string[],
  };

  const fixState: FixState = { lastDiff: undefined };
  const loopDeps: RcaLoopDeps = {
    runSession: buildRunSession(runCtx, lane, baseSha, fixState, agent),
    runShell: (command, cwd) => runShellCommand(command, cwd),
    clock,
    // `runCtx.now` is already a real, clock-derived epoch-millis source (`buildRunEngineContext`'s own
    // `Date.parse(clock.now())`) — reused rather than a second, independent `Date.now()` read
    // (`QUALITY-BAR.md` R10: no direct `Date.now()`/`crypto.randomUUID()` in production code).
    now: runCtx.now,
    cwd: lane.path,
  };

  let recorded = false;
  try {
    const result = await runRcaLoop(defectContext, loopDeps, options.costBudgetUsd);

    if (result.outcome === 'recorded') {
      recorded = true;
      // `loop.ts` only ever reaches `'recorded'` once its own FIX-attempt loop `break`s on a real,
      // proved fix (`fixed !== undefined`) — `fixState.lastDiff` is set on every accepted attempt's own
      // real, non-empty diff, so it is always defined here; a genuine internal-invariant violation
      // (never yet observed) fails loudly rather than silently committing whatever the lane's own,
      // possibly-PROVE-polluted working state currently holds.
      if (fixState.lastDiff === undefined) {
        throw new Error(
          'forge debug: internal invariant violated — runRcaLoop reported "recorded" with no tracked fix diff.',
        );
      }
      await resetLaneWorktree(lane, baseSha);
      await applyDiff(lane, fixState.lastDiff);
      const rcaId = await recordRca(deps, result.record, agent, clock);
      await commitInLane(lane, {
        message: formatCommitMessage({
          scope: defectId,
          subject: result.record.title,
          stepId: DEBUG_LANE_STEP_ID,
          runId,
          agentRole: DIAGNOSTICIAN_AGENT_ID,
        }),
        sign: deps.config.vcs.signCommits,
      });
      await closeDefect(deps, defect, clock);
      return { outcome: 'recorded', defectId, rcaId };
    }

    if (result.outcome === 'needs-more-evidence') {
      return {
        outcome: 'needs-more-evidence',
        defectId,
        instrumentationPlan: result.instrumentationPlan,
      };
    }
    return { outcome: 'escalated', defectId, reason: result.reason, evidence: result.evidence };
  } finally {
    // A `'recorded'` outcome's own lane holds a real, committed fix — always kept for review/merge
    // (the identical "real, unbounded, disk accumulates, forge doctor's own remit" accepted trade-off
    // `forge review`'s own header already discloses for its own telemetry directories). `recorded`
    // is set *before* the record/commit/close sequence below runs, not after: a failure partway
    // through that sequence leaves real, partially-recorded work behind, which must never be silently
    // discarded by this cleanup either (the identical "residual risk, not fully solved" limitation
    // `adrSupersede`'s own doc comment already accepts for its own two-write sequence). Every other
    // outcome — `escalated`, `needs-more-evidence`, or a hard INTAKE/HYPOTHESISE/PREVENT refusal
    // thrown mid-loop (`loop.ts`'s own `refuse`, `RUN-060`) — has nothing real worth keeping: reset
    // any dangling fix attempt and remove the lane, following the same `retainLaneWorktrees` policy
    // every other engine step already honours for a failed step.
    if (!recorded) {
      await resetLaneWorktree(lane, baseSha);
      await removeLaneWorktree(deps.projectRoot, lane, { retain: runCtx.retainLaneWorktrees });
    }
  }
}

// --- public entry points ------------------------------------------------------------------------------

/** `13` §13's own real intake normalisation, for a bare symptom string alone. */
export async function debugSymptom(
  deps: DebugDeps,
  symptom: string,
  options: DebugOptions = {},
): Promise<DebugResult> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const defect = await scaffoldDefect(deps.paths, deps.config.paths.reports, clock, symptom, []);
  return runDebugLoop(deps, defect, options);
}

/** `--from-failure <runId>`: the real `observed` text and `affected` step come from the run's own
 * durable event log — the same `readEvents` replay `forge status`/`forge lanes` already use. */
export async function debugFromFailure(
  deps: DebugDeps,
  runId: string,
  options: DebugOptions = {},
): Promise<DebugResult> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const { stepId, message } = await findFailedStep(deps.projectRoot, runId);
  const defect = await scaffoldDefect(deps.paths, deps.config.paths.reports, clock, message, [
    stepId,
  ]);
  return runDebugLoop(deps, defect, options);
}
