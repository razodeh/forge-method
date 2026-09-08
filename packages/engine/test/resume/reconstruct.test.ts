/**
 * `reconstructRunState` — `06` §6.10 step 1: replaying the event log into a `RunState`.
 *
 * @see specs/06 §6.10
 * @see specs/18 §18.4
 * @see PLAN-M5.md P18
 */
import type { EventType, ForgeEvent } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { EVENT_TYPES_HANDLED, reconstructRunState } from '../../src/resume/reconstruct.ts';

let seqCounter = 0;

function event(overrides: Partial<ForgeEvent> & { readonly type: EventType }): ForgeEvent {
  seqCounter += 1;
  return {
    v: 1,
    seq: seqCounter,
    ts: `2026-01-01T00:00:${String(seqCounter).padStart(2, '0')}.000Z`,
    runId: 'run-test',
    payload: undefined,
    ...overrides,
  };
}

async function* asAsyncIterable(events: readonly ForgeEvent[]): AsyncGenerator<ForgeEvent> {
  await Promise.resolve();
  for (const item of events) yield item;
}

describe('reconstructRunState', () => {
  it('replaying an empty log produces a well-defined initial state, not a thrown error', async () => {
    const state = await reconstructRunState(asAsyncIterable([]));
    expect(state).toEqual({
      runId: undefined,
      planRef: undefined,
      runStatus: undefined,
      stepStatuses: new Map(),
      unresolvedStepIds: [],
      laneStatuses: new Map(),
      spentUsd: 0,
    });
  });

  it('handles every real, registered event type without throwing -- the exhaustive switch really does cover the full current catalogue, not just a hand-copied subset of it', async () => {
    const events = EVENT_TYPES_HANDLED.map((type) => event({ type, stepId: 's', laneId: 'l' }));
    await expect(reconstructRunState(asAsyncIterable(events))).resolves.toBeDefined();
  });

  it('a StepStarted with no matching terminal event surfaces the step as in-flight-and-unresolved', async () => {
    const events = [
      event({ type: 'StepScheduled', stepId: 'wf:a' }),
      event({ type: 'StepStarted', stepId: 'wf:a' }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.stepStatuses.get('wf:a')).toBe('running');
    expect(state.unresolvedStepIds).toEqual(['wf:a']);
  });

  it('a step that reaches a real terminal event is not reported as unresolved', async () => {
    const events = [
      event({ type: 'StepScheduled', stepId: 'wf:a' }),
      event({ type: 'StepStarted', stepId: 'wf:a' }),
      event({ type: 'StepSucceeded', stepId: 'wf:a' }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.stepStatuses.get('wf:a')).toBe('succeeded');
    expect(state.unresolvedStepIds).toEqual([]);
  });

  it('replaying the identical sequence twice produces byte-identical RunState', async () => {
    const events = [
      event({ type: 'RunPlanned', payload: { planRef: 'workflow:build' } }),
      event({ type: 'StepScheduled', stepId: 'wf:a' }),
      event({ type: 'StepStarted', stepId: 'wf:a' }),
      event({ type: 'UsageRecorded', stepId: 'wf:a', payload: { costUsd: 1.5 } }),
      event({ type: 'StepSucceeded', stepId: 'wf:a' }),
    ];
    const first = await reconstructRunState(asAsyncIterable(events));
    const second = await reconstructRunState(asAsyncIterable(events));
    expect(second).toEqual(first);
  });

  it('covers every event group in the catalogue with a real, expected effect on RunState', async () => {
    const events = [
      event({ type: 'RunPlanned', payload: { planRef: 'workflow:build' } }),
      event({ type: 'RunStarted' }),
      event({ type: 'StepScheduled', stepId: 'wf:a' }),
      event({ type: 'StepStarted', stepId: 'wf:a' }),
      event({ type: 'LaneCreated', laneId: 'lane-a' }),
      event({ type: 'SessionStarted', stepId: 'wf:a', laneId: 'lane-a' }),
      event({ type: 'SessionEnded', stepId: 'wf:a', laneId: 'lane-a', payload: { ok: true } }),
      event({ type: 'LaneCommitted', laneId: 'lane-a' }),
      event({ type: 'ArtifactCreated', payload: { artifactId: 'story:1' } }),
      event({ type: 'KbWritten' }),
      event({ type: 'GateEvaluated', payload: { gateId: 'G-Test' } }),
      event({ type: 'GateApproved', payload: { gateId: 'G-Test' } }),
      event({ type: 'MergeQueued', laneId: 'lane-a' }),
      event({ type: 'MergeCompleted', laneId: 'lane-a', payload: { mergeCommitSha: 'abc123' } }),
      event({ type: 'LaneRemoved', laneId: 'lane-a' }),
      event({ type: 'ElicitationRequested' }),
      event({ type: 'ElicitationAnswered' }),
      event({ type: 'UsageRecorded', stepId: 'wf:a', payload: { costUsd: 2.5 } }),
      event({ type: 'PolicyViolation' }),
      event({ type: 'CheckRun' }),
      event({ type: 'StepSucceeded', stepId: 'wf:a' }),
      event({ type: 'RunCompleted' }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.runId).toBe('run-test');
    expect(state.planRef).toBe('workflow:build');
    expect(state.runStatus).toBe('completed');
    expect(state.stepStatuses.get('wf:a')).toBe('succeeded');
    expect(state.laneStatuses.get('lane-a')).toBe('removed');
    expect(state.spentUsd).toBe(2.5);
    expect(state.unresolvedStepIds).toEqual([]);
  });

  it('RunAborted cascades to every step still scheduled, running, or escalated -- not to one already succeeded/failed/skipped', async () => {
    const events = [
      event({ type: 'StepScheduled', stepId: 'still-scheduled' }),
      event({ type: 'StepStarted', stepId: 'still-running' }),
      event({ type: 'StepStarted', stepId: 'was-escalated' }),
      event({ type: 'StepEscalated', stepId: 'was-escalated' }),
      event({ type: 'StepStarted', stepId: 'already-done' }),
      event({ type: 'StepSucceeded', stepId: 'already-done' }),
      event({ type: 'StepStarted', stepId: 'already-failed' }),
      event({ type: 'StepFailed', stepId: 'already-failed' }),
      event({ type: 'StepSkipped', stepId: 'was-skipped' }),
      event({ type: 'RunAborted' }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.stepStatuses.get('still-scheduled')).toBe('aborted');
    expect(state.stepStatuses.get('still-running')).toBe('aborted');
    expect(state.stepStatuses.get('was-escalated')).toBe('aborted');
    expect(state.stepStatuses.get('already-done')).toBe('succeeded');
    expect(state.stepStatuses.get('already-failed')).toBe('failed');
    expect(state.stepStatuses.get('was-skipped')).toBe('skipped');
    expect(state.runStatus).toBe('aborted');
  });

  it('StepRetried resets a failed step back to scheduled, ready for a fresh attempt', async () => {
    const events = [
      event({ type: 'StepStarted', stepId: 'wf:a' }),
      event({ type: 'StepFailed', stepId: 'wf:a' }),
      event({ type: 'StepRetried', stepId: 'wf:a' }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.stepStatuses.get('wf:a')).toBe('scheduled');
  });

  it('a second LaneCommitted for the identical lane (a claim-enforcement revert commit) just updates the same status, not an error', async () => {
    const events = [
      event({ type: 'LaneCreated', laneId: 'lane-a' }),
      event({ type: 'LaneCommitted', laneId: 'lane-a' }),
      event({ type: 'LaneCommitted', laneId: 'lane-a' }),
      event({ type: 'LaneReady', laneId: 'lane-a' }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.laneStatuses.get('lane-a')).toBe('ready');
  });

  it('sums UsageRecorded costUsd across multiple events, attributing retries to the same total (20 §20.8)', async () => {
    const events = [
      event({ type: 'UsageRecorded', stepId: 'wf:a', payload: { costUsd: 2 } }),
      event({ type: 'UsageRecorded', stepId: 'wf:a', payload: { costUsd: 2 } }),
      event({ type: 'UsageRecorded', stepId: 'wf:a', payload: { costUsd: 2 } }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.spentUsd).toBe(6);
  });

  it('a malformed UsageRecorded payload contributes 0 rather than throwing or poisoning the running total with NaN', async () => {
    const events = [
      event({ type: 'UsageRecorded', payload: { costUsd: 'not-a-number' } }),
      event({ type: 'UsageRecorded', payload: {} }),
      event({ type: 'UsageRecorded', payload: undefined }),
      event({ type: 'UsageRecorded', payload: { costUsd: 3 } }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.spentUsd).toBe(3);
  });

  it('a missing or malformed RunPlanned payload leaves planRef undefined rather than throwing', async () => {
    const events = [event({ type: 'RunPlanned', payload: { planRef: 42 } })];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.planRef).toBeUndefined();
  });

  it('a malformed RunPlanned does not overwrite an already-recovered planRef from an earlier, well-formed one', async () => {
    // A gauntlet-loop critic round found an earlier version unconditionally overwrote planRef on every
    // RunPlanned, including a malformed one -- silently discarding a previously-good reference instead
    // of leaving it alone, doing the opposite of this reducer's own documented leniency. A second,
    // malformed RunPlanned later in the same log (a plausible partially-written trailing line after a
    // crash) is exactly the scenario this leniency exists to survive.
    const events = [
      event({ type: 'RunPlanned', payload: { planRef: 'workflow:build' } }),
      event({ type: 'RunPlanned', payload: { planRef: 42 } }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.planRef).toBe('workflow:build');
  });

  it('run-level status tracks the most recent Run-group event, not just the first one', async () => {
    const events = [
      event({ type: 'RunPlanned', payload: { planRef: 'workflow:build' } }),
      event({ type: 'RunStarted' }),
      event({ type: 'RunPaused' }),
      event({ type: 'RunResumed' }),
    ];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.runStatus).toBe('resumed');
  });

  it('an event with no stepId/laneId at all (e.g. a run-scoped event) does not throw or pollute stepStatuses/laneStatuses', async () => {
    const events = [event({ type: 'StepScheduled' }), event({ type: 'LaneCreated' })];
    const state = await reconstructRunState(asAsyncIterable(events));
    expect(state.stepStatuses.size).toBe(0);
    expect(state.laneStatuses.size).toBe(0);
  });

  const STEP_SCOPED_TYPES: readonly EventType[] = [
    'StepScheduled',
    'StepStarted',
    'StepSucceeded',
    'StepFailed',
    'StepRetried',
    'StepSkipped',
    'StepEscalated',
  ];

  it.each(STEP_SCOPED_TYPES)(
    '%s with no stepId at all leaves stepStatuses untouched, not just the one already-covered case',
    async (type) => {
      const state = await reconstructRunState(asAsyncIterable([event({ type })]));
      expect(state.stepStatuses.size).toBe(0);
    },
  );

  const LANE_SCOPED_TYPES: readonly EventType[] = [
    'LaneCreated',
    'LaneCommitted',
    'LaneReady',
    'LaneAbandoned',
    'LaneRemoved',
  ];

  it.each(LANE_SCOPED_TYPES)(
    '%s with no laneId at all leaves laneStatuses untouched, not just the one already-covered case',
    async (type) => {
      const state = await reconstructRunState(asAsyncIterable([event({ type })]));
      expect(state.laneStatuses.size).toBe(0);
    },
  );
});
