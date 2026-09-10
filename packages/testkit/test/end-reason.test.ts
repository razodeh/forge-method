/**
 * `FakeSessionScript.endReason` — `'error'` ends the session with a typed `error` event and
 * `result.ok: false`, using `errorInfo` when given or a reasonable default otherwise. Exercised for
 * both a fresh session and a resumed one, since `runResumedScript` handles its own copy of this check.
 *
 * @see PLAN-M4.md P5
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FAKE_MODEL_ID, FakePlatformAdapter } from '../src/fake-adapter.ts';

async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-testkit-end-reason-'));
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

describe('FakeSessionScript.endReason === "error", fresh session', () => {
  it('ends with the scripted errorInfo when one is given', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'fail', {
      text: ['partial progress'],
      endReason: 'error',
      errorInfo: { code: 'CUSTOM_FAILURE', message: 'the script says this step fails' },
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'fail' }));
    const events = [];
    for await (const event of handle.events) events.push(event);
    const result = await handle.result();

    expect(events.some((event) => event.type === 'error' && event.code === 'CUSTOM_FAILURE')).toBe(
      true,
    );
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'error')).toBe(
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'CUSTOM_FAILURE',
      message: 'the script says this step fails',
    });
    // The text emitted before the scripted failure is still reported, not discarded.
    expect(result.finalText).toBe('partial progress');
  });

  it('ends with a reasonable default error when endReason is "error" but no errorInfo is given', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'fail-default', { endReason: 'error' });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'fail-default' }));
    const result = await handle.result();

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('FakeSessionScript.endReason === "error", resumed session', () => {
  it("a resumed session's matched script can also end with a scripted error", async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: ['started'] });
    adapter.script((r) => r.prompt === 'continue-and-fail', {
      text: ['one', 'two', 'three'],
      endReason: 'error',
      errorInfo: { code: 'RESUMED_FAILURE', message: 'fails on resume' },
    });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'continue-and-fail',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    const events = [];
    for await (const event of resumed.events) events.push(event);
    const result = await resumed.result();

    expect(events.some((event) => event.type === 'error' && event.code === 'RESUMED_FAILURE')).toBe(
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ code: 'RESUMED_FAILURE', message: 'fails on resume' });
    // Scaled by the 3 turns actually run, not the flat single-turn numbers a resumed error path once
    // hardcoded regardless of how much the script actually did — self-consistent with its own
    // usage.turns, and matching what a fresh session with the identical script would report.
    expect(result.usage.turns).toBe(3);
    expect(result.usage.inputTokens).toBe(30);
    expect(result.usage.outputTokens).toBe(15);
  });

  it('a resumed session also uses a reasonable default error when endReason is "error" but no errorInfo is given', async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: ['started'] });
    adapter.script((r) => r.prompt === 'continue-and-fail-default', { endReason: 'error' });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'continue-and-fail-default',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    const result = await resumed.result();

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
