/**
 * `evidenceBundleSchema` — `PLAN-M15.md` P7's own Mandate, made real. Every field's own source and
 * reasoning is documented in full on `evidenceBundleSchema` itself; this file tests the shape, not how
 * or whether a bundle gets assembled (that is `packages/cli/test/commands/loop/test/evidence-bundle.
 * test.ts`'s own job) or written (`packages/core/test/fs/atomic.test.ts`/`append-only-evidence.test.ts`,
 * the identical split `mutation-evidence.test.ts` already establishes).
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P2, P7
 * @see SPEC-QUESTIONS.md Q280, Q286
 */
import { describe, expect, it } from 'vitest';

import { evidenceBundleSchema } from '../../src/artifacts/evidence-bundle.ts';

function validEvidenceBundle(): Record<string, unknown> {
  return {
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
  };
}

describe('evidenceBundleSchema — valid', () => {
  it('accepts a real, full record', () => {
    const result = evidenceBundleSchema.safeParse(validEvidenceBundle());
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts empty bindingEvidence/gates/exemptions (an honest story with none of each)', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      bindingEvidence: [],
      gates: [],
      exemptions: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts coverage with a problems entry (coverage tooling not configured, reported honestly)', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      coverage: {
        acCoveragePercent: 0,
        ratchetRegressions: 0,
        problems: ['no coverage-summary.json'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts coverage with missingAcIds (which specific ACs have no bound passing test)', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      coverage: { acCoveragePercent: 50, ratchetRegressions: 0, missingAcIds: ['AC-014-2'] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts cost with a problems entry (no FORGE_RUN_ID, cost could not be attributed)', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      cost: { totalUsd: 0, estimated: true, problems: ['no FORGE_RUN_ID in the environment'] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a gate with no outcome (a pre-P17 or stub GateReport)', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      gates: [{ id: 'GATE-001', gate: 'G-Verify' }],
    });
    expect(result.success).toBe(true);
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

  it('rejects an unknown top-level key', () => {
    const result = evidenceBundleSchema.safeParse({ ...validEvidenceBundle(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });

  it('rejects a missing story', () => {
    const data = validEvidenceBundle();
    delete data['story'];
    const result = evidenceBundleSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['story']);
  });

  it('rejects verify.checks empty (a profile with no checks for this phase is not a real verification)', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      verify: { phase: 'done', passed: true, errors: 0, checks: [] },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['verify', 'checks']);
  });

  it('rejects a verify.phase other than "verify"/"done"', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      verify: { ...(validEvidenceBundle()['verify'] as object), phase: 'self-verify' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['verify', 'phase']);
  });

  it('rejects coverage.acCoveragePercent above 100', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      coverage: { acCoveragePercent: 101, ratchetRegressions: 0 },
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['coverage', 'acCoveragePercent']);
  });

  it('rejects coverage.ratchetRegressions negative', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      coverage: { acCoveragePercent: 100, ratchetRegressions: -1 },
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['coverage', 'ratchetRegressions']);
  });

  it('rejects reviews empty — the Mandate\'s own worked example: "Omit the review verdict: the required-kind test fails"', () => {
    const result = evidenceBundleSchema.safeParse({ ...validEvidenceBundle(), reviews: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['reviews']);
  });

  it('rejects a review with no recorded verdict', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      reviews: [{ id: 'REVIEW-001' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['reviews']);
  });

  it('rejects a review verdict outside the real engine enum', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      reviews: [{ id: 'REVIEW-001', verdict: 'approved' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['reviews', 0, 'verdict']);
  });

  it('rejects a gate outcome outside the real engine enum', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      gates: [{ id: 'GATE-001', gate: 'G-Verify', outcome: 'pending' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['gates', 0, 'outcome']);
  });

  it('rejects cost.totalUsd negative', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      cost: { totalUsd: -0.01, estimated: true },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['cost', 'totalUsd']);
  });

  it('rejects a non-boolean cost.estimated', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      cost: { totalUsd: 0, estimated: 'yes' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['cost', 'estimated']);
  });

  it('rejects an assembledAt that is not a real ISO instant', () => {
    const result = evidenceBundleSchema.safeParse({
      ...validEvidenceBundle(),
      assembledAt: '2026-09-30',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['assembledAt']);
  });
});
