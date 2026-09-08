/**
 * `computeReadySet` — `06` §6.3's own ready-set definition: dependencies succeeded, no conflicting
 * running claim.
 *
 * @see specs/06 §6.3
 * @see PLAN-M5.md P12
 */
import { describe, expect, it } from 'vitest';

import { computeReadySet } from '../../src/scheduler/ready-set.ts';
import type { StepStatus } from '../../src/scheduler/types.ts';
import type { StepNode } from '../../src/plan/types.ts';

function node(overrides: Partial<StepNode> & { readonly id: string }): StepNode {
  return {
    kind: 'agent',
    inputs: [],
    outputs: [],
    dependsOn: [],
    produces: [],
    consumes: [],
    retry: { maxAttempts: 1, backoffMs: [1000, 30_000], retryOn: [] },
    limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    idempotencyKey: overrides.id,
    onFailure: 'block',
    ...overrides,
  };
}

describe('computeReadySet', () => {
  it('includes a pending node with no dependencies', () => {
    const a = node({ id: 'a' });
    expect(computeReadySet([a], new Map(), [])).toEqual([a]);
  });

  it('excludes a node whose dependency has not succeeded yet', () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b', dependsOn: ['a'] });
    const statuses = new Map<string, StepStatus>([['a', 'pending']]);
    expect(computeReadySet([a, b], statuses, [])).toEqual([a]);
  });

  it('includes a node once all its dependencies have succeeded', () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b', dependsOn: ['a'] });
    const statuses = new Map<string, StepStatus>([['a', 'succeeded']]);
    expect(computeReadySet([a, b], statuses, [])).toEqual([b]);
  });

  it('excludes a node that is already running, succeeded, failed, or skipped', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' }), node({ id: 'd' }), node({ id: 'e' })];
    const statuses = new Map<string, StepStatus>([
      ['a', 'running'],
      ['b', 'succeeded'],
      ['c', 'failed'],
      ['d', 'skipped'],
    ]);
    expect(computeReadySet(nodes, statuses, [])).toEqual([nodes[4]]);
  });

  it('excludes a node whose produces claim conflicts with a currently running claim', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'] });
    expect(computeReadySet([a], new Map(), ['src/foo.ts'])).toEqual([]);
  });

  it('excludes a node whose produces claim overlaps a running claim via a wildcard, not just an exact match', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'] });
    expect(computeReadySet([a], new Map(), ['src/*.ts'])).toEqual([]);
  });

  it('includes a node whose produces claim does not conflict with any running claim', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'] });
    expect(computeReadySet([a], new Map(), ['test/bar.ts'])).toEqual([a]);
  });

  it('treats a step depending on a currently-failed step as never becoming ready -- 06 §6.8\'s own retry/replan decisions are a caller concern, not this function\'s', () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b', dependsOn: ['a'] });
    const statuses = new Map<string, StepStatus>([['a', 'failed']]);
    expect(computeReadySet([a, b], statuses, [])).toEqual([]);
  });
});
