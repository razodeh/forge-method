/**
 * `computeCriticalPath` — `PLAN-M5.md` P11's own Checks section: critical path on a diamond-shaped DAG
 * picks the longer of two paths, proven by cost, not just length.
 *
 * @see specs/06 §6.2
 * @see PLAN-M5.md P11
 */
import { describe, expect, it } from 'vitest';

import { computeCriticalPath } from '../../src/plan/critical-path.ts';
import type { StepNode } from '../../src/plan/types.ts';

function node(id: string, dependsOn: readonly string[], maxCostUsd: number): StepNode {
  return {
    id,
    kind: 'agent',
    inputs: [],
    outputs: [],
    dependsOn,
    produces: [],
    consumes: [],
    retry: { maxAttempts: 1, backoffMs: [1000, 30_000], retryOn: [] },
    limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd },
    idempotencyKey: id,
    onFailure: 'block',
  };
}

describe('computeCriticalPath', () => {
  it('returns the empty path at zero cost for an empty plan', () => {
    expect(computeCriticalPath([])).toEqual({ path: [], estimatedCost: 0 });
  });

  it('a single node is its own critical path', () => {
    expect(computeCriticalPath([node('a', [], 5)])).toEqual({ path: ['a'], estimatedCost: 5 });
  });

  it('a straight chain sums every node\'s own cost along it', () => {
    const nodes = [node('a', [], 1), node('b', ['a'], 2), node('c', ['b'], 3)];
    expect(computeCriticalPath(nodes)).toEqual({ path: ['a', 'b', 'c'], estimatedCost: 6 });
  });

  it('on a diamond-shaped DAG, picks the longer (by cost) of two paths, not the one with fewer/more steps', () => {
    // a -> b (cheap, 1) -> d
    // a -> c (expensive, 10) -> d
    // The critical path must go through c, even though both branches are the same *length* (one step).
    const nodes = [
      node('a', [], 1),
      node('b', ['a'], 1),
      node('c', ['a'], 10),
      node('d', ['b', 'c'], 1),
    ];
    const result = computeCriticalPath(nodes);
    expect(result.path).toEqual(['a', 'c', 'd']);
    expect(result.estimatedCost).toBe(12);
  });

  it('picks the longer-by-cost path even when the cheaper path has strictly more steps', () => {
    // a -> b1 -> b2 -> b3 -> d (4 cheap steps, total 4)
    // a -> c -> d (1 expensive step, total 21)
    const nodes = [
      node('a', [], 1),
      node('b1', ['a'], 1),
      node('b2', ['b1'], 1),
      node('b3', ['b2'], 1),
      node('c', ['a'], 20),
      node('d', ['b3', 'c'], 1),
    ];
    const result = computeCriticalPath(nodes);
    expect(result.path).toEqual(['a', 'c', 'd']);
    expect(result.estimatedCost).toBe(22);
  });

  it('does not loop forever or crash if handed a cyclic graph directly, and simply excludes the cyclic portion', () => {
    const nodes = [node('a', ['b'], 1), node('b', ['a'], 1), node('isolated', [], 5)];
    expect(() => computeCriticalPath(nodes)).not.toThrow();
    const result = computeCriticalPath(nodes);
    expect(result.path).toEqual(['isolated']);
  });

  it('excludes a node depending on a cyclic node too, not just the cycle\'s own two members', () => {
    const nodes = [node('a', ['b'], 1), node('b', ['a'], 1), node('c', ['a'], 5), node('isolated', [], 1)];
    const result = computeCriticalPath(nodes);
    expect(result.path).toEqual(['isolated']);
  });

  it('does not crash on a dangling dependsOn reference (naming no real node) -- the referencing node is silently excluded, the same outcome a real cycle produces', () => {
    const nodes = [node('a', ['nonexistent'], 5), node('isolated', [], 1)];
    expect(() => computeCriticalPath(nodes)).not.toThrow();
    const result = computeCriticalPath(nodes);
    expect(result.path).toEqual(['isolated']);
  });

  it('still finds the real critical path among nodes with no dangling reference, when another node in the same graph has one', () => {
    const nodes = [node('a', ['nonexistent'], 1), node('b', [], 1), node('c', ['b'], 10)];
    const result = computeCriticalPath(nodes);
    expect(result.path).toEqual(['b', 'c']);
    expect(result.estimatedCost).toBe(11);
  });
});
