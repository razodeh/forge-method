/**
 * `@forge/engine/dispatch` — `10` §10.1's step-kind table made runnable: `executeStep` dispatches a
 * compiled `StepNode` (`@forge/engine/plan`, P10/P11) to the right handler, wiring together `@forge/vcs`
 * (lanes, claim enforcement, merge queue), `@forge/telemetry` (the event log), `@forge/adapter-kit` (agent
 * sessions), and `@forge/engine/gates` (P14) into one call.
 *
 * Five of `10` §10.1's own nine *runtime* kinds have real handlers here (`agent`, `command`, `gate`,
 * `merge`, `checkpoint`); a sixth, `session`, has a real handler one layer up, in
 * `@forge/engine/interaction`'s own `runSessionStep` (`PLAN-M10.md` P10) — `execute.ts`'s own `dispatch`
 * calls it directly rather than adding it to this file's own five, since it needs `16`'s own facilitated-
 * session machinery (`@forge/sessions`) this file has no reason to import. `elicit`/`subworkflow` still
 * need infrastructure this milestone does not build (a real interactive human-input channel; recursive
 * workflow invocation) and are refused with a specific, actionable error (`RUN-039`) rather than silently
 * mishandled — the identical "visibly has none" standard `SPEC-QUESTIONS.md` Q62 already holds this whole
 * milestone to for agent/role resolution. `fanout`/`parallel`/`sequence` never reach this module at all:
 * `@forge/engine/plan`'s own `compilePlan` (P10) structurally excludes them from ever producing a
 * `StepNode` of their own kind (confirmed directly in `compile.ts`).
 *
 * @see specs/06 §6.4, §6.7, §6.8
 * @see specs/10 §10.1
 * @see specs/18 §18.4
 * @see specs/20 §20.10
 * @see PLAN-M5.md P15
 */
import type { AbsolutePath, ProjectPaths } from '@forge/core';
import type { PlatformAdapter, SessionResult, ToolGrant } from '@forge/adapter-kit';
import type { Escalation } from '@forge/extensions/agents';
import type { StyleProfile } from '@forge/extensions/style';
import type { AgentDefinition } from '@forge/agents/schema';
import type { KbIndexBackend, KbTree } from '@forge/kb';
import type { ForgeConfig } from '@forge/schemas/config';
import type { ForgeEvent, EventType } from '@forge/telemetry/events';

import type { GateDefinition, GateReport } from '../gates/index.ts';
import type { StepNodeKind } from '../plan/index.ts';

/** `@forge/vcs`'s own `LaneHandle` (`lanes.ts`), re-declared structurally rather than imported: this
 * module's own public surface should not force every consumer of `@forge/engine/dispatch` to also resolve
 * `@forge/vcs`'s own branded `LaneId` type, and nothing here needs anything beyond these three fields
 * structurally. Any real `LaneHandle` from `@forge/vcs` already satisfies this shape. */
export interface LaneHandle {
  readonly laneId: string;
  readonly path: string;
  readonly branch: string;
}

/** The thin seam over `@forge/vcs`'s own lane/claim functions — "this piece has no opinion on the real
 * mechanism, only on how to interpret its result," the identical stance `@forge/engine/gates`' own
 * `CheckRunner` (P14) and `@forge/engine/scheduler`'s own `resourceClassOf` (P12) already take. A real
 * implementation (`createVcsFacade`, `facades.ts`) wraps `@forge/vcs`'s real functions directly, bound to
 * one `(projectRoot, runId)` pair; nothing about the *shape* here requires that — a test could substitute
 * a different one — but every real test in this package still exercises a real tmp-dir git repository
 * through the real implementation, matching this piece's own Checks text ("a real tmp-dir lane"), not a
 * hand-rolled fake of git itself. */
