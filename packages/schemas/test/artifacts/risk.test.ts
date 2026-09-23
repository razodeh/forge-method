/**
 * `riskSchema` — one `RISK-###` entry in `kb/risks.md`.
 *
 * @see specs/08 §8.2
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { riskSchema } from '../../src/artifacts/risk.ts';

function validRisk(): Record<string, unknown> {
  return {
    id: 'RISK-007',
    statement: 'Quick invoice path bypasses tax validation',
    likelihood: 'medium',
    impact: 'high',
    mitigation: 'Route the quick path through the same validator as the full form',
    owner: 'architect',
  };
}

describe('riskSchema — valid', () => {
  it('accepts a well-formed risk entry', () => {
    expect(riskSchema.safeParse(validRisk()).success).toBe(true);
  });

  it('accepts with no sources field at all (PLAN-M14.md P11: sources is optional here)', () => {
    const result = riskSchema.safeParse(validRisk());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sources).toBeUndefined();
  });

  it('accepts a well-formed sources array', () => {
    const result = riskSchema.safeParse({
      ...validRisk(),
      sources: [{ kind: 'code', ref: 'src/tax/validate.ts@a1b2c3d' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('riskSchema — sources shape (PLAN-M14.md P11)', () => {
  it('rejects a source with an unknown kind', () => {
    const result = riskSchema.safeParse({ ...validRisk(), sources: [{ kind: 'guess', ref: 'x' }] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['sources', 0, 'kind']);
  });
});

describe('riskSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match Risk', () => {
    const result = riskSchema.safeParse({ ...validRisk(), id: 'ASM-007' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a missing mitigation', () => {
    const withoutMitigation = validRisk();
    delete withoutMitigation['mitigation'];
    const result = riskSchema.safeParse(withoutMitigation);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['mitigation']);
  });

  it('rejects an empty owner', () => {
    const result = riskSchema.safeParse({ ...validRisk(), owner: '' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['owner']);
  });

  it('rejects an unknown key', () => {
    const result = riskSchema.safeParse({ ...validRisk(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
