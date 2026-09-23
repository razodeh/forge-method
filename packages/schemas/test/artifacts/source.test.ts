/**
 * `artifactSourceSchema` — one provenance entry (`08` §8.3/§8.6), shared by `kbEntrySchema`
 * (`@forge/kb`, where it stays required) and the six KB-located registry schemas this piece
 * (`PLAN-M14.md` P11) gives an OPTIONAL `sources` field.
 *
 * @see specs/08 §8.3
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 */
import { describe, expect, it } from 'vitest';

import { artifactSourceSchema } from '../../src/artifacts/source.ts';

describe('artifactSourceSchema — valid', () => {
  it('accepts each of the three kinds `08` §8.3 names', () => {
    for (const kind of ['decision', 'human', 'code']) {
      expect(artifactSourceSchema.safeParse({ kind, ref: 'ADR-0011' }).success).toBe(true);
    }
  });
});

describe('artifactSourceSchema — invalid, each asserting the error path', () => {
  it('rejects a kind outside the closed enum', () => {
    const result = artifactSourceSchema.safeParse({ kind: 'guess', ref: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['kind']);
  });

  it('rejects an empty ref', () => {
    const result = artifactSourceSchema.safeParse({ kind: 'decision', ref: '' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['ref']);
  });

  it('rejects a missing ref', () => {
    const result = artifactSourceSchema.safeParse({ kind: 'decision' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['ref']);
  });

  it('rejects an unknown key', () => {
    const result = artifactSourceSchema.safeParse({ kind: 'decision', ref: 'x', extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
