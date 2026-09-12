/**
 * `computeBlastRadius`/`expandTestScope` — `17` §17.4 point 2: "any story touching a component
 * computes its dependents from the module graph and includes them in the test scope."
 *
 * @see specs/17 §17.4
 * @see PLAN-M10.md P20
 */
import { describe, expect, it } from 'vitest';

import { computeBlastRadius, expandTestScope } from '../../src/adopt/blast-radius.ts';
import type { DependencyGraph } from '../../src/adopt/inventory.ts';

/** `a` <- `b`, `c`, `d` (three direct dependents), `e` <- `b` (a second edge onto an already-counted
 * dependent), `f` -> `g` -> `h` (a transitive chain unrelated to `a`), and a real cycle `x` <-> `y`. */
const FIXTURE_GRAPH: DependencyGraph = {
  nodes: [
    { module: 'a', imports: [] },
    { module: 'b', imports: ['a', 'e'] },
    { module: 'c', imports: ['a'] },
    { module: 'd', imports: ['a'] },
    { module: 'e', imports: [] },
    { module: 'f', imports: ['g'] },
    { module: 'g', imports: ['h'] },
    { module: 'h', imports: [] },
    { module: 'x', imports: ['y'] },
    { module: 'y', imports: ['x'] },
  ],
  cycles: [['x', 'y', 'x']],
};

describe('computeBlastRadius', () => {
  it("a component with 3 real dependents gets exactly those 3 — the pure computation behind the PLAN-M10 P20 check (wiring this into a live story's compiled test scope is a separate, disclosed, not-yet-built scheduler feature — see this module's own doc comment)", () => {
    const result = computeBlastRadius(FIXTURE_GRAPH, ['a']);
    expect(result.touched).toEqual(['a']);
    expect(result.dependents).toEqual(['b', 'c', 'd']);
  });

  it('is transitive: a dependent of a dependent is included', () => {
    const result = computeBlastRadius(FIXTURE_GRAPH, ['h']);
    expect(result.dependents).toEqual(['f', 'g']);
  });

  it('never reports a touched module back as its own dependent, even across a real cycle', () => {
    const result = computeBlastRadius(FIXTURE_GRAPH, ['x']);
    expect(result.dependents).toEqual(['y']);
    expect(result.dependents).not.toContain('x');
  });

  it('a module unrelated to the touched set is never included', () => {
    const result = computeBlastRadius(FIXTURE_GRAPH, ['a']);
    expect(result.dependents).not.toContain('e');
    expect(result.dependents).not.toContain('f');
  });

  it('a module absent from the graph entirely has zero dependents, not an error', () => {
    const result = computeBlastRadius(FIXTURE_GRAPH, ['does-not-exist']);
    expect(result.touched).toEqual(['does-not-exist']);
    expect(result.dependents).toEqual([]);
  });

  it('deduplicates and sorts a touched set spanning more than one module', () => {
    const result = computeBlastRadius(FIXTURE_GRAPH, ['h', 'a', 'h']);
    expect(result.touched).toEqual(['a', 'h']);
    expect(result.dependents).toEqual(['b', 'c', 'd', 'f', 'g']);
  });

  it('an empty touched set has no dependents', () => {
    expect(computeBlastRadius(FIXTURE_GRAPH, [])).toEqual({ touched: [], dependents: [] });
  });

  it('a real, deep import chain does not overflow the call stack — iterative, not recursive', () => {
    // A linear chain m0 <- m1 <- m2 <- ... <- m9999, far deeper than a real recursive `visit()` could
    // walk before hitting V8's default call-stack limit (a gauntlet critic round found the original,
    // recursive version of `computeBlastRadius` had no depth bound at all).
    const chainLength = 50_000;
    const nodes = Array.from({ length: chainLength }, (_, i) => ({
      module: `m${String(i)}`,
      imports: i === 0 ? [] : [`m${String(i - 1)}`],
    }));
    const deepGraph: DependencyGraph = { nodes, cycles: [] };

    const result = computeBlastRadius(deepGraph, ['m0']);

    // Lexicographic sort order over variable-length numeric suffixes is not numeric chain order (`m2`
    // sorts after `m19999`), so this asserts membership and length, not position.
    expect(result.dependents).toHaveLength(chainLength - 1);
    expect(result.dependents).toContain('m1');
    expect(result.dependents).toContain(`m${String(chainLength - 1)}`);
    expect([...result.dependents].sort()).toEqual(result.dependents);
  });
});

describe('expandTestScope', () => {
  it('folds touched + dependents into one sorted test-scope list', () => {
    const result = expandTestScope(FIXTURE_GRAPH, ['a']);
    expect(result.testScope).toEqual(['a', 'b', 'c', 'd']);
    expect(result.touched).toEqual(['a']);
    expect(result.dependents).toEqual(['b', 'c', 'd']);
  });
});
