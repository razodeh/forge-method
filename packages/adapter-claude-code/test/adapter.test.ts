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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import type { ForgeMcpBackend } from '../src/forge-mcp/index.ts';
import { defaultClaudeCodeTierModels, listClaudeCodeModels } from '../src/list-models.ts';
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

  it('defaultTierModels() delegates to defaultClaudeCodeTierModels()', () => {
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({}),
      env: {},
      now: () => 0,
    });
    expect(adapter.defaultTierModels()).toEqual(defaultClaudeCodeTierModels());
  });

  it("provisionSkills() delegates to skills.ts's own provisionSkills, real filesystem write included", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-adapter-claude-code-adapter-skills-'));
    scratchDirs.push(dir);
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({}),
      env: {},
      now: () => 0,
    });
    const result = await adapter.provisionSkills(
      [{ id: 'deploy', summary: 'Deploys.', body: 'Do the deploy.', appliesTo: [] }],
      { runId: 'r', stepId: 's', cwd: dir },
    );
    expect(result).toEqual({ strategy: 'native', provisionedSkillIds: ['deploy'] });
    const content = await readFile(
      path.join(dir, '.claude', 'skills', 'deploy', 'SKILL.md'),
      'utf8',
    );
    expect(content).toContain('Do the deploy.');
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

