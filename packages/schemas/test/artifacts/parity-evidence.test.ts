/**
 * `parityEvidenceSchema` — `specs/18` §18.7's `ParityEvidence` registry entry (`specs/22` M16 P5).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P5
 */
import { describe, expect, it } from 'vitest';

import { parityEvidenceSchema } from '../../src/artifacts/parity-evidence.ts';

const SHA40 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const SHA64 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const DIGEST = '1111111111111111111111111111111111111111111111111111111111111111'.slice(0, 64);
const CAPTURE_DIGEST = '2222222222222222222222222222222222222222222222222222222222222222'.slice(
  0,
  64,
);
const CONTENT_HASH = '3333333333333333333333333333333333333333333333333333333333333333'.slice(
  0,
  64,
);

function validParityEvidence(): Record<string, unknown> {
  return {
    id: 'PAR-001',
    type: 'ParityEvidence',
    schemaVersion: 1,
    title: 'forge parity check -- search-api',
    status: 'recorded',
    created: '2026-09-30',
    updated: '2026-09-30',
    revision: 1,
    author: 'engine',
    changelog: [],
    trusted: SHA40,
    headSha: SHA40,
    dirty: false,
    deltaDigest: DIGEST,
    toolVersions: { git: '2.43.0' },
    verdict: 'match',
    declarations: [
      {
        name: 'search-api',
        digest: DIGEST,
        reference: { ref: 'v1.2.0', sha: SHA40 },
        platform: 'linux-x64',
        captureDigest: CAPTURE_DIGEST,
        verdict: 'match',
        cases: [{ surface: 'process', caseIndex: 0, verdict: 'match', contentHash: CONTENT_HASH }],
        exemptCount: 0,
      },
    ],
  };
}

describe('parityEvidenceSchema — round trip (specs/22 M16 P5)', () => {
  it('accepts a real, full record and re-parses to the identical value', () => {
    const data = validParityEvidence();
    const result = parityEvidenceSchema.safeParse(data);
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
    if (!result.success) return;
    const reparsed = parityEvidenceSchema.safeParse(JSON.parse(JSON.stringify(result.data)));
    expect(reparsed.success).toBe(true);
    if (reparsed.success) expect(reparsed.data).toEqual(result.data);
  });

  it('accepts trusted: null (no --trusted given)', () => {
    const result = parityEvidenceSchema.safeParse({ ...validParityEvidence(), trusted: null });
    expect(result.success).toBe(true);
  });

  it('accepts a 64-hex (SHA-256 repository) trusted/headSha/reference.sha', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      trusted: SHA64,
      headSha: SHA64,
      declarations: [{ ...first, reference: { ref: 'v1.2.0', sha: SHA64 } }],
    });
    expect(
      result.success,
      result.success ? '' : JSON.stringify((result as { error: { issues: unknown } }).error.issues),
    ).toBe(true);
  });

  it('accepts an optional story', () => {
    const result = parityEvidenceSchema.safeParse({ ...validParityEvidence(), story: 'STORY-014' });
    expect(result.success).toBe(true);
  });

  it('accepts zero declarations with reason "no-declarations"', () => {
    const result = parityEvidenceSchema.safeParse({
      ...validParityEvidence(),
      verdict: 'invalid',
      reason: 'no-declarations',
      declarations: [],
    });
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts a declaration stopped at invalid with no cases and a reason', () => {
    const result = parityEvidenceSchema.safeParse({
      ...validParityEvidence(),
      verdict: 'invalid',
      reason: 'oracle-changed: .forge/parity/search-api.parity.yaml',
      declarations: [
        {
          name: 'search-api',
          digest: DIGEST,
          reference: { ref: 'v1.2.0', sha: SHA40 },
          platform: 'linux-x64',
          captureDigest: CAPTURE_DIGEST,
          verdict: 'invalid',
          reason: 'oracle-changed',
          cases: [],
          exemptCount: 0,
        },
      ],
    });
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts multiple declarations in ascending name order', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [first, { ...first, name: 'zzz-last' }],
    });
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts a case with no contentHash (a writer that cannot yet derive one)', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [{ ...first, cases: [{ surface: 'process', caseIndex: 0, verdict: 'match' }] }],
    });
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });
});

