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
