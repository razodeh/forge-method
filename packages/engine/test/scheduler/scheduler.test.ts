/**
 * `Scheduler` — the stateful coordinator wrapping ready-set/ordering/concurrency into one `next()` call
 * per tick.
 *
 * @see specs/06 §6.3
 * @see PLAN-M5.md P12
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { toAgentId } from '../../src/plan/index.ts';
import { Scheduler } from '../../src/scheduler/scheduler.ts';
import type { ConcurrencyLimits } from '../../src/scheduler/types.ts';
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

function limits(overrides: Partial<ConcurrencyLimits> = {}): ConcurrencyLimits {
  return { global: 10, perAgent: new Map(), perResourceClass: new Map(), ...overrides };
}

describe('Scheduler', () => {
  it('throws a ForgeError (RUN-036), not silently keeping only one, when two different nodes share the same id', () => {
    // A critic round found `byId`'s own `Map` construction keeps only the last-declared duplicate, so the
    // *other* node's agent/claims would silently vanish from every concurrency/claim-conflict check the
    // moment it was marked running -- deliberately built here with different `agent`/`produces` data (not
    // just two textually-identical nodes) so this test would still fail loudly if that eager check were
    // ever removed and the silent-last-wins behavior crept back in.
    const architect = toAgentId('architect');
    const original = node({ id: 'dup', agent: architect, produces: ['src/foo.ts'] });
    const impostor = node({ id: 'dup', produces: ['src/bar.ts'] });
    let caught: unknown;
    try {
      new Scheduler([original, impostor], limits(), 'seed');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-036');
  });

  it('advances a linear chain one step at a time as each predecessor is marked succeeded', () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b', dependsOn: ['a'] });
    const c = node({ id: 'c', dependsOn: ['b'] });
    const scheduler = new Scheduler([a, b, c], limits(), 'seed');

    expect(scheduler.next().map((n) => n.id)).toEqual(['a']);
    scheduler.markRunning('a');
    expect(scheduler.next()).toEqual([]);
    scheduler.markSucceeded('a');
    expect(scheduler.next().map((n) => n.id)).toEqual(['b']);
    scheduler.markRunning('b');
    scheduler.markSucceeded('b');
    expect(scheduler.next().map((n) => n.id)).toEqual(['c']);
  });

  it("an exclusive agent's second ready step is never admitted while the first of that agent runs, across two ticks", () => {
    const architect = toAgentId('architect');
    const first = node({ id: 'first', agent: architect });
    const second = node({ id: 'second', agent: architect });
    const scheduler = new Scheduler(
      [first, second],
      limits({ perAgent: new Map([[architect, 1]]) }),
      'seed',
    );

    const tick1 = scheduler.next().map((n) => n.id);
    expect(tick1).toHaveLength(1);
    scheduler.markRunning(tick1[0] ?? '');

    // The second architect step must still not be admitted while the first is running.
    expect(scheduler.next()).toEqual([]);
  });

  it('admits both steps of an exclusive agent across separate ticks once the first finishes', () => {
    const architect = toAgentId('architect');
    const first = node({ id: 'first', agent: architect });
    const second = node({ id: 'second', agent: architect });
    const scheduler = new Scheduler(
      [first, second],
      limits({ perAgent: new Map([[architect, 1]]) }),
      'seed',
    );

    scheduler.markRunning('first');
    expect(scheduler.next()).toEqual([]);
    scheduler.markSucceeded('first');
    expect(scheduler.next().map((n) => n.id)).toEqual(['second']);
  });

  it('never admits two ready nodes with overlapping produces claims in the same tick, even with no concurrency limit in the way', () => {
    const a = node({ id: 'a', produces: ['src/foo.ts'] });
    const b = node({ id: 'b', produces: ['src/foo.ts'] });
    const scheduler = new Scheduler([a, b], limits({ global: 10 }), 'seed');
    const admitted = scheduler.next();
    expect(admitted).toHaveLength(1);
  });

  it('respects the global concurrency limit across a wide ready set', () => {
    const nodes = Array.from({ length: 5 }, (_, i) => node({ id: `s${String(i)}` }));
    const scheduler = new Scheduler(nodes, limits({ global: 2 }), 'seed');
    expect(scheduler.next()).toHaveLength(2);
  });

  it('marking a step failed removes it from running without ever making anything depending on it ready', () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b', dependsOn: ['a'] });
    const scheduler = new Scheduler([a, b], limits(), 'seed');
    scheduler.markRunning('a');
    scheduler.markFailed('a');
    expect(scheduler.status('a')).toBe('failed');
    expect(scheduler.next()).toEqual([]);
  });

  it('marking a step skipped behaves the same as failed for anything depending on it', () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b', dependsOn: ['a'] });
    const scheduler = new Scheduler([a, b], limits(), 'seed');
    scheduler.markSkipped('a');
    expect(scheduler.next()).toEqual([]);
  });

  it('uses the caller-supplied resourceClassOf function for per-resource-class limits', () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b' });
    const scheduler = new Scheduler(
      [a, b],
      limits({ perResourceClass: new Map([['migrations', 1]]) }),
      'seed',
      () => 'migrations',
    );
    expect(scheduler.next()).toHaveLength(1);
  });

  it('defaults to no resource class at all when the caller supplies no resourceClassOf function', () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b' });
    const scheduler = new Scheduler(
      [a, b],
      limits({ perResourceClass: new Map([['migrations', 1]]) }),
      'seed',
    );
    expect(scheduler.next()).toHaveLength(2);
  });

  it('produces byte-identical successive next() outputs for an unchanged state', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node({ id: `s${String(i)}` }));
    const scheduler = new Scheduler(nodes, limits({ global: 3 }), 'seed');
    const first = scheduler.next().map((n) => n.id);
    const second = scheduler.next().map((n) => n.id);
    expect(second).toEqual(first);
  });

  it('a never-marked step reports status "pending"', () => {
    const scheduler = new Scheduler([node({ id: 'a' })], limits(), 'seed');
    expect(scheduler.status('a')).toBe('pending');
  });

  it("counts an already-running node's own agent against the per-agent limit at the very start of the next tick, not just against nodes admitted within that same tick", () => {
    const architect = toAgentId('architect');
    const first = node({ id: 'first', agent: architect });
    const second = node({ id: 'second', agent: architect });
    const scheduler = new Scheduler(
      [first, second],
      limits({ perAgent: new Map([[architect, 1]]) }),
      'seed',
    );
    scheduler.markRunning('first');
    // "second" must not be admitted: "first" is already running under the same exclusive agent, counted
    // from the running set itself, before this tick's own greedy admission loop even starts.
    expect(scheduler.next()).toEqual([]);
  });

  it("counts an already-running node's own resource class against the per-resource-class limit at the start of the next tick", () => {
    const a = node({ id: 'a' });
    const b = node({ id: 'b' });
    const scheduler = new Scheduler(
      [a, b],
      limits({ perResourceClass: new Map([['migrations', 1]]) }),
      'seed',
      () => 'migrations',
    );
    scheduler.markRunning('a');
    expect(scheduler.next()).toEqual([]);
  });

  it('setLimits replaces the limits enforced by every subsequent next() call, without needing to reconstruct the scheduler or losing its own accumulated status/running state', () => {
    const nodes = Array.from({ length: 5 }, (_, i) => node({ id: `s${String(i)}` }));
    const scheduler = new Scheduler(nodes, limits({ global: 5 }), 'seed');
    expect(scheduler.next()).toHaveLength(5);

    scheduler.setLimits(limits({ global: 2 }));
    expect(scheduler.next()).toHaveLength(2);

    // Status tracked before the limits changed must still be intact afterward -- setLimits touches only
    // the concurrency ceiling, nothing else about this scheduler's own state.
    scheduler.markRunning('s0');
    expect(scheduler.status('s0')).toBe('running');
  });

  it('setLimits to a global ceiling BELOW the count of nodes already marked running does not crash, does not over-admit, and correctly reopens capacity as running nodes finish -- the shape backpressure actually needs, not just an unused-at-the-time limit change', () => {
    const nodes = Array.from({ length: 5 }, (_, i) => node({ id: `s${String(i)}` }));
    const scheduler = new Scheduler(nodes, limits({ global: 5 }), 'seed');
    scheduler.markRunning('s0');
    scheduler.markRunning('s1');
    scheduler.markRunning('s2');

    // A rate-limit signal drops the ceiling to 2 -- already BELOW the 3 nodes currently running.
    scheduler.setLimits(limits({ global: 2 }));
    expect(scheduler.next()).toEqual([]); // already over the new ceiling; nothing new admitted

    scheduler.markSucceeded('s0');
    expect(scheduler.next()).toEqual([]); // 2 still running == the new ceiling; still nothing admitted

    scheduler.markSucceeded('s1');
    expect(scheduler.next().map((n) => n.id)).toEqual(['s3']); // 1 running < ceiling of 2; one more admitted
  });

  it("does not let a phantom running id -- never one of this scheduler's own constructor nodes -- inflate the global concurrency count against real, admittable work", () => {
    // A verify round found the global counter derived from the raw `this.running.size` while the other
    // three counters (claims, perAgent, perResourceClass) all derive from `runningNodes()`, which filters
    // through `byId` -- a caller mistakenly calling `markRunning` with an id this scheduler was never
    // constructed with would silently over-count the global limit against a node that contributes nothing
    // to (and can never be admitted via) any of the other three.
    const a = node({ id: 'a' });
    const scheduler = new Scheduler([a], limits({ global: 1 }), 'seed');
    scheduler.markRunning('phantom-not-a-real-node');
    expect(scheduler.next().map((n) => n.id)).toEqual(['a']);
  });

  it('defaults canAdmit to always-admit, so a caller with no budget concept pays nothing for it', () => {
    const nodes = Array.from({ length: 3 }, (_, i) => node({ id: `s${String(i)}` }));
    const scheduler = new Scheduler(nodes, limits({ global: 5 }), 'seed');
    expect(scheduler.next()).toHaveLength(3);
  });

  it('refuses to admit a node the caller-supplied canAdmit rejects, without otherwise affecting claim/concurrency admission of the rest', () => {
    const nodes = [
      node({ id: 'expensive', produces: [] }),
      node({ id: 'cheap-a', produces: [] }),
      node({ id: 'cheap-b', produces: [] }),
    ];
    const scheduler = new Scheduler(
      nodes,
      limits({ global: 5 }),
      'seed',
      undefined,
      (candidate) => candidate.id !== 'expensive',
    );
    const admittedIds = scheduler.next().map((n) => n.id);
    expect(admittedIds).not.toContain('expensive');
    expect(admittedIds).toEqual(expect.arrayContaining(['cheap-a', 'cheap-b']));
  });

  it('a node canAdmit refuses does not consume any concurrency slot -- refusing it leaves room for a node later in priority order that canAdmit does allow', () => {
    // Global ceiling of exactly 1: if the refused node had already counted against it before being
    // rejected, the one real slot would be wasted and nothing else would be admitted this tick.
    const nodes = [node({ id: 'refused' }), node({ id: 'allowed' })];
    const scheduler = new Scheduler(
      nodes,
      limits({ global: 1 }),
      'seed',
      undefined,
      (candidate) => candidate.id !== 'refused',
    );
    expect(scheduler.next().map((n) => n.id)).toEqual(['allowed']);
  });
});
