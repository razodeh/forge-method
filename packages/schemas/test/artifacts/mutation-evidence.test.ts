/**
 * `mutationEvidenceSchema` — `specs/18` §18.7's `MutationEvidence` registry entry, made real.
 *
 * Every field here is committed verbatim from `PLAN-M15.md` P2's own Mandate (quoted in full in
 * `SPEC-QUESTIONS.md` Q280's Decision 3): the story/piece id, the mutation kind
 * (`revert-implementation` in v1 — a literal, not an enum, since v1 names no other kind; widening
 * it is a schema migration, not a config change), the exact commit range reverted (`fromSha`/`toSha`
 * — v1 is whole-change revert, not per-hunk, so a range is the right grain; per-hunk precision is
 * `specs/22` M16's own, explicitly deferred), the named tests, which of them failed under the revert
 * (the actual binding evidence), the restore verification, tool versions, and a timestamp
 * (`ranAt` — distinct from the base front matter's own date-only `created`, mirroring `GateReport`'s
 * own `evaluatedAt` for the identical reason: a date has no time-of-day precision).
 *
 * `nonBinding` (a named test that is NOT in `failedUnderMutation`) is deliberately NOT a stored field:
 * it is `namedTests` minus `failedUnderMutation`, computable by any reader, and storing it separately
 * would be redundant data that could drift out of sync with the two fields it is derived from.
 *
 * One file per `forge test binding` run (`reports/mutation/{story}-{ts}.md`) — never revisited.
 * Immutability (a second write to the same path is refused, not silently overwritten) is enforced by
 * `@forge/core/fs`'s `writeNewFileAtomic`, not by this schema: a schema validates a document's shape,
 * not how or whether it gets written, so the write-refusal test lives with the writer primitive
 * (`packages/core/test/fs/atomic.test.ts`) and its own end-to-end proof against a real record of this
 * type (`packages/core/test/artifacts/append-only-evidence.test.ts`), not here.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P2
 * @see SPEC-QUESTIONS.md Q280
 */
import { describe, expect, it } from 'vitest';

import { mutationEvidenceSchema } from '../../src/artifacts/mutation-evidence.ts';

function validMutationEvidence(): Record<string, unknown> {
  return {
    id: 'MUT-001',
    type: 'MutationEvidence',
    schemaVersion: 1,
    title: 'forge test binding — STORY-014',
    status: 'recorded',
    created: '2026-09-30',
    updated: '2026-09-30',
    revision: 1,
    author: 'engine',
    changelog: [],
    story: 'STORY-014',
    mutationKind: 'revert-implementation',
    revertedRange: {
      fromSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      toSha: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5',
    },
    namedTests: ['STORY-014: AC-014-1', 'STORY-014: AC-014-2'],
    failedUnderMutation: ['STORY-014: AC-014-1'],
    restoreVerified: true,
    toolVersions: { vitest: '4.1.11', node: 'v22.14.0' },
    ranAt: '2026-09-30T12:00:00.000Z',
  };
}

