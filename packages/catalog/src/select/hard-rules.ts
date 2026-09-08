/**
 * `evaluateHardRules` -- `12` §12.3's own three "Hard rules":
 *
 * - "The number of primary languages defaults to 1 (2 max at L3) unless an ADR justifies more."
 * - "Any technology with `maturity: emerging` requires human approval and a documented fallback."
 * - "If `constraints/technical.md` mandates a stack, the engine does not re-litigate it; it records the
 *   mandate as the decision with `framework: mandated` and moves on."
 *
 * @see specs/12 §12.3
 * @see PLAN-M6.md C5
 */
import type { CatalogEntry } from '../schema/types.ts';
import type { ChosenEntry, HardRuleFlag, ProjectLevel } from './types.ts';

/** The third hard rule ("mandated... records the mandate... and moves on") is not a *flag* -- it is
 * `selectStack`'s own control-flow decision (a mandated entry skips scoring entirely, recorded via
 * `ChosenReason: { kind: 'mandated' }`), so it has no corresponding check here; this function evaluates
 * only the two rules that are real, checkable properties of the final `chosen` set. */
export function evaluateHardRules(
  chosen: readonly ChosenEntry[],
  level: ProjectLevel,
): readonly HardRuleFlag[] {
  const flags: HardRuleFlag[] = [];

  const languageCount = chosen.filter((c) => c.entry.kind === 'language').length;
  const languageLimit = level === 'L3' ? 2 : 1;
  if (languageCount > languageLimit) {
    flags.push({
      rule: 'primary-language-count',
      message: `${String(languageCount)} primary languages selected, exceeding the default limit of ${String(languageLimit)} at ${level} -- requires an ADR justifying more.`,
    });
  }

  for (const { entry } of chosen) {
    if (entry.maturity === 'emerging') {
      flags.push({
        rule: 'emerging-maturity',
        message: `"${entry.id}" has maturity: emerging -- requires human approval and a documented fallback.`,
        entryId: entry.id,
      });
    }
  }

  return flags;
}

/** Whether `entry` is named in `constraints.mandated`, by id -- `selectStack`'s own entry point into the
 * third hard rule. Exported separately (rather than folded into `evaluateHardRules`) because it must run
 * *before* scoring for a given kind, not after the full `chosen` set exists. */
export function isMandated(entry: CatalogEntry, mandated: readonly string[]): boolean {
  return mandated.includes(entry.id);
}
