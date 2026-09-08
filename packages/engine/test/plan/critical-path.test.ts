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

  it('on a genuine cost tie between two different-length chains, the shallower (fewer-hop) one wins, not whichever was declared first', () => {
    // A verify round found the real tie-break is topological depth, not declaration order as an earlier
    // version of this file's own doc comment claimed: Kahn's algorithm processes every node at depth 1
    // before any node at depth 2, regardless of array position. Declared here with the *deeper* chain
    // first specifically to prove that alone doesn't win it the tie.
    const nodes = [
      node('deep1', [], 3),
      node('deep2', ['deep1'], 3),
      node('deep3', ['deep2'], 4),
      node('shallow', [], 10),
    ];
    const result = computeCriticalPath(nodes);
    expect(result.path).toEqual(['shallow']);
    expect(result.estimatedCost).toBe(10);
  });

  it('declaration order only breaks a cost tie among candidates already at the same topological depth', () => {
    const nodes = [
      node('first', [], 5),
      node('second', [], 5),
    ];
    const result = computeCriticalPath(nodes);
    expect(result.path).toEqual(['first']);
    expect(computeCriticalPath([...nodes].reverse()).path).toEqual(['second']);
  });

  it('does not let a NaN-costed node silently poison the best-path selection -- a verify round found any comparison against NaN is false, so a NaN visited first could never be replaced by a later, real, higher cost', () => {
    const poisoned = node('poisoned', [], Number.NaN);
    const real = node('real', [], 5);
    const nodes = [poisoned, real];
    const result = computeCriticalPath(nodes);
    expect(result.path).toEqual(['real']);
    expect(result.estimatedCost).toBe(5);
  });

  it('treats a NaN cost as zero rather than propagating it through a downstream sum', () => {
    const poisoned = node('poisoned', [], Number.NaN);
    const sink = node('sink', ['poisoned'], 3);
    const result = computeCriticalPath([poisoned, sink]);
    expect(result.path).toEqual(['poisoned', 'sink']);
    expect(result.estimatedCost).toBe(3);
    expect(Number.isFinite(result.estimatedCost)).toBe(true);
  });

  it('does not treat an Infinity cost the same as NaN -- unlike NaN, Infinity carries real ordering information ("more expensive than anything finite"), so it is left to flow through untouched, correctly making that node dominate rather than being silently reported as free', () => {
    const unbounded = node('unbounded', [], Number.POSITIVE_INFINITY);
    const real = node('real', [], 1_000_000);
    const result = computeCriticalPath([unbounded, real]);
    expect(result.path).toEqual(['unbounded']);
    expect(result.estimatedCost).toBe(Number.POSITIVE_INFINITY);
  });

  it('propagates an Infinity cost through a downstream sum as Infinity, deliberately unlike the NaN case above (which is neutralised to 0, not propagated)', () => {
    // "sink"'s own total (Infinity + 3) is still exactly Infinity in IEEE 754 -- a genuine tie with
    // "unbounded" alone, not a strictly larger value -- so "unbounded" (the shallower of the two) correctly
    // wins the already-established depth tie-break, exactly as it would for any other genuine cost tie.
    // Had the old, un-narrowed `Number.isFinite`-based guard still been in place, "unbounded" would have
    // been silently zeroed instead, "sink" would total a bare 3, and *that* (not a tie at Infinity) would
    // have been reported as the answer -- so the assertions below still fully distinguish the two.
    const unbounded = node('unbounded', [], Number.POSITIVE_INFINITY);
    const sink = node('sink', ['unbounded'], 3);
    const result = computeCriticalPath([unbounded, sink]);
    expect(result.path).toEqual(['unbounded']);
    expect(result.estimatedCost).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isFinite(result.estimatedCost)).toBe(false);
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