describe('ClaudeCodeAdapter — provisionMcp()/MCP load-verification', () => {
  it('provisionMcp() records the grant and immediately returns loadedServerIds as an optimistic echo of the granted, safe-id server set -- before any session has run', async () => {
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({}),
      env: {},
      now: () => 0,
    });
    const result = await adapter.provisionMcp(
      [
        { id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' },
        { id: 'b', transport: 'stdio', command: 'server-b', grantedTools: '*' },
      ],
      {
        runId: 'run-1',
        stepId: 'implement-story-1',
        cwd: '/tmp/forge-adapter-claude-code-test-mcp-provisional',
      },
    );
    expect(result).toEqual({ loadedServerIds: ['a', 'b'] });
  });

  it("provisionMcp()'s own optimistic echo never claims a server whose id fails mcp.ts's own safety filter -- it was never actually going to be sent to Claude Code, so it is never claimed as loaded either", async () => {
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({}),
      env: {},
      now: () => 0,
    });
    const result = await adapter.provisionMcp(
      [
        { id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' },
        { id: 'evil)Bash(*', transport: 'stdio', command: 'server-evil', grantedTools: '*' },
      ],
      {
        runId: 'run-1',
        stepId: 'implement-story-1',
        cwd: '/tmp/forge-adapter-claude-code-test-mcp-unsafe-id',
      },
    );
    expect(result).toEqual({ loadedServerIds: ['a'] });
  });

  it("a session granted only server 'a' is accepted when the real init event reports 'a' plus an extra, unrequested 'b' -- 07 §7.3's own Check names only missing servers as a failure", async () => {
    const log: string[] = [];
    const cwd = '/tmp/forge-adapter-claude-code-test-mcp-extra-lane';
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log, {
        events: [
          {
            type: 'session.started',
            sessionId: 'mcp-extra-test',
            model: 'm',
            tools: [],
            meta: {
              mcp_servers: [
                { name: 'a', status: 'connected' },
                { name: 'b', status: 'connected' },
              ],
            },
          },
          { type: 'session.ended', reason: 'complete' },
        ],
      }),
    });
    await adapter.provisionMcp(
      [{ id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    const handle = await adapter.startSession(baseRequest({ cwd }));
    const { events, result } = await drain(handle);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(result.ok).toBe(true);
  });

  it("a session granted servers 'a' and 'b' ends the step with a real, typed error naming 'b' specifically when the real init event reports only 'a' -- cli transport", async () => {
    const log: string[] = [];
    const cwd = '/tmp/forge-adapter-claude-code-test-mcp-missing-lane-cli';
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log, {
        events: [
          {
            type: 'session.started',
            sessionId: 'mcp-missing-test-cli',
            model: 'm',
            tools: [],
            meta: { mcp_servers: [{ name: 'a', status: 'connected' }] },
          },
          { type: 'session.ended', reason: 'complete' },
        ],
      }),
    });
    await adapter.provisionMcp(
      [
        { id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' },
        { id: 'b', transport: 'stdio', command: 'server-b', grantedTools: '*' },
      ],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    const handle = await adapter.startSession(baseRequest({ cwd }));
    const { events, result } = await drain(handle);
    expect(events.map((event) => event.type)).toEqual([
      'session.started',
      'error',
      'session.ended',
    ]);
    const errorEvent = events.find((event) => event.type === 'error');
    expect(errorEvent).toMatchObject({ code: 'ADP-CLAUDE-CODE-MCP-LOAD-FAILED' });
    expect((errorEvent as { message: string }).message).toContain('b');
    expect(events.at(-1)).toEqual({ type: 'session.ended', reason: 'error' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ADP-CLAUDE-CODE-MCP-LOAD-FAILED');
    expect(result.error?.message).toContain('b');
  });

  it("the identical missing-server Check applies on the sdk transport too -- drainAndTrack's own load-verification is transport-agnostic", async () => {
    const log: string[] = [];
    const cwd = '/tmp/forge-adapter-claude-code-test-mcp-missing-lane-sdk';
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'sdk' }),
      env: {},
      now: () => 0,
      loadSdkTransport: () =>
        Promise.resolve({
          buildSdkOptions: () => ({}),
          runSdkQuery: () => {
            log.push('sdk');
            return {
              events: eventsOf([
                {
                  type: 'session.started',
                  sessionId: 'mcp-missing-test-sdk',
                  model: 'm',
                  tools: [],
                  meta: { mcp_servers: [] },
                },
                { type: 'session.ended', reason: 'complete' },
              ]),
              interrupt: () => Promise.resolve(),
            };
          },
        }),
    });
    await adapter.provisionMcp(
      [{ id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    const handle = await adapter.startSession(baseRequest({ cwd }));
    const { result } = await drain(handle);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ADP-CLAUDE-CODE-MCP-LOAD-FAILED');
    expect(result.error?.message).toContain('a');
  });

  it('a session whose cwd never had provisionMcp() called for it behaves exactly as before this piece existed -- no MCP-related error, no --mcp-config threaded', async () => {
    const log: string[] = [];
    const capturedArgs: (readonly string[])[] = [];
    const cwd = '/tmp/forge-adapter-claude-code-test-mcp-unprovisioned-lane';
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: (args, options) => {
        capturedArgs.push(args);
        return fakeSpawnCli(log)(args, options);
      },
    });
    const handle = await adapter.startSession(baseRequest({ cwd }));
    const { result } = await drain(handle);
    expect(result.ok).toBe(true);
    expect(capturedArgs[0]).not.toContain('--mcp-config');
    expect(capturedArgs[0]).not.toContain('--strict-mcp-config');
  });

  it('config.mcp.adoptHostServers defaults to false, proven end to end: a granted session passes --strict-mcp-config on the cli transport and strictMcpConfig:true on the sdk transport with no override at all', async () => {
    const log: string[] = [];
    const capturedArgs: (readonly string[])[] = [];
    const cliCwd = '/tmp/forge-adapter-claude-code-test-mcp-strict-default-cli';
    const cliAdapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: (args, options) => {
        capturedArgs.push(args);
        // A fresh critic round noted the original draft here used `fakeSpawnCli(log)`'s own default
        // fixture, whose `meta: {}` reports no loaded servers at all -- silently tripping this same
        // piece's own MCP load-verification for the server granted below, so the session this test
        // drained had actually already failed for an unrelated, unasserted reason. Harmless to what
        // was asserted (`capturedArgs` is captured synchronously at spawn time, before any of that),
        // but this test's own name claims a clean, successful "end to end" grant -- an honest fixture
        // (server `a` genuinely reported loaded) is needed to actually be that, not merely to pass.
        return fakeSpawnCli(log, {
          events: [
            {
              type: 'session.started',
              sessionId: 'strict-default-cli',
              model: 'm',
              tools: [],
              meta: { mcp_servers: [{ name: 'a', status: 'connected' }] },
            },
            { type: 'session.ended', reason: 'complete' },
          ],
        })(args, options);
      },
    });
    await cliAdapter.provisionMcp(
      [{ id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd: cliCwd },
    );
    const cliResult = await drain(await cliAdapter.startSession(baseRequest({ cwd: cliCwd })));
    expect(cliResult.result.ok).toBe(true);
    expect(capturedArgs[0]).toContain('--strict-mcp-config');

    // `fakeSdkModule`'s own default `buildSdkOptions: () => ({})` ignores every argument (it exists to
    // let other tests capture what `runSdkQuery` received, not what `buildSdkOptions` itself was
    // called with) -- this test needs the latter, so it defines its own minimal stub that echoes back
    // the real `mcp` parameter `startOnTransport` (adapter.ts, P7) computed and passed in, the one
    // piece of new adapter-level logic no build-options.test.ts-level unit test can reach.
    const capturedMcpArg: unknown[] = [];
    const sdkCwd = '/tmp/forge-adapter-claude-code-test-mcp-strict-default-sdk';
    const sdkAdapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'sdk' }),
      env: {},
      now: () => 0,
      loadSdkTransport: () =>
        Promise.resolve({
          buildSdkOptions: (..._args: unknown[]) => {
            capturedMcpArg.push(_args[3]);
            return {};
          },
          runSdkQuery: () => {
            log.push('sdk');
            return {
              events: eventsOf([
                {
                  type: 'session.started',
                  sessionId: 'strict-default-sdk',
                  model: 'm',
                  tools: [],
                  meta: { mcp_servers: [{ name: 'a', status: 'connected' }] },
                },
                { type: 'session.ended', reason: 'complete' },
              ]),
              interrupt: () => Promise.resolve(),
            };
          },
        }),
    });
    await sdkAdapter.provisionMcp(
      [{ id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd: sdkCwd },
    );
    const sdkResult = await drain(await sdkAdapter.startSession(baseRequest({ cwd: sdkCwd })));
    expect(sdkResult.result.ok).toBe(true);
    expect((capturedMcpArg[0] as { strict: boolean }).strict).toBe(true);
  });

  it('config.mcp.adoptHostServers: true omits --strict-mcp-config on the cli transport', async () => {
    const log: string[] = [];
    const capturedArgs: (readonly string[])[] = [];
    const cwd = '/tmp/forge-adapter-claude-code-test-mcp-adopt-host-lane';
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({
        transport: 'cli',
        mcp: { adoptHostServers: true },
      }),
      env: {},
      now: () => 0,
      spawnCli: (args, options) => {
        capturedArgs.push(args);
        return fakeSpawnCli(log, {
          events: [
            {
              type: 'session.started',
              sessionId: 'adopt-host-cli',
              model: 'm',
              tools: [],
              meta: { mcp_servers: [{ name: 'a', status: 'connected' }] },
            },
            { type: 'session.ended', reason: 'complete' },
          ],
        })(args, options);
      },
    });
    await adapter.provisionMcp(
      [{ id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    const { result } = await drain(await adapter.startSession(baseRequest({ cwd })));
    expect(result.ok).toBe(true);
    expect(capturedArgs[0]).not.toContain('--strict-mcp-config');
  });

  it('a second provisionMcp() call for the same cwd replaces the first grant entirely, not merges with it', async () => {
    const log: string[] = [];
    const cwd = '/tmp/forge-adapter-claude-code-test-mcp-replace-lane';
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log, {
        events: [
          {
            type: 'session.started',
            sessionId: 'mcp-replace-test',
            model: 'm',
            tools: [],
            // Only 'b' genuinely loaded -- if the first grant (below, for 'a') were still in effect
            // (a merge bug) rather than fully replaced, this session would incorrectly fail for a
            // missing 'a' that was never actually granted the second time around.
            meta: { mcp_servers: [{ name: 'b', status: 'connected' }] },
          },
          { type: 'session.ended', reason: 'complete' },
        ],
      }),
    });
    await adapter.provisionMcp(
      [{ id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    await adapter.provisionMcp(
      [{ id: 'b', transport: 'stdio', command: 'server-b', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    const handle = await adapter.startSession(baseRequest({ cwd }));
    const { events, result } = await drain(handle);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('the sdk transport also threads no mcpServers/strictMcpConfig at all when provisionMcp() was never called for that cwd -- the identical "no behavioural change" contract already proven for the cli transport above', async () => {
    const capturedMcpArg: unknown[] = [];
    const cwd = '/tmp/forge-adapter-claude-code-test-mcp-unprovisioned-lane-sdk';
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'sdk' }),
      env: {},
      now: () => 0,
      loadSdkTransport: () =>
        Promise.resolve({
          buildSdkOptions: (..._args: unknown[]) => {
            capturedMcpArg.push(_args[3]);
            return {};
          },
          runSdkQuery: () => ({
            events: eventsOf([
              {
                type: 'session.started',
                sessionId: 'unprovisioned-sdk',
                model: 'm',
                tools: [],
                meta: {},
              },
              { type: 'session.ended', reason: 'complete' },
            ]),
            interrupt: () => Promise.resolve(),
          }),
        }),
    });
    const { result } = await drain(await adapter.startSession(baseRequest({ cwd })));
    expect(result.ok).toBe(true);
    expect(capturedMcpArg[0]).toBeUndefined();
  });

  it('SessionHandle.stop() is safe to call after the session already ended itself via the internal MCP-mismatch abort -- both routes share the identical abortController, and AbortController.abort() is spec-idempotent', async () => {
    const log: string[] = [];
    const cwd = '/tmp/forge-adapter-claude-code-test-mcp-stop-after-abort-lane';
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log, {
        events: [
          {
            type: 'session.started',
            sessionId: 'mcp-stop-after-abort-test',
            model: 'm',
            tools: [],
            meta: { mcp_servers: [] },
          },
          { type: 'session.ended', reason: 'complete' },
        ],
      }),
    });
    await adapter.provisionMcp(
      [{ id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    const handle = await adapter.startSession(baseRequest({ cwd }));
    const { result } = await drain(handle);
    expect(result.ok).toBe(false);
    await expect(handle.stop('cleanup after the session already ended')).resolves.toBeUndefined();
  });

  it('only the first session.started event in a stream is checked against the grant -- a later recurrence reporting a mismatch does not retroactively fail an already-verified session', async () => {
    const log: string[] = [];
    const cwd = '/tmp/forge-adapter-claude-code-test-mcp-second-turn-lane';
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      spawnCli: fakeSpawnCli(log, {
        events: [
          // First turn: 'a' genuinely reported loaded -- the grant is satisfied here.
          {
            type: 'session.started',
            sessionId: 'mcp-second-turn-test',
            model: 'm',
            tools: [],
            meta: { mcp_servers: [{ name: 'a', status: 'connected' }] },
          },
          { type: 'text', text: 'working...', partial: false },
          // A second, real `session.started` recurrence (the real SDK's own doc comment describes
          // this message as emitted "at the start of each turn") whose own snapshot would fail the
          // Check if re-run against it -- must not retroactively fail a session already verified at
          // its real, first start.
          {
            type: 'session.started',
            sessionId: 'mcp-second-turn-test',
            model: 'm',
            tools: [],
            meta: { mcp_servers: [] },
          },
          { type: 'session.ended', reason: 'complete' },
        ],
      }),
    });
    await adapter.provisionMcp(
      [{ id: 'a', transport: 'stdio', command: 'server-a', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    const handle = await adapter.startSession(baseRequest({ cwd }));
    const { events, result } = await drain(handle);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'session.ended', reason: 'complete' });
    expect(result.ok).toBe(true);
  });
});

