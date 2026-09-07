/**
 * `KbFinding` — one `08` §8.7/§8.8 rule violation, the shape every check in this module returns.
 *
 * @see specs/08 §8.7
 * @see specs/08 §8.8
 * @see PLAN-M3.md P10
 */

/** One `08` §8.7/§8.8 rule this package checks, namespaced `kb:*` — `diagram:*` ids are reserved for
 * the two checks `SPEC-QUESTIONS.md` Q44 assigns to this package from `08` §8.11.7's own table
 * (`diagram:required`, `diagram:adr-coverage`), so a caller composing this package's findings with
 * `@forge/diagrams`' own `DiagramFinding.checkId` values never sees two different meanings for one id. */
export type KbRuleId =
  | 'kb:schema'
  | 'kb:dangling-ref'
  | 'kb:supersession-cycle'
  | 'kb:contradiction'
  | 'kb:component-coverage'
  | 'diagram:required'
  | 'diagram:adr-coverage'
  | 'kb:cap-coverage'
  | 'kb:staleness'
  | 'kb:low-confidence-input'
  | 'kb:orphan'
  | 'kb:glossary-drift'
  | 'kb:needs-review';

export interface KbFinding {
  readonly ruleId: string;
  readonly severity: 'error' | 'warn';
  readonly message: string;
  readonly entryId?: string;
}

/** A canonical `(ruleId, entryId, message)` ordering, never `localeCompare` (R10) — `KbTree.entries`
 * carries no ordering guarantee for any caller other than `parseKbTree`'s own lexically-sorted walk,
 * so every exported check in this module sorts its own return value through this before returning it:
 * identical logical input must produce byte-identical output regardless of which array position each
 * entry happened to start in. A gauntlet critic found two entries in a genuinely symmetric conflict
 * (an antonym-tag clash, an ADR scope overlap) swapped which one became `entryId` and which name came
 * first in the message purely based on incidental input-array order — a real R10 violation this sort
 * closes for every check at once, not just the two it was found in. */
export function sortFindings(findings: readonly KbFinding[]): readonly KbFinding[] {
  return [...findings].sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
    const aEntry = a.entryId ?? '';
    const bEntry = b.entryId ?? '';
    if (aEntry !== bEntry) return aEntry < bEntry ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    return 0;
  });
}