export interface VcsFacade {
  createLane(stepId: string, integrationBase: string): Promise<LaneHandle>;
  removeLane(handle: LaneHandle, retain: boolean): Promise<void>;
  commit(handle: LaneHandle, message: string, sign: boolean): Promise<{ readonly sha: string }>;
  resolveRevision(ref: string): Promise<string>;
  /** Whether `handle`'s own worktree differs from `baseSha` at all — a `command`-kind step's own work
   * callback (`steps.ts`) has no cheaper, already-computed signal the way an agent session's own
   * `SessionResult.changedFiles` is: an arbitrary shell command's stdout/exit code say nothing about
   * which files, if any, it touched. Checked before committing so a command that legitimately made no
   * changes (a validation-only command, say) succeeds without one, the same as a no-op agent session
   * already does — not attempting a real `git commit` against an empty diff and treating the resulting
   * "nothing to commit" failure as though the step itself had gone wrong. */
  hasChanges(handle: LaneHandle, baseSha: string): Promise<boolean>;
  /** The files a lane produced against `baseSha`, split by whether they reached the lane branch: `committed`
   * is what `baseSha..HEAD` changed (added, modified or deleted -- exactly what a later merge would carry
   * into the integration branch), `uncommitted` what exists only in the worktree or index (never merged).
   * The output contract check (`outputs.ts`, `PLAN-M13.md` P7) reads the committed set: an artifact that
   * never reached the branch is not a produced output, whatever the worktree holds. */
  changedFiles(
    handle: LaneHandle,
    baseSha: string,
  ): Promise<{
    readonly committed: readonly string[];
    readonly uncommitted: readonly string[];
    /** The subset of `committed` whose entry at `HEAD` is a symlink or a submodule rather than a regular file.
     * A declared output's registry path is inside the step's claim (`06` §6.7, P14), so claim enforcement
     * keeps such an entry there; the output check refuses it (`outputs.ts`). Absent means none. */
    readonly nonRegular?: readonly string[];
  }>;
  /** The content of `file` (repo-relative) at `revision` (`'HEAD'` or a resolved sha) in the lane's
   * repository, read from the git object database -- never from the worktree, so an uncommitted edit cannot
   * stand in for what would merge. `undefined` when the file does not exist at that revision (an added file's
   * base, a deleted file's head) or is not a regular file there (a symlink or submodule entry). */
  readAtRevision(handle: LaneHandle, revision: string, file: string): Promise<string | undefined>;
  enforceClaim(
    handle: LaneHandle,
    baseSha: string,
    declaredGlobs: readonly string[],
    policy: 'strict' | 'warn',
  ): Promise<{ readonly outOfClaim: readonly string[]; readonly reverted: readonly string[] }>;
}

/** `runId`/`ts` are never supplied by a caller of `emit` itself — bound once at construction
 * (`createTelemetryFacade`, `facades.ts`) to the run this `ExecuteStepContext` belongs to, and to the
 * injected clock (`ExecuteStepContext.now`) every other timestamp-shaped value in this module already
 * uses, never `Date.now()` directly (`21` §21.1's determinism mandate, the same reason
 * `@forge/telemetry`'s own `ForgeEvent.ts` field is caller-supplied in the first place). */
export interface TelemetryFacade {
  emit(event: Omit<NewDispatchEvent, 'runId' | 'ts'>): Promise<ForgeEvent>;
}

/** The subset of `@forge/telemetry`'s own `NewForgeEvent` this module ever populates directly — every
 * field `TelemetryFacade.emit` itself injects (`runId`, `ts`) is omitted here rather than repeated.
 * `payload` defaults to `undefined` when omitted — `@forge/telemetry`'s own `parseEventLine` doc comment
 * already documents this as a legitimate, anticipated case ("a caller-supplied undefined payload is
 * serialised... as an absent key entirely"), not a gap this module needs to fill with an empty object at
 * every call site that has nothing meaningful to report. Every optional field spells out `| undefined`
 * explicitly, not just `?:` alone — required under this project's own `exactOptionalPropertyTypes`
 * whenever a caller (`steps.ts`) passes an already-optional upstream value (`StepNode.agent?: AgentId`)
 * straight through, rather than only ever omitting the key outright. */
