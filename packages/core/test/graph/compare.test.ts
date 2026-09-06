/**
 * `compareStrings` — code-unit-order comparison shared by `build.ts` and `spec-graph.ts`'s sorts.
 *
 * Tested directly rather than only through a `.sort()` call: `Array.prototype.sort`'s own run
 * detection can satisfy itself an array is already ascending without ever invoking the comparator
 * with a genuinely smaller first argument, so exercising this only indirectly left the `a < b`
 * branch uncovered no matter how the graph fixtures were shuffled.
 */
import { describe, expect, it } from 'vitest';

import { compareStrings } from '../../src/graph/compare.ts';

describe('compareStrings', () => {
  it('returns -1 when a sorts before b', () => {
    expect(compareStrings('AC-001', 'AC-002')).toBe(-1);
  });

  it('returns 1 when a sorts after b', () => {
    expect(compareStrings('AC-002', 'AC-001')).toBe(1);
  });

  it('returns 0 for equal strings', () => {
    expect(compareStrings('AC-001', 'AC-001')).toBe(0);
  });
});
