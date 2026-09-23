/**
 * `10` §10.1's workflow YAML shape, as typed data. The worked example there gives concrete fields for
 * six of the eleven step kinds (`agent`, `command`, `gate`, `fanout`, `merge`, `subworkflow`); the
 * step-kind table names the other five (`elicit`, `session`, `checkpoint`, `parallel`, `sequence`) with
 * a one-line semantic each and no worked example anywhere in the spec pack — their own field shapes
 * below are this piece's own design, documented at each type.
 *
 * `StepKind`'s eleven literals are transcribed independently from `10` §10.1's own table, not imported
 * from `@forge/extensions/workflows`'s own `StepKind` (`PLAN-M2.md` P6): that package's own doc comment
 * already states it holds a deliberately minimal, narrower copy for its own overlay-guardrail purposes,
 * anticipating this fuller shape landing here — reaching back into it for a single literal union would
 * be an odd dependency for this package's own foundational type to carry. Two independent, spec-derived
 * transcriptions of the same closed table is the same trade `VcsError`/`TelemetryError` already make
 * (`SPEC-QUESTIONS.md` Q62), not an oversight.
 *
 * @see specs/10 §10.1
 * @see SPEC-QUESTIONS.md Q62
 * @see PLAN-M5.md P8
 */

/** `10` §10.1's own "Step kinds" table, verbatim. */
export type StepKind =
  | 'agent'
  | 'command'
  | 'gate'
  | 'elicit'
  | 'session'
  | 'fanout'
  | 'merge'
  | 'subworkflow'
  | 'checkpoint'
  | 'parallel'
  | 'sequence';

/** Shared by every step kind. `id` is optional at the type level — required for a top-level workflow
 * step and for `ParallelStep`/`SequenceStep`'s own children, but deliberately absent from a `fanout`
 * step's single templated child (its real id is synthesized per-item at plan-compilation time, `06`
 * §6.2's own `${workflowId}:${stepId}[:${itemKey}]` shape, a later piece's job, not this one's). Pushing
 * "is `id` required *here*" to `validateStructure` rather than encoding it in the type keeps one
 * recursive `WorkflowStep` union usable in every position, instead of two near-duplicate unions. */
interface WorkflowStepBase {
  readonly id?: string | undefined;
  readonly dependsOn?: readonly string[] | undefined;
}

/** An `agent` step's own declared output: `10` §10.1's worked example shows `{ type: InterfaceContract,
 * cardinality: many }` and `{ type: ReviewReport }` (cardinality omitted). `cardinality`'s only spec-
 * given value is `many`; `one` is this piece's own inferred counterpart — the natural closed pair for
 * "how many of this artifact type does the step produce," not a spec citation. */
export interface OutputContract {
  readonly type: string;
  readonly cardinality?: 'one' | 'many' | undefined;
  readonly subtype?: string | undefined;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly retryOn: readonly string[];
}

export interface StepLimits {
  readonly maxTurns?: number | undefined;
  readonly maxCostUsd?: number | undefined;
}

export interface AgentStep extends WorkflowStepBase {
  readonly kind: 'agent';
  readonly agent: string;
  readonly brief?: string | undefined;
  /** `swarm-review`'s own interaction mode (`05` §5.7) — kept a plain string, not a closed union: the
   * set of valid modes belongs to whichever package resolves them (`@forge/agents`/`@forge/sessions`,
   * neither reachable from here per `specs/02` §2.2's own graph — `engine` and `sessions` are siblings,
   * not stacked), and this piece only needs to carry the value through, never interpret it. */
  readonly mode?: string | undefined;
  readonly perspectives?: readonly string[] | undefined;
  readonly inputs?: readonly string[] | undefined;
  readonly outputs?: readonly OutputContract[] | undefined;
  readonly gateEvidence?: readonly string[] | undefined;
  /** `10` §10.1's own worked example shows both a bare string (`"{{item.files_expected}}"`) and an
   * array (`[ "{{item.test_paths}}" ]`) across two different steps — a real, not hypothetical,
   * union this piece must accept both shapes of. */
  readonly produces?: string | readonly string[] | undefined;
  readonly limits?: StepLimits | undefined;
  readonly retry?: RetryPolicy | undefined;
  /** `"escalate"` in the worked example; kept a plain string for the same reason `mode` is — the closed
   * set of valid failure dispositions is a later piece's own concern to define and enforce. */
  readonly onFailure?: string | undefined;
  /** `20` §20.5 point 3 / `15` §15.5.4: the workflow author's own declaration that this step's context
   * includes untrusted content — `'external'` is the only value either spec passage names, so a plain
   * optional literal rather than a wider enum, matching `plan/types.ts`'s own `StepNode.taint`, the
   * compiled field `compilePlan` copies this onto verbatim (`PLAN-M14.md` P27). `agent`-kind only: no
   * other step kind's context is ever packed from KB/skill content at all (`assemble.ts`'s own
   * `AgentContextPack`), so no other kind has anything for this to describe — `validateStructure`'s
   * `taint-on-non-agent-step` check (`workflow/validate.ts`) refuses one declared anywhere else, and
   * `workflowStepSchema`'s own per-kind `.strict()` schemas already make it unauthorable there in real
   * YAML. `17` §17.2's own `adopt`/`migrate` steps that read an existing, FORGE-did-not-write codebase
   * are the two shipped workflows that declare this today (`20` §20.5 point 6). */
  readonly taint?: 'external' | undefined;
}

