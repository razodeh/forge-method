/**
 * `claimsFromSession` — the one real defensive-parsing step every `@forge/engine/adopt` dispatch call
 * shares: an LLM session's own `SessionResult.structured` is untrusted input (`20` §20.5 point 1 —
 * "never interpolated directly into an instruction position," and never trusted as well-typed data
 * either) by the identical reasoning `dispatch-agent-step.ts`'s own `reviewOutputFromSession` already
 * applies to `swarm-review`'s output: a missing field, a wrong-typed field, or a malformed `evidence`
 * entry degrades that one *claim*, not the whole session's output — one participant's partially
 * malformed response should not discard its own other, well-formed claims.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P16
 */
import type { SessionResult } from '@forge/adapter-kit';
import type { EvidenceRef } from '@forge/kb/adopt';

/** Every evidence entry an untrusted `structured.evidence` array might contain, kept only when it is
 * shaped exactly like a real `EvidenceRef` — a malformed entry (missing `path`/`description`, wrong
 * `kind`) is dropped, not coerced into a guess, since a claim `isKnownEvidence` cannot check against the
 * real index is exactly as unciteable as a claim with no evidence at all. */
export function parseEvidenceList(value: unknown): readonly EvidenceRef[] {
  if (!Array.isArray(value)) return [];
  const refs: EvidenceRef[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as Readonly<Record<string, unknown>>;
    if (candidate['kind'] === 'path' && typeof candidate['path'] === 'string') {
      const line = candidate['line'];
      refs.push({
        kind: 'path',
        path: candidate['path'],
        ...(typeof line === 'number' ? { line } : {}),
      });
    } else if (candidate['kind'] === 'fact' && typeof candidate['description'] === 'string') {
      refs.push({ kind: 'fact', description: candidate['description'] });
    }
  }
  return refs;
}

/**
 * `structured.claims`, filtered through `parseItem` — items `parseItem` returns `undefined` for are
 * dropped silently (a malformed claim contributes nothing, matching `evidence`'s own per-item tolerance),
 * never thrown for. A session with no `structured` output, or whose `structured` is not an object, or
 * whose `claims` is not an array, yields an empty list rather than a crash — the same "degrade this
 * session's own contribution to nothing real, do not fail the whole phase" policy every dispatch mode in
 * this codebase already applies to a malformed structured response.
 */
export function claimsFromSession<T>(
  session: SessionResult,
  parseItem: (raw: Readonly<Record<string, unknown>>) => T | undefined,
): readonly T[] {
  const structured = session.structured;
  if (typeof structured !== 'object' || structured === null) return [];
  const raw = structured as Readonly<Record<string, unknown>>;
  const rawClaims = Array.isArray(raw['claims']) ? raw['claims'] : [];
  const claims: T[] = [];
  for (const entry of rawClaims) {
    if (typeof entry !== 'object' || entry === null) continue;
    const parsed = parseItem(entry as Readonly<Record<string, unknown>>);
    if (parsed !== undefined) claims.push(parsed);
  }
  return claims;
}
