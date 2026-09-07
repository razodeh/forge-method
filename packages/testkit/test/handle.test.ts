/**
 * `makeHandle` — the shared `SessionHandle` builder behind both `FakePlatformAdapter` and
 * `replayFromNdjson`. Exercised indirectly by every other test file in this package; this file tests
 * its own two hardening properties directly instead, with hand-rolled generators so the exact timing of
 * a concurrent drain and of a mid-stream generator failure is under the test's own control.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P5
 */
import { describe, expect, it } from 'vitest';

import type { AdapterEvent, SessionResult } from '@forge/adapter-kit/types';

import { makeHandle } from '../src/handle.ts';

function sessionResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    sessionId: 's',
    ok: true,
    finalText: 'done',
    usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
    durationMs: 0,
    changedFiles: [],
    controlTokens: [],
    ...overrides,
  };
}

async function* twoEventScript(): AsyncGenerator<AdapterEvent, SessionResult> {
  await Promise.resolve();
  yield { type: 'session.started', sessionId: 's', model: 'm', tools: [], meta: {} };
  yield { type: 'text', text: 'hi', partial: false };
  return sessionResult();
}

describe('makeHandle', () => {
  it('drains events then result() sequentially, in the normal case', async () => {
    const handle = makeHandle('s', twoEventScript);
    const events = [];
    for await (const event of handle.events) events.push(event);
    const result = await handle.result();

    expect(events).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.finalText).toBe('done');
  });

  it('stop() resolves without disturbing the generator', async () => {
    const handle = makeHandle('s', twoEventScript);
    await expect(handle.stop('test cleanup')).resolves.toBeUndefined();

    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events).toHaveLength(2);
  });

  it('a result() call that loses a concurrent drain race is rejected immediately, and resets so a later sequential retry recovers cleanly', async () => {
    const handle = makeHandle('s', twoEventScript);
    const iterator = handle.events[Symbol.asyncIterator]();
    const firstNext = iterator.next();

    // result()'s own internal pump() call finds the events-side pump still in flight.
    await expect(handle.result()).rejects.toThrow(/drained concurrently/);

    await firstNext;
    // Sequential now: a later result() is a genuinely new attempt, not the same stale rejection.
    const result = await handle.result();
    expect(result.ok).toBe(true);
    expect(result.finalText).toBe('done');
  });

  it('a generator that throws mid-stream leaves result() reporting no SessionResult on retry, not a stale rejection', async () => {
    async function* throwing(): AsyncGenerator<AdapterEvent, SessionResult> {
      await Promise.resolve();
      yield { type: 'session.started', sessionId: 's', model: 'm', tools: [], meta: {} };
      throw new Error('boom');
    }
    const handle = makeHandle('s', throwing);

    await expect(handle.result()).rejects.toThrow(/boom/);
    // An uncaught throw closes the generator per the language spec: a further next() resolves
    // {done: true, value: undefined} rather than re-throwing, so the retry is a fresh attempt that
    // completes "successfully" with no SessionResult — result() must refuse to fabricate one.
    await expect(handle.result()).rejects.toThrow(/produced no SessionResult/);
  });
});
