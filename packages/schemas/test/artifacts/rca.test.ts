/**
 * `rcaSchema` — `13` §13's RCA.
 *
 * @see specs/13-frameworks-testing-and-debugging.md §13
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { rcaSchema } from '../../src/artifacts/rca.ts';

function validRca(): Record<string, unknown> {
  return {
    id: 'RCA-007',
    type: 'RCA',
    schemaVersion: 1,
    title: 'Invoice totals off by one cent on 3-item invoices',
    status: 'complete',
    created: '2026-03-09',
    updated: '2026-03-09',
    revision: 1,
    author: 'diagnostician',
    changelog: [],
    defect: 'DEF-014',
    severity: 'Sev2',
    symptom: 'Invoice totals off by one cent on 3-item invoices with 10% tax',
    reproduction: 'tests/billing/regression/RCA-007.test.ts',
    timeline: [{ first_seen: '2026-03-09' }, { detected_by: 'e2e AC-014-1' }],
    hypotheses: [
      {
        claim: 'Rounding applied per line rather than on the subtotal',
        refuted_by: null,
        status: 'confirmed',
      },
      {
        claim: 'Tax rate stored as float',
        refuted_by: 'DB column is numeric(5,4); verified by migration 0007',
        status: 'refuted',
      },
    ],
    root_cause: 'Line-level rounding accumulates error.',
    causal_chain: ['AC-011-2 omitted rounding semantics', 'implementer chose per-line rounding'],
    fix: 'src/billing/preview/total.ts',
    prevention: ['Property test: total always equals round(sum(raw_lines)) for any line set'],
    blast_radius: ['STORY-011', 'STORY-014', 'DM-002'],
    kb_writes: ['KB-DATA-0011'],
    time_to_diagnose_min: 14,
  };
}

describe('rcaSchema — valid', () => {
  it('accepts the spec §13 example', () => {
    expect(rcaSchema.safeParse(validRca()).success).toBe(true);
  });
});

describe('rcaSchema — invalid, each asserting the error path', () => {
  it('rejects a severity outside the Sev1-4 enum', () => {
    const result = rcaSchema.safeParse({ ...validRca(), severity: 'Sev5' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['severity']);
  });

  it('rejects a hypothesis status outside its closed enum', () => {
    const result = rcaSchema.safeParse({
      ...validRca(),
      hypotheses: [{ claim: 'x', refuted_by: null, status: 'pending' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['hypotheses', 0, 'status']);
  });

  it('rejects a missing root_cause', () => {
    const withoutRootCause = validRca();
    delete withoutRootCause['root_cause'];
    const result = rcaSchema.safeParse(withoutRootCause);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['root_cause']);
  });

  it('rejects a negative time_to_diagnose_min', () => {
    const result = rcaSchema.safeParse({ ...validRca(), time_to_diagnose_min: -5 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['time_to_diagnose_min']);
  });
});
