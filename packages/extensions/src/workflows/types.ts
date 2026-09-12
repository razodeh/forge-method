/**
 * Shared types for `@forge/extensions/workflows` — `15` §15.7's four remaining overlay-able document
 * kinds (workflows, gate checks, frameworks, templates).
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 */

/** `10` §10.1's "Step kinds" table. */
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

/**
 * The minimal shape this piece's own guardrail checks need from a base workflow's step — `id`,
 * `kind`, and (possibly nested, for `fanout`) `agent`. A caller who already has the real, parsed base
 * workflow document supplies this; this piece does not parse or validate a whole workflow document
 * (`10` §10.1's full DSL — inputs, vars, expressions, `onFailure`/`onComplete` — belongs to the
 * workflow engine itself, out of this milestone's `@forge/extensions` scope).
 */
export interface WorkflowStepSummary {
  readonly id: string;
  readonly kind: StepKind;
  readonly agent?: string;
  /** `kind: 'session'` only (`PLAN-M10.md` P14) — needed to tell a mandatory stage retro apart from
   * every other session step, the same reason `agent` is carried for `protectionReason`'s own
   * red/review check. */
  readonly sessionType?: string;
  /** `fanout`'s own nested step, whose `agent` is what actually runs per item. */
  readonly step?: WorkflowStepSummary;
}

export type WorkflowGuardrailCode =
  | 'gate-step-removed'
  | 'protected-step-removed'
  | 'mandatory-retro-step-removed'
  | 'insert-after-anchor-missing';

export interface WorkflowGuardrailFinding {
  readonly severity: 'error';
  readonly code: WorkflowGuardrailCode;
  readonly message: string;
}

/** One `$insertAfter` directive: insert `steps` immediately after the step named `anchor`. */
export interface InsertAfterDirective {
  readonly anchor: string;
  readonly steps: readonly WorkflowStepSummary[];
}

export interface ThresholdCheckInput {
  readonly checkId: string;
  readonly field: string;
  /** The ceiling-bearing module's own declared value — never invented, always caller-supplied. */
  readonly floor: number;
  readonly overlayValue: number;
}

export interface ThresholdFinding {
  readonly severity: 'warning';
  readonly code: 'threshold-below-floor';
  readonly message: string;
  readonly delta: number;
}

export interface FrameworkReferenceFinding {
  readonly severity: 'error';
  readonly code: 'framework-still-referenced';
  readonly message: string;
}

export interface TemplateFieldFinding {
  readonly severity: 'error';
  readonly code: 'required-field-missing';
  readonly message: string;
}
