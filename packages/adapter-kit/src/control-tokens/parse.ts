/**
 * `parseControlTokens` — `05` §5.5's own closing line: "Structured control tokens (`FORGE_*`) are
 * parsed out of agent output by the adapter layer... Each has a schema; unknown tokens are logged and
 * ignored." One shared implementation every adapter (M7, M11) calls, rather than each hand-rolling its
 * own line scanner.
 *
 * @see specs/05 §5.5
 * @see SPEC-QUESTIONS.md Q59
 * @see PLAN-M4.md P3
 */
import type { ParsedControlToken } from '../types/control-tokens.ts';
import { scanLine } from './scan.ts';

export interface ParseControlTokensResult {
  readonly tokens: readonly ParsedControlToken[];
  readonly unknownLines: readonly string[];
}

/** Recognition is line-anchored: only a line whose own content (ignoring leading whitespace) starts
 * with a `FORGE_TOKEN:` prefix counts — a token name appearing mid-sentence is not a real token and is
 * not reported anywhere (neither `tokens` nor `unknownLines`), matching every worked example in `05`,
 * which always presents a token as a line of its own. A line that names one of the seven registered
 * tokens but whose payload doesn't fit that token's own grammar is treated the same as an unregistered
 * name: it lands in `unknownLines`, never silently dropped and never given partial/defaulted fields
 * (`SPEC-QUESTIONS.md` Q59 point 1). Windows line endings (`\r\n`) are handled the same as `\n`/`\r`
 * alone — a trailing `\r` never leaks into a parsed field. */
export function parseControlTokens(text: string): ParseControlTokensResult {
  const tokens: ParsedControlToken[] = [];
  const unknownLines: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const result = scanLine(line);
    if (result.kind === 'recognized') tokens.push(result.token);
    else if (result.kind === 'unknown') unknownLines.push(result.raw);
  }
  return { tokens, unknownLines };
}
