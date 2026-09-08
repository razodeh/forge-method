/**
 * `formatStreamLine` — the Stream mode row of `03` §3.5's table.
 *
 * @see specs/03 §3.5
 */
import { describe, expect, it } from 'vitest';

import type { ForgeEvent } from '@forge/telemetry/events';

import { formatStreamLine } from '../../src/output/format-stream-line.ts';

function event(overrides: Partial<ForgeEvent> = {}): ForgeEvent {
  return {
    v: 1,
    seq: 1,
    ts: '2026-09-08T00:00:00.000Z',
    runId: 'run-1',
    type: 'StepStarted',
    payload: { note: 'building' },
    ...overrides,
  };
}

describe('formatStreamLine', () => {
  it('prefixes [lane][agent][step], `-` for each field the event does not carry', () => {
    const line = formatStreamLine(event(), { color: false });
    expect(line).toBe('[-][-][-] StepStarted {"note":"building"}');
  });

  it('fills in real lane/agent/step ids when present', () => {
    const line = formatStreamLine(
      event({ laneId: 'lane-a', agentId: 'agent-1', stepId: 'step-3' }),
      { color: false },
    );
    expect(line).toBe('[lane-a][agent-1][step-3] StepStarted {"note":"building"}');
  });

  it('emits no ANSI codes when color is false', () => {
    const line = formatStreamLine(event(), { color: false });
    expect(line.includes('\x1b[')).toBe(false);
  });

  it('emits ANSI codes around the prefix when color is true', () => {
    const line = formatStreamLine(event(), { color: true });
    expect(line.startsWith('\x1b[2m[-][-][-]\x1b[0m ')).toBe(true);
  });

  it('omits the trailing payload segment when payload is undefined', () => {
    const line = formatStreamLine(event({ payload: undefined }), { color: false });
    expect(line).toBe('[-][-][-] StepStarted');
  });
});