describe('mutationEvidenceSchema — valid', () => {
  it('accepts a real, full record', () => {
    const result = mutationEvidenceSchema.safeParse(validMutationEvidence());
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts failedUnderMutation as empty (every named test is non-binding — the worst case, still a valid record, not a schema failure)', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validMutationEvidence(),
      failedUnderMutation: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts failedUnderMutation equal to namedTests (every named test is binding)', () => {
    const data = validMutationEvidence();
    const result = mutationEvidenceSchema.safeParse({
      ...data,
      failedUnderMutation: data['namedTests'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts restoreVerified: false (a real, disclosed failure to restore cleanly — still a valid record of what happened, not a schema error)', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validMutationEvidence(),
      restoreVerified: false,
    });
    expect(result.success).toBe(true);
  });
});

describe('mutationEvidenceSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match its type', () => {
    const result = mutationEvidenceSchema.safeParse({ ...validMutationEvidence(), id: 'RUN-001' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a type other than the literal "MutationEvidence"', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validMutationEvidence(),
      type: 'EvidenceBundle',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  it('rejects an unknown top-level key', () => {
    const result = mutationEvidenceSchema.safeParse({ ...validMutationEvidence(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });

  it('rejects a mutationKind other than "revert-implementation" (v1 names no other kind)', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validMutationEvidence(),
      mutationKind: 'per-hunk',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['mutationKind']);
  });

  it('rejects a missing story', () => {
    const data = validMutationEvidence();
    delete data['story'];
    const result = mutationEvidenceSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['story']);
  });

  it('rejects an empty namedTests (a binding run with nothing named is not a real run)', () => {
    const result = mutationEvidenceSchema.safeParse({ ...validMutationEvidence(), namedTests: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['namedTests']);
  });

  it('rejects revertedRange missing toSha', () => {
    const data = validMutationEvidence();
    const revertedRange = data['revertedRange'] as Record<string, unknown>;
    delete revertedRange['toSha'];
    const result = mutationEvidenceSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['revertedRange', 'toSha']);
  });

  it('rejects a revertedRange sha that is not 40 real hex characters', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validMutationEvidence(),
      revertedRange: { fromSha: 'deadbeef', toSha: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['revertedRange', 'fromSha']);
  });

  it('rejects a non-boolean restoreVerified', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validMutationEvidence(),
      restoreVerified: 'yes',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['restoreVerified']);
  });

  it('rejects a ranAt that is not a real ISO instant', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validMutationEvidence(),
      ranAt: '2026-09-30',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['ranAt']);
  });

  it('rejects toolVersions with a non-string value', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validMutationEvidence(),
      toolVersions: { vitest: 4.1 },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['toolVersions', 'vitest']);
  });

  it('rejects failedUnderMutation naming a test not present in namedTests (evidence cannot reference a test it never named)', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validMutationEvidence(),
      failedUnderMutation: ['STORY-014: AC-014-1', 'STORY-014: AC-014-99-never-named'],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['failedUnderMutation']);
  });
});

function validHunkRun(): Record<string, unknown> {
  return {
    baseSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    diffAlgorithm: 'git diff -U0 --no-renames (myers)',
    granularity: 'hunk',
    hunks: [
      {
        id: 'src/search.ts#1',
        path: 'src/search.ts',
        ranges: { old: { start: 10, length: 2 }, new: { start: 10, length: 3 } },
        contentHash: '4444444444444444444444444444444444444444444444444444444444444444'.slice(
          0,
          64,
        ),
        verdict: 'killed',
        killedBy: 'STORY-014: AC-014-1',
      },
    ],
  };
}

function validRevertHunksRecord(): Record<string, unknown> {
  return {
    ...validMutationEvidence(),
    schemaVersion: 2,
    mutationKind: 'revert-hunks',
    hunkRun: validHunkRun(),
  };
}

