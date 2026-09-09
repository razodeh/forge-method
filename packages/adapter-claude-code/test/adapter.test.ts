/**
 * `ClaudeCodeAdapter` — the real `PlatformAdapter` tying P1-P3 together. Every scenario here is
 * driven through the two injected seams (`spawnCli`, `loadSdkTransport`) rather than a real, billed
 * `claude` process or API call -- `PLAN-M7.md` P4's own Checks name exactly these fixture-driven
 * scenarios; the deferred, gated real dual-auth-mode live test is P4's own P10 companion, not this
 * file.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  AdapterEvent,
  SessionHandle,
  SessionRequest,
  SessionResult,
} from '@forge/adapter-kit';

import { ClaudeCodeAdapter } from '../src/adapter.ts';
import type { SdkTransportModule } from '../src/adapter.ts';
import { claudeCodeAdapterConfigSchema } from '../src/config.ts';
import { listClaudeCodeModels } from '../src/list-models.ts';
import type { spawnClaudeCli } from '../src/cli/spawn.ts';

function baseRequest(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    runId: 'run-1',
    stepId: 'implement-story-1',
    cwd: '/tmp/forge-adapter-claude-code-test-lane-does-not-exist',
    systemPrompt: { mode: 'append', text: 'You are a FORGE engineer.' },
    prompt: 'Implement the story.',
    model: 'claude-sonnet-5',
    tools: { read: true, write: true, exec: false, network: 'none' },
    permissionMode: 'accept-edits',
    limits: {},
    env: {},
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

async function* eventsOf(events: readonly AdapterEvent[]): AsyncGenerator<AdapterEvent> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

async function drain(
  handle: SessionHandle,
): Promise<{ events: AdapterEvent[]; result: SessionResult }> {
  const events: AdapterEvent[] = [];
  for await (const event of handle.events) events.push(event);
  const result = await handle.result();
  return { events, result };
}

/** A fake `spawnClaudeCli` that never touches a real process: records every call into `log`, and
 * yields a `session.started`/`session.ended` pair (or a caller-given override) instead. */
function fakeSpawnCli(
  log: string[],
  options: { readonly sessionId?: string; readonly events?: readonly AdapterEvent[] } = {},
): typeof spawnClaudeCli {
  return () => {
    log.push('cli');
    const sessionId = options.sessionId ?? 'fake-cli-session-id';
    const stream = options.events ?? [
      { type: 'session.started', sessionId, model: 'm', tools: [], meta: {} },
      { type: 'session.ended', reason: 'complete' },
    ];
    return {
      events: eventsOf(stream),
      stop: () => {
        // Nothing to stop -- no real process was ever spawned.
      },
      exitCode: Promise.resolve(0),
    };
  };
}

/** A fake SDK transport module that never touches the real `@anthropic-ai/claude-agent-sdk`: records
 * every `runSdkQuery` call into `log`, and captures the `Options` it was actually given (for the env-
 * merge check) alongside a canned event stream. */
function fakeSdkModule(
  log: string[],
  options: { readonly sessionId?: string; readonly capturedOptions?: unknown[] } = {},
): SdkTransportModule {
  const sessionId = options.sessionId ?? 'fake-sdk-session-id';
  return {
    buildSdkOptions: () => ({}),
    runSdkQuery: (_prompt, sdkOptions) => {
      log.push('sdk');
      options.capturedOptions?.push(sdkOptions);
      return {
        events: eventsOf([
          { type: 'session.started', sessionId, model: 'm', tools: [], meta: {} },
          { type: 'session.ended', reason: 'complete' },
        ]),
        interrupt: () => Promise.resolve(),
      };
    },
  };
}

function neverLoadSdk(): Promise<SdkTransportModule | undefined> {
  return Promise.resolve(undefined);
}

