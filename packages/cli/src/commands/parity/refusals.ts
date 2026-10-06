/**
 * `secretRefusal`/`lossyUtf8Refusal` — `13` F-TEST-9's own refusal rule, checked HERE, before
 * anything this piece returns is written to a capture or handed up as a comparable observation:
 * "An observation that contains a secret, or a text observation that does not decode as UTF-8, is
 * refused ... before anything is stored."
 *
 * Both return the refusal as DATA (a constructed `ForgeError`, never thrown) rather than throwing
 * directly: a secret or a lossy decode found on one case's stdout must not abort every other case's
 * observation, so `observe.ts`'s own per-case loop decides what to do with the returned error (fold
 * it into that one case's own `failed` outcome) rather than this module deciding how far the failure
 * propagates.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 */
import { ForgeError } from '@forge/core/errors';
import { SECRET_PATTERNS } from '@forge/extensions/skills';

import type { SurfaceKind } from './declaration-types.ts';

/**
 * `RUN-121` when `text` contains a secret-shaped value (`SECRET_PATTERNS`), `undefined` otherwise.
 * Runs on the lossy-decoded TEXT, not the raw bytes: a secret is a text pattern, and `SECRET_PATTERNS`
 * is already written as such (the identical set `@forge/engine/dispatch/facades.ts` and
 * `@forge/engine/dispatch/result-record.ts` already scan real event/result text with).
 */
export function secretRefusal(
  surface: SurfaceKind,
  stream: string,
  text: string,
): ForgeError | undefined {
  const matched = SECRET_PATTERNS.some((pattern) => pattern.test(text));
  return matched ? new ForgeError('RUN-121', { surface, stream }) : undefined;
}

/**
 * `RUN-122` when `bytes` is not a valid UTF-8 byte sequence at all, `undefined` otherwise. Decided
 * with a STRICT (`fatal: true`) `TextDecoder` over the RAW bytes `preserveRawOutput` hands back —
 * never on a string a lossy decode already produced.
 *
 * **This refuses an invalid byte sequence, not the codepoint U+FFFD.** Q294 Decision 7's own
 * "refusing any U+FFFD is the conservative fallback for the decode" was written for a world where
 * only a lossy-decoded STRING was available, in which a real U+FFFD and a lossy-decode artifact are
 * indistinguishable, so refusing every occurrence was the only sound fallback. This piece's own
 * `preserveRawOutput` addition changes that premise: deciding on the RAW BYTES, a strict decoder can
 * tell the two apart precisely — a byte sequence that is itself a genuinely valid 3-byte UTF-8
 * encoding of U+FFFD (`0xEF 0xBF 0xBD`) decodes successfully here and is NOT refused, which is
 * strictly more accurate information than the all-U+FFFD-is-suspect rule could give when a lossy
 * string was the only thing available (round-2 critic finding, confirmed live: this is correct
 * behaviour given the raw bytes, not a residual gap — see `refusals.test.ts`'s own, deliberately
 * contrasting pair of tests for an invalid sequence versus a genuinely valid encoding of U+FFFD).
 */
export function lossyUtf8Refusal(
  surface: SurfaceKind,
  stream: string,
  bytes: Uint8Array,
): ForgeError | undefined {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return undefined;
  } catch {
    return new ForgeError('RUN-122', { surface, stream });
  }
}
