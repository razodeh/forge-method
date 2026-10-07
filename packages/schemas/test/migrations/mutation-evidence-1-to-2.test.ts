/**
 * `mutationEvidence1To2` — golden-file tests, both directions (`18` §18.9, `specs/22` M16 P5).
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7, §18.9
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-10
 * @see process/plans/PLAN-M16.md P5
 */
import { describe, expect, it } from 'vitest';

import { applyMigrations } from '../../src/migrations/apply.ts';
import { mutationEvidence1To2 } from '../../src/migrations/mutation-evidence-1-to-2.ts';
import type { MigratableDocument } from '../../src/migrations/types.ts';

/** `Migration.down` is declared optional (`down?(doc): doc`) because an irreversible migration has
 * none — `mutationEvidence1To2` always does, but the type does not know that, so every direct call
 * below goes through this assertion rather than a bare, possibly-`undefined` `.down(doc)`. */
function down(doc: MigratableDocument): MigratableDocument {
  if (mutationEvidence1To2.down === undefined) throw new Error('mutationEvidence1To2 has no down');
  return mutationEvidence1To2.down(doc);
}

/** A real, schema-version-1 "before" fixture: a genuine `revert-implementation` record, exactly as
 * `mutation-evidence.test.ts`'s own `validMutationEvidence()` builds one, with its own own `type`
 * carried alongside `frontmatter` the way `MigratableDocument` requires. */
function before(): MigratableDocument {
  return {
    type: 'MutationEvidence',
    body: '<Nothing further...>',
    frontmatter: {
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
      namedTests: ['STORY-014: AC-014-1'],
      failedUnderMutation: ['STORY-014: AC-014-1'],
      restoreVerified: true,
      toolVersions: { vitest: '4.1.11' },
      ranAt: '2026-09-30T12:00:00.000Z',
    },
  };
}

/** A real hunk-level "before" fixture — already schemaVersion 2 (it has no version-1 form at all,
 * `18` §18.7's own words), used only for the `down` refusal tests below. */
function hunkLevel(): MigratableDocument {
  const base = before();
  return {
    ...base,
    frontmatter: {
      ...base.frontmatter,
      schemaVersion: 2,
      mutationKind: 'revert-hunks',
      hunkRun: {
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
            killedBy: ['STORY-014: AC-014-1'],
          },
        ],
      },
    },
  };
}

describe('mutationEvidence1To2.up (specs/22 M16 P5)', () => {
  it('sets schemaVersion: 2 and changes nothing else (golden before/after)', () => {
    const after = mutationEvidence1To2.up(before());
    expect(after.frontmatter['schemaVersion']).toBe(2);
    expect({ ...after.frontmatter, schemaVersion: 1 }).toEqual(before().frontmatter);
    // Round-2 critic: a mutation that silently discarded `body`/`type` (returning `{type, body: '',
    // frontmatter: {...}}`) left every assertion above green, since neither had ever been checked.
    expect(after.body).toBe(before().body);
    expect(after.type).toBe(before().type);
  });

  it('is pure: does not mutate its own input', () => {
    const input = before();
    const frozen = structuredClone(input.frontmatter);
    mutationEvidence1To2.up(input);
    expect(input.frontmatter).toEqual(frozen);
  });

  it('through applyMigrations: a real schemaVersion-1 document migrates to schemaVersion 2', () => {
    const result = applyMigrations(before(), { direction: 'up', steps: [mutationEvidence1To2] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.document.frontmatter['schemaVersion']).toBe(2);
  });
});

describe('mutationEvidence1To2.down — a change-level record (specs/22 M16 P5)', () => {
  it('strips the schemaVersion-2 shape and sets schemaVersion: 1, reproducing the original golden "before"', () => {
    const after = mutationEvidence1To2.up(before());
    const roundTripped = down(after);
    expect(roundTripped.frontmatter).toEqual(before().frontmatter);
    // Round-2 critic: a mutation that silently discarded `body`/`type` left this round-trip's own
    // frontmatter assertion green, since neither field had ever been checked.
    expect(roundTripped.body).toBe(before().body);
    expect(roundTripped.type).toBe(before().type);
  });

  it('a revert-implementation record never had hunkRun, so down is a true no-op on that field', () => {
    const data = before();
    expect(data.frontmatter['hunkRun']).toBeUndefined();
    const after = down(mutationEvidence1To2.up(data));
    expect(after.frontmatter['hunkRun']).toBeUndefined();
  });

  // A migration transforms raw, on-disk frontmatter -- not necessarily a document the CURRENT schema
  // would accept (`18` §18.9: "document in, document out", no schema validation of its own). A stray
  // `hunkRun` alongside `mutationKind: 'revert-implementation'` is exactly the schema-invalid shape
  // `parityEvidenceSchema`'s own `superRefine` would reject on a FRESH write, but `down` must still
  // strip it defensively on an OLDER, already-on-disk record -- this is the one case the two "no
  // hunkRun to strip" tests above cannot exercise at all, since neither ever gives `down` a non-empty
  // `hunkRun` to actually remove.
  it('strips a stray hunkRun even on an otherwise revert-implementation record (defensive: a migration transforms raw frontmatter, not a pre-validated document)', () => {
    const withStrayHunkRun: MigratableDocument = {
      ...before(),
      frontmatter: {
        ...before().frontmatter,
        schemaVersion: 2,
        hunkRun: hunkLevel().frontmatter['hunkRun'],
      },
    };
    expect(withStrayHunkRun.frontmatter['hunkRun']).toBeDefined();
    const after = down(withStrayHunkRun);
    expect(after.frontmatter['hunkRun']).toBeUndefined();
    expect(after.frontmatter).toEqual(before().frontmatter);
  });
});

describe('mutationEvidence1To2.down — hunk-level refusal (specs/22 M16 P5) (13 F-TEST-10)', () => {
  it('throws rather than silently stripping hunkRun, naming the record id and why', () => {
    expect(() => down(hunkLevel())).toThrow(/MUT-001.*revert-hunks/s);
  });

  it('never a silent no-op: the thrown message says there is no version-1 form, not merely that something failed', () => {
    expect(() => down(hunkLevel())).toThrow(/no version-1 form/);
  });

  it('names "(unknown id)" rather than crashing when the record carries no string id at all', () => {
    const withoutId: MigratableDocument = {
      ...hunkLevel(),
      frontmatter: { ...hunkLevel().frontmatter, id: 42 },
    };
    expect(() => down(withoutId)).toThrow(/\(unknown id\).*revert-hunks/s);
  });

  it('through applyMigrations: the refusal is caught as a structured MigrationStepFailure, never an uncaught crash', () => {
    const result = applyMigrations(hunkLevel(), {
      direction: 'down',
      steps: [mutationEvidence1To2],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failure.migration).toBe(mutationEvidence1To2);
      expect(result.failure.cause).toBeInstanceOf(Error);
      expect((result.failure.cause as Error).message).toMatch(/revert-hunks/);
      expect(result.appliedBeforeFailure).toEqual([]);
    }
  });

  it('a change-level record with the SAME story never hits the refusal (the kind, not the story, decides it)', () => {
    const after = mutationEvidence1To2.up(before());
    expect(() => down(after)).not.toThrow();
  });
});
