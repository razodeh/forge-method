/**
 * `detectCycles`/`renderCycleAsMermaid` — `PLAN-M5.md` P11's own Checks section: a constructed 4-node
 * cycle is detected and its rendered Mermaid output contains all four node ids in cycle order.
 *
 * @see specs/06 §6.2
 * @see PLAN-M5.md P11
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { detectCycles, renderCycleAsMermaid } from '../../src/plan/cycles.ts';
import type { StepNode } from '../../src/plan/types.ts';

function node(id: string, dependsOn: readonly string[] = []): StepNode {
  return {
    id,
    kind: 'agent',
    inputs: [],
    outputs: [],
    dependsOn,
    produces: [],
    consumes: [],
    retry: { maxAttempts: 1, backoffMs: [1000, 30_000], retryOn: [] },
    limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    idempotencyKey: id,
    onFailure: 'block',
  };
}

describe('detectCycles', () => {
  it('reports undefined for an acyclic graph', () => {
    expect(detectCycles([node('a'), node('b', ['a']), node('c', ['b'])])).toBeUndefined();
  });

  it('does not re-visit a node already resolved as a dependency of an earlier root -- the array-order root loop skips it, not just the inner dependency walk', () => {
    // "a" is listed first and depends on "b", so "b" gets fully visited (and marked 'done') as part of
    // "a"'s own traversal *before* the outer loop ever reaches "b" as a root in its own right.
    expect(detectCycles([node('a', ['b']), node('b')])).toBeUndefined();
  });

  it('detects a constructed 4-node cycle, closed (first id equals last)', () => {
    const nodes = [node('a', ['d']), node('b', ['a']), node('c', ['b']), node('d', ['c'])];
    const result = detectCycles(nodes);
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.cycle[0]).toBe(result.cycle[result.cycle.length - 1]);
    expect(new Set(result.cycle)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('detects a direct self-dependency as a 1-node cycle', () => {
    const result = detectCycles([node('a', ['a'])]);
    expect(result).toEqual({ cycle: ['a', 'a'] });
  });

  it('does not report a cycle for a diamond shape (shared ancestor, not a loop)', () => {
    const nodes = [node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c'])];
    expect(detectCycles(nodes)).toBeUndefined();
  });

  it('finds a cycle even when it is not reachable from the first node in the array', () => {
    const nodes = [node('isolated'), node('x', ['y']), node('y', ['x'])];
    const result = detectCycles(nodes);
    expect(result).toBeDefined();
  });

  it('throws a ForgeError (RUN-035), not a raw RangeError, on pathologically deep dependsOn chaining', () => {
    // Built with the deepest-depending node FIRST: `detectCycles` iterates `nodes` in array order as
    // potential roots, and a root already resolved to 'done' by an earlier root's own traversal is
    // skipped trivially -- building the chain n0-first (each later node merely re-confirming its one
    // dependency is already 'done') would never actually grow the stack past a couple of frames. Starting
    // from n6000 forces one single, genuinely deep traversal before anything is marked 'done' at all.
    const nodes: StepNode[] = [];
    for (let i = 6000; i >= 1; i -= 1) {
      nodes.push(node(`n${String(i)}`, [`n${String(i - 1)}`]));
    }
    nodes.push(node('n0'));
    let caught: unknown;
    try {
      detectCycles(nodes);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-035');
  });

  it('a dependsOn reference to a nonexistent id is simply a dead end, not a crash or a fabricated cycle', () => {
    expect(detectCycles([node('a', ['nonexistent'])])).toBeUndefined();
  });
});

describe('renderCycleAsMermaid', () => {
  // A verify round confirmed against the real Mermaid parser (`mermaid`, vendored via `@forge/diagrams`,
  // not a dependency this package's own tests can reach -- `@forge/engine` has no edge to `@forge/
  // diagrams` at all) that a bare quoted string is *never* a valid edge endpoint in Mermaid's own
  // flowchart grammar -- confirmed both for the previous, broken implementation (which always produced
  // this shape) and independently for the fix below (a synthetic identifier followed by a bracketed
  // label, `n0["real id"]`, which the real parser accepts). These tests assert the *structural* property
  // that makes the fix valid -- never a bare `"..."` immediately next to `-->` -- rather than re-running
  // the real parser as part of this package's own suite.
  const BARE_QUOTED_ENDPOINT = /(-->\s*"|"\s*-->)/;

  it('never emits a bare quoted string as an edge endpoint -- the exact shape the real Mermaid parser rejects unconditionally', () => {
    const rendered = renderCycleAsMermaid(['a', 'b', 'a']);
    expect(rendered).not.toMatch(BARE_QUOTED_ENDPOINT);
  });

  it('renders all four node ids of a 4-node cycle, in cycle order, each as a bracketed label', () => {
    const rendered = renderCycleAsMermaid(['a', 'b', 'c', 'd', 'a']);
    expect(rendered).toContain('graph TD');
    expect(rendered).not.toMatch(BARE_QUOTED_ENDPOINT);
    const idsInOrder = ['a', 'b', 'c', 'd'];
    let lastIndex = -1;
    for (const id of idsInOrder) {
      const index = rendered.indexOf(`[${JSON.stringify(id)}]`);
      expect(index).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
  });

  it('renders each consecutive pair as a --> edge between two bracket-labelled node references', () => {
    const rendered = renderCycleAsMermaid(['a', 'b', 'a']);
    expect(rendered).toMatch(/^\s*\S+\["a"\] --> \S+\["b"\]$/m);
    expect(rendered).toMatch(/^\s*\S+\["b"\] --> \S+\["a"\]$/m);
  });

  it('reuses the identical synthetic node reference for the wrap-around element -- a real closed loop back to one node, not two different-looking nodes that merely share a label', () => {
    const rendered = renderCycleAsMermaid(['a', 'b', 'a']);
    const firstLine = /^\s*(\S+)\["a"\] --> (\S+)\["b"\]$/m.exec(rendered);
    const secondLine = /^\s*(\S+)\["b"\] --> (\S+)\["a"\]$/m.exec(rendered);
    expect(firstLine).not.toBeNull();
    expect(secondLine).not.toBeNull();
    // The synthetic id for "a" in the first edge's own left side must be the *same* one used for "a" in
    // the second edge's own right side.
    expect(firstLine?.[1]).toBe(secondLine?.[2]);
  });

  it('escapes an id containing its own literal brackets safely inside the label', () => {
    const rendered = renderCycleAsMermaid(['w:a[1]', 'w:b', 'w:a[1]']);
    expect(rendered).not.toMatch(BARE_QUOTED_ENDPOINT);
    expect(rendered).toContain(JSON.stringify('w:a[1]'));
  });

  // Extracts each bracket label's own *inner* content, stripped of the one leading and one trailing
  // quote `JSON.stringify` always adds as the label's real delimiters -- distinct from a literal quote
  // character appearing *inside* that content, which is what these tests assert never happens.
  function innerLabelContents(rendered: string): readonly string[] {
    return [...rendered.matchAll(/\[(".*?")\]/g)].map((m) => (m[1] ?? '').slice(1, -1));
  }

  it('renders an id containing its own literal double-quote as its HTML entity, not a backslash-escaped quote -- a verify round confirmed the real Mermaid label lexer does not honour backslash-escaping at all, terminating the label at the first raw quote byte regardless', () => {
    const rendered = renderCycleAsMermaid(['w:a:"weird"', 'w:b', 'w:a:"weird"']);
    expect(rendered).not.toMatch(BARE_QUOTED_ENDPOINT);
    for (const content of innerLabelContents(rendered)) expect(content).not.toContain('"');
    expect(rendered).toContain('w:a:&quot;weird&quot;');
  });

  it('handles multiple adjacent quotes, and a quote immediately next to a literal backslash, without breaking label boundaries', () => {
    for (const id of ['"""', 'a\\"b', '\\"\\']) {
      const rendered = renderCycleAsMermaid([id, 'other', id]);
      expect(rendered).not.toMatch(BARE_QUOTED_ENDPOINT);
      for (const content of innerLabelContents(rendered)) expect(content).not.toContain('"');
    }
  });

  it('substitutes a placeholder for an empty-string id rather than emitting an empty label -- Mermaid\'s own label lexer rejects [""] outright, confirmed against the real parser, even though no real compiled StepNode.id can ever actually be empty (06 §6.2\'s own id format always contains at least one ":")', () => {
    const rendered = renderCycleAsMermaid(['', 'b', '']);
    expect(rendered).not.toMatch(/\[""\]/);
    expect(rendered).toContain('(empty)');
  });
});
