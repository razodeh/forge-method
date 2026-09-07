/**
 * `stripControlTokens` — `20` §20.5 point 2: "Strip control tokens. `FORGE_*` tokens appearing inside
 * untrusted content are removed and logged as `InjectionAttemptBlocked`. This is done in the adapter
 * layer, at the boundary." This piece removes and returns the fact; per `SPEC-QUESTIONS.md` Q57, it
 * does not log anything itself (`@forge/adapter-kit` has no path to `@forge/telemetry`) — a caller with
 * `core`/`telemetry` access constructs the real `InjectionAttemptBlocked` event from `stripped`.
 *
 * @see specs/20 §20.5 point 2
 * @see SPEC-QUESTIONS.md Q57
 * @see SPEC-QUESTIONS.md Q59
 * @see PLAN-M4.md P3
 */
import type { ParsedControlToken } from '../types/control-tokens.ts';
import { scanLine } from './scan.ts';

export interface StripControlTokensResult {
  readonly text: string;
  readonly stripped: readonly ParsedControlToken[];
  readonly unknownLines: readonly string[];
}

/** Only a line that successfully parses into a real `ParsedControlToken` is removed — the identical
 * recognition `parseControlTokens` uses (both call the same `scanLine`), so `stripped` here is always
 * exactly what `parseControlTokens(text).tokens` would find for the same input, and `unknownLines` is
 * always exactly `parseControlTokens(text).unknownLines`. An unregistered-or-malformed `FORGE_`-shaped
 * line is left in the text untouched, not removed — silently deleting text this module cannot actually
 * interpret would be a worse failure mode than leaving it in place (`SPEC-QUESTIONS.md` Q59 point 2) —
 * but it is *reported* via `unknownLines`, not silently folded into "ordinary text": a gauntlet critic
 * found that a near-miss of a real token (one wrong space, one wrong pipe-field count) is exactly the
 * shape a genuine injection attempt is likely to take, and a caller who only inspected `stripped` had no
 * way to learn such a line existed at all. `unknownLines` gives a caller everything needed to flag or
 * escalate a near-miss even though this module itself does not delete it. A removed line's own line
 * terminator is removed with it (the next line folds up), so stripping never leaves a blank line where a
 * token line used to be; every other line, and every other line's own terminator style (`\n`, `\r\n`, or
 * `\r`), is preserved exactly — "changes nothing else in the text" (`PLAN-M4.md` P3) holds byte for
 * byte. */
export function stripControlTokens(text: string): StripControlTokensResult {
  const parts = text.split(/(\r\n|\r|\n)/);
  const stripped: ParsedControlToken[] = [];
  const unknownLines: string[] = [];
  const kept: string[] = [];
  // A removed line normally takes its own following terminator with it (the next line folds up). The
  // one line that has no following terminator is the text's very last segment — if it is removed and
  // the immediately preceding kept item is itself a terminator (this line's leading separator), that
  // terminator is now orphaned (it no longer separates anything) and must be un-kept instead, or the
  // result would end in a stray newline the input never had.
  let lastKeptWasTerminator = false;
  for (let i = 0; i < parts.length; i += 2) {
    // Cast, not a runtime check: `i < parts.length` (the loop condition) already guarantees this index
    // is in bounds — `noUncheckedIndexedAccess` cannot derive that from a loop bound, so this cast makes
    // it visible to the type checker instead of leaving an unreachable `?? ''` fallback in place.
    // `parts[i + 1]` (`terminatorAfter`, below) genuinely can be out of bounds — the last line of text
    // with no trailing terminator — so it keeps its own real `| undefined` type, unmodified. `!` is
    // banned in src/** in this codebase, so an explicit, commented `as` cast is used instead (see
    // packages/core/src/artifacts/edit.ts's identical loop-bound-guaranteed-index precedent).
    // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
    const line = parts[i] as string;
    const terminatorAfter = parts[i + 1];
    const result = scanLine(line);
    if (result.kind === 'recognized') {
      stripped.push(result.token);
      if (terminatorAfter === undefined && lastKeptWasTerminator) {
        kept.pop();
        lastKeptWasTerminator = false;
      }
      continue;
    }
    if (result.kind === 'unknown') unknownLines.push(result.raw);
    kept.push(line);
    lastKeptWasTerminator = false;
    if (terminatorAfter !== undefined) {
      kept.push(terminatorAfter);
      lastKeptWasTerminator = true;
    }
  }
  return { text: kept.join(''), stripped, unknownLines };
}
