/**
 * `parseEvidenceList`/`claimsFromSession` — the defensive-parsing layer every `@forge/engine/adopt`
 * dispatch call shares, unit-tested directly against every malformed shape an untrusted `SessionResult.
 * structured` could plausibly carry.
 *
 * @see PLAN-M10.md P16
 */
import type { SessionResult } from '@forge/adapter-kit';
import { describe, expect, it } from 'vitest';

import { claimsFromSession, parseEvidenceList } from '../../src/adopt/session-claims.ts';

function sessionWith(structured: unknown): SessionResult {
  return { ok: true, finalText: '', structured } as SessionResult;
}

describe('parseEvidenceList', () => {
  it('returns [] for a non-array value', () => {
    expect(parseEvidenceList('not an array')).toEqual([]);
    expect(parseEvidenceList(undefined)).toEqual([]);
    expect(parseEvidenceList(null)).toEqual([]);
  });

  it('skips a non-object entry', () => {
    expect(parseEvidenceList(['a string entry', 42, null])).toEqual([]);
  });

  it('parses a real path entry, with and without a line number', () => {
    expect(
      parseEvidenceList([
        { kind: 'path', path: 'src/a.ts' },
        { kind: 'path', path: 'src/b.ts', line: 12 },
      ]),
    ).toEqual([
      { kind: 'path', path: 'src/a.ts' },
      { kind: 'path', path: 'src/b.ts', line: 12 },
    ]);
  });

  it('drops a path entry with a non-numeric line -- kept, minus the malformed line field', () => {
    expect(parseEvidenceList([{ kind: 'path', path: 'src/a.ts', line: 'twelve' }])).toEqual([
      { kind: 'path', path: 'src/a.ts' },
    ]);
  });

  it('drops a path entry missing its own path field', () => {
    expect(parseEvidenceList([{ kind: 'path' }])).toEqual([]);
  });

  it('parses a real fact entry', () => {
    expect(
      parseEvidenceList([{ kind: 'fact', description: 'external-dependency:x@1.0.0' }]),
    ).toEqual([{ kind: 'fact', description: 'external-dependency:x@1.0.0' }]);
  });

  it('drops a fact entry missing its own description field', () => {
    expect(parseEvidenceList([{ kind: 'fact' }])).toEqual([]);
  });

  it('drops an entry with an unrecognised kind', () => {
    expect(parseEvidenceList([{ kind: 'guess', path: 'src/a.ts' }])).toEqual([]);
  });
});

describe('claimsFromSession', () => {
  const keepAll = (raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
    raw;

  it('returns [] when structured is absent, null, or not an object', () => {
    expect(claimsFromSession(sessionWith(undefined), keepAll)).toEqual([]);
    expect(claimsFromSession(sessionWith(null), keepAll)).toEqual([]);
    expect(claimsFromSession(sessionWith('not an object'), keepAll)).toEqual([]);
  });

  it('returns [] when structured.claims is missing or not an array', () => {
    expect(claimsFromSession(sessionWith({}), keepAll)).toEqual([]);
    expect(claimsFromSession(sessionWith({ claims: 'not an array' }), keepAll)).toEqual([]);
  });

  it('skips a non-object claim entry, keeps a real one', () => {
    const result = claimsFromSession(
      sessionWith({ claims: ['a string entry', null, { real: true }] }),
      keepAll,
    );
    expect(result).toEqual([{ real: true }]);
  });

  it('drops a claim parseItem itself rejects as undefined, keeps the rest', () => {
    const result = claimsFromSession(
      sessionWith({ claims: [{ ok: false }, { ok: true }] }),
      (raw) => (raw['ok'] === true ? raw : undefined),
    );
    expect(result).toEqual([{ ok: true }]);
  });
});
