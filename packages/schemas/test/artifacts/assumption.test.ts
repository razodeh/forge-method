/**
 * `assumptionSchema` — one `ASM-###` entry in `kb/assumptions.md`.
 *
 * @see specs/05 §5.6
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { assumptionSchema } from '../../src/artifacts/assumption.ts';

function validAssumption(): Record<string, unknown> {
  return {
    id: 'ASM-004',
    text: 'Single deployable at MVP; second service arrives at M2',
    confidence: 'high',
    validate_by: 'stage plan review at M2 kickoff',
  };
}

describe('assumptionSchema — valid', () => {
  it('accepts the spec §5.6 example', () => {
    expect(assumptionSchema.safeParse(validAssumption()).success).toBe(true);
  });

  it('accepts with no sources field at all (PLAN-M14.md P11: sources is optional here)', () => {
    const result = assumptionSchema.safeParse(validAssumption());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sources).toBeUndefined();
  });

  it('accepts a well-formed sources array', () => {
    const result = assumptionSchema.safeParse({
      ...validAssumption(),
      sources: [{ kind: 'human', ref: 'elicitation 2026-03-04' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('assumptionSchema — sources shape (PLAN-M14.md P11)', () => {
  it('rejects a source with an unknown kind', () => {
    const result = assumptionSchema.safeParse({
      ...validAssumption(),
      sources: [{ kind: 'guess', ref: 'x' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['sources', 0, 'kind']);
  });
});

describe('assumptionSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match Assumption', () => {
    const result = assumptionSchema.safeParse({ ...validAssumption(), id: 'RISK-004' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a confidence outside its closed enum', () => {
    const result = assumptionSchema.safeParse({ ...validAssumption(), confidence: 'verified' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['confidence']);
  });

  it('rejects a missing validate_by', () => {
    const withoutValidateBy = validAssumption();
    delete withoutValidateBy['validate_by'];
    const result = assumptionSchema.safeParse(withoutValidateBy);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['validate_by']);
  });

  it('rejects an unknown key', () => {
    const result = assumptionSchema.safeParse({ ...validAssumption(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
