/**
 * `CatalogEntry` — `12` §12.2's own entry YAML shape, verbatim (the full worked `postgresql` example
 * names every field this type declares).
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */

/** `12` §12.2's own `kind` enum, transcribed verbatim from its comment: "language | framework |
 * datastore | queue | stream | cache | search | ci | observability | infra | auth | payments | testing |
 * frontend | mobile | orm | api-style | cloud | container | iac" -- 20 members, not the 19 an earlier
 * draft of this plan miscounted before this piece was implemented (corrected in `PLAN-M6.md` alongside
 * this type; see `SPEC-QUESTIONS.md`). */
export type CatalogKind =
  | 'language'
  | 'framework'
  | 'datastore'
  | 'queue'
  | 'stream'
  | 'cache'
  | 'search'
  | 'ci'
  | 'observability'
  | 'infra'
  | 'auth'
  | 'payments'
  | 'testing'
  | 'frontend'
  | 'mobile'
  | 'orm'
  | 'api-style'
  | 'cloud'
  | 'container'
  | 'iac';

export type CatalogMaturity = 'emerging' | 'growing' | 'mature' | 'legacy' | 'declining';

/** `12` §12.2's own worked example only ever shows `medium`/`high` values for these four fields --
 * `low` is this piece's own inferred third value, completing the obvious ordinal scale, recorded as a
 * spec-silence resolution rather than a silent guess. */
export type CatalogBurdenLevel = 'low' | 'medium' | 'high';

export interface CatalogEntry {
  readonly id: string;
  readonly kind: CatalogKind;
  readonly name: string;
  readonly category: string;
  readonly maturity: CatalogMaturity;
  readonly licence: string;
  readonly managed_options?: readonly string[] | undefined;
  readonly strengths: readonly string[];
  readonly weaknesses: readonly string[];
  readonly fits_when: readonly string[];
  readonly avoid_when: readonly string[];
  readonly pairs_with?: readonly string[] | undefined;
  readonly alternatives?: readonly string[] | undefined;
  readonly operational_burden: CatalogBurdenLevel;
  readonly team_familiarity_weight: CatalogBurdenLevel;
  readonly exit_cost: CatalogBurdenLevel;
  readonly agent_friendliness: CatalogBurdenLevel;
  readonly notes_for_agents: readonly string[];
}

export interface CatalogIssue {
  readonly path: string;
  readonly message: string;
}

export type CatalogParseResult =
  | { readonly success: true; readonly entry: CatalogEntry }
  | { readonly success: false; readonly issues: readonly CatalogIssue[] };
