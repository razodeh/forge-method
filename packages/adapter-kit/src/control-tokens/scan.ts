/**
 * Shared line-by-line `FORGE_*` control-token recognizer — the one place `parseControlTokens` and
 * `stripControlTokens` both derive "is this line a real control token" from, so the two functions can
 * never independently drift apart on which lines count (`SPEC-QUESTIONS.md` Q59 point 2: `stripped` is
 * defined to be exactly what `parseControlTokens` alone would have found, by construction, not by
 * coincidence). Not exported from the package — `scanLine` has no standalone use a caller would reach
 * for; `parseControlTokens`/`stripControlTokens` are the public surface.
 *
 * @see specs/05 §5.4 point 4
 * @see specs/05 §5.5
 * @see SPEC-QUESTIONS.md Q58 point 16
 * @see SPEC-QUESTIONS.md Q59
 * @see PLAN-M4.md P3
 */
import type { ParsedControlToken } from '../types/control-tokens.ts';

export type ScanResult =
  | { readonly kind: 'plain' }
  | { readonly kind: 'unknown'; readonly raw: string }
  | { readonly kind: 'recognized'; readonly token: ParsedControlToken };

const TOKEN_LINE_PATTERN = /^(FORGE_[A-Z0-9_]+):(.*)$/;

/** A line "names" a token only by its own content — leading whitespace is ignored (so an indented
 * token line still counts), but the match is anchored at the line's own start, so a token name
 * appearing mid-sentence (e.g. "...so I'll FORGE_ASK: is this right?") never matches at all. */
function matchTokenLine(
  line: string,
): { readonly name: string; readonly payload: string } | undefined {
  const match = TOKEN_LINE_PATTERN.exec(line.trimStart());
  // Both capture groups are mandatory in the pattern above (neither sits inside an optional
  // quantifier or alternation), so they are always populated together whenever `match` is non-null —
  // `noUncheckedIndexedAccess` cannot express that, so this reads as "did we get a match at all,"
  // covering the null-match and (structurally unreachable) partial-match cases in one check, the same
  // shape already established at `packages/kb/src/write/scan.ts`'s own `claimedByKbId`.
  const name = match?.[1];
  const payload = match?.[2];
  if (name === undefined || payload === undefined) return undefined;
  return { name, payload };
}

const ASSUME_CONFIDENCE_VALUES = new Set(['low', 'medium', 'high']);

/** Every field of every returned `ParsedControlToken` is guaranteed non-empty (and, for
 * `FORGE_ASSUME.confidence`, a genuine member of its literal union) — a payload that cannot satisfy
 * that returns `undefined` rather than a token with an empty/defaulted field, so a caller never has to
 * defensively re-check a "successfully parsed" token (`SPEC-QUESTIONS.md` Q59 point 1). */
function parseTokenPayload(name: string, rawPayload: string): ParsedControlToken | undefined {
  switch (name) {
    case 'FORGE_REQUEST_CONTEXT': {
      const query = rawPayload.trim();
      return query === '' ? undefined : { token: 'FORGE_REQUEST_CONTEXT', query };
    }
    case 'FORGE_ASK': {
      // `.split()` on any string always returns at least one element (the whole string, when the
      // separator never matches) — `noUncheckedIndexedAccess` cannot express that from the return type
      // alone, so this cast makes the always-true guarantee visible instead of leaving an unreachable
      // `?? ''` fallback in place.
      const [questionPart, ...rest] = rawPayload.split('|') as [string, ...string[]];
      const question = questionPart.trim();
      if (question === '') return undefined;
      const optionsPart = rest.join('|').trim();
      const options =
        optionsPart === ''
          ? []
          : optionsPart
              .split(',')
              .map((option) => option.trim())
              .filter((option) => option !== '');
      return { token: 'FORGE_ASK', question, options };
    }
    case 'FORGE_ASSUME': {
      const parts = rawPayload.split('|');
      if (parts.length !== 4) return undefined;
      // The length check above guarantees exactly four elements — `noUncheckedIndexedAccess` cannot
      // derive that from a `.length` comparison, so this cast makes it visible to the type checker
      // instead of leaving four unreachable `?? ''` fallbacks in place.
      const [textRaw, confidenceRaw, impactRaw, validateByRaw] = parts as [
        string,
        string,
        string,
        string,
      ];
      const text = textRaw.trim();
      const confidence = confidenceRaw.trim().toLowerCase();
      const impact = impactRaw.trim();
      const validateBy = validateByRaw.trim();
      if (text === '' || impact === '' || validateBy === '') return undefined;
      if (!ASSUME_CONFIDENCE_VALUES.has(confidence)) return undefined;
      // The `.has` check above proves membership; this cast makes that proof visible to the type
      // checker without a fourth redundant string-literal comparison chain.
      return {
        token: 'FORGE_ASSUME',
        text,
        confidence: confidence as 'low' | 'medium' | 'high',
        impact,
        validateBy,
      };
    }
    case 'FORGE_HANDOFF': {
      // `trimmed` has no leading/trailing whitespace (it is itself the result of `.trim()`), so once
      // `spaceIndex !== -1`, `role` (everything before the first space) and `reason` (everything from
      // just after it, re-trimmed) are provably non-empty: `role` contains at least `trimmed[0]`, and
      // `reason` contains at least `trimmed`'s own last character, which cannot itself be whitespace.
      // No separate emptiness check is reachable here — unlike `FORGE_ASSUME`'s pipe-delimited fields,
      // which are independently extracted and can each be genuinely blank.
      const trimmed = rawPayload.trim();
      const spaceIndex = trimmed.indexOf(' ');
      if (spaceIndex === -1) return undefined;
      const role = trimmed.slice(0, spaceIndex);
      const reason = trimmed.slice(spaceIndex + 1).trim();
      return { token: 'FORGE_HANDOFF', role, reason };
    }
    case 'FORGE_REQUEST_CHANGE': {
      // Same proof as FORGE_HANDOFF, above: once `spaceIndex !== -1`, `target`/`reason` are provably
      // non-empty.
      const trimmed = rawPayload.trim();
      const spaceIndex = trimmed.indexOf(' ');
      if (spaceIndex === -1) return undefined;
      const target = trimmed.slice(0, spaceIndex);
      const reason = trimmed.slice(spaceIndex + 1).trim();
      return { token: 'FORGE_REQUEST_CHANGE', target, reason };
    }
    case 'FORGE_CONFLICT': {
      const reason = rawPayload.trim();
      return reason === '' ? undefined : { token: 'FORGE_CONFLICT', reason };
    }
    case 'FORGE_LOAD_SKILL': {
      const skillId = rawPayload.trim();
      return skillId === '' ? undefined : { token: 'FORGE_LOAD_SKILL', skillId };
    }
    default:
      return undefined;
  }
}

export function scanLine(line: string): ScanResult {
  const match = matchTokenLine(line);
  if (match === undefined) return { kind: 'plain' };
  const token = parseTokenPayload(match.name, match.payload);
  if (token === undefined) return { kind: 'unknown', raw: line };
  return { kind: 'recognized', token };
}
