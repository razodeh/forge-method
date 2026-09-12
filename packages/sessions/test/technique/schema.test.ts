/**
 * `techniqueSchema` — `16` §16.4's technique document shape.
 *
 * @see PLAN-M10.md P9
 */
import { describe, expect, it } from 'vitest';

import { techniqueSchema } from '../../src/technique/schema.ts';

const VALID = {
  id: 'scamper',
  name: 'SCAMPER',
  bestFor: 'Improving something that exists',
  phases: ['diverge'],
  prompt: 'Do the thing.',
};

describe('techniqueSchema', () => {
  it('accepts a real, minimal technique document', () => {
    expect(techniqueSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts an id with a capitalised letter, matching `16` §16.4's own what-would-X-do row", () => {
    expect(techniqueSchema.safeParse({ ...VALID, id: 'what-would-X-do' }).success).toBe(true);
  });

  it('accepts a technique with more than one phase (five-whys: diverge and retro)', () => {
    expect(techniqueSchema.safeParse({ ...VALID, phases: ['diverge', 'retro'] }).success).toBe(
      true,
    );
  });

  it.each([
    ['empty id', { ...VALID, id: '' }],
    ['id with a space', { ...VALID, id: 'has space' }],
    ['empty phases array', { ...VALID, phases: [] }],
    ['an unknown phase', { ...VALID, phases: ['brainstorm'] }],
    ['empty bestFor', { ...VALID, bestFor: '' }],
    ['empty prompt', { ...VALID, prompt: '' }],
    ['an unknown extra field', { ...VALID, extra: 'nope' }],
  ])('rejects %s', (_label, candidate) => {
    expect(techniqueSchema.safeParse(candidate).success).toBe(false);
  });
});