describe('ClaudeCodeAdapter — capabilities()', () => {
  it('reports the conservative static defaults before any session has started, and the confirmed set once one has', async () => {
    const log: string[] = [];
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log),
    });

    const before = await adapter.capabilities();
    expect(before.partialText).toBe(false);
    expect(before.sessionResume).toBe(false);
    expect(before.structuredOutput).toBe(false);

    const handle = await adapter.startSession(baseRequest());
    await drain(handle);

    const after = await adapter.capabilities();
    expect(after.partialText).toBe(true);
    expect(after.sessionResume).toBe(true);
    // structuredOutput stays false even confirmed -- this adapter does not deliver it end to end on
    // either transport yet (SPEC-QUESTIONS.md Q116); see capabilities.test.ts for the dedicated test.
    expect(after.structuredOutput).toBe(false);
  });

  it("permissionModes reflects the CLI transport's own real vocabulary when pinned to cli", async () => {
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
    });
    const caps = await adapter.capabilities();
    expect(caps.permissionModes).toContain('manual');
    expect(caps.permissionModes).not.toContain('default');
  });

  it("permissionModes reflects the SDK transport's own real vocabulary when pinned to sdk", async () => {
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'sdk' }),
      env: {},
      now: () => 0,
    });
    const caps = await adapter.capabilities();
    expect(caps.permissionModes).toContain('default');
    expect(caps.permissionModes).not.toContain('manual');
  });
});

describe('ClaudeCodeAdapter — preflight()/listModels()', () => {
  let scratchDirs: string[] = [];
  afterEach(async () => {
    for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
    scratchDirs = [];
  });

  it('preflight() delegates to runPreflight, reporting two distinct issues for no binary + no credentials', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-adapter-claude-code-adapter-preflight-'));
    scratchDirs.push(dir);
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ bare: true }),
      env: {},
      now: () => 0,
    });
    const result = await adapter.preflight({ projectRoot: dir, env: { PATH: dir } });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'ADP-CLAUDE-CODE-NOT-FOUND',
      'ADP-CLAUDE-CODE-NO-API-KEY',
    ]);
  });

  it('listModels() delegates to listClaudeCodeModels()', async () => {
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({}),
      env: {},
      now: () => 0,
    });
    expect(await adapter.listModels()).toEqual(listClaudeCodeModels());
  });
});

describe('ClaudeCodeAdapter — transport selection', () => {
  it('auto-select (config.transport undefined) falls back to cli, provably, when the sdk transport fails to load', async () => {
    const log: string[] = [];
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({}),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log),
      loadSdkTransport: neverLoadSdk,
    });
    const handle = await adapter.startSession(baseRequest());
    const { result } = await drain(handle);
    expect(log).toEqual(['cli']);
    expect(result.ok).toBe(true);
  });

  it('auto-select prefers sdk, provably, when it loads successfully -- the cli transport is never touched', async () => {
    const log: string[] = [];
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({}),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log), // a trap: must never be called
      loadSdkTransport: () => Promise.resolve(fakeSdkModule(log)),
    });
    const handle = await adapter.startSession(baseRequest());
    await drain(handle);
    expect(log).toEqual(['sdk']);
  });

  it('an explicit sdk pin that genuinely fails to load ends the session with a loud, typed error -- never a silent fallback to cli', async () => {
    const log: string[] = [];
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'sdk' }),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log), // a trap: must never be called
      loadSdkTransport: neverLoadSdk,
    });
    const handle = await adapter.startSession(baseRequest());
    const { events, result } = await drain(handle);
    expect(log).toEqual([]);
    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'session.ended', reason: 'error' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ADP-CLAUDE-CODE-SDK-UNAVAILABLE');
  });

  it("starts the real sdk query eagerly, before the caller ever begins consuming events -- matching the cli transport's own already-eager spawn (a fresh critic round's own finding: this used to be deferred until first consumption)", async () => {
    let queryStarted = false;
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'sdk' }),
      env: {},
      now: () => 0,
      loadSdkTransport: () =>
        Promise.resolve({
          buildSdkOptions: () => ({}),
          runSdkQuery: () => {
            queryStarted = true;
            return {
              events: eventsOf([
                {
                  type: 'session.started',
                  sessionId: 'eager-sdk-test',
                  model: 'm',
                  tools: [],
                  meta: {},
                },
                { type: 'session.ended', reason: 'complete' },
              ]),
              interrupt: () => Promise.resolve(),
            };
          },
        }),
    });

    const handle = await adapter.startSession(baseRequest());
    // Deliberately not drained yet -- the assertion below must hold *before* `.events`/`.result()`
    // is ever touched, or it would not distinguish eager start from lazy start at all.
    expect(queryStarted).toBe(true);
    await drain(handle);
  });

  it('auto-select probes the sdk loader exactly once when it resolves to sdk, not a second, redundant time', async () => {
    let loadCalls = 0;
    const log: string[] = [];
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({}),
      env: {},
      now: () => 0,
      loadSdkTransport: () => {
        loadCalls += 1;
        return Promise.resolve(fakeSdkModule(log));
      },
    });
    const handle = await adapter.startSession(baseRequest());
    await drain(handle);
    expect(loadCalls).toBe(1);
  });
});

