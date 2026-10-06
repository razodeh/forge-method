/**
 * `selectCapture` — `13` F-TEST-9's capture selection: a capture is selected by the key
 * `(name, declaration digest, reference sha, platform)`; none selected is `missing`; two or more
 * differing captures under one key is `ambiguous`.
 *
 * Pure: takes the already-read, already-parsed captures as a plain array (reading
 * `.forge/parity/captures/*.json` off disk is P6/P7's job, not this pure-data piece's). "A selected
 * capture that holds no entry for one of the declaration's cases on a surface that is not exempt...
 * also reads `missing`" (`13` F-TEST-9) is explicitly left to P6/P7: this module exposes the
 * selected capture's own `cases` list (keyed by surface and case index, `capture.ts`'s
 * `ParityCaptureCaseEntry`) for that caller to check against the declaration's own surfaces, rather
 * than re-deriving "which cases a declaration expects" here, which this pure selection step has no
 * need to know.
 *
 * @see specs/13 F-TEST-9
 * @see process/plans/PLAN-M16.md P2
 */
import { serialiseCapture, type ParityCapture } from './capture.ts';

/** The key `13` F-TEST-9 selects a capture by. `referenceSha` is "the one `reference.ref` resolves
 * to when the check runs" — resolution is P6/P7's job; this module only compares the sha it is
 * given. */
export interface CaptureSelectionKey {
  readonly name: string;
  readonly digest: string;
  readonly referenceSha: string;
  readonly platform: string;
}

/** {@link selectCapture}'s own result: none matching the key, exactly one (after de-duplicating
 * byte-identical files), or two or more that genuinely differ. */
export type CaptureSelectionResult =
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'selected'; readonly capture: ParityCapture }
  | { readonly outcome: 'ambiguous'; readonly captures: readonly ParityCapture[] };

/**
 * Selects the one capture matching `key` among `captures`, or reports why none was selected.
 *
 * "Two or more differing captures" is decided on their own canonical bytes
 * ({@link serialiseCapture}), never on object identity or a shallow field comparison: several
 * byte-identical captures under the same key (`13` F-TEST-9: "capturing identical behaviour again is
 * a no-op") still select as one.
 */
export function selectCapture(
  captures: readonly ParityCapture[],
  key: CaptureSelectionKey,
): CaptureSelectionResult {
  const matching = captures.filter(
    (capture) =>
      capture.name === key.name &&
      capture.digest === key.digest &&
      capture.reference.sha === key.referenceSha &&
      capture.platform === key.platform,
  );
  if (matching.length === 0) return { outcome: 'missing' };

  const distinct = new Map<string, ParityCapture>();
  for (const capture of matching) {
    const bytes = serialiseCapture(capture);
    if (!distinct.has(bytes)) distinct.set(bytes, capture);
  }
  if (distinct.size === 1) {
    const [capture] = distinct.values();
    if (capture === undefined) return { outcome: 'missing' };
    return { outcome: 'selected', capture };
  }
  return { outcome: 'ambiguous', captures: [...distinct.values()] };
}