export interface CommandStep extends WorkflowStepBase {
  readonly kind: 'command';
  readonly run: string;
  readonly inline?: boolean | undefined;
  /** `06` §6.2's `StepNode.produces` is a shared field, not agent-only (`PLAN-M14.md` P2): a non-inline
   * `command` step that writes a tracked file in its lane declares it here, so `resolveStepClaim`
   * (`@forge/engine/dispatch`) has something other than an empty claim to hold the step's own session to. */
  readonly produces?: string | readonly string[] | undefined;
}

export interface GateStep extends WorkflowStepBase {
  readonly kind: 'gate';
  readonly gate: string;
}

/** No worked example anywhere in the spec pack for `elicit` — only "Ask the human structured questions;
 * blocks" (`10` §10.1's own step-kind table). `18` §18.4's own event catalogue already has
 * `ElicitationRequested`/`ElicitationAnswered`, confirming "structured questions" is a real, named
 * concept elsewhere, not just prose — modeled here as a named, prompted list a future elicitation-
 * running piece can render and collect answers against, the minimal shape "structured" plausibly
 * requires. Entirely this piece's own design. */
export interface ElicitQuestion {
  /** An identifier (letters, digits, underscores; starts with a letter), unique across the workflow: the answer is
   * bound under this name in the run's `answers` and read by a `command` step as `$FORGE_ANSWER_<name>`. */
  readonly name: string;
  readonly prompt: string;
  /** When present the answer must be exactly one of these (compared after trimming, case-sensitively), so a
   * value that reaches a command or a config key is one the workflow author listed, not free text
   * (`PLAN-M13.md` P20). Absent, any non-blank answer is accepted. */
  readonly choices?: readonly string[] | undefined;
}

export interface ElicitStep extends WorkflowStepBase {
  readonly kind: 'elicit';
  readonly questions: readonly ElicitQuestion[];
}

/** No worked example for `session` either. `16` §16.2's own table names ten closed session types
 * (`brainstorm`, `design-review`, ...); kept a plain string here rather than that closed union for the
 * same cross-package reason `AgentStep.mode` is — `@forge/sessions` is a sibling `engine` cannot reach,
 * per `specs/02` §2.2's own graph, not a forward dependency this piece can wait out.
 *
 * `question` (`PLAN-M10.md` P14's own addition, `16` §16.6): the literal, already-framed one-sentence
 * question `16` §16.3 step 1 asks for — confirmed directly against `@forge/engine/interaction/session`'s
 * own `runSessionStep` (`FRAME` phase: `question: node.brief ?? ''`) and the CLI's own hand-built ad-hoc
 * session `StepNode` (`buildAdHocSessionStepNode`) that a compiled `session` step's `brief` is read as
 * *raw question text*, never a `briefs/*.md` file path the way `AgentStep.brief` is — deliberately a
 * differently-named authored field here (not reusing `AgentStep.brief`'s own name) so the two genuinely
 * different semantics are not confused at the authoring layer, even though `compileStep` (`compile.ts`)
 * folds both into the one shared, kind-overloaded `StepNode.brief` this piece cannot rename without
 * touching `session.ts`, out of `PLAN-M10.md` P14's own scope. Every real `kind: 'session'` step this
 * piece adds to `@forge/templates`'s own workflow content sets `question`; a step authored without one
 * still compiles (the field is optional), but fails FRAME with `RUN-061` the moment it actually runs —
 * `16` §16.3's own honest "no real question at all" outcome, not something this type should paper over.
 *
 * `when` (`PLAN-M10.md` P14's own addition, `16` §16.6): a `@forge/methods/expr`-grammar-shaped
 * condition string for a *triggered* placement (`standup` "on long runs," `premortem` "at L3+," `war-room`
 * "on Sev1") — carried through compilation onto `StepNode.when` as real, parseable, evaluable data (see
 * `@forge/methods`'s own `session-triggers.ts`), but **not** evaluated by `compilePlan` or the scheduler
 * itself: no per-step conditional-inclusion or conditional-dispatch mechanism exists anywhere in this
 * package today (confirmed directly — `workflow.levels` gates a whole workflow, never one step, and
 * `compilePlan` compiles every step in `workflow.steps` unconditionally), and building one is a real,
 * separate, cross-cutting scheduler feature this milestone's own P14 piece does not build. Every
 * triggered placement this piece adds is therefore positioned as a dependency-terminal step (nothing
 * else in the same workflow depends on it) precisely so an always-compiled-but-not-yet-runtime-gated
 * `session` step can never deadlock or block a gate it should not apply to — see the worked comment atop
 * each edited `*.workflow.yaml` file for the specific reasoning per placement. */