export interface NewDispatchEvent {
  readonly type: EventType;
  readonly stepId?: string | undefined;
  readonly laneId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly payload?: unknown;
  readonly causedBy?: number | undefined;
}

/** Looks a gate up by the id a `gate`-kind `StepNode.gate` names and evaluates it — `10` §10.3's own
 * mechanism (`@forge/engine/gates`, P14) plus the one thing that piece deliberately left to its own
 * caller: resolving a bare gate id into a real `GateDefinition` (real gate *content* is M6's job, `Q62`
 * part 3; this module only needs *some* definition to evaluate, supplied by whoever constructs the real
 * implementation, `createGateEvaluator`). `RUN-040` if `gateId` names nothing in that registry. */
export interface GateEvaluator {
  evaluate(gateId: string, cwd: string): Promise<GateReport>;
}

/** One `@forge/vcs`-shaped merge candidate, minus the fields `MergeQueueFacade`'s own real implementation
 * already knows from its own construction (`integrationPath`, pre/post checks, a conflict resolver) —
 * structurally compatible with `@forge/vcs`'s own `MergeCandidate`, the same "re-declared, not imported"
 * choice `LaneHandle` above makes and for the identical reason. */
export interface MergeCandidateLike {
  readonly handle: LaneHandle;
  readonly stepId: string;
  readonly runId: string;
  /** `@forge/vcs`'s own doc comment: a resolver needs "both lanes' intents" for a real `'agent'`/
   * `'human'` conflict resolution. `runMergeStep` (`steps.ts`) always passes `[]` here — a predecessor's
   * own declared claim (`StepNode.produces`) is not itself retained anywhere `ctx.laneRegistry` (keyed
   * only by `LaneHandle`) can still hand it to a later `merge` step. Not a bug M5 needs to close: no
   * `conflictResolver` exists yet either (`Q77`), so nothing in this milestone's own scope actually reads
   * this field — real content for both is the same later piece's job. */
  readonly declaredClaim: readonly string[];
  readonly conflictPolicy: 'agent' | 'human' | 'abort';
}

/** `@forge/vcs`'s own `MergeOutcome` discriminated union, re-declared structurally for the identical
 * "do not force every consumer to resolve `@forge/vcs`'s own types" reason `LaneHandle` above already
 * gives. */
export type MergeOutcome =
  | { readonly kind: 'clean'; readonly mergeCommitSha: string }
  | { readonly kind: 'conflict-resolved'; readonly mergeCommitSha: string }
  | {
      readonly kind: 'conflict-unresolved';
      readonly reason: 'abort-policy' | 'resolver-unresolved';
    }
  | {
      readonly kind: 'pre-check-failed';
      readonly checkResult: { readonly passed: boolean; readonly summary: string };
    }
  | {
      readonly kind: 'post-check-failed-reverted';
      readonly checkResult: { readonly passed: boolean; readonly summary: string };
      readonly revertCommitSha: string;
    };

/** A single command string each, mirroring `MergePolicy.preChecks`/`postChecks` (`@forge/engine/workflow`)
 * exactly — a merge step's own declared policy, not a per-run constant, so `MergeQueueFacade.process`
 * takes these per call rather than a real implementation baking one fixed pair in at construction. */
export interface MergeCandidateChecks {
  readonly preCheck?: string | undefined;
  readonly postCheck?: string | undefined;
}

export interface MergeQueueFacade {
  process(candidate: MergeCandidateLike, checks: MergeCandidateChecks): Promise<MergeOutcome>;
}

/** One open view of a project's Knowledge Body for one context-pack build (`05` §5.4): the parsed tree
 * plus the search index over it. `close` releases the index handle -- the pack build is synchronous once
 * its inputs are in hand, so a caller opens, packs and closes within one assembly. */
export interface KbAccess {
  readonly backend: KbIndexBackend;
  readonly tree: KbTree;
  /** Files under the KB root that failed to parse. Reported in the step's context manifest so a
   * malformed entry that never reached the pack is visible rather than silently absent. */
  readonly parseErrorCount: number;
  close(): void;
}

