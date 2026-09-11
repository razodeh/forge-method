/**
 * `reduceRun` — the first real slice of `@forge/tui`'s own event-sourced read model.
 *
 * @see specs/04 §4.6
 * @see PLAN-M9.md P1
 */
import { describe, expect, it } from 'vitest';

import type { EventType, ForgeEvent } from '@forge/telemetry/events';

import {
  INITIAL_RUN_READ_MODEL,
  reduceRun,
  type RunReadModel,
} from '../../src/state/run-read-model.ts';

let seq = 1;
function event(type: EventType, overrides: Partial<ForgeEvent> = {}): ForgeEvent {
  return {
    v: 1,
    seq: seq++,
    ts: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    type,
    payload: undefined,
    ...overrides,
  };
}

function fold(
  events: readonly ForgeEvent[],
  initial: RunReadModel = INITIAL_RUN_READ_MODEL,
): RunReadModel {
  return events.reduce(reduceRun, initial);
}

describe('reduceRun', () => {
  it('an empty event sequence leaves the read model at its real, well-defined initial state', () => {
    expect(fold([])).toBe(INITIAL_RUN_READ_MODEL);
  });

  it('Run group events set runStatus, one real transition at a time', () => {
    expect(fold([event('RunPlanned')]).runStatus).toBe('planned');
    expect(fold([event('RunPlanned'), event('RunStarted')]).runStatus).toBe('started');
    expect(fold([event('RunPlanned'), event('RunStarted'), event('RunPaused')]).runStatus).toBe(
      'paused',
    );
    expect(
      fold([event('RunPlanned'), event('RunStarted'), event('RunPaused'), event('RunResumed')])
        .runStatus,
    ).toBe('resumed');
    expect(fold([event('RunPlanned'), event('RunStarted'), event('RunCompleted')]).runStatus).toBe(
      'completed',
    );
    expect(fold([event('RunPlanned'), event('RunFailed')]).runStatus).toBe('failed');
  });

  it('StepProgress is a real, deliberate no-op -- it carries nothing this read model projects', () => {
    const initial = fold([event('StepStarted', { stepId: 's1' })]);
    const next = reduceRun(initial, event('StepProgress', { stepId: 's1' }));
    expect(next).toBe(initial);
  });

  it('LaneAbandoned and LaneRemoved set the named lane to the expected terminal status', () => {
    expect(
      fold([
        event('LaneCreated', { laneId: 'l1' }),
        event('LaneAbandoned', { laneId: 'l1' }),
      ]).laneStatuses.get('l1'),
    ).toBe('abandoned');
    expect(
      fold([
        event('LaneCreated', { laneId: 'l1' }),
        event('LaneRemoved', { laneId: 'l1' }),
      ]).laneStatuses.get('l1'),
    ).toBe('removed');
  });

  it('Step group events set the named step to the expected status', () => {
    const state = fold([
      event('StepScheduled', { stepId: 's1' }),
      event('StepStarted', { stepId: 's1' }),
    ]);
    expect(state.stepStatuses.get('s1')).toBe('running');
  });

  it('StepRetried resets a failed step back to scheduled', () => {
    const state = fold([
      event('StepStarted', { stepId: 's1' }),
      event('StepFailed', { stepId: 's1' }),
      event('StepRetried', { stepId: 's1' }),
    ]);
    expect(state.stepStatuses.get('s1')).toBe('scheduled');
  });

  it('an event with no stepId/laneId at all is a real no-op, not a crash', () => {
    const state = fold([event('StepScheduled'), event('LaneCreated')]);
    expect(state.stepStatuses.size).toBe(0);
    expect(state.laneStatuses.size).toBe(0);
  });

  it('Lane group events set the named lane to the expected status', () => {
    const state = fold([
      event('LaneCreated', { laneId: 'l1' }),
      event('LaneCommitted', { laneId: 'l1' }),
      event('LaneReady', { laneId: 'l1' }),
    ]);
    expect(state.laneStatuses.get('l1')).toBe('ready');
  });

  it('RunAborted cascades to every step still scheduled/running/escalated, leaving terminal-or-skipped steps untouched', () => {
    const state = fold([
      event('StepStarted', { stepId: 'running-step' }),
      event('StepSucceeded', { stepId: 'done-step' }),
      event('StepSkipped', { stepId: 'skipped-step' }),
      event('StepEscalated', { stepId: 'escalated-step' }),
      event('RunAborted'),
    ]);
    expect(state.runStatus).toBe('aborted');
    expect(state.stepStatuses.get('running-step')).toBe('aborted');
    expect(state.stepStatuses.get('escalated-step')).toBe('aborted');
    expect(state.stepStatuses.get('done-step')).toBe('succeeded');
    expect(state.stepStatuses.get('skipped-step')).toBe('skipped');
  });

  it('UsageRecorded accumulates a real, valid costUsd across multiple events', () => {
    const state = fold([
      event('UsageRecorded', { payload: { costUsd: 0.5 } }),
      event('UsageRecorded', { payload: { costUsd: 1.25 } }),
    ]);
    expect(state.spentUsd).toBeCloseTo(1.75);
  });

  it('UsageRecorded with a malformed or missing costUsd contributes 0, never throws or produces NaN', () => {
    const state = fold([
      event('UsageRecorded', { payload: { costUsd: 'not-a-number' } }),
      event('UsageRecorded', { payload: {} }),
      event('UsageRecorded', { payload: undefined }),
    ]);
    expect(state.spentUsd).toBe(0);
  });

  it("an event carrying no real state change returns the identical state reference (the store's own no-op contract, store.ts)", () => {
    const initial = fold([event('StepStarted', { stepId: 's1' })]);
    const next = reduceRun(initial, event('StepStarted', { stepId: 's1' }));
    expect(next).toBe(initial);
  });

  it('every event type with no dedicated field returns the identical state reference unchanged', () => {
    const initial = fold([event('RunStarted')]);
    const next = reduceRun(initial, event('KbWritten'));
    expect(next).toBe(initial);
  });

  it('replaying the identical event sequence twice from the initial state produces deep-equal (deterministic) results', () => {
    const events = [
      event('RunPlanned'),
      event('RunStarted'),
      event('StepScheduled', { stepId: 's1' }),
      event('StepStarted', { stepId: 's1' }),
      event('UsageRecorded', { payload: { costUsd: 2 } }),
      event('LaneCreated', { laneId: 'l1' }),
    ];
    expect(fold(events)).toEqual(fold(events));
  });
});
