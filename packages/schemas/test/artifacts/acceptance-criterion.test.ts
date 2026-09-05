/**
 * `acceptanceCriterionSchema` — `specs/09` §9.5's Given/When/Then acceptance criterion.
 *
 * @see specs/09 §9.5
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { acceptanceCriterionSchema } from '../../src/artifacts/acceptance-criterion.ts';

function validCriterion(): Record<string, unknown> {
  return {
    id: 'AC-014-1',
    given: 'an invoice with 3 line items',
    when: 'the preview is requested',
    then: 'the total is computed correctly',
    kind: 'functional',
  };
}

describe('acceptanceCriterionSchema — valid', () => {
  it('accepts a well-formed criterion', () => {
    expect(acceptanceCriterionSchema.safeParse(validCriterion()).success).toBe(true);
  });

  it('accepts an optional nfr reference', () => {
    const result = acceptanceCriterionSchema.safeParse({
      ...validCriterion(),
      kind: 'nfr',
      nfr: 'NFR-0002',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a 4-digit sequence number and a suffixed sub-id', () => {
    expect(
      acceptanceCriterionSchema.safeParse({ ...validCriterion(), id: 'AC-1400-2' }).success,
    ).toBe(true);
  });
});

describe('acceptanceCriterionSchema — invalid, each asserting the error path', () => {
  it('rejects an id not matching ^AC-\\d{3,4}-\\d+$', () => {
    const result = acceptanceCriterionSchema.safeParse({ ...validCriterion(), id: 'AC-14-1' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a missing given', () => {
    const withoutGiven = validCriterion();
    delete withoutGiven['given'];
    const result = acceptanceCriterionSchema.safeParse(withoutGiven);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['given']);
  });

  it('rejects an unknown key', () => {
    const result = acceptanceCriterionSchema.safeParse({ ...validCriterion(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