/**
 * Everything dispatch needs to turn an agent step into a real `SessionRequest` (`PLAN-M13.md` P5): load
 * the agent, load the brief/prompt text, pack KB context, resolve the grant and model, compile `05`
 * §5.3's nine blocks and write the mandatory audit record. Every field is required on purpose -- an
 * optional one is exactly how the prior "pass the raw brief path through" behaviour stayed reachable.
 * `createPromptAssemblyContext` builds the real thing; tests build small fixtures in their own helpers.
 */
export interface PromptAssemblyContext {
  /** Where `.forge/state/runs/<runId>/steps/<stepId>/{prompt.md,context.json}` are written. */
  readonly paths: ProjectPaths;
  /** The project's own resolved agent `agentId`, or a `ForgeError` (`RUN-056`) when it has none. */
  readonly loadAgent: (agentId: string) => Promise<AgentDefinition>;
  /** Real text for a `briefs/<name>.md` / `prompts/<name>.md` reference (`@forge/agents/prompt`'s
   * `resolveContentReference`); throws a `ForgeError` (`CFG-053`/`RUN-079`) rather than returning empty. */
  readonly loadContent: (reference: string) => Promise<string>;
  readonly openKb: () => Promise<KbAccess>;
  /** `.forge/config.yaml`'s `models` block: `05` §5.8's tier -> model table and per-agent overrides. */
  readonly models: ForgeConfig['models'];
  /** `security.toolCeilingEscalations`, already validated into the real shape. */
  readonly escalations: readonly Escalation[];
  readonly autonomy: 'supervised' | 'guided' | 'autonomous';
  readonly kbPackBudgetTokens: number;
  readonly skillsPackBudgetTokens: number;
  readonly templatesPackageRoot: AbsolutePath;
  /** `05` §5.4 point 1's pinned-core items that come from config rather than the KB. */
  readonly pinnedCore: { readonly projectIdentity?: string; readonly level?: string };
  readonly styleProfile?: StyleProfile | undefined;
}

/** Everything one `executeStep` call needs beyond the `StepNode` itself — `PLAN-M5.md`'s own Surface text
 * shows `{ adapter, vcs, telemetry, gates, mergeQueue }` alone, undersold relative to what a real call
 * needs to actually reach `createLaneWorktree`/`appendEvent`/`startSession` at all (a run id, a project
 * root, an integration branch/worktree, a model, a tool grant, an injected clock, a shared lane registry)
 * — the same "the plan's own bullet undersells what the signature needs" correction this package has
 * already made once per piece for several pieces running (`Q70`/`Q71`/`Q73`/`Q75`/`Q76`). Bundled into
 * `ctx` rather than added as separate `executeStep` parameters because every one of them is a *per-run*
 * constant (fixed for the life of one run, unlike `node`, which changes on every call) — the same
 * "everything this call needs beyond the step itself" framing the plan's own bullet already uses to
 * justify `ctx` existing at all. */