describe('ClaudeCodeAdapter — forgeMcpBackend wiring (P8)', () => {
  const fixtureBackend: ForgeMcpBackend = {
    kbSearch: () => Promise.resolve([]),
    kbGet: () => Promise.resolve(undefined),
    specGet: () => Promise.resolve(undefined),
    ask: () => Promise.resolve({ answer: 'ok' }),
    assume: () => Promise.resolve({ acknowledged: true }),
    handoff: () => Promise.resolve({ acknowledged: true }),
    requestChange: () => Promise.resolve({ acknowledged: true }),
    report: () => Promise.resolve({ acknowledged: true }),
    skillLoad: () => Promise.resolve(undefined),
  };

  function sdkAdapterCapturingMcpArg(capturedMcpArg: unknown[]): ClaudeCodeAdapter {
    return new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'sdk' }),
      env: {},
      now: () => 0,
      forgeMcpBackend: fixtureBackend,
      loadSdkTransport: () =>
        Promise.resolve({
          buildSdkOptions: (..._args: unknown[]) => {
            capturedMcpArg.push(_args[3]);
            return {};
          },
          runSdkQuery: () => ({
            events: eventsOf([
              {
                type: 'session.started',
                sessionId: 'forge-mcp-sdk-test',
                model: 'm',
                tools: [],
                meta: {},
              },
              { type: 'session.ended', reason: 'complete' },
            ]),
            interrupt: () => Promise.resolve(),
          }),
        }),
    });
  }

  it('an sdk-transport session gets a real, in-process "forge" server entry and mcp__forge__* allowed, when forgeMcpBackend is configured and no provisionMcp grant exists at all', async () => {
    const capturedMcpArg: unknown[] = [];
    const adapter = sdkAdapterCapturingMcpArg(capturedMcpArg);
    const { result } = await drain(
      await adapter.startSession(baseRequest({ cwd: '/tmp/forge-mcp-sdk-lane-1' })),
    );
    expect(result.ok).toBe(true);
    const mcp = capturedMcpArg[0] as {
      allowedTools: readonly string[];
      serverConfig: Record<string, { type: string; name: string; instance: unknown }>;
      strict: boolean;
    };
    expect(mcp.allowedTools).toContain('mcp__forge__*');
    expect(mcp.serverConfig['forge']).toMatchObject({ type: 'sdk', name: 'forge' });
    expect(mcp.serverConfig['forge']?.instance).toBeDefined();
  });

  it('the forge server entry is merged alongside, not instead of, a real provisionMcp() grant for the same session', async () => {
    const capturedMcpArg: unknown[] = [];
    const adapter = sdkAdapterCapturingMcpArg(capturedMcpArg);
    const cwd = '/tmp/forge-mcp-sdk-lane-merge';
    await adapter.provisionMcp(
      [{ id: 'github', transport: 'stdio', command: 'npx', grantedTools: ['get_issue'] }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    await drain(await adapter.startSession(baseRequest({ cwd })));
    const mcp = capturedMcpArg[0] as {
      allowedTools: readonly string[];
      serverConfig: Record<string, unknown>;
    };
    expect(mcp.allowedTools).toEqual(
      expect.arrayContaining(['mcp__github__get_issue', 'mcp__forge__*']),
    );
    expect(Object.keys(mcp.serverConfig).sort()).toEqual(['forge', 'github']);
  });

  it("the reserved 'forge' server id silently supersedes a caller-granted server that happens to use the identical id -- documented precedence, not a merge or a conflict error", async () => {
    const capturedMcpArg: unknown[] = [];
    const adapter = sdkAdapterCapturingMcpArg(capturedMcpArg);
    const cwd = '/tmp/forge-mcp-sdk-lane-collision';
    await adapter.provisionMcp(
      [{ id: 'forge', transport: 'stdio', command: 'a-caller-supplied-binary', grantedTools: '*' }],
      { runId: 'run-1', stepId: 'implement-story-1', cwd },
    );
    await drain(await adapter.startSession(baseRequest({ cwd })));
    const mcp = capturedMcpArg[0] as { serverConfig: Record<string, { type: string }> };
    expect(mcp.serverConfig['forge']?.type).toBe('sdk');
  });

  it('each session gets its own fresh McpServer instance -- never the same live object reused across two sessions on the same adapter', async () => {
    const capturedMcpArg: unknown[] = [];
    const adapter = sdkAdapterCapturingMcpArg(capturedMcpArg);
    await drain(
      await adapter.startSession(baseRequest({ cwd: '/tmp/forge-mcp-sdk-lane-fresh-1' })),
    );
    await drain(
      await adapter.startSession(baseRequest({ cwd: '/tmp/forge-mcp-sdk-lane-fresh-2' })),
    );
    const first = capturedMcpArg[0] as { serverConfig: Record<string, { instance: unknown }> };
    const second = capturedMcpArg[1] as { serverConfig: Record<string, { instance: unknown }> };
    expect(first.serverConfig['forge']?.instance).not.toBe(second.serverConfig['forge']?.instance);
  });

  it('a cli-transport session never receives a forge server entry at all, even when forgeMcpBackend is configured -- a live McpServer instance cannot cross the real subprocess boundary', async () => {
    const log: string[] = [];
    const capturedArgs: (readonly string[])[] = [];
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'cli' }),
      env: {},
      now: () => 0,
      forgeMcpBackend: fixtureBackend,
      spawnCli: (args, options) => {
        capturedArgs.push(args);
        return fakeSpawnCli(log)(args, options);
      },
    });
    const { result } = await drain(
      await adapter.startSession(baseRequest({ cwd: '/tmp/forge-mcp-cli-lane' })),
    );
    expect(result.ok).toBe(true);
    expect(capturedArgs[0]).not.toContain('--mcp-config');
  });

  it('omitting forgeMcpBackend entirely leaves an sdk-transport session exactly as before this option existed -- no mcp arg at all when no provisionMcp grant exists either', async () => {
    const capturedMcpArg: unknown[] = [];
    const adapter = new ClaudeCodeAdapter({
      config: claudeCodeAdapterConfigSchema.parse({ transport: 'sdk' }),
      env: {},
      now: () => 0,
      loadSdkTransport: () =>
        Promise.resolve({
          buildSdkOptions: (..._args: unknown[]) => {
            capturedMcpArg.push(_args[3]);
            return {};
          },
          runSdkQuery: () => ({
            events: eventsOf([
              {
                type: 'session.started',
                sessionId: 'no-forge-mcp-test',
                model: 'm',
                tools: [],
                meta: {},
              },
              { type: 'session.ended', reason: 'complete' },
            ]),
            interrupt: () => Promise.resolve(),
          }),
        }),
    });
    await drain(await adapter.startSession(baseRequest({ cwd: '/tmp/forge-mcp-sdk-lane-absent' })));
    expect(capturedMcpArg[0]).toBeUndefined();
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
