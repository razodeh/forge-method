/**
 * `forge overlay explain <id>` — `03` §3.2.8, a thin wrapper over `@forge/extensions/compile`'s own
 * already-built `explainOverlay` (M2).
 *
 * Takes an already-real `CompileResult` (`forge compile`'s own output) rather than recompiling from
 * scratch — the same "this command's real caller already has the expensive object; don't rebuild it"
 * shape every other read-only command in this file family takes over already-parsed input.
 *
 * @see specs/03 §3.2.8
 * @see specs/15 §15.12
 */
import {
  explainOverlay,
  type CompileResult,
  type DocumentKind,
  type FieldProvenanceEntry,
} from '@forge/extensions/compile';

export function overlayExplain(
  result: CompileResult,
  kind: DocumentKind,
  id: string,
): readonly FieldProvenanceEntry[] {
  return explainOverlay(result, kind, id);
}