export interface ExecuteStepContext {
  readonly adapter: PlatformAdapter;
  readonly vcs: VcsFacade;
  readonly telemetry: TelemetryFacade;
  readonly gates: GateEvaluator;
  readonly mergeQueue: MergeQueueFacade;
  readonly runId: string;
  /** The real, on-disk repository root — `createLaneWorktree`'s own `cwd`. */
  readonly projectRoot: string;
  /** The ref lanes branch from, e.g. `"main"` or `"forge/integration/P3"` (`06` §6.4). */
  readonly integrationBase: string;
  /** An existing worktree already checked out on `integrationBase` — `@forge/vcs`'s own
   * `processMergeCandidate` requires a caller-maintained one; creating/maintaining it across a whole run
   * is out of this module's own scope (a later piece's concern), only *using* one it is handed is not. */
  readonly integrationPath: string;
  /** One fixed model for sessions that are *not* agent-step dispatch: `forge debug`'s own ad-hoc RCA
   * sessions (`packages/cli/src/commands/loop/debug.ts`), which still build their own `SessionRequest`.
   * Agent steps and interaction-mode participant sessions never read this -- they resolve a model per
   * agent from `assembly` (`05` §5.8) -- and a test proves it. */
  readonly model: string;
  /** The identical "one fixed grant" stand-in as `model` above, for the same ad-hoc sessions only. Agent
   * steps and participants resolve a per-agent grant (`resolveStepToolGrant`) and never read this. */
  readonly tools: ToolGrant;
  /** How agent steps and participant sessions become real session requests. Required, never optional. */
  readonly assembly: PromptAssemblyContext;
  /** `18` §18.3's own `execution.retainLaneWorktrees` simplified to a boolean for M5's own scope
   * (`never`/`always`; the real three-way `never | on-failure | always` policy is additive scope a later
   * piece can add without changing this shape, only what populates it). */
  readonly retainLaneWorktrees: boolean;
  readonly claimPolicy: 'strict' | 'warn';
  readonly signCommits: boolean;
  /** Injected, never `Date.now()` internally — every event this module emits, and every `StepOutcome`'s
   * own `startedAt`/`finishedAt`, reads this instead (`21` §21.1). Unlike `@forge/engine/scheduler`/
   * `backpressure`, this module is not a pure state machine (it performs real I/O — a real subprocess, a
   * real adapter session), so injecting the clock is about deterministic, testable *timestamps* on real
   * work, not about making the work itself pure. */
  readonly now: () => number;
  /** Populated by `runAgentStep`/`runCommandStep` on their own successful completion, keyed by `StepNode.
   * id`; read by `runMergeStep` to find the lane(s) its own `dependsOn` predecessors left "ready" —
   * `06` §6.4's own lane lifecycle step 4 ("on success → enqueue in merge queue") and `Q62`'s own sixth
   * note ("claim enforcement runs... before handing the lane to the merge queue") read together as two
   * separate acts, not one: an agent/command step's own job ends at a claim-enforced, ready lane; *handing*
   * it to the merge queue is a dedicated `merge`-kind step's own job, `10` §10.1's own "merge-queue
   * processing for a *set* of lanes" wording taken literally (one `merge` step can process several
   * predecessor lanes at once, not necessarily a fixed 1:1 pairing with the step that produced each). A
   * caller constructs one empty `Map` per run and reuses it across every `executeStep` call in that run. */
  readonly laneRegistry: Map<string, LaneHandle>;
  /** A `gate`-kind step names only a bare id (`StepNode.gate`) — this is the registry `GateEvaluator`
   * itself is built from (`createGateEvaluator`), listed here too since a caller constructing `ctx` is
   * exactly where a real gate catalogue (or a test's own fixture gate) is assembled. Not read by
   * `executeStep` itself — `ctx.gates` already closes over it — kept here only so a caller building `ctx`
   * has one place to see everything a run needs. */
  readonly gateRegistry: ReadonlyMap<string, GateDefinition>;
  /** `16` §16.8's own "all configurable" cost/time/round bounds for `kind: 'session'` steps
   * (`@forge/engine/interaction/session.ts`'s own `runSessionStep`, `PLAN-M10.md` P12) — a run-wide
   * knob, alongside `model`/`tools`/`retainLaneWorktrees` above, resolved from whatever configuration
   * source constructs `ctx` (a project's `forge.config`, a CLI flag, ...; no such source populates this
   * yet in this milestone's own scope — the identical "a real, wired extension point with no caller
   * yet" shape `HumanSessionInput` already is, `@forge/engine/interaction/session.ts`'s own doc
   * comment). `undefined` means every bound falls back to `16` §16.8's own literal defaults
   * (`DEFAULT_SESSION_BOUNDS`), not that no bounds apply at all — every session step is bounded
   * unconditionally, per the spec's own "on breach" rule, never opt-in. Declared here (not in
   * `interaction/session.ts`, which imports it from here instead) so this file never needs an edge
   * back into `interaction/` -- the same "sits with the context it configures" placement `model`/
   * `tools`/`retainLaneWorktrees` already have. */
  readonly sessionBounds?: SessionBounds | undefined;
  /** Environment variables layered over the parent's for every shell command a run spawns: `command`
   * steps, gate checks, merge checks (`PLAN-M13.md` P12, `Q208` finding 3). The CLI supplies a `PATH` that
   * starts with a directory holding a `forge` executable running the same CLI that launched the run, so
   * the shipped workflows' `forge kb sync` / `forge plan run-plan` / `forge spec validate` work when `forge`
   * is not installed globally (a checkout, `node .../forge.mjs`). Injected because the engine may neither
   * import the CLI nor read the ambient environment (R10); `undefined` leaves the environment untouched. */
  readonly commandEnv?: Readonly<Record<string, string>> | undefined;
  /** The project's configured documentation roots (`18` §18.3 `paths`), which the output contract check
   * (`outputs.ts`, `PLAN-M13.md` P7) roots each `18` §18.7 artifact path template under. `forge run` supplies
   * the project's own `paths` (`buildRunEngineContext`). Omitted, it defaults to `@forge/schemas`'s default
   * layout (`docs/forge/...`): the check itself never becomes optional, and a project that relocated its
   * docs but built a context without this fails loudly (a declared output is "not found") rather than
   * passing. */
  readonly docRoots?: DocRoots | undefined;
}

