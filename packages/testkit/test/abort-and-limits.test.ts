/**
 * `request.abortSignal` is checked before *every* phase of a scripted session, and before *every item*
 * inside a many-item phase (writes, exec attempts, MCP tool attempts) — not just once, before the
 * script's own `text` turns. A fresh critic round found the per-item check applied only to `text`;
 * these tests pin the fix (`runScriptPhases`'s shared `bailIfAborted`) against each of the other
 * many-item phases directly.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P5
 */
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '@forge/adapter-kit/types';

import { FAKE_MODEL_ID, FakePlatformAdapter } from '../src/fake-adapter.ts';

async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-testkit-abort-'));
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

/** Drains `events` one step at a time, calling `shouldAbortAfter` after each — lets a test abort
 * partway through a many-item phase, deterministically, right after observing a specific event. */
async function drainAbortingAfter(
  events: AsyncIterable<AdapterEvent>,
  shouldAbortAfter: (event: AdapterEvent) => boolean,
  controller: AbortController,
): Promise<AdapterEvent[]> {
  const collected: AdapterEvent[] = [];
  for await (const event of events) {
    collected.push(event);
    if (shouldAbortAfter(event)) controller.abort();
  }
  return collected;
}

describe('abortSignal checked at every phase boundary, not just inside multi-item loops', () => {
  it('an abort issued after the first text turn stops the remaining text turns from running', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'go', { text: ['one', 'two'] });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'go', abortSignal: controller.signal }));
    const events = await drainAbortingAfter(
      handle.events,
      (event) => event.type === 'text' && event.text === 'one',
      controller,
    );
    const result = await handle.result();

    expect(events.some((event) => event.type === 'text' && event.text === 'two')).toBe(false);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
    expect(result.finalText).toBe('one');
  });

  it('an abort issued right after text ends stops the thinking phase from running', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'go', { text: ['one'], thinking: ['should not run'] });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'go', abortSignal: controller.signal }));
    const events = await drainAbortingAfter(handle.events, (event) => event.type === 'text', controller);

    expect(events.some((event) => event.type === 'thinking')).toBe(false);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
  });

  it('the thinking phase runs normally, with no abort, and emits a thinking event per entry', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'go', { thinking: ['pondering'] });
    const cwd = await createScratchDir();

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'go' }));
    const events = [];
    for await (const event of handle.events) events.push(event);

    expect(events.some((event) => event.type === 'thinking' && event.text === 'pondering')).toBe(true);
  });

  it('an abort issued right after the first thinking entry stops the remaining thinking entries from running', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'go', { thinking: ['first thought', 'second thought'] });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'go', abortSignal: controller.signal }));
    const events = await drainAbortingAfter(
      handle.events,
      (event) => event.type === 'thinking' && event.text === 'first thought',
      controller,
    );

    expect(events.some((event) => event.type === 'thinking' && event.text === 'second thought')).toBe(false);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
  });

  it('an abort issued right after thinking ends stops the untrustedContent phase from running', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'go', { thinking: ['thought'], untrustedContent: 'should not appear' });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'go', abortSignal: controller.signal }));
    const events = await drainAbortingAfter(handle.events, (event) => event.type === 'thinking', controller);

    expect(events.some((event) => event.type === 'text')).toBe(false);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
  });

  it('an abort issued right after untrustedContent stops the skillVisibleText phase from running', async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'go', { untrustedContent: 'harmless', skillVisibleText: 'SKILL TEXT' });
    await adapter.provisionSkills([{ id: 's1', summary: 's', body: 'b', appliesTo: [] }], { runId: 'r', stepId: 's', cwd });
    const controller = new AbortController();

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'go', abortSignal: controller.signal }));
    const events = await drainAbortingAfter(
      handle.events,
      (event) => event.type === 'text' && event.text === 'harmless',
      controller,
    );

    expect(events.some((event) => event.type === 'text' && event.text.includes('SKILL TEXT'))).toBe(false);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
  });

  it('an abort issued right after the only (last) scripted write is still detected, not silently completed', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'one-write', { writeFiles: [{ relativePath: 'a.txt', content: 'a' }] });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'one-write', abortSignal: controller.signal }));
    const events = await drainAbortingAfter(handle.events, (event) => event.type === 'file.changed', controller);

    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'complete')).toBe(false);
  });

  it('an abort issued right after the only (last) exec attempt is still detected, not silently completed', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'one-exec', { execAttempts: ['echo hi'] });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'one-exec',
        tools: { read: true, write: true, exec: ['echo*'], network: 'none' },
        abortSignal: controller.signal,
      }),
    );
    const events = await drainAbortingAfter(handle.events, (event) => event.type === 'tool.result', controller);

    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'complete')).toBe(false);
  });

  it('an abort issued right after the only (last) MCP tool attempt is still detected, not silently completed', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'one-mcp', { mcpToolAttempts: ['tool-a'] });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'one-mcp', abortSignal: controller.signal }));
    const events = await drainAbortingAfter(handle.events, (event) => event.type === 'tool.result', controller);

    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'complete')).toBe(false);
  });

  it('an abort issued right after skillVisibleText, the last populated phase, is still detected, not silently completed', async () => {
    const adapter = new FakePlatformAdapter();
    const cwd = await createScratchDir();
    adapter.script((r) => r.prompt === 'go', { skillVisibleText: 'SKILL TEXT' });
    await adapter.provisionSkills([{ id: 's1', summary: 's', body: 'b', appliesTo: [] }], { runId: 'r', stepId: 's', cwd });
    const controller = new AbortController();

    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'go', abortSignal: controller.signal }));
    const events = await drainAbortingAfter(
      handle.events,
      (event) => event.type === 'text' && event.text === 'SKILL TEXT',
      controller,
    );

    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'complete')).toBe(false);
  });

  it('an abort issued right after the first exec attempt stops the remaining attempts from running', async () => {
    const adapter = new FakePlatformAdapter();
    const commands = Array.from({ length: 20 }, (_, index) => `echo ${String(index)}`);
    adapter.script((r) => r.prompt === 'many-execs', { execAttempts: commands });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'many-execs',
        tools: { read: true, write: true, exec: ['echo*'], network: 'none' },
        abortSignal: controller.signal,
      }),
    );
    const events = await drainAbortingAfter(
      handle.events,
      (event) => event.type === 'tool.call',
      controller,
    );
    const result = await handle.result();

    expect(events.filter((event) => event.type === 'tool.call')).toHaveLength(1);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('an abort issued right after the first scripted write stops the remaining writes from running', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'many-writes', {
      writeFiles: [
        { relativePath: 'a.txt', content: 'a' },
        { relativePath: 'b.txt', content: 'b' },
        { relativePath: 'c.txt', content: 'c' },
      ],
    });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(
      baseRequest({ cwd, prompt: 'many-writes', abortSignal: controller.signal }),
    );
    const events = await drainAbortingAfter(
      handle.events,
      (event) => event.type === 'file.changed',
      controller,
    );
    const result = await handle.result();

    expect(existsSync(path.join(cwd, 'a.txt'))).toBe(true);
    expect(existsSync(path.join(cwd, 'b.txt'))).toBe(false);
    expect(existsSync(path.join(cwd, 'c.txt'))).toBe(false);
    expect(result.changedFiles).toEqual(['a.txt']);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
  });

  it('an abort issued right after the first MCP tool attempt stops the remaining attempts from running', async () => {
    const adapter = new FakePlatformAdapter();
    adapter.script((r) => r.prompt === 'many-mcp', { mcpToolAttempts: ['tool-a', 'tool-b', 'tool-c'] });
    const cwd = await createScratchDir();
    const controller = new AbortController();

    const handle = await adapter.startSession(
      baseRequest({ cwd, prompt: 'many-mcp', abortSignal: controller.signal }),
    );
    const events = await drainAbortingAfter(
      handle.events,
      (event) => event.type === 'tool.call',
      controller,
    );
    await handle.result();

    expect(events.filter((event) => event.type === 'tool.call')).toHaveLength(1);
    expect(events.some((event) => event.type === 'session.ended' && event.reason === 'aborted')).toBe(true);
  });
});
