/**
 * `projectLedger`/`attributedSpend`/`checkBudget`/`detectRunaway` — `PLAN-M5.md` P7's own Checks
 * section, verbatim.
 *
 * @see specs/06 §6.9
 * @see specs/18 §18.4
 * @see specs/18 §18.5
 * @see specs/20 §20.8
 * @see PLAN-M5.md P7
 */
import { describe, expect, it } from 'vitest';

import { TelemetryError } from '../src/errors.ts';
import type { ForgeEvent, NewForgeEvent } from '../src/events.ts';
import {
  attributedSpend,
  checkBudget,
  detectRunaway,
  projectLedger,
  type LedgerEntry,
  type RetryAttempt,
  type UsageRecordedPayload,
} from '../src/ledger.ts';

function usagePayload(overrides: Partial<UsageRecordedPayload> = {}): UsageRecordedPayload {
  return {
    model: 'test-model-1',
    platform: 'anthropic',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    costUsd: 0.5,
    estimated: false,
    durationMs: 1000,
    ...overrides,
  };
}

function usageEvent(overrides: Partial<NewForgeEvent> = {}): NewForgeEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    type: 'UsageRecorded',
    stepId: 'story-014:implement',
    agentId: 'engineer',
    payload: usagePayload(),
    ...overrides,
  };
}

/** `projectLedger` takes `AsyncIterable<ForgeEvent>` so a real `readEvents(...)` can be passed directly
 * with no intermediate buffering — this wraps a plain array of already-`seq`-assigned events (built by
 * hand, not through `appendEvent`, since these tests are about the projection, not the write path
 * already covered by `events.test.ts`) into that same shape. */
async function* asAsyncIterable(events: readonly NewForgeEvent[]): AsyncGenerator<ForgeEvent> {
  await Promise.resolve();
  let seq = 1;
  for (const event of events) {
    yield { ...event, v: 1, seq };
    seq += 1;
  }
}

function ledgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    runId: 'run-1',
    stepId: 'story-014:implement',
    agent: 'engineer',
    model: 'test-model-1',
    platform: 'anthropic',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    costUsd: 0.5,
    estimated: false,
    durationMs: 1000,
    ts: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('projectLedger', () => {
  it('projects a UsageRecorded event into a LedgerEntry with every field carried across correctly', async () => {
    const entries = await projectLedger(asAsyncIterable([usageEvent()]));

    expect(entries).toEqual([ledgerEntry()]);
  });

  it('skips every non-UsageRecorded event, including other Cost-group events', async () => {
    const entries = await projectLedger(
      asAsyncIterable([
        { ts: 't', runId: 'run-1', type: 'RunStarted', payload: {} },
        { ts: 't', runId: 'run-1', type: 'BudgetWarning', payload: { level: 'run', spent: 5, cap: 10 } },
        usageEvent(),
        { ts: 't', runId: 'run-1', type: 'BudgetBreached', payload: { level: 'run', spent: 10, cap: 10 } },
      ]),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.stepId).toBe('story-014:implement');
  });

  it('projects multiple UsageRecorded events in read order, one row each', async () => {
    const entries = await projectLedger(
      asAsyncIterable([
        usageEvent({ payload: usagePayload({ costUsd: 0.1 }) }),
        usageEvent({ payload: usagePayload({ costUsd: 0.2 }) }),
      ]),
    );

    expect(entries.map((e) => e.costUsd)).toEqual([0.1, 0.2]);
  });

  it('marks an adapter-estimated figure as estimated, never silently presented as a reported cost', async () => {
    const entries = await projectLedger(asAsyncIterable([usageEvent({ payload: usagePayload({ estimated: true }) })]));

    expect(entries[0]?.estimated).toBe(true);
  });

  it('throws a TelemetryError for a UsageRecorded event with no stepId at all', async () => {
    // Omitted, not set to `undefined` -- exactOptionalPropertyTypes distinguishes the two, and only
    // omission is a valid NewForgeEvent; toLedgerEntry treats both identically at runtime regardless.
    const event: NewForgeEvent = {
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'UsageRecorded',
      agentId: 'engineer',
      payload: usagePayload(),
    };

    let caught: unknown;
    try {
      await projectLedger(asAsyncIterable([event]));
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected projectLedger to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT');
  });

  it('throws a TelemetryError for a UsageRecorded event with no agentId at all', async () => {
    const event: NewForgeEvent = {
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'UsageRecorded',
      stepId: 'story-014:implement',
      payload: usagePayload(),
    };

    let caught: unknown;
    try {
      await projectLedger(asAsyncIterable([event]));
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected projectLedger to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT');
  });

  it.each([
    ['not an object', 'not-an-object'],
    ['null', null],
    ['missing every field', {}],
    ['model wrong type', usagePayload({ model: 42 as unknown as string })],
    ['platform wrong type', usagePayload({ platform: 42 as unknown as string })],
    ['model empty string', usagePayload({ model: '' })],
    ['model whitespace-only', usagePayload({ model: '   ' })],
    ['platform empty string', usagePayload({ platform: '' })],
    ['platform whitespace-only', usagePayload({ platform: '\t\n' })],
    ['inputTokens wrong type', usagePayload({ inputTokens: '100' as unknown as number })],
    ['outputTokens wrong type', usagePayload({ outputTokens: '50' as unknown as number })],
    ['cacheReadTokens wrong type', usagePayload({ cacheReadTokens: '0' as unknown as number })],
    ['costUsd wrong type', usagePayload({ costUsd: '0.5' as unknown as number })],
    ['estimated wrong type', usagePayload({ estimated: 'false' as unknown as boolean })],
    ['durationMs wrong type', usagePayload({ durationMs: '1000' as unknown as number })],
  ])('throws a TelemetryError for a UsageRecorded event whose payload is %s', async (_label, payload) => {
    let caught: unknown;
    try {
      await projectLedger(asAsyncIterable([usageEvent({ payload })]));
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected projectLedger to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT');
  });

  it.each(['inputTokens', 'outputTokens', 'cacheReadTokens', 'costUsd', 'durationMs'] as const)(
    'throws a TelemetryError when %s is NaN, not silently accepted since typeof NaN === "number"',
    async (field) => {
      let caught: unknown;
      try {
        await projectLedger(asAsyncIterable([usageEvent({ payload: usagePayload({ [field]: NaN }) })]));
      } catch (error) {
        caught = error;
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(`expected projectLedger to reject with a TelemetryError, got ${String(caught)}`);
      }
      expect(caught.code).toBe('TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT');
    },
  );

  it.each(['inputTokens', 'outputTokens', 'cacheReadTokens', 'costUsd', 'durationMs'] as const)(
    'throws a TelemetryError when %s is negative',
    async (field) => {
      let caught: unknown;
      try {
        await projectLedger(asAsyncIterable([usageEvent({ payload: usagePayload({ [field]: -1 }) })]));
      } catch (error) {
        caught = error;
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(`expected projectLedger to reject with a TelemetryError, got ${String(caught)}`);
      }
      expect(caught.code).toBe('TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT');
    },
  );

  it.each(['inputTokens', 'outputTokens', 'cacheReadTokens', 'costUsd', 'durationMs'] as const)(
    'throws a TelemetryError when %s is Infinity',
    async (field) => {
      let caught: unknown;
      try {
        await projectLedger(asAsyncIterable([usageEvent({ payload: usagePayload({ [field]: Infinity }) })]));
      } catch (error) {
        caught = error;
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(`expected projectLedger to reject with a TelemetryError, got ${String(caught)}`);
      }
      expect(caught.code).toBe('TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT');
    },
  );

  it('accepts a zero value for every numeric field — zero is a valid amount, not treated as missing', async () => {
    const entries = await projectLedger(
      asAsyncIterable([
        usageEvent({
          payload: usagePayload({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, durationMs: 0 }),
        }),
      ]),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.costUsd).toBe(0);
  });

  it.each(['', '   ', '\t\n', undefined])(
    'throws a TelemetryError for a UsageRecorded event whose stepId is %s',
    async (stepId) => {
      const event: NewForgeEvent =
        stepId === undefined
          ? { ts: 't', runId: 'run-1', type: 'UsageRecorded', agentId: 'engineer', payload: usagePayload() }
          : usageEvent({ stepId });

      let caught: unknown;
      try {
        await projectLedger(asAsyncIterable([event]));
      } catch (error) {
        caught = error;
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(`expected projectLedger to reject with a TelemetryError, got ${String(caught)}`);
      }
      expect(caught.code).toBe('TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT');
    },
  );

  it.each(['', '   ', '\t\n'])('throws a TelemetryError for a UsageRecorded event whose agentId is %s', async (agentId) => {
    let caught: unknown;
    try {
      await projectLedger(asAsyncIterable([usageEvent({ agentId })]));
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected projectLedger to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT');
  });

  it('does not discard entries already read before a later, malformed event — a mixed stream still throws, but the failure is diagnosable', async () => {
    const good = usageEvent({ payload: usagePayload({ costUsd: 1 }) });
    const bad = usageEvent({ payload: usagePayload({ costUsd: NaN }) });

    let caught: unknown;
    try {
      await projectLedger(asAsyncIterable([good, bad]));
    } catch (error) {
      caught = error;
    }

    // Pins the current all-or-nothing behaviour explicitly: one malformed event anywhere in the stream
    // throws and discards every entry already collected, rather than returning the good ones. The error
    // names which event failed (run + seq) so an operator can actually locate and fix it.
    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected projectLedger to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.message).toContain('seq 2');
  });

  it('returns an empty ledger for an empty event stream, not an error', async () => {
    const entries = await projectLedger(asAsyncIterable([]));

    expect(entries).toEqual([]);
  });

  it('preserves read order across multiple steps with non-UsageRecorded events interleaved between them', async () => {
    const entries = await projectLedger(
      asAsyncIterable([
        usageEvent({ stepId: 'step-a', payload: usagePayload({ costUsd: 1 }) }),
        { ts: 't', runId: 'run-1', type: 'StepSucceeded', stepId: 'step-a', payload: {} },
        usageEvent({ stepId: 'step-b', payload: usagePayload({ costUsd: 2 }) }),
        { ts: 't', runId: 'run-1', type: 'StepRetried', stepId: 'step-b', payload: {} },
        usageEvent({ stepId: 'step-a', payload: usagePayload({ costUsd: 3 }) }),
      ]),
    );

    expect(entries.map((e) => ({ stepId: e.stepId, costUsd: e.costUsd }))).toEqual([
      { stepId: 'step-a', costUsd: 1 },
      { stepId: 'step-b', costUsd: 2 },
      { stepId: 'step-a', costUsd: 3 },
    ]);
  });
});

describe('attributedSpend', () => {
  it('sums every entry attributed to a step across all its retries, not just the last one', () => {
    const entries = [
      ledgerEntry({ costUsd: 2, ts: 't1' }),
      ledgerEntry({ costUsd: 3, ts: 't2' }),
      ledgerEntry({ costUsd: 1, ts: 't3' }),
    ];

    expect(attributedSpend(entries, 'story-014:implement')).toBe(6);
  });

  it('does not attribute spend from a different step', () => {
    const entries = [ledgerEntry({ stepId: 'a', costUsd: 2 }), ledgerEntry({ stepId: 'b', costUsd: 3 })];

    expect(attributedSpend(entries, 'a')).toBe(2);
  });

  it('returns 0 for a step with no ledger entries at all', () => {
    expect(attributedSpend([], 'story-014:implement')).toBe(0);
  });
});

describe('checkBudget', () => {
  it('reports "ok" when spend is comfortably under the warning threshold', () => {
    expect(checkBudget({ spent: 1, cap: 10 })).toBe('ok');
  });

  it('reports "warning" once spend crosses the warning threshold but has not yet reached the cap', () => {
    expect(checkBudget({ spent: 8, cap: 10 })).toBe('warning');
  });

  it('reports "breached" at exactly the cap boundary, not "ok" — an off-by-one here is a financial bug', () => {
    expect(checkBudget({ spent: 10, cap: 10 })).toBe('breached');
  });

  it('reports "breached" for spend beyond the cap', () => {
    expect(checkBudget({ spent: 15, cap: 10 })).toBe('breached');
  });

  it('reports "ok" at exactly the warning threshold\'s own lower boundary minus a cent, "warning" at the boundary itself', () => {
    expect(checkBudget({ spent: 7.99, cap: 10 })).toBe('ok');
    expect(checkBudget({ spent: 8, cap: 10 })).toBe('warning');
  });

  it('honours a caller-supplied warningThreshold instead of the default 0.8', () => {
    expect(checkBudget({ spent: 6, cap: 10, warningThreshold: 0.5 })).toBe('warning');
    expect(checkBudget({ spent: 4, cap: 10, warningThreshold: 0.5 })).toBe('ok');
  });

  it('reports "breached" for a cap of exactly 0 with spend of 0 — a zero budget is a valid, extreme configuration, not an error', () => {
    expect(checkBudget({ spent: 0, cap: 0 })).toBe('breached');
  });

  it.each([
    ['spent is NaN', { spent: NaN, cap: 10 }],
    ['spent is negative', { spent: -1, cap: 10 }],
    ['cap is NaN', { spent: 5, cap: NaN }],
    ['cap is negative', { spent: 5, cap: -10 }],
  ])(
    'throws a TelemetryError rather than silently returning "ok" when %s — this is the exact silent-bypass shape S9 exists to prevent',
    (_label, input) => {
      let caught: unknown;
      try {
        checkBudget(input);
      } catch (error) {
        caught = error;
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(`expected checkBudget to throw a TelemetryError, got ${String(caught)}`);
      }
      expect(caught.code).toBe('TELEMETRY-BUDGET-INVALID-INPUT');
    },
  );

  it.each([0, -0.1, 1.5, NaN])('throws a TelemetryError for a warningThreshold of %s, outside (0, 1]', (warningThreshold) => {
    let caught: unknown;
    try {
      checkBudget({ spent: 5, cap: 10, warningThreshold });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected checkBudget to throw a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-BUDGET-INVALID-INPUT');
  });

  it('accepts a warningThreshold of exactly 1 — degenerate (breach and warning coincide) but not invalid', () => {
    expect(checkBudget({ spent: 9, cap: 10, warningThreshold: 1 })).toBe('ok');
    expect(checkBudget({ spent: 10, cap: 10, warningThreshold: 1 })).toBe('breached');
  });

  it('does not accept Infinity for spent or cap, even though the relational comparisons alone would fail toward breached', () => {
    // Infinity biases the *comparison* toward the safe direction (Infinity >= cap is true), but it is
    // still not a real financial figure -- rejected for the same "not a sane number" reason NaN is,
    // not because it was observed to bypass anything.
    expect(() => checkBudget({ spent: Infinity, cap: 10 })).toThrow(
      expect.objectContaining({ code: 'TELEMETRY-BUDGET-INVALID-INPUT' }) as Error,
    );
    expect(() => checkBudget({ spent: 5, cap: Infinity })).toThrow(
      expect.objectContaining({ code: 'TELEMETRY-BUDGET-INVALID-INPUT' }) as Error,
    );
  });
});

describe('detectRunaway', () => {
  function attempt(totalTokens: number, progressed = false): RetryAttempt {
    return { totalTokens, progressed };
  }

  it('fires on a monotonic-growth, no-progress sequence of at least three attempts', () => {
    expect(detectRunaway([attempt(100), attempt(200), attempt(400)])).toBe(true);
  });

  it('does not fire on the same monotonic-growth shape when any attempt made progress', () => {
    expect(detectRunaway([attempt(100), attempt(200, true), attempt(400)])).toBe(false);
  });

  it('does not fire when token consumption does not strictly increase at every step', () => {
    expect(detectRunaway([attempt(100), attempt(200), attempt(200)])).toBe(false);
    expect(detectRunaway([attempt(100), attempt(200), attempt(150)])).toBe(false);
  });

  it('does not fire for fewer than three attempts, even if strictly growing with no progress', () => {
    expect(detectRunaway([])).toBe(false);
    expect(detectRunaway([attempt(100)])).toBe(false);
    expect(detectRunaway([attempt(100), attempt(200)])).toBe(false);
  });

  it('fires for a longer strictly-growing, all-unprogressed sequence', () => {
    expect(detectRunaway([attempt(50), attempt(100), attempt(150), attempt(300), attempt(500)])).toBe(true);
  });

  it('throws a TelemetryError rather than reporting a false positive when a NaN totalTokens sits between two real, decreasing values', () => {
    // Confirmed empirically that the naive monotonic-growth loop's own "did this decrease" bail-out
    // (`current <= previous`) is `false` whenever either side is `NaN` -- so a single NaN silently
    // suppressed the correct "false" verdict for this genuinely-decreasing 500 -> 100 sequence.
    let caught: unknown;
    try {
      detectRunaway([attempt(500), attempt(NaN), attempt(100)]);
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected detectRunaway to throw a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-LEDGER-INVALID-NUMBER');
  });

  it.each([-1, Infinity])('throws a TelemetryError for a totalTokens of %s', (totalTokens) => {
    expect(() => detectRunaway([attempt(100), attempt(200), attempt(totalTokens)])).toThrow(
      expect.objectContaining({ code: 'TELEMETRY-LEDGER-INVALID-NUMBER' }) as Error,
    );
  });

  it('validates every attempt up front, even for fewer than three attempts where the length check alone would otherwise short-circuit first', () => {
    expect(() => detectRunaway([attempt(NaN)])).toThrow(
      expect.objectContaining({ code: 'TELEMETRY-LEDGER-INVALID-NUMBER' }) as Error,
    );
  });

  it('accepts a totalTokens of exactly 0 — zero consumption is a valid amount, not treated as invalid', () => {
    expect(detectRunaway([attempt(0), attempt(100), attempt(200)])).toBe(true);
  });
});
