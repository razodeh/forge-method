/**
 * `injectFailure` — produces exactly the requested failure shape (`error`/`timeout`/`abort`) and no
 * others; an unmatched request is unaffected by an injection registered for a different matcher; the
 * *next* matching call fails, consumed once. `PLAN-M4.md` P5's own Checks section, verbatim.
 *
 * @see PLAN-M4.md P5
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SessionHandle } from '@forge/adapter-kit/types';

import { FAKE_MODEL_ID, FakePlatformAdapter, HAND_BUILT_REQUESTS } from '../src/fake-adapter.ts';

async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-testkit-failure-injection-'));
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'r',
    stepId: 's',
    cwd: '',
    systemPrompt: { mode: 'append' as const, text: '' },
    prompt: '',
    model: FAKE_MODEL_ID,
    tools: { read: true, write: true, exec: false as const, network: 'none' as const },
    permissionMode: 'auto' as const,
    limits: {},
    env: {},
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

async function drain(handle: SessionHandle) {
  const events = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

describe('injectFailure', () => {
  it("'error': produces a typed error event and result.error, and no other shape", async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.injectFailure((r) => r.prompt === 'target', 'error');
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'target' }));
    const events = await drain(handle);
    const result = await handle.result();

    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'session.ended' && e.reason === 'error')).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("'abort': ends with reason 'aborted', no error event", async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.injectFailure((r) => r.prompt === 'target', 'abort');
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'target' }));
    const events = await drain(handle);
    const result = await handle.result();

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.some((e) => e.type === 'session.ended' && e.reason === 'aborted')).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("'timeout': never settles — events stall and result() never resolves", async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.injectFailure((r) => r.prompt === 'target', 'timeout');
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'target' }));

    const raced = await Promise.race([
      handle.result().then(() => 'resolved' as const),
      new Promise<'still-pending'>((resolve) => {
        setTimeout(() => {
          resolve('still-pending');
        }, 200);
      }),
    ]);
    expect(raced).toBe('still-pending');
  });

  it('an unmatched request is unaffected by an injection registered for a different matcher', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.injectFailure((r) => r.prompt === 'target', 'error');
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'not-the-target' }));
    const result = await handle.result();
    expect(result.ok).toBe(true);
  });

  it('is consumed on the first matching call — a second matching call runs normally', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.injectFailure((r) => r.prompt === 'target', 'error');
    const cwd = await createScratchDir();

    const first = await adapter.startSession(baseRequest({ cwd, prompt: 'target' }));
    const firstResult = await first.result();
    expect(firstResult.ok).toBe(false);

    const second = await adapter.startSession(baseRequest({ cwd, prompt: 'target' }));
    const secondResult = await second.result();
    expect(secondResult.ok).toBe(true);
  });
});

describe('a caller-supplied matcher that itself throws', () => {
  it('startSession rejects instead of throwing synchronously, for a matcher registered via .script()', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script(
      () => {
        throw new Error('matcher blew up');
      },
      { text: ['unreachable'] },
    );
    const cwd = await createScratchDir();

    // A rejected startSession(...) must reject the returned promise, not throw while this expression is
    // still being evaluated — a synchronous throw here would crash this test with an uncaught exception
    // instead of being captured by .rejects, the same distinction the sessionResume/requiresMcpServer
    // refusal paths must respect.
    await expect(adapter.startSession(baseRequest({ cwd, prompt: 'anything' }))).rejects.toThrow(
      /matcher blew up/,
    );
  });

  it('startSession rejects instead of throwing synchronously, for a matcher registered via .injectFailure()', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.injectFailure(() => {
      throw new Error('injection matcher blew up');
    }, 'error');
    const cwd = await createScratchDir();

    await expect(adapter.startSession(baseRequest({ cwd, prompt: 'anything' }))).rejects.toThrow(
      /injection matcher blew up/,
    );
  });

  it('a matcher that throws a non-Error value still rejects startSession with a real Error', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script(
      () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error, to prove startSession normalises it
        throw 'a plain string, not an Error';
      },
      { text: ['unreachable'] },
    );
    const cwd = await createScratchDir();

    const rejection = adapter.startSession(baseRequest({ cwd, prompt: 'anything' }));
    await expect(rejection).rejects.toBeInstanceOf(Error);
    await expect(rejection).rejects.toThrow(/a plain string, not an Error/);
  });
});
