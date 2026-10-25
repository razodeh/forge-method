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

/** `SessionRequest.vetExecCommand` (`specs/22` M17 P7, critic round 4): the one way a fake-adapter-
 * backed test can exercise a caller's own per-call exec gate at all, since the real property it
 * models (Claude Code's own SDK `canUseTool`, wired by `@forge/adapter-claude-code`'s own
 * `build-options.ts`) lives in a real adapter this package deliberately never runs. Disclosed in
 * `fake-adapter.ts`'s own `ScriptPhaseContext.vetExecCommand` doc comment: this proves the FAKE
 * consults the callback correctly, never that the real SDK does. */
describe('FakeSessionScript.execAttempts + SessionRequest.vetExecCommand', () => {
  it('a scripted exec attempt that matches the tool grant but fails vetExecCommand is still refused', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'exec', { execAttempts: ['make -f /tmp/evil.mk pwn'] });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'exec',
        tools: { read: true, write: true, exec: ['make *'], network: 'none' },
        // Matches the grant pattern (`make *`) but is refused by the gate anyway -- the exact
        // "pattern cannot express this verb, without this dangerous flag" gap `isExecAllowed` alone
        // cannot close (`adopt-tests-grant.test.ts`'s own identical live repro).
        vetExecCommand: (command: string) =>
          Promise.resolve(
            command.includes('-f /tmp/')
              ? { allowed: false, reason: 'refused: reaches outside the sandboxed root' }
              : { allowed: true },
          ),
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);

    const execResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'exec:0',
    );
    expect(execResult).toMatchObject({ ok: false });
  });

  it('a scripted exec attempt that matches the tool grant AND passes vetExecCommand is allowed', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'exec', { execAttempts: ['make test'] });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'exec',
        tools: { read: true, write: true, exec: ['make *'], network: 'none' },
        vetExecCommand: (command: string) =>
          Promise.resolve(
            command.includes('-f /tmp/')
              ? { allowed: false, reason: 'refused' }
              : { allowed: true },
          ),
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);

    const execResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'exec:0',
    );
    expect(execResult).toMatchObject({ ok: true });
  });

  it('with no vetExecCommand at all (every caller before critic round 4), behaviour is unchanged: grant membership alone decides', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'exec', { execAttempts: ['make -f /tmp/evil.mk pwn'] });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'exec',
        tools: { read: true, write: true, exec: ['make *'], network: 'none' },
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);

    const execResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'exec:0',
    );
    // Allowed here ONLY because this test's own grant is deliberately loose and no gate is set --
    // documenting the pre-round-4 status quo this file's own doc comment contrasts against, not
    // endorsing the command.
    expect(execResult).toMatchObject({ ok: true });
  });
});

/** `SessionRequest.vetFileAccess` (`SPEC-QUESTIONS.md` Q347): the identical mechanism as
 * `vetExecCommand` immediately above, added to the same fake adapter for the identical reason --
 * `FakeSessionScript.writeFiles` already checks `resolveInsideCwd` on its own, the same way
 * `execAttempts` already checks `isExecAllowed` on its own, and `ctx.vetFileAccess` is consulted IN
 * ADDITION to that, never in place of it (`fake-adapter.ts`'s own `writeFiles` handling, immediately
 * after its `resolveInsideCwd` check). This proves the FAKE consults the callback correctly, never
 * that a real adapter's own live SDK hook does -- `confined-command.test.ts`'s own
 * `createLiveFileAccessGate` suite and `file-access-gate.live.test.ts` cover that separately. */
describe('FakeSessionScript.writeFiles + SessionRequest.vetFileAccess', () => {
  it('a scripted write attempt whose target is inside cwd but fails vetFileAccess is still refused, and the file is never actually written', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'write', {
      writeFiles: [{ relativePath: 'secret.txt', content: 'x' }],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'write',
        // Inside cwd (passes resolveInsideCwd on its own), but refused anyway -- the exact
        // "contained by the lexical check, denied by the live gate anyway" gap this suite mirrors
        // from vetExecCommand's own identical case above.
        vetFileAccess: (_toolName: string, filePath: string) =>
          Promise.resolve(
            filePath.includes('secret')
              ? {
                  allowed: false,
                  reason: 'refused: this path is denied regardless of cwd containment',
                }
              : { allowed: true },
          ),
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);
    const result = await handle.result();

    const writeResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'write:secret.txt',
    );
    expect(writeResult).toMatchObject({ ok: false });
    expect(existsSync(path.join(cwd, 'secret.txt'))).toBe(false);
    expect(result.changedFiles).toEqual([]);
  });

  it('a scripted write attempt that is inside cwd AND passes vetFileAccess is allowed, and the file is actually written', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'write', {
      writeFiles: [{ relativePath: 'ok.txt', content: 'hello' }],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'write',
        vetFileAccess: (_toolName: string, filePath: string) =>
          Promise.resolve(
            filePath.includes('secret') ? { allowed: false, reason: 'refused' } : { allowed: true },
          ),
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);
    const result = await handle.result();

    const writeResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'write:ok.txt',
    );
    expect(writeResult).toMatchObject({ ok: true });
    expect(await readFile(path.join(cwd, 'ok.txt'), 'utf8')).toBe('hello');
    expect(result.changedFiles).toEqual(['ok.txt']);
  });

  it('with no vetFileAccess at all (every caller before this piece), behaviour is unchanged: cwd containment alone decides', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'write', {
      writeFiles: [{ relativePath: 'secret.txt', content: 'x' }],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'write' }));
    const events = [];
    for await (const event of handle.events) events.push(event);
    const result = await handle.result();

    const writeResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'write:secret.txt',
    );
    // Allowed here ONLY because this test's own target is inside cwd and no gate is set --
    // documenting the pre-Q347 status quo this file's own doc comment contrasts against, not
    // endorsing the name.
    expect(writeResult).toMatchObject({ ok: true });
    expect(result.changedFiles).toEqual(['secret.txt']);
  });
});

