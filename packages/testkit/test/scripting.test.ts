/**
 * `FakeSessionScript.writeFiles` — claimed file writes actually land in the given `cwd` and nowhere
 * else. `PLAN-M4.md` P5's own Checks section, verbatim.
 *
 * @see PLAN-M4.md P5
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FAKE_MODEL_ID, FakePlatformAdapter, HAND_BUILT_REQUESTS } from '../src/fake-adapter.ts';

async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-testkit-scripting-'));
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

describe('FakeSessionScript.writeFiles', () => {
  it('writes claimed files into the real, given cwd', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'write', {
      writeFiles: [
        { relativePath: 'a.txt', content: 'hello a' },
        { relativePath: 'nested/b.txt', content: 'hello b' },
      ],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'write' }));
    const result = await handle.result();

    expect(result.ok).toBe(true);
    expect(await readFile(path.join(cwd, 'a.txt'), 'utf8')).toBe('hello a');
    expect(await readFile(path.join(cwd, 'nested', 'b.txt'), 'utf8')).toBe('hello b');
    expect([...result.changedFiles].sort()).toEqual(['a.txt', 'nested/b.txt']);
  });

  it('refuses a scripted write whose relativePath traverses outside the given cwd', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    const parentDir = await createScratchDir();
    const cwd = path.join(parentDir, 'nested', 'cwd');
    await mkdir(cwd, { recursive: true });
    adapter.script((r) => r.prompt === 'escape', {
      writeFiles: [{ relativePath: '../../escape-marker.txt', content: 'ESCAPED' }],
    });
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'escape' }));
    const events = [];
    for await (const event of handle.events) events.push(event);
    const result = await handle.result();

    // Not written inside cwd (the literal relativePath is not a real path there) and not written where
    // the traversal points either — the escape must be refused, not merely relocated.
    expect(existsSync(path.join(parentDir, 'escape-marker.txt'))).toBe(false);
    expect(result.changedFiles).toEqual([]);
    expect(events.some((event) => event.type === 'tool.result' && !event.ok)).toBe(true);
  });

  it('refuses a scripted write whose relativePath is an absolute path', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    const cwd = await createScratchDir();
    const outsideDir = await createScratchDir();
    const absoluteTarget = path.join(outsideDir, 'absolute-marker.txt');
    adapter.script((r) => r.prompt === 'absolute', {
      writeFiles: [{ relativePath: absoluteTarget, content: 'ESCAPED' }],
    });
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'absolute' }));
    const result = await handle.result();

    expect(existsSync(absoluteTarget)).toBe(false);
    expect(result.changedFiles).toEqual([]);
  });

  it('refuses an absolute relativePath even when it would resolve inside cwd — relativePath must genuinely be relative', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    const cwd = await createScratchDir();
    const absoluteButInsideCwd = path.join(cwd, 'inside.txt');
    adapter.script((r) => r.prompt === 'absolute-but-inside', {
      writeFiles: [{ relativePath: absoluteButInsideCwd, content: 'x' }],
    });
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'absolute-but-inside' }));
    const result = await handle.result();

    expect(existsSync(absoluteButInsideCwd)).toBe(false);
    expect(result.changedFiles).toEqual([]);
  });

  it('does not write, and reports a refusal, when tools.write is not granted', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'write', {
      writeFiles: [{ relativePath: 'a.txt', content: 'x' }],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'write',
        tools: { read: true, write: false, exec: false, network: 'none' },
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);
    const result = await handle.result();

    expect(existsSync(path.join(cwd, 'a.txt'))).toBe(false);
    expect(result.changedFiles).toEqual([]);
    expect(events.some((event) => event.type === 'tool.result' && !event.ok)).toBe(true);
  });
});