describe('ClaudeCodeAdapter — resumeSession()', () => {
  it("reuses the same transport a session originally started under, even once this adapter's own current auto-select preference has since become sdk", async () => {
    const log: string[] = [];
    let loadAttempts = 0;
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({}),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log, { sessionId: 'real-cli-session-id' }),
      loadSdkTransport: () => {
        loadAttempts += 1;
        // Unavailable for the *first* resolution (the original startSession), available afterward --
        // this adapter's own resolveTransport() is deliberately not memoized (adapter.ts's own doc
        // comment) specifically so this can happen.
        return Promise.resolve(loadAttempts === 1 ? undefined : fakeSdkModule(log));
      },
    });

    const handle = await adapter.startSession(baseRequest());
    await drain(handle);
    expect(log).toEqual(['cli']);

    // Proves the adapter's own *current* default preference really has become sdk in the meantime.
    const caps = await adapter.capabilities();
    expect(caps.permissionModes).toContain('default');
    expect(caps.permissionModes).not.toContain('manual');

    const resumedHandle = await adapter.resumeSession(handle.sessionId, {
      prompt: 'continue',
      limits: {},
      abortSignal: new AbortController().signal,
    });
    await drain(resumedHandle);
    expect(log).toEqual(['cli', 'cli']);
  });

  it('rejects clearly for a sessionId this adapter never started', async () => {
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
    });
    await expect(
      adapter.resumeSession('never-started', {
        prompt: 'continue',
        limits: {},
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow(/cannot resume/);
  });

  it('rejects clearly for a session that ended before a real session.started event ever arrived', async () => {
    const log: string[] = [];
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log, { events: [{ type: 'session.ended', reason: 'error' }] }),
    });
    const handle = await adapter.startSession(baseRequest());
    await drain(handle);
    await expect(
      adapter.resumeSession(handle.sessionId, {
        prompt: 'continue',
        limits: {},
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow(/cannot resume/);
  });

  it('rejects cleanly (never throws synchronously out of resumeSession itself) when the underlying transport throws synchronously while starting the resumed session', async () => {
    // A fresh critic round found the original resumeSession -- a plain method returning
    // `Promise.resolve(this.startOnTransport(...))` -- let a synchronous throw from inside
    // startOnTransport (a real, reachable one: spawnCli itself throwing) escape as an uncaught
    // exception instead of a clean rejection. This fake's own second call (the resume) throws
    // synchronously; the first call (the original start) succeeds normally.
    let calls = 0;
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: () => {
        calls += 1;
        if (calls > 1) throw new Error('spawn failed synchronously');
        return {
          events: eventsOf([
            {
              type: 'session.started',
              sessionId: 'sync-throw-test',
              model: 'm',
              tools: [],
              meta: {},
            },
            { type: 'session.ended', reason: 'complete' },
          ]),
          stop: () => {
            // Never called by this test.
          },
          exitCode: Promise.resolve(0),
        };
      },
    });

    const handle = await adapter.startSession(baseRequest());
    await drain(handle);

    await expect(
      adapter.resumeSession(handle.sessionId, {
        prompt: 'continue',
        limits: {},
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow('spawn failed synchronously');
  });
});

