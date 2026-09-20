/**
 * `RunState.runFailure` — why a run failed, projected from `RunFailed`'s payload (`PLAN-M13.md` P12,
 * `Q208` finding 1): `18` §18.4, "if a value cannot be derived from the log, it does not exist".
 *
 * @see specs/18 §18.4
 */
import type { ForgeEvent } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { reconstructRunState } from '../../src/resume/reconstruct.ts';

// eslint-disable-next-line @typescript-eslint/require-await -- a synchronous list served as the async stream the reducer takes
async function* events(...list: Partial<ForgeEvent>[]): AsyncGenerator<ForgeEvent> {
  let seq = 0;
  for (const event of list) {
    seq += 1;
    yield {
      v: 1,
      seq,
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'r',
      payload: undefined,
      ...event,
    } as ForgeEvent;
  }
}

const PAYLOAD = {
  reason: 'budget',
  message: 'no step could be admitted within the budget: step wf:a reserves $3.00 ...',
  failedSteps: [],
  failedTotal: 0,
  unfinished: [
    {
      stepId: 'wf:a',
      cause: { kind: 'budget', level: 'run', reservationUsd: 3, spentUsd: 0, capUsd: 2 },
    },
  ],
  unfinishedTotal: 1,
};

describe('reconstructRunState runFailure', () => {
  it('carries the reason, message, failed steps and per-step causes of a failed run', async () => {
    const state = await reconstructRunState(
      events({ type: 'RunStarted' }, { type: 'RunFailed', payload: PAYLOAD } as never),
    );
    expect(state.runStatus).toBe('failed');
    expect(state.runFailure).toEqual(PAYLOAD);
  });

  it('has none for a bare RunFailed written before the payload existed: nothing is invented', async () => {
    const state = await reconstructRunState(events({ type: 'RunFailed' }));
    expect(state.runStatus).toBe('failed');
    expect(state.runFailure).toBeUndefined();
    expect('runFailure' in state).toBe(false);
  });

  it('ignores a malformed payload rather than throwing', async () => {
    for (const payload of [
      'nope',
      null,
      { reason: 1 },
      { ...PAYLOAD, failedSteps: [1] },
      { ...PAYLOAD, unfinished: [{ stepId: 3, cause: {} }] },
      { ...PAYLOAD, unfinished: [{ stepId: 'a', cause: { kind: 7 } }] },
    ]) {
      const state = await reconstructRunState(events({ type: 'RunFailed', payload }));
      expect(state.runStatus).toBe('failed');
      expect(state.runFailure).toBeUndefined();
    }
  });

  it('drops the failure once a resumed run completes', async () => {
    const state = await reconstructRunState(
      events({ type: 'RunFailed', payload: PAYLOAD }, { type: 'RunCompleted' }),
    );
    expect(state.runStatus).toBe('completed');
    expect(state.runFailure).toBeUndefined();
  });

  it('reports the latest failure when a resumed run fails again', async () => {
    const second = { ...PAYLOAD, reason: 'step-failed', message: 'second' };
    const state = await reconstructRunState(
      events({ type: 'RunFailed', payload: PAYLOAD }, { type: 'RunFailed', payload: second }),
    );
    expect(state.runFailure?.reason).toBe('step-failed');
  });

  it('is not reported for a run whose status is no longer failed', async () => {
    const state = await reconstructRunState(
      events({ type: 'RunFailed', payload: PAYLOAD }, { type: 'RunResumed' }),
    );
    expect(state.runStatus).toBe('resumed');
    expect(state.runFailure).toBeUndefined();
  });
});
