/**
 * `evidenceBundleSchema` — base front matter narrowed to `type: 'EvidenceBundle'`; the identical
 * "no field-level spec exists for the document itself yet" situation `gate-report.ts`'s own doc
 * comment (`SPEC-QUESTIONS.md` Q23) establishes for `GateReport`, and `review-report.ts` for
 * `ReviewReport` before its own `verdict` field was added three pieces later.
 *
 * `PLAN-M15.md` P2's own Mandate for `EvidenceBundle` is a genuine placeholder ("references a set of
 * evidence artifacts plus the gate they support"), unlike `MutationEvidence`'s complete field list —
 * `SPEC-QUESTIONS.md` Q280's Decision 3 records this asymmetry explicitly. The real, detailed shape
 * (binding evidence, test results, coverage delta, every `ReviewReport` verdict, gate outcomes,
 * exemptions in force, real cost) is `PLAN-M15.md` P7's own Mandate, added when P7 assembles one.
 *
 * Genuinely append-only (`specs/18` §18.7, §8.3/§8.4's real "superseded" meaning): every assembly
 * gets its own, newly-allocated `EVID-####` id and its own file (`reports/evidence/{id}-{story}.md`).
 * `specs/18` §18.7's own normative text and `SPEC-QUESTIONS.md` Q280 Decision 3 both require the
 * writer to ACTIVELY REFUSE a second write to an already-existing path, not merely rely on the naming
 * scheme making collision unlikely — checked directly: neither of this codebase's two pre-existing
 * write paths already covered that for a `reports/`-rooted, non-KB, append-only type like this one
 * (`KbWriter.write()`'s `KB-009` refusal is scoped to `kb/`-rooted entries; `GateReport`/`ReviewReport`
 * use a direct, unguarded `writeFileAtomic()` with no existing-file check at all), so `@forge/core/fs`
 * gained a third primitive for exactly this family: `writeNewFileAtomic`, which refuses (`RUN-114`)
 * instead of overwriting. Proven generically in `packages/core/test/fs/atomic.test.ts` and end to end
 * against a real `EvidenceBundle` record in `packages/core/test/artifacts/append-only-evidence.test.ts`
 * — not in this file, which validates the schema's shape, not how or whether it gets written.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P2, P7
 * @see SPEC-QUESTIONS.md Q280
 */
import { describe, expect, it } from 'vitest';

import { evidenceBundleSchema } from '../../src/artifacts/evidence-bundle.ts';

function validEvidenceBundle(): Record<string, unknown> {
  return {
    id: 'EVID-001',
    type: 'EvidenceBundle',
    schemaVersion: 1,
    title: 'Evidence bundle — STORY-014',
    status: 'assembled',
    created: '2026-09-30',
    updated: '2026-09-30',
    revision: 1,
    author: 'engine',
    changelog: [],
  };
}

describe('evidenceBundleSchema — valid', () => {
  it('accepts base front matter with type EvidenceBundle', () => {
    expect(evidenceBundleSchema.safeParse(validEvidenceBundle()).success).toBe(true);
  });
});

describe('evidenceBundleSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match its type', () => {
    const result = evidenceBundleSchema.safeParse({ ...validEvidenceBundle(), id: 'MUT-001' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a type other than the literal "EvidenceBundle"', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      type: 'MutationEvidence',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  it('rejects an unknown top-level key — this piece deliberately carries no type-specific field yet (PLAN-M15.md P7 adds them)', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      bindingEvidence: ['MUT-001'],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