describe('ClaudeCodeAdapter — session environment', () => {
  it('merges the constructor-level ambient env with the per-request grant-scoped env, the request winning on an overlapping key, for both transports', async () => {
    const capturedCliEnv: Readonly<Record<string, string>>[] = [];
    const capturedSdkOptions: unknown[] = [];
    const log: string[] = [];

    const cliAdapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: { PATH: '/usr/bin', SHARED: 'ambient' },
      now: () => 0,
      spawnCli: (_args, options) => {
        capturedCliEnv.push(options.env);
        return fakeSpawnCli(log)(_args, options);
      },
    });
    await drain(
      await cliAdapter.startSession(
        baseRequest({ env: { ANTHROPIC_API_KEY: 'sk-req', SHARED: 'from-request' } }),
      ),
    );
    expect(capturedCliEnv[0]).toEqual({
      PATH: '/usr/bin',
      SHARED: 'from-request',
      ANTHROPIC_API_KEY: 'sk-req',
    });

    const sdkAdapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'sdk' }),
      env: { PATH: '/usr/bin', SHARED: 'ambient' },
      now: () => 0,
      loadSdkTransport: () =>
        Promise.resolve(fakeSdkModule(log, { capturedOptions: capturedSdkOptions })),
    });
    await drain(
      await sdkAdapter.startSession(
        baseRequest({ env: { ANTHROPIC_API_KEY: 'sk-req', SHARED: 'from-request' } }),
      ),
    );
    expect((capturedSdkOptions[0] as { env: unknown }).env).toEqual({
      PATH: '/usr/bin',
      SHARED: 'from-request',
      ANTHROPIC_API_KEY: 'sk-req',
    });
  });
});

describe('ClaudeCodeAdapter — SessionHandle.stop()', () => {
  it('takes effect even when called before the caller has begun consuming events, ending the session as aborted', async () => {
    function abortAwareSpawnCli(): typeof spawnClaudeCli {
      return (_args, options) => {
        async function* events(): AsyncGenerator<AdapterEvent> {
          yield {
            type: 'session.started',
            sessionId: 'abort-test',
            model: 'm',
            tools: [],
            meta: {},
          };
          await new Promise<void>((resolve) => {
            if (options.abortSignal?.aborted === true) {
              resolve();
              return;
            }
            options.abortSignal?.addEventListener('abort', () => {
              resolve();
            });
          });
          yield { type: 'session.ended', reason: 'aborted' };
        }
        return {
          events: { [Symbol.asyncIterator]: events },
          stop: () => {
            // Nothing to stop -- this fake reacts to abortSignal alone, not a separate stop() call.
          },
          exitCode: Promise.resolve(-1),
        };
      };
    }

    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: abortAwareSpawnCli(),
    });
    const handle = await adapter.startSession(baseRequest());
    await handle.stop('cancelled before consumption');
    const { events, result } = await drain(handle);
    expect(events.at(-1)).toEqual({ type: 'session.ended', reason: 'aborted' });
    // A fresh critic round found this exact abort path reported ok:true (indistinguishable from a
    // real success) before session-result.ts's own reason-aware fix -- asserted here too, not only
    // at session-result.test.ts's own unit level, since this is the one place the full real
    // stop()-to-SessionResult pipeline is actually exercised end to end.
    expect(result.ok).toBe(false);
  });
});