describe('mutationEvidenceSchema — revert-hunks (specs/22 M16 P5) (13 F-TEST-10)', () => {
  it('accepts a real, full revert-hunks record (schemaVersion 2, carrying hunkRun alongside revertedRange)', () => {
    const result = mutationEvidenceSchema.safeParse(validRevertHunksRecord());
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts granularity "file" and "change"', () => {
    for (const granularity of ['file', 'change']) {
      const data = validRevertHunksRecord();
      const hunkRun = data['hunkRun'] as Record<string, unknown>;
      const result = mutationEvidenceSchema.safeParse({
        ...data,
        hunkRun: { ...hunkRun, granularity },
      });
      expect(result.success, granularity).toBe(true);
    }
  });

  it.each(['uncovered', 'invalid', 'timeout', 'skipped'])(
    'accepts a hunk verdict of "%s" with no killedBy',
    (verdict) => {
      const data = validRevertHunksRecord();
      const hunkRun = data['hunkRun'] as Record<string, unknown>;
      const hunks = hunkRun['hunks'] as Record<string, unknown>[];
      const hunk = { ...hunks[0] };
      delete hunk['killedBy'];
      const result = mutationEvidenceSchema.safeParse({
        ...data,
        hunkRun: { ...hunkRun, hunks: [{ ...hunk, verdict }] },
      });
      expect(
        result.success,
        result.success
          ? ''
          : JSON.stringify((result as { error: { issues: unknown } }).error.issues),
      ).toBe(true);
    },
  );

  it('rejects mutationKind: "revert-hunks" with no hunkRun', () => {
    const data = validMutationEvidence();
    const result = mutationEvidenceSchema.safeParse({
      ...data,
      schemaVersion: 2,
      mutationKind: 'revert-hunks',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['hunkRun']);
  });

  it('rejects mutationKind: "revert-implementation" that carries a hunkRun', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validRevertHunksRecord(),
      mutationKind: 'revert-implementation',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['hunkRun']);
  });

  it('rejects a revert-hunks record at schemaVersion 1 (hunkRun needs 2 or higher)', () => {
    const result = mutationEvidenceSchema.safeParse({
      ...validRevertHunksRecord(),
      schemaVersion: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['schemaVersion']);
  });

  it('rejects a hunk verdict of "killed" with no killedBy', () => {
    const data = validRevertHunksRecord();
    const hunkRun = data['hunkRun'] as Record<string, unknown>;
    const hunks = hunkRun['hunks'] as Record<string, unknown>[];
    const hunk = { ...hunks[0] };
    delete hunk['killedBy'];
    const result = mutationEvidenceSchema.safeParse({
      ...data,
      hunkRun: { ...hunkRun, hunks: [hunk] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['hunkRun', 'hunks', 0, 'killedBy']);
    }
  });

  it('rejects a hunk verdict of "uncovered" that still carries a killedBy', () => {
    const data = validRevertHunksRecord();
    const hunkRun = data['hunkRun'] as Record<string, unknown>;
    const hunks = hunkRun['hunks'] as Record<string, unknown>[];
    const hunk = { ...hunks[0], verdict: 'uncovered' };
    const result = mutationEvidenceSchema.safeParse({
      ...data,
      hunkRun: { ...hunkRun, hunks: [hunk] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['hunkRun', 'hunks', 0, 'killedBy']);
    }
  });

  it('rejects a hunk contentHash that is not 64 hex characters (never raw reversed source text)', () => {
    const data = validRevertHunksRecord();
    const hunkRun = data['hunkRun'] as Record<string, unknown>;
    const hunks = hunkRun['hunks'] as Record<string, unknown>[];
    const hunk = { ...hunks[0], contentHash: 'function search() { /* the reversed hunk body */ }' };
    const result = mutationEvidenceSchema.safeParse({
      ...data,
      hunkRun: { ...hunkRun, hunks: [hunk] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a granularity outside the real three-member set', () => {
    const data = validRevertHunksRecord();
    const hunkRun = data['hunkRun'] as Record<string, unknown>;
    const result = mutationEvidenceSchema.safeParse({
      ...data,
      hunkRun: { ...hunkRun, granularity: 'hunks' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown key inside hunkRun', () => {
    const data = validRevertHunksRecord();
    const hunkRun = data['hunkRun'] as Record<string, unknown>;
    const result = mutationEvidenceSchema.safeParse({
      ...data,
      hunkRun: { ...hunkRun, extra: 'nope' },
    });
    expect(result.success).toBe(false);
  });

  // Round-2 critic: a `revert-hunks` record with `revertedRange.fromSha` and `hunkRun.baseSha` set to
  // two UNRELATED commits was accepted before this check existed -- both fields describe the same
  // revert base (this file's own DECISION comment on `mutationKind`), so they must agree.
  it('rejects revertedRange.fromSha and hunkRun.baseSha naming two different commits', () => {
    const data = validRevertHunksRecord();
    const revertedRange = data['revertedRange'] as Record<string, unknown>;
    const result = mutationEvidenceSchema.safeParse({
      ...data,
      revertedRange: {
        ...revertedRange,
        fromSha: '0000000000000000000000000000000000000000',
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['hunkRun', 'baseSha']);
    }
  });

  it('accepts revertedRange.fromSha and hunkRun.baseSha naming the identical commit (the ordinary case)', () => {
    const data = validRevertHunksRecord();
    const revertedRange = data['revertedRange'] as Record<string, unknown>;
    const hunkRun = data['hunkRun'] as Record<string, unknown>;
    expect(revertedRange['fromSha']).toBe(hunkRun['baseSha']);
    const result = mutationEvidenceSchema.safeParse(data);
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });
});
