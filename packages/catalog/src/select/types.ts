/**
 * `12` §12.3's own technology selection engine (`F-TECH-1 · Stack selection`) -- types.
 *
 * @see specs/12 §12.3
 * @see specs/12 §12.4
 * @see PLAN-M6.md C5
 */
import type { CatalogEntry } from '../schema/types.ts';

/** `@forge/methods/level`'s own `ProjectLevel` (M3) is not importable here -- `02` §2.2's own boundary
 * graph gives `@forge/catalog` no `methods` edge (`catalog ← schemas` only, confirmed directly against
 * `tools/eslint-plugin-forge-boundaries/src/graph.mjs`; `catalog` and `methods` are graph peers). A
 * second, independent declaration of the same five-value union -- the identical small, unavoidable
 * duplication `@forge/methods` itself already accepts for this exact type, for the identical boundary
 * reason (`SPEC-QUESTIONS.md` Q85). */
export type ProjectLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface StackConstraints {
  readonly mandated: readonly string[];
  readonly forbidden: readonly string[];
  readonly teamSkills: readonly string[];
  readonly cloud?: string | undefined;
  readonly licencePolicy?: readonly string[] | undefined;
  readonly compliance?: readonly string[] | undefined;
}

export interface StackSelectionInput {
  readonly constraints: StackConstraints;
  readonly architectureStyle: string;
  readonly accessPatterns: readonly string[];
  readonly nfrs: readonly string[];
  readonly deploymentTargets: readonly string[];
  readonly level: ProjectLevel;
}

export interface RemovedCandidate {
  readonly entry: CatalogEntry;
  readonly reason: string;
}

/** `12` §12.3 step 1's own "print what was removed and why... silent elimination is a bug" made a real,
 * non-optional return field, not a side-effect log. */
export interface FilterResult {
  readonly kept: readonly CatalogEntry[];
  readonly removed: readonly RemovedCandidate[];
}

export type HardRuleId = 'primary-language-count' | 'emerging-maturity' | 'mandated-decision';

export interface HardRuleFlag {
  readonly rule: HardRuleId;
  readonly message: string;
  readonly entryId?: string | undefined;
}

export type ChosenReason =
  | { readonly kind: 'mandated' }
  | { readonly kind: 'scored'; readonly weightedScore: number; readonly coherenceBonus: number };

export interface ChosenEntry {
  readonly catalogKind: string;
  readonly entry: CatalogEntry;
  readonly reason: ChosenReason;
}

export interface StackSelectionResult {
  readonly chosen: readonly ChosenEntry[];
  readonly eliminated: readonly RemovedCandidate[];
  readonly coherenceScore: number;
  readonly hardRuleFlags: readonly HardRuleFlag[];
}
