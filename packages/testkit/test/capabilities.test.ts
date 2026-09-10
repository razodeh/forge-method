/**
 * `withCapabilities` — a degraded fake adapter refuses (not silently ignores) any request that needs a
 * capability it was configured without. `PLAN-M4.md` P5's own Checks section, verbatim.
 *
 * @see specs/07 §7.4
 * @see specs/15 §15.6
 * @see PLAN-M4.md P5
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FAKE_MODEL_ID, withCapabilities } from '../src/fake-adapter.ts';

async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-testkit-capabilities-'));
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

describe('withCapabilities({ sessionResume: false })', () => {
  it('resumeSession refuses with a typed, actionable error rather than pretending to resume', async () => {
    const adapter = withCapabilities({ sessionResume: false });
    const capabilities = await adapter.capabilities();
    expect(capabilities.sessionResume).toBe(false);

    await expect(
      adapter.resumeSession('some-session-id', {
        prompt: 'continue',
        limits: {},
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow(/sessionResume/);
  });

  it('a default (full-capability) adapter does allow resumeSession', async () => {
    const adapter = withCapabilities({});
    const cwd = await createScratchDir();
    const initial = await adapter.startSession(baseRequest({ cwd, prompt: 'hello' }));
    await initial.result();
    await expect(
      adapter.resumeSession(initial.sessionId, {
        prompt: 'continue',
        limits: {},
        abortSignal: new AbortController().signal,
      }),
    ).resolves.toBeDefined();
  });
});

describe('withCapabilities({ mcp: false, toolProxy: false })', () => {
  it('provisionMcp is genuinely absent, not present-but-throwing', () => {
    const adapter = withCapabilities({ mcp: false, toolProxy: false });
    expect(adapter.provisionMcp).toBeUndefined();
  });

  it('a session requiring a granted MCP server is refused with a precise message naming the server', async () => {
    const adapter = withCapabilities({ mcp: false, toolProxy: false });
    adapter.script((r) => r.prompt === 'needs-mcp', { requiresMcpServer: 'my-special-server' });
    const cwd = await createScratchDir();

    await expect(adapter.startSession(baseRequest({ cwd, prompt: 'needs-mcp' }))).rejects.toThrow(
      /my-special-server/,
    );
  });

  it('a session that does not require MCP still runs normally', async () => {
    const adapter = withCapabilities({ mcp: false, toolProxy: false });
    adapter.script((r) => r.prompt === 'no-mcp-needed', { text: ['fine'] });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'no-mcp-needed' }));
    const result = await handle.result();
    expect(result.ok).toBe(true);
  });
});

describe('withCapabilities({ structuredOutput: false })', () => {
  it('omits a scripted structured payload rather than returning it anyway', async () => {
    const adapter = withCapabilities({ structuredOutput: false });
    adapter.script((r) => r.prompt === 'structured', { structured: { secret: 'leaked-anyway' } });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'structured' }));
    const result = await handle.result();

    expect(result.ok).toBe(true);
    expect(result.structured).toBeUndefined();
  });

  it('a default (full-capability) adapter does report a scripted structured payload', async () => {
    const adapter = withCapabilities({});
    adapter.script((r) => r.prompt === 'structured', { structured: { ok: true } });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'structured' }));
    const result = await handle.result();

    expect(result.structured).toEqual({ ok: true });
  });
});

describe('withCapabilities({ fileEditing: false })', () => {
  it('refuses a scripted write even when tools.write is granted', async () => {
    const adapter = withCapabilities({ fileEditing: false });
    adapter.script((r) => r.prompt === 'write', {
      writeFiles: [{ relativePath: 'a.txt', content: 'x' }],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'write' }));
    const events = [];
    for await (const event of handle.events) events.push(event);
    const result = await handle.result();

    expect(result.changedFiles).toEqual([]);
    expect(events.some((event) => event.type === 'tool.result' && !event.ok)).toBe(true);
  });
});

describe('withCapabilities({ bash: false })', () => {
  it('refuses a scripted exec attempt even when tools.exec would otherwise allow it', async () => {
    const adapter = withCapabilities({ bash: false });
    adapter.script((r) => r.prompt === 'exec', { execAttempts: ['echo hi'] });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'exec',
        tools: { read: true, write: true, exec: ['echo*'], network: 'none' },
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);
    await handle.result();

    expect(events.some((event) => event.type === 'tool.result' && !event.ok)).toBe(true);
  });
});
