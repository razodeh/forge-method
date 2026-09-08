/**
 * `FrameworkDefinition` — `11` §11.0's own framework YAML shape, verbatim (the full worked
 * `repo-strategy` example names every field this type declares).
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M1
 */

export interface FrameworkProduces {
  readonly adr_category: string;
  readonly kb_section: string;
}

export interface FrameworkDerivedInput {
  readonly id: string;
  /** A small local expression string — see `../expr.ts`'s own doc comment for why this package
   * evaluates its own bounded grammar rather than importing `@forge/engine/expr`. */
  readonly from: string;
}

export interface FrameworkInputs {
  readonly required: readonly string[];
  readonly derived?: readonly FrameworkDerivedInput[] | undefined;
}

export interface FrameworkQuestion {
  readonly id: string;
  readonly text: string;
  readonly type: 'number' | 'choice' | 'text' | 'boolean';
  readonly options?: readonly string[] | undefined;
  readonly default_from?: string | undefined;
}

export interface FrameworkOption {
  readonly id: string;
}

export interface FrameworkCriterion {
  readonly id: string;
  readonly weight: number;
}

export type FrameworkScoring = 'rubric' | 'rules' | 'hybrid';

export interface FrameworkRuleThen {
  readonly eliminate?: readonly string[] | undefined;
  readonly prefer?: string | undefined;
}

export interface FrameworkRule {
  readonly if: string;
  readonly then: FrameworkRuleThen;
}

export interface FrameworkFollowOn {
  readonly create_stories_from: string;
}

export interface FrameworkDefinition {
  readonly id: string;
  readonly name: string;
  readonly owner_agent: string;
  readonly produces: FrameworkProduces;
  readonly inputs: FrameworkInputs;
  readonly questions?: readonly FrameworkQuestion[] | undefined;
  readonly options: readonly FrameworkOption[];
  readonly criteria?: readonly FrameworkCriterion[] | undefined;
  readonly scoring: FrameworkScoring;
  readonly rules?: readonly FrameworkRule[] | undefined;
  readonly output_template: string;
  readonly follow_on?: readonly FrameworkFollowOn[] | undefined;
}

/** One problem `loadFramework` found — a discriminated result, never a thrown error, matching
 * `@forge/engine/workflow`'s own `ParseResult` precedent (M5 P8) for the identical "this can fail on
 * ordinary malformed input, a caller needs to react to that" reason. Simpler than that precedent's own
 * line/column CST tracking, deliberately: `11` §11.0's own schema is much flatter than the full
 * workflow DSL with its expression templating, and this package has no `yaml` CST-walking need beyond
 * "which field, in which framework, was wrong." */
export interface FrameworkIssue {
  readonly path: string;
  readonly message: string;
}

export type FrameworkParseResult =
  | { readonly success: true; readonly framework: FrameworkDefinition }
  | { readonly success: false; readonly issues: readonly FrameworkIssue[] };