/** `SessionRequest.vetNetworkAccess` (`SPEC-QUESTIONS.md` Q350, found while fixing Q347): the identical
 * mechanism as `vetExecCommand`/`vetFileAccess` above, added to the same fake adapter for the identical
 * reason -- `FakeSessionScript.webFetchAttempts`/`webSearchAttempts` already check the grant-native
 * `isHostAllowed`/`tools.network === 'full'` on their own, and `ctx.vetNetworkAccess` is consulted IN
 * ADDITION to that, never in place of it. This proves the FAKE consults the callback correctly, never
 * that a real adapter's own live SDK hook does -- `confined-command.test.ts`'s own
 * `createLiveNetworkAccessGate` suite and `build-options.test.ts`'s own `vetNetworkAccess` wiring suite
 * cover that separately. */
describe('FakeSessionScript.webFetchAttempts/webSearchAttempts + SessionRequest.vetNetworkAccess', () => {
  it('a scripted WebFetch attempt whose host is granted (network: full) but fails vetNetworkAccess is still refused', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'fetch', {
      webFetchAttempts: ['https://evil.example.com/'],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'fetch',
        tools: { read: true, write: false, exec: false, network: 'full' },
        // Matches the grant (`network: 'full'` allows every host) but is refused by the gate anyway --
        // the exact "grant-native check passes, live gate still decides" shape `vetExecCommand`'s own
        // identical case above already proves for Bash.
        vetNetworkAccess: (_toolName: 'WebFetch' | 'WebSearch', url: string | undefined) =>
          Promise.resolve(
            url?.includes('evil')
              ? { allowed: false, reason: 'refused: this host is denied regardless of the grant' }
              : { allowed: true },
          ),
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);

    const fetchResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'webfetch:0',
    );
    expect(fetchResult).toMatchObject({ ok: false });
  });

  it('a scripted WebFetch attempt that is granted AND passes vetNetworkAccess is allowed', async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'fetch', {
      webFetchAttempts: ['https://docs.example.com/'],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'fetch',
        tools: { read: true, write: false, exec: false, network: 'full' },
        vetNetworkAccess: (_toolName: 'WebFetch' | 'WebSearch', url: string | undefined) =>
          Promise.resolve(
            url?.includes('evil') ? { allowed: false, reason: 'refused' } : { allowed: true },
          ),
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);

    const fetchResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'webfetch:0',
    );
    expect(fetchResult).toMatchObject({ ok: true });
  });

  it("a scripted WebFetch attempt is refused when the grant's own network is 'none', even with no vetNetworkAccess at all -- the grant-native check alone already refuses it", async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'fetch', {
      webFetchAttempts: ['https://example.com/'],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(baseRequest({ cwd, prompt: 'fetch' }));
    const events = [];
    for await (const event of handle.events) events.push(event);

    const fetchResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'webfetch:0',
    );
    // `baseRequest`'s own default grant is `network: 'none'` -- refused here ONLY by the grant-native
    // check, documenting the pre-Q350 status quo this file's own doc comment contrasts against.
    expect(fetchResult).toMatchObject({ ok: false });
  });

  it("a scripted WebSearch attempt is allowed only when the grant's network is 'full', and vetNetworkAccess is consulted with 'WebSearch'/undefined -- WebSearchInput has no real per-call host to vet at all", async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'search', {
      webSearchAttempts: ['forge adapter sdk'],
    });
    const cwd = await createScratchDir();
    let receivedArgs: readonly [string, string | undefined] | undefined;
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'search',
        tools: { read: true, write: false, exec: false, network: 'full' },
        vetNetworkAccess: (toolName: 'WebFetch' | 'WebSearch', url: string | undefined) => {
          receivedArgs = [toolName, url];
          return Promise.resolve({ allowed: true });
        },
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);

    const searchResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'websearch:0',
    );
    expect(searchResult).toMatchObject({ ok: true });
    expect(receivedArgs).toEqual(['WebSearch', undefined]);
  });

  it("a scripted WebSearch attempt is refused under network: 'allowlist', even with no vetNetworkAccess at all -- WebSearch has no domain-scoped grant form, mirroring tool-grant.ts's own documented precedent", async () => {
    const adapter = new FakePlatformAdapter({}, HAND_BUILT_REQUESTS);
    adapter.script((r) => r.prompt === 'search', {
      webSearchAttempts: ['forge adapter sdk'],
    });
    const cwd = await createScratchDir();
    const handle = await adapter.startSession(
      baseRequest({
        cwd,
        prompt: 'search',
        tools: {
          read: true,
          write: false,
          exec: false,
          network: 'allowlist',
          allowlistHosts: ['example.com'],
        },
      }),
    );
    const events = [];
    for await (const event of handle.events) events.push(event);

    const searchResult = events.find(
      (event) => event.type === 'tool.result' && event.id === 'websearch:0',
    );
    expect(searchResult).toMatchObject({ ok: false });
  });
});
