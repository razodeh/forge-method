/**
 * `resumeSession` — a resumed session enforces grants/limits/abort and runs the full phase set exactly
 * like a fresh one (`runScriptPhases`, shared by both), matcher-probed with the *original* session's own
 * remembered `cwd`/`tools`/`stepId` since `ResumeRequest` itself carries none of that. A fresh critic
 * round found `runResumedScript` only ever replayed `script.text`, ignoring `abortSignal`, `limits`, and
 * every other script field — this file pins the fix.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58 point 4
 * @see PLAN-M4.md P5
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FAKE_MODEL_ID, FakePlatformAdapter } from '../src/fake-adapter.ts';

async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-testkit-resume-'));
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

describe('resumeSession runs the full script phase set, not just text', () => {
  it("a resumed session's matched script can write files, into the original session's own remembered cwd", async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: ['started'] });
    adapter.script((r) => r.prompt === 'continue-with-write', {
      writeFiles: [{ relativePath: 'resumed.txt', content: 'from resume' }],
    });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'continue-with-write',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    const result = await resumed.result();

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(cwd, 'resumed.txt'))).toBe(true);
    expect(result.changedFiles).toEqual(['resumed.txt']);
  });

  it('a resumed session honours an already-aborted abortSignal', async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: [] });
    adapter.script((r) => r.prompt === 'continue', { text: ['should not run'] });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const controller = new AbortController();
    controller.abort();
    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'continue',
      limits: {},
      abortSignal: controller.signal,
    });
    const events = [];
    for await (const event of resumed.events) events.push(event);
    const result = await resumed.result();

    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.finalText).not.toContain('should not run');
  });

  it('a resumed session honours limits.maxTurns', async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: [] });
    adapter.script((r) => r.prompt === 'continue', { text: ['one', 'two', 'three'] });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'continue',
      limits: { maxTurns: 1 },
      abortSignal: new AbortController().signal,
    });
    const events = [];
    for await (const event of resumed.events) events.push(event);
    const result = await resumed.result();

    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'limit')).toBe(true);
    expect(result.finalText).toContain('one');
    expect(result.finalText).not.toContain('two');
  });

  it("a control token in a resumed session's own newly-matched script text is promoted to a real control event", async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: ['started'] });
    adapter.script((r) => r.prompt === 'ask-again', {
      text: ['FORGE_ASK: which database? | Postgres, SQLite'],
    });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'ask-again',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    const events = [];
    for await (const event of resumed.events) events.push(event);
    const result = await resumed.result();

    expect(events.some((event) => event.type === 'control')).toBe(true);
    expect(result.controlTokens).toHaveLength(1);
    expect(result.controlTokens[0]?.token).toBe('FORGE_ASK');
  });

  it("a resumed request is matcher-probed with the original session's own remembered cwd, not an empty synthetic default", async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: ['started'] });
    adapter.script((r) => r.prompt === 'continue' && r.cwd === cwd, { text: ['matched on remembered cwd'] });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'continue',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    const result = await resumed.result();

    expect(result.finalText).toContain('matched on remembered cwd');
  });

  it('a resumed session whose prompt matches no registered script still completes cleanly, with no phases run', async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: [] });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'nothing registered matches this',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    const events = [];
    for await (const event of resumed.events) events.push(event);
    const result = await resumed.result();

    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'complete')).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.finalText).toBe('');
    expect(result.changedFiles).toEqual([]);
  });

  it('resuming a sessionId this adapter never started falls back to harmless defaults instead of crashing', async () => {
    const adapter = new FakePlatformAdapter();
    const resumed = await adapter.resumeSession('never-started-session-id', {
      prompt: 'anything',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    const result = await resumed.result();

    expect(result.ok).toBe(true);
    expect(result.finalText).toBe('');
  });

  it('resuming an unrecognised sessionId can never write a real file anywhere, even if a registered script matches on prompt alone', async () => {
    // The unrecognised-sessionId fallback's own cwd ('') must never be treated as a real, writable
    // location — a matcher that only checks r.prompt (the style this package's own tests otherwise use
    // throughout) would otherwise still match here, and Node's path.resolve/path.relative silently
    // treat '' as process.cwd(), which previously let a write land in the real, actual working
    // directory of whatever process is running this adapter (reproduced writing into this very repo's
    // root during a review). Cleaned up in `finally` as a safety net regardless of outcome, since this
    // test's whole point is to prove no real file is ever created outside a sandboxed scratch dir.
    const dangerousTarget = path.resolve('should-never-exist.txt');
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'unscoped-write', {
      writeFiles: [{ relativePath: 'should-never-exist.txt', content: 'x' }],
    });

    try {
      const resumed = await adapter.resumeSession('never-started-session-id', {
        prompt: 'unscoped-write',
        limits: {},
        abortSignal: new AbortController().signal,
      });
      const events = [];
      for await (const event of resumed.events) events.push(event);
      const result = await resumed.result();

      expect(existsSync(dangerousTarget)).toBe(false);
      expect(result.changedFiles).toEqual([]);
      expect(events.some((event) => event.type === 'tool.result' && !event.ok)).toBe(true);
    } finally {
      if (existsSync(dangerousTarget)) await rm(dangerousTarget);
    }
  });

  it('a resumed session that completes normally still streams a usage event, like a fresh session does', async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: [] });
    adapter.script((r) => r.prompt === 'continue', { text: ['one turn'] });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'continue',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    const events = [];
    for await (const event of resumed.events) events.push(event);

    const usageEvent = events.find((event) => event.type === 'usage');
    expect(usageEvent).toBeDefined();
  });

  it("a resumed session's matched script can also report structured output", async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'start', { text: ['started'] });
    adapter.script((r) => r.prompt === 'continue-structured', { structured: { resumed: true } });

    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'start' }));
    await initial.result();

    const resumed = await adapter.resumeSession(initial.sessionId, {
      prompt: 'continue-structured',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    const result = await resumed.result();

    expect(result.structured).toEqual({ resumed: true });
  });
});
