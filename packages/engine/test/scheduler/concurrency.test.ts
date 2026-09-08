/**
 * `admitsMoreConcurrency` — `06` §6.3's own three concurrency-limit classes plus the adapter-reported one.
 *
 * @see specs/06 §6.3
 * @see PLAN-M5.md P12
 */
import { describe, expect, it } from 'vitest';

import { admitsMoreConcurrency } from '../../src/scheduler/concurrency.ts';
import { toAgentId } from '../../src/plan/index.ts';
import type { ConcurrencyLimits, RunningCounts } from '../../src/scheduler/types.ts';
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

const NO_RUNNING: RunningCounts = { global: 0, perAgent: new Map(), perResourceClass: new Map() };

function limits(overrides: Partial<ConcurrencyLimits> = {}): ConcurrencyLimits {
  return { global: 10, perAgent: new Map(), perResourceClass: new Map(), ...overrides };
}

describe('admitsMoreConcurrency — global limit', () => {
  it('admits when running is below the global limit', () => {
    const candidate = { node: node({ id: 'a' }) };
    expect(admitsMoreConcurrency(candidate, limits({ global: 2 }), { ...NO_RUNNING, global: 1 })).toBe(true);
  });

  it('does not admit when running is already at the global limit', () => {
    const candidate = { node: node({ id: 'a' }) };
    expect(admitsMoreConcurrency(candidate, limits({ global: 2 }), { ...NO_RUNNING, global: 2 })).toBe(false);
  });
});

describe('admitsMoreConcurrency — an exclusive agent\'s second ready step is never admitted while the first of that agent runs (06 §6.3\'s own worked example)', () => {
  it('does not admit a second step for an agent already at its own per-agent limit of 1', () => {
    const architect = toAgentId('architect');
    const candidate = { node: node({ id: 'b', agent: architect }) };
    const runningLimits = limits({ global: 10, perAgent: new Map([[architect, 1]]) });
    const running: RunningCounts = { global: 1, perAgent: new Map([[architect, 1]]), perResourceClass: new Map() };
    expect(admitsMoreConcurrency(candidate, runningLimits, running)).toBe(false);
  });

  it('admits a step for a different agent even while the exclusive agent is running', () => {
    const architect = toAgentId('architect');
    const reviewer = toAgentId('reviewer');
    const candidate = { node: node({ id: 'b', agent: reviewer }) };
    const runningLimits = limits({ perAgent: new Map([[architect, 1]]) });
    const running: RunningCounts = { global: 1, perAgent: new Map([[architect, 1]]), perResourceClass: new Map() };
    expect(admitsMoreConcurrency(candidate, runningLimits, running)).toBe(true);
  });

  it('admits the first step for an agent with no one currently running', () => {
    const architect = toAgentId('architect');
    const candidate = { node: node({ id: 'a', agent: architect }) };
    const runningLimits = limits({ perAgent: new Map([[architect, 1]]) });
    expect(admitsMoreConcurrency(candidate, runningLimits, NO_RUNNING)).toBe(true);
  });

  it('does not enforce any per-agent limit when the agent has no entry in the limits map at all', () => {
    const unconfigured = toAgentId('unconfigured');
    const candidate = { node: node({ id: 'a', agent: unconfigured }) };
    const running: RunningCounts = { global: 1, perAgent: new Map([[unconfigured, 5]]), perResourceClass: new Map() };
    expect(admitsMoreConcurrency(candidate, limits(), running)).toBe(true);
  });
});

describe('admitsMoreConcurrency — per-resource-class limit', () => {
  it('does not admit a step whose own resource class is already at its configured limit', () => {
    const candidate = { node: node({ id: 'a' }), resourceClass: 'migrations' };
    const runningLimits = limits({ perResourceClass: new Map([['migrations', 1]]) });
    const running: RunningCounts = { global: 1, perAgent: new Map(), perResourceClass: new Map([['migrations', 1]]) };
    expect(admitsMoreConcurrency(candidate, runningLimits, running)).toBe(false);
  });

  it('admits a step with no resource class even when an unrelated resource class is at its own limit', () => {
    const candidate = { node: node({ id: 'a' }) };
    const runningLimits = limits({ perResourceClass: new Map([['migrations', 1]]) });
    const running: RunningCounts = { global: 1, perAgent: new Map(), perResourceClass: new Map([['migrations', 1]]) };
    expect(admitsMoreConcurrency(candidate, runningLimits, running)).toBe(true);
  });
});

describe('admitsMoreConcurrency — adapter-reported limit', () => {
  it('takes the tighter of global and adapterMax', () => {
    const candidate = { node: node({ id: 'a' }) };
    const runningLimits = limits({ global: 10, adapterMax: 2 });
    expect(admitsMoreConcurrency(candidate, runningLimits, { ...NO_RUNNING, global: 2 })).toBe(false);
    expect(admitsMoreConcurrency(candidate, runningLimits, { ...NO_RUNNING, global: 1 })).toBe(true);
  });

  it('is not limited by adapterMax when it is undefined', () => {
    const candidate = { node: node({ id: 'a' }) };
    const runningLimits = limits({ global: 3 });
    expect(admitsMoreConcurrency(candidate, runningLimits, { ...NO_RUNNING, global: 2 })).toBe(true);
  });
});

describe('admitsMoreConcurrency — a NaN limit value fails safe (denies), matching every other degenerate limit value, rather than silently disabling that limit axis', () => {
  // A verify round found every OTHER degenerate limit value (0, negative, Infinity) already fails safe on
  // its own, purely because `count >= that value` behaves sensibly for all of them -- NaN was the one
  // exception (`count >= NaN` is always false), confirmed through this exact function for all three limit
  // classes below.

  it('denies when adapterMax is NaN, rather than corrupting the combined global limit into "unlimited"', () => {
    const candidate = { node: node({ id: 'a' }) };
    const runningLimits = limits({ global: 10, adapterMax: Number.NaN });
    expect(admitsMoreConcurrency(candidate, runningLimits, { ...NO_RUNNING, global: 5 })).toBe(false);
  });

  it('denies when a configured perAgent limit is NaN, rather than making that agent unlimited', () => {
    const architect = toAgentId('architect');
    const candidate = { node: node({ id: 'a', agent: architect }) };
    const runningLimits = limits({ perAgent: new Map([[architect, Number.NaN]]) });
    const running: RunningCounts = { global: 1, perAgent: new Map([[architect, 50]]), perResourceClass: new Map() };
    expect(admitsMoreConcurrency(candidate, runningLimits, running)).toBe(false);
  });

  it('denies when a configured perResourceClass limit is NaN, rather than making that resource class unlimited', () => {
    const candidate = { node: node({ id: 'a' }), resourceClass: 'migrations' };
    const runningLimits = limits({ perResourceClass: new Map([['migrations', Number.NaN]]) });
    const running: RunningCounts = { global: 1, perAgent: new Map(), perResourceClass: new Map([['migrations', 50]]) };
    expect(admitsMoreConcurrency(candidate, runningLimits, running)).toBe(false);
  });
});