/** The four `paths` config keys an artifact path template's first segment names (`18` §18.7): `specs/...`,
 * `kb/...`, `sessions/...`, `reports/...`. */
export type DocRoots = Pick<ForgeConfig['paths'], 'kb' | 'specs' | 'sessions' | 'reports'>;

/** `16` §16.8's own literal bound table, all optional and independently overridable — see
 * `ExecuteStepContext.sessionBounds`'s own doc comment for how a caller supplies this. */
export interface SessionBounds {
  /** `16` §16.8: "Max rounds per phase: DIVERGE 3." */
  readonly maxDivergeRounds?: number;
  /** `16` §16.8: "Max rounds per phase: CONVERGE 2." */
  readonly maxConvergeRounds?: number;
  /** `16` §16.8: "Max participants: 5 agents + human" — threaded into `@forge/sessions`'s own
   * `SessionPhaseMachine` (`MAX_AGENT_PARTICIPANTS` by default). */
  readonly maxAgentParticipants?: number;
  /** `16` §16.8: "Max wall clock: 20 min," in milliseconds. */
  readonly maxWallClockMs?: number;
  /** `16` §16.8: "Max cost: $3." */
  readonly maxCostUsd?: number;
  /** `16` §16.8: "Idea cap in DIVERGE: 30 before forced clustering" — threaded into `@forge/sessions`'s
   * own `SessionPhaseMachine` (`DIVERGE_IDEA_CAP` by default); `PLAN-M10.md` P9 already built the
   * enforcement itself (`SessionPhaseMachine.diverge`'s own cap check) — this only makes the cap value
   * itself configurable, per `16` §16.8's own "all configurable" line, rather than duplicating the
   * enforcement a second time here. */
  readonly divergeIdeaCap?: number;
}

/** Every real handler's own failure reason, in one small, kind-independent vocabulary `06` §6.8's own
 * classification table (`PLAN-M5.md` P16, not built yet) can inspect without needing per-kind logic of its
 * own — `code` carries whatever the underlying layer's own code was (an adapter error code, a `VcsError`/
 * `TelemetryError` code, an exit code as a string, a `GateReport`'s own lack of approval has none) so P16
 * loses no information this module had. */
