/**
 * `explainOverlay` — `15` §15.2 rule 3 / `AC15-2`: "prints the final resolved object and, per field,
 * which layer supplied it," reproduced through the full `compile()` pipeline rather than P2's own
 * unit-level `explainField` alone.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P9
 */
import type { CompileResult, DocumentKind, FieldProvenanceEntry } from './types.ts';

/**
 * Every field `id`'s resolved entity actually carries provenance for, sorted by path — deterministic
 * regardless of the `Map`'s own insertion order. `[]` for an unknown `kind`/`id` (never throws,
 * matching every other boundary-input function in this milestone).
 *
 * `provenance` is itself a `Map` keyed by path, so two entries can never share a path — the sort
 * comparator only ever needs to say which of two *distinct* paths sorts first, never "equal".
 */
export function explainOverlay(
  result: CompileResult,
  kind: DocumentKind,
  id: string,
): readonly FieldProvenanceEntry[] {
  const entity = result.documents[kind].get(id);
  if (entity === undefined) return [];
  return [...entity.provenance.entries()]
    .map(([path, layer]) => ({ path, layer }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}