export interface SessionStep extends WorkflowStepBase {
  readonly kind: 'session';
  readonly sessionType: string;
  readonly question?: string | undefined;
  readonly when?: string | undefined;
}

/** The templated child (`step`) is a full `WorkflowStep` minus the two fields a fanout child never
 * declares for itself — see `WorkflowStepBase`'s own doc comment for why `id`/`dependsOn` are optional
 * on every kind rather than encoded away here as a distinct, near-duplicate type. */
export interface FanoutStep extends WorkflowStepBase {
  readonly kind: 'fanout';
  /** An expression string (`10` §10.1's own sandboxed expression language, `SPEC-QUESTIONS.md`-tracked
   * as P9's own piece, not yet built) resolving to an array at *plan-compilation* time — "against a
   * schema, not executed" (`PLAN-M5.md` P8's own mandate): this piece checks `over` is present and
   * non-blank, nothing about whether it would actually resolve, since actually resolving it needs the
   * expression evaluator P9 builds next. */
  readonly over: string;
  readonly itemKey?: string | undefined;
  readonly step: WorkflowStep;
}

export interface MergePolicy {
  readonly conflict: string;
  readonly preChecks?: string | undefined;
  readonly postChecks?: string | undefined;
}

export interface MergeStep extends WorkflowStepBase {
  readonly kind: 'merge';
  readonly over: string;
  readonly policy: MergePolicy;
}

export interface SubworkflowStep extends WorkflowStepBase {
  readonly kind: 'subworkflow';
  readonly workflow: string;
}

/** "Force a commit + event-log flush; a safe resume point" (`10` §10.1's own step-kind table) — no
 * configurable behaviour of its own beyond where it sits in the DAG, so no fields beyond the shared
 * base. Entirely this piece's own design (there is nothing to design: the table's own description is
 * already a complete field list of zero). */
export interface CheckpointStep extends WorkflowStepBase {
  readonly kind: 'checkpoint';
}

/** "Explicit grouping when dependencies alone are insufficient" (`10` §10.1's own step-kind table) —
 * modeled as wrapping real, independently-addressable child steps (each needing its own `id`, unlike a
 * `fanout`'s single templated child): a `parallel` group declares its children have no ordering
 * constraint *relative to each other*; a `sequence` group forces array-order execution among its own
 * children. Neither this type nor `validateStructure` invents an extra rule restricting `dependsOn` on
 * a group's children (e.g. "a `sequence` child may not declare its own `dependsOn`") — nothing in the
 * spec text states one, and a child may legitimately still depend on a step *outside* its own group.
 * Entirely this piece's own design. */
export interface ParallelStep extends WorkflowStepBase {
  readonly kind: 'parallel';
  readonly steps: readonly WorkflowStep[];
}

export interface SequenceStep extends WorkflowStepBase {
  readonly kind: 'sequence';
  readonly steps: readonly WorkflowStep[];
}

export type WorkflowStep =
  | AgentStep
  | CommandStep
  | GateStep
  | ElicitStep
  | SessionStep
  | FanoutStep
  | MergeStep
  | SubworkflowStep
  | CheckpointStep
  | ParallelStep
  | SequenceStep;

