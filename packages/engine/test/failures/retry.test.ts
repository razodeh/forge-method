/**
 * `decideRetry`/`computeBackoff` — `06` §6.8's own never-retry rule and backoff-with-jitter.
 *
 * @see specs/06 §6.8
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P16
 */
import { ForgeError } from '@forge/core/errors';
import { describe, expect, it } from 'vitest';

import type { StepFailureInfo, StepOutcome } from '../../src/dispatch/index.ts';
import { computeBackoff, decideRetry } from '../../src/failures/retry.ts';
import type { StepNodeRetryPolicy } from '../../src/plan/index.ts';

function outcome(failure: StepFailureInfo): StepOutcome {
  return {
    stepId: 'wf:step',
    status: 'failed',
    startedAt: 0,
    finishedAt: 1,
    detail: { kind: 'checkpoint' },
    failure,
  };
}

function policy(overrides: Partial<StepNodeRetryPolicy> = {}): StepNodeRetryPolicy {
  return {
    maxAttempts: 3,
    backoffMs: [1000, 30_000],
    retryOn: ['transient', 'tool-error', 'validation', 'test-failure', 'timeout'],
    ...overrides,
  };
}

const TOOL_ERROR: StepFailureInfo = {
  source: 'adapter',
  code: 'TOOL_ERROR',
  message: 'a tool failed',
};
const GATE_REJECTED: StepFailureInfo = { source: 'gate', message: 'Gate G-Test was not approved.' };

describe('decideRetry', () => {
  it('throws RUN-043 for an empty attemptHistory', () => {
    let caught: unknown;
    try {
      decideRetry(policy(), []);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-043');
  });

  it('retries a retryable class within maxAttempts, with no repeated signature yet', () => {
    expect(decideRetry(policy({ maxAttempts: 3 }), [outcome(TOOL_ERROR)])).toBe('retry');
  });

  it("escalates immediately when the failure class is not in the policy's own retryOn list", () => {
    // 'validation' is 06 §6.8's own class for a gate rejection, deliberately excluded here.
    const restrictivePolicy = policy({ retryOn: ['transient', 'tool-error'] });
    expect(decideRetry(restrictivePolicy, [outcome(GATE_REJECTED)])).toBe('escalate');
  });

  it('escalates once maxAttempts is reached, even with no repeated signature', () => {
    const twoAttemptPolicy = policy({ maxAttempts: 2 });
    const history = [
      outcome({ source: 'command', code: '1', message: 'first distinct failure' }),
      outcome({ source: 'command', code: '2', message: 'second distinct failure' }),
    ];
    expect(decideRetry(twoAttemptPolicy, history)).toBe('escalate');
  });

  it('the never-retry rule escalates on the would-be third identical attempt, even though maxAttempts is not yet exhausted', () => {
    const generousPolicy = policy({ maxAttempts: 10 });
    const identicalFailure: StepFailureInfo = {
      source: 'command',
      code: '1',
      message: 'the same lint error every time',
    };
    const history = [outcome(identicalFailure), outcome({ ...identicalFailure })];
    expect(decideRetry(generousPolicy, history)).toBe('escalate');
  });

  it('does not trigger the never-retry rule for two genuinely different signatures', () => {
    const generousPolicy = policy({ maxAttempts: 10 });
    const history = [
      outcome({ source: 'command', code: '1', message: 'lint failed' }),
      outcome({ source: 'command', code: '2', message: 'build failed' }),
    ];
    expect(decideRetry(generousPolicy, history)).toBe('retry');
  });

  it('a single occurrence of a signature is not itself evidence of a stuck loop', () => {
    // Only one attempt so far -- the never-retry rule requires a *second*, matching occurrence.
    expect(decideRetry(policy({ maxAttempts: 5 }), [outcome(TOOL_ERROR)])).toBe('retry');
  });
});

describe('computeBackoff', () => {
  it('throws RUN-044 for a non-positive attemptNumber', () => {
    let caught: unknown;
    try {
      computeBackoff(policy(), 0, 'seed');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-044');
  });

  it('throws RUN-044 for a non-integer attemptNumber', () => {
    expect(() => computeBackoff(policy(), 1.5, 'seed')).toThrow(ForgeError);
  });

  it('falls within [initial, max] across many attempt numbers and seeds', () => {
    const [initialMs, maxMs] = [1000, 30_000];
    const testPolicy = policy({ backoffMs: [initialMs, maxMs] });
    for (let attemptNumber = 1; attemptNumber <= 20; attemptNumber += 1) {
      for (let seedIndex = 0; seedIndex < 10; seedIndex += 1) {
        const value = computeBackoff(testPolicy, attemptNumber, `run-${String(seedIndex)}:wf:step`);
        expect(value).toBeGreaterThanOrEqual(initialMs);
        expect(value).toBeLessThanOrEqual(maxMs);
      }
    }
  });

  it('is reproducible: the identical policy, attemptNumber, and seed always produce the identical value', () => {
    const testPolicy = policy();
    const first = computeBackoff(testPolicy, 3, 'run-1:wf:step');
    const second = computeBackoff(testPolicy, 3, 'run-1:wf:step');
    expect(first).toBe(second);
  });

  it('a different seed generally produces a different value, proving jitter is not a no-op', () => {
    const testPolicy = policy({ backoffMs: [1000, 100_000] });
    const values = new Set(
      Array.from({ length: 10 }, (_, index) =>
        computeBackoff(testPolicy, 3, `seed-${String(index)}`),
      ),
    );
    // Not every seed needs to differ, but a jitter implementation collapsing to one constant value
    // across ten different seeds would be a real bug, not a coincidence.
    expect(values.size).toBeGreaterThan(1);
  });

  it('the first attempt is always exactly `initial`, with zero jitter range of its own', () => {
    // attempt 1's own ceiling is min(max, initial * 2^0) = initial -- the jitter range (ceiling -
    // initial) is exactly zero, so this is the one attempt number with a single, seed-independent
    // correct answer, not a range. Confirmed across many seeds, not just one.
    const testPolicy = policy({ backoffMs: [1000, 1_000_000] });
    for (let seedIndex = 0; seedIndex < 10; seedIndex += 1) {
      expect(computeBackoff(testPolicy, 1, `seed-${String(seedIndex)}`)).toBe(1000);
    }
  });

  it("the exponential ceiling grows across attempts -- observable as the maximum value seen across many seeds, since any one seed's own jitter draw could otherwise mask it", () => {
    // Not `expect(computeBackoff(p, 2, oneSeed)).toBeGreaterThan(computeBackoff(p, 1, oneSeed))` for
    // attempt 2 vs 3: a high jitter draw on attempt 2 combined with a low one on attempt 3 could make
    // that specific comparison fail for an unlucky seed even though the underlying ceiling still grew --
    // the ceiling itself, not any single sample within its own range, is what is guaranteed to grow.
    const testPolicy = policy({ backoffMs: [1000, 1_000_000] });
    const seeds = Array.from({ length: 30 }, (_, index) => `seed-${String(index)}`);
    const maxObservedAt = (attemptNumber: number): number =>
      Math.max(...seeds.map((seed) => computeBackoff(testPolicy, attemptNumber, seed)));
    expect(maxObservedAt(2)).toBeGreaterThan(maxObservedAt(1));
    expect(maxObservedAt(3)).toBeGreaterThan(maxObservedAt(2));
  });

  it('never exceeds max even for a very large attemptNumber', () => {
    const testPolicy = policy({ backoffMs: [1000, 30_000] });
    const value = computeBackoff(testPolicy, 50, 'run-1:wf:step');
    expect(value).toBeLessThanOrEqual(30_000);
  });
});
