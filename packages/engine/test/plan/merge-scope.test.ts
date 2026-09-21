/**
 * Which lanes a `merge` step lands and which lanes wait for one (`PLAN-M13.md` P19, `06` §6.4-§6.5, `10` §10.1,
 * `SPEC-QUESTIONS.md` Q221). Graphs are hand-built: only `id`, `kind` and `dependsOn` matter here.
 */
import { describe, expect, it } from 'vitest';

import { mergeLandingScope, stepsLandedByMerges, type StepNodeKind } from '../../src/plan/index.ts';
import { node } from '../dispatch/helpers.ts';

function graph(spec: Record<string, { kind: StepNodeKind; dependsOn?: readonly string[] }>) {
  return Object.entries(spec).map(([id, { kind, dependsOn }]) =>
    node({
      id,
      kind,
      dependsOn: dependsOn ?? [],
      ...(kind === 'merge' ? { mergePolicy: { conflict: 'abort' } } : {}),
    }),
  );
}

const byId = (nodes: ReturnType<typeof graph>) => new Map(nodes.map((n) => [n.id, n] as const));

describe('mergeLandingScope', () => {
  it('is the dependency closure of the merge, dependencies first, not just its direct predecessors', () => {
    const nodes = graph({
      plan: { kind: 'agent' },
      green: { kind: 'agent', dependsOn: ['plan'] },
      review: { kind: 'agent', dependsOn: ['green'] },
      commit: { kind: 'checkpoint', dependsOn: ['review'] },
      merge: { kind: 'merge', dependsOn: ['commit'] },
    });
    expect(mergeLandingScope(byId(nodes), 'merge')).toEqual(['plan', 'green', 'review', 'commit']);
  });

  it('lists every step once, in the order each dependency list names them (a diamond)', () => {
    const nodes = graph({
      root: { kind: 'agent' },
      left: { kind: 'agent', dependsOn: ['root'] },
      right: { kind: 'agent', dependsOn: ['root'] },
      merge: { kind: 'merge', dependsOn: ['left', 'right'] },
    });
    expect(mergeLandingScope(byId(nodes), 'merge')).toEqual(['root', 'left', 'right']);
  });

  it('leaves out a step behind a gate that is upstream of the merge, and the gate itself', () => {
    const nodes = graph({
      design: { kind: 'agent' },
      gate: { kind: 'gate', dependsOn: ['design'] },
      build: { kind: 'agent', dependsOn: ['gate'] },
      merge: { kind: 'merge', dependsOn: ['build'] },
    });
    expect(mergeLandingScope(byId(nodes), 'merge')).toEqual(['build']);
  });

  it("leaves out a step behind a gate even when it also reaches the merge by a direct edge (the compiler's implicit contract dependency)", () => {
    const nodes = graph({
      freeze: { kind: 'agent' },
      gate: { kind: 'gate', dependsOn: ['freeze'] },
      // `implement` waits for the gate AND, through an implicit edge, for `freeze` itself.
      implement: { kind: 'agent', dependsOn: ['gate', 'freeze'] },
      merge: { kind: 'merge', dependsOn: ['implement'] },
    });
    expect(mergeLandingScope(byId(nodes), 'merge')).toEqual(['implement']);
  });

  it('does not reach past an earlier merge: that merge landed its own closure', () => {
    const nodes = graph({
      draft: { kind: 'agent' },
      mergeContract: { kind: 'merge', dependsOn: ['draft'] },
      tests: { kind: 'agent', dependsOn: ['mergeContract'] },
      mergeTests: { kind: 'merge', dependsOn: ['tests'] },
    });
    expect(mergeLandingScope(byId(nodes), 'mergeContract')).toEqual(['draft']);
    expect(mergeLandingScope(byId(nodes), 'mergeTests')).toEqual(['tests']);
  });

  it('is empty for an unknown id, a non-merge id, and a merge whose only predecessor is a gate', () => {
    const nodes = graph({
      a: { kind: 'agent' },
      gate: { kind: 'gate', dependsOn: ['a'] },
      merge: { kind: 'merge', dependsOn: ['gate'] },
    });
    expect(mergeLandingScope(byId(nodes), 'nope')).toEqual([]);
    expect(mergeLandingScope(byId(nodes), 'a')).toEqual([]);
    expect(mergeLandingScope(byId(nodes), 'merge')).toEqual([]);
  });

  it('skips a dependency that names no step of the plan instead of throwing', () => {
    const nodes = graph({
      a: { kind: 'agent', dependsOn: ['ghost'] },
      merge: { kind: 'merge', dependsOn: ['a', 'ghost'] },
    });
    expect(mergeLandingScope(byId(nodes), 'merge')).toEqual(['a']);
  });
});

describe('stepsLandedByMerges', () => {
  it("is empty for a workflow with no merge step: every lane is the engine's to integrate", () => {
    const nodes = graph({ a: { kind: 'agent' }, b: { kind: 'agent', dependsOn: ['a'] } });
    expect(stepsLandedByMerges(nodes).size).toBe(0);
  });

  it('is the union over merges, and excludes steps no merge waits for (a branch nothing merges)', () => {
    const nodes = graph({
      a: { kind: 'agent' },
      b: { kind: 'agent', dependsOn: ['a'] },
      side: { kind: 'agent', dependsOn: ['a'] },
      merge: { kind: 'merge', dependsOn: ['b'] },
    });
    expect([...stepsLandedByMerges(nodes)].sort()).toEqual(['a', 'b']);
  });
});
