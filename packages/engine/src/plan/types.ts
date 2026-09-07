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
export type RetryableFailureClass = 'transient' | 'tool-error' | 'validation' | 'test-failure' | 'timeout';

export interface StepNodeRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: readonly [number, number];
  readonly retryOn: readonly RetryableFailureClass[];
  readonly escalate?: { readonly afterAttempts: number; readonly to: 'stronger-model' | 'human' | 'diagnostician' } | undefined;
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
export type StepNodeKind = 'agent' | 'command' | 'gate' | 'elicit' | 'session' | 'subworkflow' | 'fanout' | 'merge' | 'checkpoint';

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