export interface WorkflowInput {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

export interface WorkflowRequires {
  readonly gates_passed?: readonly string[] | undefined;
  readonly artifacts?: readonly string[] | undefined;
}

export interface OnFailureEscalation {
  readonly when: string;
  readonly do: WorkflowStep;
}

export interface WorkflowOnFailure {
  readonly default: string;
  readonly escalations?: readonly OnFailureEscalation[] | undefined;
}

/** `10` §10.1's own worked example, typed field-for-field. */
export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly levels?: readonly string[] | undefined;
  readonly requires?: WorkflowRequires | undefined;
  readonly inputs?: readonly WorkflowInput[] | undefined;
  readonly vars?: Readonly<Record<string, string>> | undefined;
  readonly steps: readonly WorkflowStep[];
  readonly onFailure?: WorkflowOnFailure | undefined;
  readonly onComplete?: readonly WorkflowStep[] | undefined;
}

/** A single problem `parseWorkflow` found, positioned in the *original YAML source text* via the `yaml`
 * package's own CST (`02` §2.1) — never a bare `JSON.parse`-shaped failure with no position at all.
 * `line`/`column` are omitted (not `undefined`-valued) when no source position could be resolved for
 * this specific issue — a schema violation on a field that is entirely *missing* from the document has
 * no source text to point to; see `schema.ts`'s own `resolvePosition` for exactly which shapes do and
 * don't resolve. */
export interface ParseIssue {
  readonly message: string;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
}

/** A discriminated result, not a thrown error: `10` §10.1's own "Validation" subsection treats a
 * workflow document the same way whether it fails to parse at all or parses but has referential/
 * structural problems — both are just issues a caller (eventually `forge workflow validate`) wants to
 * collect and report together, not two different control-flow shapes to handle separately. */
export type ParseResult =
  | { readonly success: true; readonly workflow: Workflow }
  | { readonly success: false; readonly issues: readonly ParseIssue[] };

/** One problem `validateStructure`/`validateWorkflow` found in an already-parsed `Workflow`. Unlike
 * `ParseIssue`, these operate on typed data with no YAML CST behind them any more, so a step-scoped
 * `stepId` (not a `line`/`column`) is how an issue names *where* the problem is — matching the
 * established `{ severity, code, message }`-shaped finding convention already used elsewhere in this
 * codebase (`@forge/extensions`'s own `PresetValidationFinding`/`WorkflowGuardrailFinding`), extended
 * with `stepId` since this piece's own issues are always step-scoped, never document-wide. */
export interface ValidationIssue {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly stepId?: string | undefined;
}

/** A caller-supplied "what exists" oracle (`PLAN-M5.md` P8's own Surface text, verbatim on the first
 * four methods) rather than a real registry — `SPEC-QUESTIONS.md` Q62's forward-dependency shape, since
 * every one of `@forge/agents`/gate config/`@forge/schemas`/a workflow registry is either unreachable
 * from `engine` or (for `schemas`) reachable but not yet the actual source of truth a real oracle would
 * need to be backed by. `briefExists` is a fifth method *not* in the plan's own original four-method
 * list: `10` §10.1's own "Validation" subsection prose says "referenced agents, briefs, gates,
 * artifacts and workflows exist" — five things — so the plan's own four-method interface was itself
 * incomplete relative to the spec text it cites, the same class of correction as `Q66`'s `baseSha`
 * addition to `enforceClaim`. All four (five) are synchronous: `validateWorkflow`'s own signature
 * returns a plain array, not a `Promise`, so an async oracle could never be called from inside it — a
 * real caller backs this with an already-loaded, in-memory index, not a live lookup.
 *
 * `agentWrites` (`PLAN-M14.md` P7, `SPEC-QUESTIONS.md` Q225/Q232 decision 6) is a sixth method, of a
 * different shape than the other five: they ask "does this reference resolve," `agentWrites` asks "if
 * it resolves, does the resulting agent hold `tools.write: true`" — the same grant
 * `assembleAgentSession` (`06` §6.7, `PLAN-M13.md` P36) reads before an empty claim withholds it. A
 * real caller answers `false` for an id it cannot load a real definition for (unknown or corrupt: "not
 * a writer, not judged," the identical stance the P36 owner-role check already takes for a corrupt
 * sibling agent file) — never `true` by default, since defaulting to "writes" for an id nothing backs
 * would fabricate a finding this oracle cannot actually support. */
export interface WorkflowExistenceOracle {
  readonly agentExists: (id: string) => boolean;
  readonly briefExists: (path: string) => boolean;
  readonly gateExists: (id: string) => boolean;
  readonly artifactTypeExists: (id: string) => boolean;
  readonly workflowExists: (id: string) => boolean;
  readonly agentWrites: (id: string) => boolean;
}
