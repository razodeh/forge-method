/**
 * `@forge/engine/backpressure` wired into `@forge/engine/scheduler`'s own `Scheduler.setLimits` —
 * `PLAN-M5.md` P13's own Surface text: "wired into P12's Scheduler as one more input to
 * admitsMoreConcurrency's global limit." The two modules never import each other (`state.ts`'s own doc
 * comment has the fuller reasoning) — this file is the seam, proving the wiring actually works end to end
 * rather than merely asserting it in prose.
 *
 * @see specs/06 §6.3
 * @see PLAN-M5.md P13
 */
import { describe, expect, it } from 'vitest';

import { createBackpressureState, onRateLimitSignal, tick } from '../../src/backpressure/state.ts';
import { Scheduler } from '../../src/scheduler/scheduler.ts';
import type { ConcurrencyLimits } from '../../src/scheduler/types.ts';
import type { StepNode } from '../../src/plan/types.ts';

const QUIET_PERIOD_MS = 30_000;

function node(id: string): StepNode {
  return {
    id,
    kind: 'agent',
    inputs: [],
    outputs: [],
    dependsOn: [],
    produces: [],
    consumes: [],
    retry: { maxAttempts: 1, backoffMs: [1000, 30_000], retryOn: [] },
    limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    idempotencyKey: id,
    onFailure: 'block',
  };
}

function limitsAt(ceiling: number): ConcurrencyLimits {
  return { global: ceiling, perAgent: new Map(), perResourceClass: new Map() };
}

describe('backpressure wired into Scheduler via setLimits', () => {
  it('a rate-limit signal, fed into the scheduler through setLimits, immediately caps the next admitted batch -- without reconstructing the scheduler or losing its own tracked state', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(`s${String(i)}`));
    const configuredCeiling = 8;
    const scheduler = new Scheduler(nodes, limitsAt(configuredCeiling), 'seed');

    expect(scheduler.next()).toHaveLength(8);

    const afterSignal = onRateLimitSignal(createBackpressureState(configuredCeiling), 0);
    expect(afterSignal.ceiling).toBe(4);
    scheduler.setLimits(limitsAt(afterSignal.ceiling));

    expect(scheduler.next()).toHaveLength(4);
  });

  it('restoration climbing back over successive ticks is reflected in the scheduler as soon as each setLimits call happens, tracking an injected clock rather than real elapsed time', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(`s${String(i)}`));
    const configuredCeiling = 8;
    const scheduler = new Scheduler(nodes, limitsAt(configuredCeiling), 'seed');

    let backpressure = onRateLimitSignal(createBackpressureState(configuredCeiling), 0);
    scheduler.setLimits(limitsAt(backpressure.ceiling));
    expect(scheduler.next()).toHaveLength(4);

    // No new signal, and the quiet period has now elapsed three times over: restoration should have
    // climbed back to 4 + 3 = 7, still short of the full, pre-signal ceiling of 8.
    backpressure = tick(backpressure, QUIET_PERIOD_MS * 3);
    scheduler.setLimits(limitsAt(backpressure.ceiling));
    expect(scheduler.next()).toHaveLength(7);

    // Once fully recovered, the scheduler admits up to the original configured ceiling again.
    backpressure = tick(backpressure, QUIET_PERIOD_MS * 1000);
    expect(backpressure.ceiling).toBe(configuredCeiling);
    scheduler.setLimits(limitsAt(backpressure.ceiling));
    expect(scheduler.next()).toHaveLength(8);
  });

  it('a rate-limit signal arriving while real work is already in flight does not disturb that work, and capacity correctly reopens for genuinely PENDING work as running nodes finish, capped at the new ceiling not the original one', () => {
    // 10 independent nodes -- deliberately more than the configured ceiling of 8, so two remain genuinely
    // "pending" after the first admission, giving something real for reopened capacity to admit later (a
    // test with exactly as many nodes as the ceiling would pass even under a broken implementation, since
    // there would be nothing left to admit either way).
    const nodes = Array.from({ length: 10 }, (_, i) => node(`s${String(i)}`));
    const configuredCeiling = 8;
    const scheduler = new Scheduler(nodes, limitsAt(configuredCeiling), 'seed');

    const firstBatch = scheduler.next();
    expect(firstBatch).toHaveLength(8);
    for (const admitted of firstBatch) scheduler.markRunning(admitted.id);

    const afterSignal = onRateLimitSignal(createBackpressureState(configuredCeiling), 0);
    expect(afterSignal.ceiling).toBe(4);
    scheduler.setLimits(limitsAt(afterSignal.ceiling));

    // Already 8 running, well over the new ceiling of 4 -- nothing new admitted, and none of the 8
    // in-flight nodes are disturbed (still reported as running, not silently reset or re-admitted).
    expect(scheduler.next()).toEqual([]);
    for (const admitted of firstBatch) expect(scheduler.status(admitted.id)).toBe('running');

    // Five of the eight finish, leaving 3 running -- one slot open under the ceiling of 4. One of the two
    // still-genuinely-pending nodes must be admitted; which one depends on the ordinary ordering tiebreak,
    // not on backpressure itself, so only the count is asserted here.
    for (const admitted of firstBatch.slice(0, 5)) scheduler.markSucceeded(admitted.id);
    const reopened = scheduler.next();
    expect(reopened).toHaveLength(1);
    expect(['s8', 's9']).toContain(reopened[0]?.id);
  });
});