export interface StepFailureInfo {
  readonly source:
    | 'adapter'
    | 'vcs'
    | 'telemetry'
    | 'command'
    | 'gate'
    | 'merge'
    | 'unsupported'
    /** Prompt assembly refused the step before anything was dispatched (`PLAN-M13.md` P5): a missing
     * agent/brief, an unresolvable grant or model, a ceiling violation. `code` carries the `ForgeError`
     * code. Never retryable -- the same inputs fail identically -- see `classifyFailure`. */
    | 'prompt'
    /** The step's session ended ok but a declared `outputs` entry is absent or invalid (`PLAN-M13.md` P7,
     * `outputs.ts`). `code` is `RUN-083` (or `RUN-084` when the agent's own grant is the cause). Always
     * classified `validation` (`06` §6.8) by `classifyFailure`. */
    | 'output';
  readonly code?: string | undefined;
  readonly message: string;
  /** The real, registered `ForgeError` a `vcs`-sourced failure was wrapped into for provenance
   * (`steps.ts`'s own `runVcsStep`, `RUN-037`) — present so a caller who wants the underlying error's
   * own remedy (not just this flat summary) can still reach it, matching `RUN-037`'s own registered
   * remedy text ("check the underlying VCS error's own remedy, chained as this error's cause"). */
  readonly cause?: unknown;
}

/** The kind-specific payload every `StepOutcome` carries — always present, for both a succeeded and a
 * failed outcome, since rule 4's own audit trail (`10` §10.3) and a later retry decision (P16) both want
 * the raw underlying data regardless of which way the step went. `checkpoint` carries none of its own: `10`
 * §10.1 describes it as "force a commit + event-log flush; a safe resume point," and `@forge/telemetry`'s
 * own `appendEvent` is already `fsync`'d per call (`18` §18.10) — for M5's own scope, marking a resumable
 * point in an *already*-durable log needs no further side effect of its own; the real "does resume actually
 * work" verification is P19/P20's own piece (`StepNode.idempotencyKey`'s own doc comment already defers
 * this exact question there). */
export type StepOutcomeDetail =
  | { readonly kind: 'agent'; readonly session: SessionResult }
  | {
      readonly kind: 'command';
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly kind: 'gate'; readonly report: GateReport }
  | {
      readonly kind: 'merge';
      /** One entry per predecessor lane this step actually processed, `10` §10.1's own "merge-queue
       * processing for a *set* of lanes" taken literally — a single `MergeOutcome` cannot represent a
       * merge step with more than one `dependsOn` predecessor without silently discarding every lane's
       * outcome but one. Empty when no `dependsOn` predecessor had a registered lane to merge at all
       * (`runMergeStep`'s own "succeeds vacuously" case) — an honest empty list, not a fabricated
       * placeholder outcome for a merge that never actually happened. */
      readonly merges: readonly { readonly stepId: string; readonly outcome: MergeOutcome }[];
    }
  | { readonly kind: 'checkpoint' }
  | { readonly kind: 'unsupported'; readonly stepKind: StepNodeKind };

/** `PLAN-M5.md`'s own Surface text: "the raw result P16 (failure classification) and P12 (re-scheduling)
 * both consume." P12's own `Scheduler` needs only `stepId`/`status` (`markSucceeded`/`markFailed`); P16's
 * own `classifyFailure` needs the rest. A plain interface with a nested `detail` union, not a top-level
 * union keyed on `kind` or `status`: `stepId`/`status`/timing are always unconditionally readable without
 * narrowing first, and `detail.kind` narrows separately, for whichever of the two axes a given caller
 * actually cares about — `Scheduler` never needs to look at `detail` at all. */
export interface StepOutcome {
  readonly stepId: string;
  readonly status: 'succeeded' | 'failed';
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly detail: StepOutcomeDetail;
  /** Present exactly when `status` is `'failed'` — not encoded as a second, all-failed-variants-repeated
   * type (a 2×6 cross product of status×kind) for the same reason `@forge/engine/gates`'
   * `DeterministicCheckResult.reason?` stays a plain optional field rather than two full result shapes:
   * the marginal type-safety is not worth doubling every variant here. */
  readonly failure?: StepFailureInfo;
}
