/**
 * `evidenceBundle1To2` — golden-file tests, both directions (`18` §18.9, `specs/22` M16 P5).
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7, §18.9
 * @see process/plans/PLAN-M16.md P5
 */
import { describe, expect, it } from 'vitest';

import { applyMigrations } from '../../src/migrations/apply.ts';
import { evidenceBundle1To2 } from '../../src/migrations/evidence-bundle-1-to-2.ts';
import type { MigratableDocument } from '../../src/migrations/types.ts';

/** `Migration.down` is declared optional (`down?(doc): doc`); `evidenceBundle1To2` always has one,
 * but the type does not know that -- the identical assertion `mutation-evidence-1-to-2.test.ts`'s
 * own `down` helper uses. */
function down(doc: MigratableDocument): MigratableDocument {
  if (evidenceBundle1To2.down === undefined) throw new Error('evidenceBundle1To2 has no down');
  return evidenceBundle1To2.down(doc);
}

/** A real, schema-version-1 "before" fixture, mirroring `evidence-bundle.test.ts`'s own
 * `validEvidenceBundle()`. */
function before(): MigratableDocument {
  return {
    type: 'EvidenceBundle',
    body: '<Nothing further...>',
    frontmatter: {
      id: 'EVID-001',
      type: 'EvidenceBundle',
      schemaVersion: 1,
      title: 'Evidence — STORY-014',
      status: 'recorded',
      created: '2026-09-30',
      updated: '2026-09-30',
      revision: 1,
      author: 'engine',
      changelog: [],
      story: 'STORY-014',
      verify: {
        phase: 'done',
        passed: true,
        errors: 0,
        checks: [{ check: 'unit tests pass', status: 'pass', message: 'ok' }],
      },
      coverage: { acCoveragePercent: 100, ratchetRegressions: 0 },
      bindingEvidence: ['MUT-001'],
      reviews: [{ id: 'REVIEW-001', verdict: 'clear' }],
      gates: [{ id: 'GATE-001', gate: 'G-Verify', outcome: 'passed' }],
      exemptions: [],
      cost: { totalUsd: 0.42, estimated: true },
      assembledAt: '2026-09-30T12:00:00.000Z',
    },
  };
}

describe('evidenceBundle1To2.up (specs/22 M16 P5)', () => {
  it('sets schemaVersion: 2 and changes nothing else (golden before/after)', () => {
    const after = evidenceBundle1To2.up(before());
    expect(after.frontmatter['schemaVersion']).toBe(2);
    expect({ ...after.frontmatter, schemaVersion: 1 }).toEqual(before().frontmatter);
    // Round-2 critic: a mutation that silently discarded `body`/`type` left every assertion above
    // green, since neither had ever been checked.
    expect(after.body).toBe(before().body);
    expect(after.type).toBe(before().type);
  });

  it('is pure: does not mutate its own input', () => {
    const input = before();
    const frozen = structuredClone(input.frontmatter);
    evidenceBundle1To2.up(input);
    expect(input.frontmatter).toEqual(frozen);
  });

  it('through applyMigrations: a real schemaVersion-1 document migrates to schemaVersion 2', () => {
    const result = applyMigrations(before(), { direction: 'up', steps: [evidenceBundle1To2] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.document.frontmatter['schemaVersion']).toBe(2);
  });
});

describe('evidenceBundle1To2.down — always reversible, no hunk-level counterpart (specs/22 M16 P5)', () => {
  it('strips parityEvidence and sets schemaVersion: 1, reproducing the original golden "before"', () => {
    const withField = {
      ...before(),
      frontmatter: { ...before().frontmatter, schemaVersion: 2, parityEvidence: ['PAR-001'] },
    };
    const after = down(withField);
    expect(after.frontmatter).toEqual(before().frontmatter);
    // Round-2 critic: a mutation that silently discarded `body`/`type` left the frontmatter
    // assertion above green, since neither field had ever been checked.
    expect(after.body).toBe(before().body);
    expect(after.type).toBe(before().type);
  });

  it('a bundle with no parityEvidence at all: down is a true no-op on that field', () => {
    const after = down(evidenceBundle1To2.up(before()));
    expect(after.frontmatter['parityEvidence']).toBeUndefined();
    expect(after.frontmatter).toEqual(before().frontmatter);
  });

  it('never refuses: unlike mutationEvidence1To2, every EvidenceBundle has a version-1 form', () => {
    const withField = {
      ...before(),
      frontmatter: {
        ...before().frontmatter,
        schemaVersion: 2,
        parityEvidence: ['PAR-001', 'PAR-002'],
      },
    };
    expect(() => down(withField)).not.toThrow();
  });

  it('through applyMigrations: a real schemaVersion-2 bundle migrates back to schemaVersion 1', () => {
    const withField = {
      ...before(),
      frontmatter: { ...before().frontmatter, schemaVersion: 2, parityEvidence: ['PAR-001'] },
    };
    const result = applyMigrations(withField, { direction: 'down', steps: [evidenceBundle1To2] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.document.frontmatter['schemaVersion']).toBe(1);
      expect(result.document.frontmatter['parityEvidence']).toBeUndefined();
    }
  });
});