describe('parityEvidenceSchema — invalid, each asserting the error path (specs/22 M16 P5)', () => {
  it('rejects an id whose prefix does not match PAR', () => {
    const result = parityEvidenceSchema.safeParse({ ...validParityEvidence(), id: 'MUT-001' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a type other than the literal "ParityEvidence"', () => {
    const result = parityEvidenceSchema.safeParse({
      ...validParityEvidence(),
      type: 'MutationEvidence',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    const result = parityEvidenceSchema.safeParse({ ...validParityEvidence(), extra: 'nope' });
    expect(result.success).toBe(false);
  });

  it('rejects an abbreviated (short) trusted sha', () => {
    const result = parityEvidenceSchema.safeParse({ ...validParityEvidence(), trusted: 'a1b2c3d' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['trusted']);
  });

  it('rejects an upper-case headSha', () => {
    const result = parityEvidenceSchema.safeParse({
      ...validParityEvidence(),
      headSha: SHA40.toUpperCase(),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['headSha']);
  });

  it('rejects a non-boolean dirty', () => {
    const result = parityEvidenceSchema.safeParse({ ...validParityEvidence(), dirty: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects a deltaDigest that is not 64 hex characters', () => {
    const result = parityEvidenceSchema.safeParse({ ...validParityEvidence(), deltaDigest: 'xyz' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['deltaDigest']);
  });

  it('rejects an overall verdict not in the real nine-member set', () => {
    const result = parityEvidenceSchema.safeParse({ ...validParityEvidence(), verdict: 'failing' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['verdict']);
  });

  it('rejects toolVersions with a non-string value', () => {
    const result = parityEvidenceSchema.safeParse({
      ...validParityEvidence(),
      toolVersions: { git: 123 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects reason "no-declarations" alongside a non-empty declarations list', () => {
    const result = parityEvidenceSchema.safeParse({
      ...validParityEvidence(),
      reason: 'no-declarations',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['declarations']);
  });

  it('rejects declarations out of name order', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [
        { ...first, name: 'zzz' },
        { ...first, name: 'aaa' },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path[0]).toBe('declarations');
  });

  it('rejects duplicate declaration names', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({ ...data, declarations: [first, { ...first }] });
    expect(result.success).toBe(false);
  });

  it('rejects a declaration with verdict "match" and a reason present', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [{ ...first, reason: 'should not be here' }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['declarations', 0, 'reason']);
  });

  it('rejects a declaration with verdict "mismatch" and no reason', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [
        {
          ...first,
          verdict: 'mismatch',
          cases: [{ surface: 'process', caseIndex: 0, verdict: 'mismatch' }],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['declarations', 0, 'reason']);
  });

  it('rejects a stopped declaration (invalid) that still carries cases', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [{ ...first, verdict: 'invalid', reason: 'bad declaration' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['declarations', 0, 'cases']);
  });

  it('rejects a non-stopped declaration (match) with zero cases', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [{ ...first, cases: [] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['declarations', 0, 'cases']);
  });

  it('rejects a case contentHash that is not 64 hex characters (never raw observed text)', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [
        {
          ...first,
          cases: [
            {
              surface: 'process',
              caseIndex: 0,
              verdict: 'match',
              contentHash: 'the quick brown fox -- this is raw text, not a hash',
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['declarations', 0, 'cases', 0, 'contentHash']);
    }
  });

  it('rejects a case surface outside the real four-member set', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [{ ...first, cases: [{ surface: 'network', caseIndex: 0, verdict: 'match' }] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative caseIndex', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [
        { ...first, cases: [{ surface: 'process', caseIndex: -1, verdict: 'match' }] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a platform not shaped <os>-<arch>', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [{ ...first, platform: 'LINUX_X64' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative exemptCount', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [{ ...first, exemptCount: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an exemptCount over 4 (13 F-TEST-9 names exactly four surfaces)', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [{ ...first, exemptCount: 1_000_000 }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['declarations', 0, 'exemptCount']);
  });

  it('rejects exemptCount plus observed surfaces exceeding four, even when exemptCount alone is <= 4', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    // One observed surface (process, from `first`'s own case) plus 4 claimed exempt is 5 total.
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [{ ...first, exemptCount: 4 }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['declarations', 0, 'exemptCount']);
  });
});

describe('parityEvidenceSchema — verdict-precedence invariants (specs/22 M16 P5) (13 F-TEST-9)', () => {
  it('rejects declarations: [] with an overall verdict other than "invalid"/"no-declarations" (the reverse of the already-checked direction)', () => {
    const result = parityEvidenceSchema.safeParse({
      ...validParityEvidence(),
      verdict: 'match',
      declarations: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['verdict']);
  });

  it('rejects a declaration verdict of "match" whose own cases include a "mismatch"', () => {
    const data = validParityEvidence();
    const declarations = data['declarations'] as Record<string, unknown>[];
    const first = declarations[0]!;
    const result = parityEvidenceSchema.safeParse({
      ...data,
      declarations: [
        {
          ...first,
          cases: [
            { surface: 'process', caseIndex: 0, verdict: 'match' },
            { surface: 'file', caseIndex: 0, verdict: 'mismatch' },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join('.') === 'declarations.0.verdict'),
      ).toBe(true);
    }
  });

  it('rejects an overall verdict of "match" while the sole declaration is "invalid"', () => {
    const data = validParityEvidence();
    const result = parityEvidenceSchema.safeParse({
      ...data,
      verdict: 'match',
      declarations: [
        {
          name: 'search-api',
          digest: DIGEST,
          reference: { ref: 'v1.2.0', sha: SHA40 },
          platform: 'linux-x64',
          captureDigest: CAPTURE_DIGEST,
          verdict: 'invalid',
          reason: 'bad declaration',
          cases: [],
          exemptCount: 0,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'verdict')).toBe(true);
    }
  });

  it('rejects the exact reverse: an overall verdict of "mismatch" while the sole declaration is "match"', () => {
    const result = parityEvidenceSchema.safeParse({
      ...validParityEvidence(),
      verdict: 'mismatch',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'verdict')).toBe(true);
    }
  });
});
