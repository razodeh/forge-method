/**
 * `makeSessionHandle` — a deliberate, small local duplicate of `@forge/testkit`'s own `makeHandle`
 * (no boundary-graph edge to `@forge/testkit` exists for a production package to use it directly).
 * Mirrors `packages/testkit/test/handle.test.ts`'s own scenarios for the shape this duplicates, plus
 * one this piece's own third `stopImpl` constructor parameter needs that the original had no reason
 * to test (`makeHandle` has no injected stop implementation of its own to verify was actually called).
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
 */
import { describe, expect, it } from 'vitest';

import type { AdapterEvent, SessionResult } from '@forge/adapter-kit';

import { makeSessionHandle } from '../src/session-handle.ts';

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

function neverStop(): Promise<void> {
  return Promise.resolve();
}

describe('makeSessionHandle', () => {
  it('exposes the given sessionId verbatim', () => {
    const handle = makeSessionHandle('some-session-id', twoEventScript, neverStop);
    expect(handle.sessionId).toBe('some-session-id');
  });

  it('drains events then result() sequentially, in the normal case', async () => {
    const handle = makeSessionHandle('s', twoEventScript, neverStop);
    const events = [];
    for await (const event of handle.events) events.push(event);
    const result = await handle.result();

    expect(events).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.finalText).toBe('done');
  });

  it('result() alone (without separately draining events) still returns the real final result', async () => {
    const handle = makeSessionHandle('s', twoEventScript, neverStop);
    const result = await handle.result();
    expect(result.finalText).toBe('done');
  });

  it('stop(reason) calls the injected stopImpl with that exact reason, and resolves', async () => {
    const calls: string[] = [];
    const handle = makeSessionHandle('s', twoEventScript, (reason) => {
      calls.push(reason);
      return Promise.resolve();
    });
    await expect(handle.stop('caller cancelled')).resolves.toBeUndefined();
    expect(calls).toEqual(['caller cancelled']);
  });

  it('stop() does not itself disturb the generator -- events still drain normally afterward', async () => {
    const handle = makeSessionHandle('s', twoEventScript, neverStop);
    await handle.stop('test cleanup');

    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events).toHaveLength(2);
  });

  it('a result() call that loses a concurrent drain race is rejected immediately, and resets so a later sequential retry recovers cleanly', async () => {
    const handle = makeSessionHandle('s', twoEventScript, neverStop);
    const iterator = handle.events[Symbol.asyncIterator]();
    const firstNext = iterator.next();

    await expect(handle.result()).rejects.toThrow(/drained concurrently/);

    await firstNext;
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
    const handle = makeSessionHandle('s', throwing, neverStop);

    await expect(handle.result()).rejects.toThrow(/boom/);
    await expect(handle.result()).rejects.toThrow(/produced no SessionResult/);
  });
});
