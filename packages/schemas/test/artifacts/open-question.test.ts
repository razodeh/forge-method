/**
 * `openQuestionSchema` — one `OQ-###` entry in `kb/open-questions.md`.
 *
 * @see specs/08 §8.2
 * @see specs/21 §21.3
 * @see SPEC-QUESTIONS.md Q23
 */
import { describe, expect, it } from 'vitest';

import { openQuestionSchema } from '../../src/artifacts/open-question.ts';

function validOpenQuestion(): Record<string, unknown> {
  return {
    id: 'OQ-001',
    question:
      'Do we need a separate package for shared domain types, or is a folder enough at MVP?',
    status: 'open',
  };
}

describe('openQuestionSchema — valid', () => {
  it('accepts a well-formed open question', () => {
    expect(openQuestionSchema.safeParse(validOpenQuestion()).success).toBe(true);
  });

  it('accepts status resolved', () => {
    expect(
      openQuestionSchema.safeParse({ ...validOpenQuestion(), status: 'resolved' }).success,
    ).toBe(true);
  });

  it('accepts with no sources field at all (PLAN-M14.md P11: sources is optional here)', () => {
    const result = openQuestionSchema.safeParse(validOpenQuestion());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sources).toBeUndefined();
  });

  it('accepts a well-formed sources array, resolved with a source recording why', () => {
    const result = openQuestionSchema.safeParse({
      ...validOpenQuestion(),
      status: 'resolved',
      sources: [{ kind: 'decision', ref: 'ADR-0014' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('openQuestionSchema — sources shape (PLAN-M14.md P11)', () => {
  it('rejects a source with an unknown kind', () => {
    const result = openQuestionSchema.safeParse({
      ...validOpenQuestion(),
      sources: [{ kind: 'guess', ref: 'x' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['sources', 0, 'kind']);
  });
});

describe('openQuestionSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match OpenQuestion', () => {
    const result = openQuestionSchema.safeParse({ ...validOpenQuestion(), id: 'RISK-001' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a status outside its closed enum', () => {
    const result = openQuestionSchema.safeParse({ ...validOpenQuestion(), status: 'blocked' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['status']);
  });

  it('rejects a missing question', () => {
    const withoutQuestion = validOpenQuestion();
    delete withoutQuestion['question'];
    const result = openQuestionSchema.safeParse(withoutQuestion);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['question']);
  });

  it('rejects an unknown key', () => {
    const result = openQuestionSchema.safeParse({ ...validOpenQuestion(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
