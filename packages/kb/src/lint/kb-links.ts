/**
 * The KB-entry-as-bridge mechanism `SPEC-QUESTIONS.md` Q56 (points 2–3) settled: neither `adrSchema`
 * nor `Component` (P10) has any field naming which components/entries an ADR concerns, so this derives
 * an ADR's own "scope" from the KB entries that already, in the real fixture, connect the two —
 * `applies_to` names what a KB entry concerns, `sources` (`kind: 'decision'`) names which ADR it came
 * from. An ADR's derived scope is the union of `applies_to` across every KB entry citing it this way.
 *
 * @see SPEC-QUESTIONS.md Q56
 * @see PLAN-M3.md P10
 */
import type { ADR } from '@forge/schemas';

import type { KbEntry } from '../schema/kb-entry.ts';

/** Every `applies_to` tag named by an *active* KB entry that cites `adrId` as a `kind: 'decision'`
 * source. Non-`active` entries are excluded — a gauntlet critic found this filter missing, so a single
 * `deprecated` or `draft` KB entry citing an accepted ADR was enough to silently satisfy "has an owning
 * ADR" for whatever component it named, and to trigger a false-positive scope-overlap contradiction
 * between two otherwise-unrelated ADRs. `checkAntonymTagConflicts` (`contradictions.ts`) already
 * applies the identical `status === 'active'` filter for the same reason: stale/never-vetted content
 * should not establish real facts about what a decision covers. */
export function adrScope(adrId: string, kbEntries: readonly KbEntry[]): ReadonlySet<string> {
  const scope = new Set<string>();
  for (const entry of kbEntries) {
    if (entry.status !== 'active') continue;
    const citesAdr = entry.sources.some(
      (source) => source.kind === 'decision' && source.ref === adrId,
    );
    if (!citesAdr) continue;
    for (const tag of entry.applies_to) scope.add(tag);
  }
  return scope;
}

/** Every ADR id whose own derived scope (`adrScope`) contains `componentId` — "has an owning ADR". */
export function owningAdrIds(
  componentId: string,
  kbEntries: readonly KbEntry[],
  adrs: readonly ADR[],
): readonly string[] {
  return adrs.filter((adr) => adrScope(adr.id, kbEntries).has(componentId)).map((adr) => adr.id);
}
