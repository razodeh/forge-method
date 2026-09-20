/**
 * `06` §6.2's `StepNode` — the compiled, runnable unit a `Workflow` (`@forge/engine/workflow`, P8)
 * compiles down into. Several of `06` §6.2's own field types (`AgentId`, `ArtifactRef`, `ResourceClaim`,
 * `AutonomyLevel`) name concepts owned by packages this milestone cannot reach (`@forge/agents`, a real
 * KB pack, `@forge/schemas`'s own config) — `SPEC-QUESTIONS.md` Q62's own "minimal, locally-typed
 * stand-in" pattern, applied again here rather than invented fresh. `06` §6.2's own `RetryPolicy` (this
 * module's own `StepNodeRetryPolicy`) is fuller than `@forge/engine/workflow`'s own `RetryPolicy` — see
 * that type's own doc comment for why these are two independent types, not one shared one.
 *
 * @see specs/06 §6.2, §6.7, §6.8, §6.9
 * @see specs/10 §10.1
 * @see PLAN-M5.md P10
 */
import type { ElicitQuestion, MergePolicy, OutputContract } from '../workflow/types.ts';

declare const AGENT_ID_BRAND: unique symbol;

/** `SPEC-QUESTIONS.md` Q62's own "Conflict, part 2" resolution: "`AgentId` is a plain branded string
 * type (no registry lookup, no persona/prompt-block compilation)" — `@forge/agents` (M6) owns the real
 * roster; M5 only needs a type-safe marker so a random string cannot be passed where a compiled step's
 * own agent reference is expected. Branded the same way `@forge/vcs`'s own `LaneId` is, via `toAgentId`
 * below rather than a bare cast at every call site. */
export type AgentId = string & { readonly [AGENT_ID_BRAND]: true };

export function toAgentId(value: string): AgentId {
  return value as AgentId;
}

/** `06` §6.2's own comment: "file globs written" / "file globs read (advisory)". `06` §6.7 confirms:
 * "each step declares `produces` **globs**" — a claim, structurally, is just a glob pattern string; a
 * plain alias, not branded, since (unlike `AgentId`) nothing calls for a single blessed constructor —
 * any string is a syntactically valid glob to carry through, well-formedness is checked separately
 * (`10` §10.1's own "produces globs are well-formed" validation clause, already enforced by
 * `@forge/engine/workflow`'s own `validateStructure` at P8, upstream of this piece). */
export type ResourceClaim = string;

/** `06` §6.2's own `inputs: ArtifactRef[]` — the worked example's own `artifact:Story({{item.id}})` /
 * `kb:architecture/**` / `diff:lane` strings are a small reference mini-DSL of their own, but *parsing*
 * that DSL into a structured reference needs a real KB pack and a real artifact-type registry to resolve
 * against, neither reachable from `engine` in M5 (`Q62`). `@forge/engine/workflow`'s own `AgentStep.
 * inputs?: readonly string[]` already made the identical call for the authored shape; a plain alias here
 * keeps the compiled shape consistent with it — this piece carries the string through unresolved, never
 * interprets it. */
export type ArtifactRef = string;

/** `@forge/schemas`'s own `config/schema.ts` (`executionSchema.autonomy`) already closes this exact set
 * (`z.enum(['supervised', 'guided', 'autonomous'])`) — transcribed independently here rather than adding
 * a new `engine → schemas` dependency edge for one three-value enum nested inside a much larger config
 * object type, the same "two independent transcriptions of one small closed table" trade `StepKind`
 * already makes (`SPEC-QUESTIONS.md` Q62, citing P8's own `types.ts`). */
export type AutonomyLevel = 'supervised' | 'guided' | 'autonomous';

/** `06` §6.8's own fuller `RetryPolicy`, verbatim in shape — genuinely a different type from
 * `@forge/engine/workflow`'s own `RetryPolicy` (`{ maxAttempts, retryOn: readonly string[] }`), not a
 * duplicate: that one is the *authoring*-time shape, deliberately minimal (P8's own doc comment: "the
 * closed set of valid failure dispositions is a later piece's own concern to define and enforce") —
 * `compileStep` (`compile.ts`) is that later piece, and this is the fuller, *validated*, defaulted shape
 * it produces. `retryOn` is narrowed to `06` §6.8's own closed five-value set (validated at compile time,
 * `invalid-retry-on-value`); `backoffMs`/`escalate` have no authored-DSL counterpart anywhere in `06` or
 * `10` (P8's own `RetryPolicy` has neither field) — `backoffMs` gets this piece's own invented, clearly-
 * placeholder default (`DEFAULT_BACKOFF_MS` in `compile.ts`), `escalate` stays `undefined` for every M5
 * step (nothing authors it yet; the field itself is optional in `06` §6.8's own interface too). */
