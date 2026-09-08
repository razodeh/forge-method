/**
 * `scoreCoherence` -- `12` §12.3 steps 2 and 4, combined (per `PLAN-M6.md` C5's own surface note: "both
 * operate on the same candidate combination"):
 *
 * - Step 2, coherence grouping: "technologies are selected as a coherent stack, not independently. The
 *   engine prefers combinations with existing `pairs_with` edges and penalises combinations that
 *   introduce a new runtime, a new package manager, or a new deployment mechanism without cause."
 * - Step 4, runtime-count penalty: "every additional language runtime, datastore, or infra primitive
 *   costs points. Complexity must be paid for by a named requirement."
 *
 * @see specs/12 §12.3
 * @see PLAN-M6.md C5
 */
import type { CatalogEntry } from '../schema/types.ts';

/** `12` §12.3 step 4's own "language runtime, datastore, or infra primitive" -- the `kind` values whose
 * *count beyond one* in a selected set is a real complexity cost, not a `pairs_with` edge to reward.
 * `CatalogKind` (C1) has a literal `'infra'` value (one of the 20 kinds `12` §12.2's own comment names),
 * but no catalog piece (C2-C4) ever shipped an entry under it -- none of the 18 real scope-table rows
 * maps to it. Included here anyway, alongside `'iac'`/`'container'` (the two real, populated kinds that
 * concretely embody "infra primitive" in the shipped catalog today), so this check is already correct
 * the moment a future piece adds real `infra`-kind content, rather than needing to be revisited then. */
const RUNTIME_COUNT_PENALTY_KINDS: ReadonlySet<string> = new Set([
  'language',
  'datastore',
  'iac',
  'container',
  'infra',
]);

const PAIRS_WITH_EDGE_WEIGHT = 1;
const EXTRA_RUNTIME_PENALTY_WEIGHT = 2;

/** Pure and deterministic (R10). Rewards `+1` per real `pairs_with` edge between two entries both present
 * in `selected` (counted once per ordered pair, so a mutual edge both directions counts twice -- a
 * deliberate choice: two entries that *each* independently list the other as a real pairing is stronger
 * coherence evidence than a one-directional mention). Penalises `-2` per entry beyond the first, per
 * `RUNTIME_COUNT_PENALTY_KINDS` kind, in `selected` -- "complexity must be paid for by a named
 * requirement" is not mechanically checkable from catalog data alone (a "named requirement" lives in the
 * caller's own `StackSelectionInput`, not the entry), so this function always applies the penalty; a
 * caller wanting to justify extra runtimes with a named requirement does so by weighing this score
 * against that requirement itself, not by this function silently waiving it. */
export function scoreCoherence(selected: readonly CatalogEntry[]): number {
  const selectedIds = new Set(selected.map((entry) => entry.id));

  let score = 0;
  for (const entry of selected) {
    for (const pairedId of entry.pairs_with ?? []) {
      if (selectedIds.has(pairedId)) score += PAIRS_WITH_EDGE_WEIGHT;
    }
  }

  const countsByKind = new Map<string, number>();
  for (const entry of selected) {
    if (!RUNTIME_COUNT_PENALTY_KINDS.has(entry.kind)) continue;
    countsByKind.set(entry.kind, (countsByKind.get(entry.kind) ?? 0) + 1);
  }
  for (const count of countsByKind.values()) {
    if (count > 1) score -= (count - 1) * EXTRA_RUNTIME_PENALTY_WEIGHT;
  }

  return score;
}
