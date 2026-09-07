/**
 * `estimateTokens` — a documented, deterministic, dependency-free approximation.
 *
 * @see PLAN-M3.md P9
 */
import { describe, expect, it } from 'vitest';

import { estimateTokens } from '../../src/pack/estimate-tokens.ts';

describe('estimateTokens', () => {
  it('is 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up, never down, so a partial token is never undercounted', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('is deterministic across repeated calls', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    expect(estimateTokens(text)).toBe(estimateTokens(text));
  });

  it('grows monotonically with input length', () => {
    expect(estimateTokens('a'.repeat(100))).toBeGreaterThan(estimateTokens('a'.repeat(10)));
  });
});