export type RetryableFailureClass =
  'transient' | 'tool-error' | 'validation' | 'test-failure' | 'timeout';

export interface StepNodeRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: readonly [number, number];
  readonly retryOn: readonly RetryableFailureClass[];
  readonly escalate?:
    | { readonly afterAttempts: number; readonly to: 'stronger-model' | 'human' | 'diagnostician' }
    | undefined;
}

/** `06` §6.2's own inline `limits: { maxTurns: number; wallClockMs: number; maxCostUsd: number }`,
 * named here for clarity. All three are required, but every authored source is optional or absent
 * entirely (`@forge/engine/workflow`'s own `StepLimits` has only `maxTurns?`/`maxCostUsd?`, no
 * `wallClockMs` at all) — `10` §10.1's own "limits within module ceilings" validation clause describes a
 * real per-role/per-module ceiling system that is `@forge/agents`' own concern (M6, `Q62`), not available
 * to resolve against here. `compileStep` fills an absent field with this piece's own conservative,
 * explicitly-placeholder default (`DEFAULT_LIMITS` in `compile.ts`) — not a faked ceiling lookup with no
 * real roster behind it, the identical reasoning `Q62` already applies to agent role/persona resolution. */
export interface StepNodeLimits {
  readonly maxTurns: number;
  readonly wallClockMs: number;
  readonly maxCostUsd: number;
}

/** `06` §6.2's own eight literals, plus `'checkpoint'`: `10` §10.1's own eleven-kind step-kind table
 * describes `checkpoint` as real, scheduled work ("force a commit + event-log flush; a safe resume
 * point"), not a grouping construct that could erase away the way `parallel`/`sequence` do (see
 * `compile.ts`'s own top-of-file comment for why those two never become a `StepNode` at all) — so `06`
 * §6.2's own closed `StepNode.kind` union is incomplete relative to the fuller table it's compiled from,
 * the same class of correction `Q70`'s design point 5 already made for `WorkflowExistenceOracle`. */
export type StepNodeKind =
  | 'agent'
  | 'command'
  | 'gate'
  | 'elicit'
  | 'session'
  | 'subworkflow'
  | 'fanout'
  | 'merge'
  | 'checkpoint';

/** `06` §6.2's own closed four-value set — `@forge/engine/workflow`'s own `AgentStep.onFailure?: string`
 * is deliberately loose at the *authoring* level (P8's own doc comment: "the closed set of valid failure
 * dispositions is a later piece's own concern to define and enforce"); `compileStep` is that piece,
 * narrowing and validating into this closed set (`invalid-on-failure-value` for a non-blank value that
 * matches none of the four). */
export type StepNodeOnFailure = 'block' | 'continue' | 'escalate' | 'replan';

/**
 * `06` §6.2's own `StepNode` interface, verbatim where given, extended in two documented ways: six
 * kind-specific fields (`run`/`gate`/`workflow`/`mergePolicy`/`questions`/`sessionType`) the verbatim
 * interface omits entirely — without them, a compiled `command`/`gate`/`subworkflow`/`merge`/`elicit`/
 * `session` step would carry no way to actually run it, the same "prose promises more than the one given
 * interface shows" gap `StepNodeKind`'s own doc comment already names for `checkpoint` — added directly
 * on the shared shape as optional, kind-scoped fields, following the exact pattern `06` §6.2's own
 * `agent?`/`brief?` (both already kind-scoped to `'agent'` alone) already establish, not a new one
 * invented here.
 *
 * `autonomy` and `consumes` are real fields with no authored-DSL source anywhere this milestone (no
 * `WorkflowStep` kind has an `autonomy` or `consumes` field, and neither appears in `10` §10.1's own
 * worked example) — every M5-compiled `StepNode` carries `autonomy: undefined`, `consumes: []`, both
 * left for a later piece to actually populate once something authors them.
 */
