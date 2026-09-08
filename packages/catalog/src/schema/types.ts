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
 * this type; see `SPEC-QUESTIONS.md` Q86).
 *
 * `'stack' | 'feature-flags' | 'secrets'` are a real, necessary extension beyond those 20, found while
 * building C2: `12` §12.2's own "Catalog scope" table requires a "Stacks (as compositions)" row (9 named
 * items: MERN/MEAN, T3, etc.) and, later, "Feature flags & config" and "Secrets" rows, none of which the
 * closed 20-value enum names a matching `kind` for -- confirmed by direct re-enumeration of the spec's
 * own comment, not an oversight in that comment's transcription. Misclassifying a stack composition or a
 * secrets manager under an unrelated existing kind (e.g. `framework`) would be dishonest catalog data;
 * extending the enum by exactly the three kinds the scope table itself requires and nothing else keeps
 * every entry's own `kind` field a true statement. See `SPEC-QUESTIONS.md` Q87. */
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
  | 'iac'
  | 'stack'
  | 'feature-flags'
  | 'secrets';

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
  /** For an atomic technology (`kind` other than `'stack'`), a real "compatible peer" relationship
   * (`12` §12.3 step 2's own "prefers combinations with existing `pairs_with` edges"). For a `kind:
   * 'stack'` entry, this field is deliberately overloaded to mean "constituent parts of this
   * composition" instead -- a different relationship reusing the same field, flagged by a fresh critic
   * round as a real modeling seam (`SPEC-QUESTIONS.md` Q88): a selection engine (C5) must not treat a
   * stack's own `pairs_with` edges as coherence *signal* the way it would for an atomic entry, since
   * they are tautological (a stack always "pairs with" its own parts) rather than evidence of a good
   * combination. */
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
