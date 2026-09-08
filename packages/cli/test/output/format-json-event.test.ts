/**
 * `formatJsonEvent` — the JSON mode row of `03` §3.5's table: one `{"v":1,...}` NDJSON line per
 * event.
 *
 * @see specs/03 §3.5
 */
import { describe, expect, it } from 'vitest';

import type { ForgeEvent } from '@forge/telemetry/events';

import { formatJsonEvent } from '../../src/output/format-json-event.ts';

const events: readonly ForgeEvent[] = [
  { v: 1, seq: 1, ts: '2026-09-08T00:00:00.000Z', runId: 'run-1', type: 'RunStarted', payload: {} },
  {
    v: 1,
    seq: 2,
    ts: '2026-09-08T00:00:01.000Z',
    runId: 'run-1',
    type: 'StepScheduled',
    stepId: 'step-1',
    laneId: 'lane-a',
    payload: { plan: 'compiled' },
  },
  {
    v: 1,
    seq: 3,
    ts: '2026-09-08T00:00:02.000Z',
    runId: 'run-1',
    type: 'RunCompleted',
    payload: null,
  },
];

describe('formatJsonEvent', () => {
  it('round-trips every field of a real event through JSON', () => {
    for (const event of events) {
      expect(JSON.parse(formatJsonEvent(event))).toEqual(event);
    }
  });

  it('is stable and versioned: every line parses with .v === 1, for a real multi-event stream', () => {
    const lines = events.map((event) => formatJsonEvent(event));
    for (const line of lines) {
      const parsed = JSON.parse(line) as { v: unknown };
      expect(parsed.v).toBe(1);
    }
  });

  it('emits one line with no embedded newline, so NDJSON stays line-oriented', () => {
    for (const event of events) {
      expect(formatJsonEvent(event)).not.toContain('\n');
    }
  });
});