export interface StepNode {
  /** `${workflowId}:${stepId}`, or `${workflowId}:${stepId}:${itemKey}` for one fanout-expanded item —
   * see `compileStepId` in `compile.ts`. */
  readonly id: string;
  readonly kind: StepNodeKind;
  readonly agent?: AgentId | undefined;
  readonly brief?: string | undefined;
  readonly inputs: readonly ArtifactRef[];
  readonly outputs: readonly OutputContract[];
  readonly dependsOn: readonly string[];
  readonly produces: readonly ResourceClaim[];
  readonly consumes: readonly ResourceClaim[];
  readonly laneAffinity?: 'exclusive' | 'shared' | 'inline' | undefined;
  readonly retry: StepNodeRetryPolicy;
  readonly limits: StepNodeLimits;
  /** `'agent'`/`'session'` only: where `limits.maxCostUsd` came from, so the run can replace a bare
   * compile-time default with the agent's own `limits.max_cost_usd` or the project's
   * `budget.perStepUsdDefault` (`resolveStepCostCeilings`, `PLAN-M13.md` P12) but never override a value
   * the workflow step itself declared. `'default'` means the compile placeholder, still open to
   * resolution; every other value is final. Steps that run no model reserve `0` and carry none. */
  readonly maxCostSource?: 'step' | 'agent' | 'config' | 'default' | undefined;
  readonly autonomy?: AutonomyLevel | undefined;
  /** Used for resume (`06` §6.2's own comment). Equal to `id` for M5's own scope: `id`'s own stability
   * guarantee (unchanged across re-compiles of the same workflow+context, `PLAN-M5.md` P10's own Checks
   * text) already gives the one property asked for here. Distinguishing "same position, different
   * authored content — do not resume from stale state" is a real, separate resumability nuance with zero
   * spec elaboration on what should invalidate a resume, and is P19/P20's own piece to design once they
   * exist — an additive change to *how this field is computed*, not to `StepNode`'s own shape, when it
   * does. */
  readonly idempotencyKey: string;
  readonly onFailure: StepNodeOnFailure;
  /** `'agent'` only, and present only when non-empty: the gate ids whose deterministic checks will be run
   * against this step's output -- the gates this step's own `gateEvidence:` names, plus every `gate`-kind
   * step that directly `dependsOn` it (added by `compilePlan`). Read by dispatch's prompt assembly for
   * block [7] (definition of done, `05` §5.3); never used for scheduling. */
  readonly gateEvidence?: readonly string[] | undefined;
  /** `'agent'` only, and present only when non-empty: the values this run supplied for the workflow's own
   * declared `inputs:` (looked up by name in the expression context), plus the fanout `item` for a
   * per-item child. Rendered into block [4] of the compiled prompt (`PLAN-M13.md` P5): without it a run
   * input such as `stageId` or `interfaceName` reaches no brief at all, since brief text is loaded
   * verbatim and never template-resolved. */
  readonly runInputs?: Readonly<Record<string, unknown>> | undefined;
  /** `'agent'` only, present only when non-empty: declared `required: true` workflow inputs this run did
   * not supply. Named in block [4] so a prompt never silently lacks a value its brief assumes. */
  readonly missingRunInputs?: readonly string[] | undefined;
  /** `'agent'` only, present only when the step declares one: the `05` §5.7 interaction mode it names
   * (`mode:` in the workflow YAML), carried through verbatim. `executeStep` acts on exactly one value,
   * `swarm-review` (`PLAN-M13.md` P17): those steps run one read-only session per perspective and the engine
   * itself persists the merged `ReviewReport`. Every other mode is carried but not acted on here. */
  readonly interactionMode?: string | undefined;
  /** `'agent'` only, present only when non-empty: the review perspectives of a `swarm-review` step. */
  readonly perspectives?: readonly string[] | undefined;
  /** `'command'` only. */
  readonly run?: string | undefined;
  /** `'gate'` only — the gate id to evaluate. */
  readonly gate?: string | undefined;
  /** `'subworkflow'` only — the workflow id to invoke. */
  readonly workflow?: string | undefined;
  /** `'merge'` only. */
  readonly mergePolicy?: MergePolicy | undefined;
  /** `'elicit'` only. */
  readonly questions?: readonly ElicitQuestion[] | undefined;
  /** `'session'` only. */
  readonly sessionType?: string | undefined;
  /** `'session'` only (`PLAN-M10.md` P14) — the authored `SessionStep.when` expression, carried through
   * verbatim for a future scheduler piece to actually evaluate; see that field's own doc comment
   * (`@forge/engine/workflow`'s own `types.ts`) for why this piece stops at carrying it, not evaluating
   * it. */
  readonly when?: string | undefined;
  /** `20` §20.5 point 3 / `15` §15.5.4: set when this step's own context includes untrusted content
   * (`@forge/agents`'s own `markExternalContent`) — `'external'` is the only value either of those
   * describes, so a plain optional literal rather than a wider enum. Additive: no compiler in this
   * package sets it yet (a step's own taint is a runtime fact about what context it was actually built
   * with, not something `compilePlan` can determine from authored workflow YAML alone), so every
   * existing `StepNode` construction is unaffected and this defaults to `undefined` (not tainted)
   * everywhere it is not explicitly set. **This means every real, compiled `StepNode` in this codebase
   * has `taint: undefined` today** — `markExternalContent` itself has zero production callers
   * (confirmed by grep) — so `runGateStep`'s own real consumption of this field
   * (`@forge/engine/security`'s own `assertGateApprovalAllowed`) is a real, correct, always-on check
   * that simply never yet has a real tainted step to refuse. See `taint-guard.ts`'s own doc comment for
   * why this is disclosed as "the enforcement exists, the signal does not yet," not "S6 gate approval is
   * enforced in production today." */
  readonly taint?: 'external' | undefined;
}

