/**
 * `checkC13NoSecretLeak` inspects every `AdapterEvent` variant's own text-bearing field (not only
 * `text`/`thinking`), `SessionResult.error.message`/`structured`, and the real filesystem via
 * `git status --porcelain` — the main conformance suite test's compliant stub only ever emits a plain
 * `text` response and never writes an unexpected file, so none of that is reached there. Note:
 * `checkC13NoSecretLeak` unconditionally calls `initGitRepo` on its own `cwd` — every fixture here needs
 * a real, existing directory (unlike some other conformance test files' `'/tmp/unused'` placeholder,
 * which would make `initGitRepo` itself fail with `ENOENT` and any `.rejects.toThrow()` assertion pass
 * for the wrong reason).
 *
 * @see specs/07 §7.6
 * @see PLAN-M4.md P4
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkC13NoSecretLeak } from '../../src/conformance/secrets.ts';
import { createConformanceContext } from '../../src/conformance/context.ts';
import type { ConformanceOptions } from '../../src/conformance/fixtures.ts';
import type { AdapterCapabilities, PlatformAdapter } from '../../src/types/index.ts';

const SECRET = 'totally-not-leaked-secret';

function stubOptions(overrides: Partial<ConformanceOptions> = {}): ConformanceOptions {
  return {
    createScratchDir: () => mkdtemp(path.join(tmpdir(), 'forge-c13-')),
    validModel: 'model',
    invalidModel: 'invalid-model',
    helloPrompt: 'hello',
    writeFilePrompt: 'write',
    manyTurnsPrompt: 'many-turns',
    execPrompt: 'exec',
    secretProbe: { value: SECRET, prompt: 'probe' },
    controlTokenPrompt: 'control',
    ...overrides,
  };
}

const CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  partialText: false,
  sessionResume: false,
  interject: false,
  structuredOutput: false,
  toolAllowlist: true,
  permissionModes: ['auto'],
  subagents: false,
  mcp: false,
  costReporting: 'none',
  tokenReporting: true,
  maxConcurrentSessions: 0,
  cwdIsolation: true,
  systemPromptControl: 'append',
  fileEditing: true,
  bash: true,
  network: 'none',
  bareMode: true,
  skills: 'none',
  toolProxy: false,
};

function emptyResult(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    ok: true,
    finalText: '',
    usage: { inputTokens: 0, outputTokens: 0, turns: 1 },
    durationMs: 0,
    changedFiles: [],
    controlTokens: [],
    ...overrides,
  };
}

async function buildContext(adapter: PlatformAdapter, options: ConformanceOptions = stubOptions()) {
  const { context, setAdapter, setCapabilities } = createConformanceContext(options);
  setAdapter(adapter);
  setCapabilities(await adapter.capabilities());
  return context;
}

describe('checkC13NoSecretLeak — every AdapterEvent variant is inspected', () => {
  it('fails when the secret is leaked only through a tool.result.summary, not any text event', async () => {
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: () =>
        Promise.resolve({
          sessionId: 's1',
          events: (async function* () {
            await Promise.resolve();
            yield {
              type: 'tool.result' as const,
              id: 'call-1',
              ok: true,
              summary: `leaked: ${SECRET}`,
            };
          })(),
          stop: () => Promise.resolve(),
          result: () => Promise.resolve(emptyResult({ finalText: 'no secret here' })),
        }),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const context = await buildContext(adapter);
    await expect(checkC13NoSecretLeak(context)).rejects.toThrow(/not to contain/);
  });

  it('fails when the secret is leaked only through SessionResult.error.message', async () => {
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: () =>
        Promise.resolve({
          sessionId: 's1',
          events: {
            [Symbol.asyncIterator]: () => ({
              next: () => Promise.resolve({ done: true as const, value: undefined }),
            }),
          },
          stop: () => Promise.resolve(),
          result: () =>
            Promise.resolve(
              emptyResult({ ok: false, error: { code: 'E', message: `failed reading ${SECRET}` } }),
            ),
        }),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const context = await buildContext(adapter);
    await expect(checkC13NoSecretLeak(context)).rejects.toThrow(/not to contain/);
  });

  it('exercises tool.call.input, control.payload, retry.reason, session.started.meta, and result.structured without finding a leak', async () => {
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: () =>
        Promise.resolve({
          sessionId: 's1',
          events: (async function* () {
            await Promise.resolve();
            yield {
              type: 'session.started' as const,
              sessionId: 's1',
              model: 'm',
              tools: [],
              meta: { note: 'benign' },
            };
            yield { type: 'tool.call' as const, id: 'c1', name: 'x', input: { note: 'benign' } };
            yield { type: 'tool.result' as const, id: 'c1', ok: true, summary: 'benign' };
            yield {
              type: 'control' as const,
              token: 'FORGE_CONFLICT' as const,
              payload: { reason: 'benign' },
            };
            yield {
              type: 'retry' as const,
              attempt: 1,
              maxRetries: 3,
              reason: 'benign',
              delayMs: 10,
            };
            yield { type: 'error' as const, code: 'E', message: 'benign', retryable: false };
            yield { type: 'file.changed' as const, path: 'x', change: 'created' as const };
            yield { type: 'usage' as const, inputTokens: 1, outputTokens: 1 };
            yield { type: 'session.ended' as const, reason: 'complete' as const };
          })(),
          stop: () => Promise.resolve(),
          result: () =>
            Promise.resolve(emptyResult({ finalText: 'benign', structured: { note: 'benign' } })),
        }),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const context = await buildContext(adapter);
    await expect(checkC13NoSecretLeak(context)).resolves.toBeUndefined();
  });

  it('does not crash when result.structured cannot be JSON-stringified (e.g. a BigInt)', async () => {
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: () =>
        Promise.resolve({
          sessionId: 's1',
          events: {
            [Symbol.asyncIterator]: () => ({
              next: () => Promise.resolve({ done: true as const, value: undefined }),
            }),
          },
          stop: () => Promise.resolve(),
          result: () => Promise.resolve(emptyResult({ finalText: 'ok', structured: BigInt(123) })),
        }),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const context = await buildContext(adapter);
    await expect(checkC13NoSecretLeak(context)).resolves.toBeUndefined();
  });
});

describe('checkC13NoSecretLeak — the real filesystem is inspected too', () => {
  it('fails when the secret is written to a file in cwd instead of appearing in any event', async () => {
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: (request) =>
        writeFile(path.join(request.cwd, 'debug-log.txt'), `env dump: ${SECRET}`, 'utf8').then(
          () => ({
            sessionId: 's1',
            events: {
              [Symbol.asyncIterator]: () => ({
                next: () => Promise.resolve({ done: true as const, value: undefined }),
              }),
            },
            stop: () => Promise.resolve(),
            result: () => Promise.resolve(emptyResult({ finalText: 'nothing to see here' })),
          }),
        ),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const context = await buildContext(adapter);
    await expect(checkC13NoSecretLeak(context)).rejects.toThrow(/not to contain/);
  });

  it('fails when the secret is written inside a brand-new subdirectory, not only directly in cwd', async () => {
    // A gauntlet verify pass found git's own default untracked-files mode collapses a new directory
    // into one "?? dir/" line, so a file inside it was never individually read — this secret would have
    // been silently missed before gitStatusPaths gained --untracked-files=all.
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: (request) =>
        mkdir(path.join(request.cwd, 'logs'))
          .then(() =>
            writeFile(path.join(request.cwd, 'logs', 'debug.txt'), `env dump: ${SECRET}`, 'utf8'),
          )
          .then(() => ({
            sessionId: 's1',
            events: {
              [Symbol.asyncIterator]: () => ({
                next: () => Promise.resolve({ done: true as const, value: undefined }),
              }),
            },
            stop: () => Promise.resolve(),
            result: () => Promise.resolve(emptyResult({ finalText: 'nothing to see here' })),
          })),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const context = await buildContext(adapter);
    await expect(checkC13NoSecretLeak(context)).rejects.toThrow(/not to contain/);
  });

  it('skips a git-reported path that is not a plain readable file (a directory) without crashing', async () => {
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: (request) =>
        mkdir(path.join(request.cwd, 'untracked-dir'))
          .then(() =>
            writeFile(path.join(request.cwd, 'untracked-dir', 'inner.txt'), 'benign', 'utf8'),
          )
          .then(() => ({
            sessionId: 's1',
            events: {
              [Symbol.asyncIterator]: () => ({
                next: () => Promise.resolve({ done: true as const, value: undefined }),
              }),
            },
            stop: () => Promise.resolve(),
            result: () => Promise.resolve(emptyResult({ finalText: 'ok' })),
          })),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const context = await buildContext(adapter);
    // git reports the untracked directory itself (e.g. "untracked-dir/"), not its inner file — readFile
    // on that path throws EISDIR, which must be skipped rather than crash the whole check.
    await expect(checkC13NoSecretLeak(context)).resolves.toBeUndefined();
  });
});