/** One problem `compilePlan`/`expandFanout` found. Unlike `@forge/engine/workflow`'s own `ValidationIssue`
 * (which can be `warning`-severity, since a warning does not prevent `validateWorkflow` from finishing),
 * every `CompileIssue` is unconditionally blocking — there is no "plan, partially compiled, with
 * warnings" outcome this piece's own Checks text asks for, only "compiles cleanly" or "fails compilation
 * with a located, actionable error." `stepId` is how an issue names *where* the problem is, the same
 * choice `ValidationIssue` already made for the identical reason (no YAML source position survives past
 * `@forge/engine/workflow`'s own parse step into this one). */
export interface CompileIssue {
  readonly code: string;
  readonly message: string;
  readonly stepId?: string | undefined;
}

/** A discriminated result, not a thrown error — the same "collect every issue, do not stop at the first"
 * shape `@forge/engine/workflow`'s own `ParseResult`/`validateStructure` already establish for a design-
 * time operation, not `@forge/engine/expr`'s own `resolveTemplate` (which throws, because it runs at
 * *execution* time against a single already-fully-resolved context — `SPEC-QUESTIONS.md` Q71). Shared by
 * both `compilePlan` and `expandFanout`: both either produce compiled nodes or a set of located problems,
 * never a mix and never a bare exception a caller must remember to catch. */
export type CompileResult =
  | { readonly success: true; readonly nodes: readonly StepNode[] }
  | { readonly success: false; readonly issues: readonly CompileIssue[] };

/** `06` §6.2's own rule 3, and `06` §6.7's own "the scheduler builds an interval map; overlapping claims
 * are serialised": one pairwise overlap between two `produces` globs, one on each of two different
 * `StepNode`s. Exposed as its own type (not folded away into a private detail of `buildClaimIntervalMap`)
 * because `06` §6.7 frames the interval map as something *the scheduler* consults, not merely an internal
 * detail of plan compilation — a later scheduler piece can reuse this list directly, before any lane
 * exists to enforce it against real files (that enforcement, given a *real* completed lane, is `@forge/
 * vcs`'s own concern, `SPEC-QUESTIONS.md` Q62's own sixth note). */
export interface ClaimOverlap {
  readonly stepIdA: string;
  readonly stepIdB: string;
  readonly globA: string;
  readonly globB: string;
}

export interface ClaimIntervalMap {
  readonly overlaps: readonly ClaimOverlap[];
}

/** `06` §6.2's own rule 5: "reject cycles with a rendered Mermaid graph showing the cycle." `cycle` is the
 * closed loop in traversal order — its own first and last elements are the same id, matching `@forge/
 * engine/workflow`'s own `checkNoCycles` convention for the identical concept, reused here rather than
 * inventing an "implicitly closed, first id not repeated" convention that the two cycle-detectors in this
 * codebase would then disagree about. */
export interface CycleResult {
  readonly cycle: readonly string[];
}

/** `06` §6.2's own rule 6: "compute critical path and estimated cost; show both before execution." `path`
 * is a root-to-sink chain of compiled step ids in execution order; `estimatedCost` sums each node's own
 * `limits.maxCostUsd` along that one path — the only cost estimate available pre-execution (`10` §10.1's
 * own worked example shows exactly this field, `limits: { maxTurns: 25, maxCostUsd: 1.5 }`, as the
 * declared per-step budget, not a measured one; no real cost-history mechanism exists yet to do better). */
export interface CriticalPathResult {
  readonly path: readonly string[];
  readonly estimatedCost: number;
}

/** `compileRunPlan`'s own result — `PLAN-M5.md` P11's own Surface text abbreviates this to bare
 * `CompileResult`, but `06` §6.2's own rule 6 explicitly asks for the critical path and estimated cost to
 * be *shown*, which a caller can only do if the successful result actually carries them; the same
 * "the plan's own bullet undersells what the return type needs to be" correction this package's own
 * `ParseExpressionResult`/`CompileResult` (P9/P10) already made once each. `claims` is exposed on success
 * too, not just used internally and discarded: `06` §6.7 frames the interval map as something the
 * *scheduler* consults, not merely an implementation detail of compilation, so a caller building on top of
 * `compileRunPlan` (the one entry point everything downstream — scheduler, gate evaluation, resume —
 * actually calls, per this piece's own Surface text) never needs to re-derive it from `nodes` by hand. */
export type RunPlanResult =
  | {
      readonly success: true;
      readonly nodes: readonly StepNode[];
      readonly criticalPath: CriticalPathResult;
      readonly claims: ClaimIntervalMap;
    }
  | { readonly success: false; readonly issues: readonly CompileIssue[] };
