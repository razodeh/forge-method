/**
 * `checkC11ErrorSurface` — `07` §7.6's own C11 row accepts two different shapes for "surfaced": an
 * `error`-type event, or `SessionResult.error` alone, or `startSession` itself rejecting. The main
 * conformance suite test only exercises the `error`-event shape (the compliant stub's own choice); these
 * two more direct tests cover the other two, using a minimal adapter built just for each.
 *
 * @see specs/07 §7.6
 * @see PLAN-M4.md P4
 */
import { describe, expect, it } from 'vitest';

import { checkC11ErrorSurface, checkC6Limits } from '../../src/conformance/session-basics.ts';
import { createConformanceContext } from '../../src/conformance/context.ts';
import type { ConformanceOptions } from '../../src/conformance/fixtures.ts';
import type { AdapterCapabilities, PlatformAdapter, SessionResult } from '../../src/types/index.ts';

function stubOptions(): ConformanceOptions {
  return {
    createScratchDir: () => Promise.resolve('/tmp/unused'),
    validModel: 'model',
    invalidModel: 'invalid-model',
    helloPrompt: 'hello',
    writeFilePrompt: 'write',
    manyTurnsPrompt: 'many-turns',
    execPrompt: 'exec',
    secretProbe: { value: 'secret', prompt: 'probe' },
    controlTokenPrompt: 'control',
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
  turnLimitEnforcement: true,
};

function minimalAdapter(overrides: Partial<PlatformAdapter>): PlatformAdapter {
  return {
    id: 'minimal',
    displayName: 'Minimal',
    capabilities: () => Promise.resolve(CAPABILITIES),
    preflight: () => Promise.resolve({ ok: true, issues: [] }),
    listModels: () => Promise.resolve([]),
    startSession: () => Promise.reject(new Error('startSession not implemented for this test')),
    resumeSession: () => Promise.reject(new Error('resumeSession not implemented for this test')),
    ...overrides,
  };
}

async function buildContext(adapter: PlatformAdapter) {
  const { context, setAdapter, setCapabilities } = createConformanceContext(stubOptions());
  setAdapter(adapter);
  setCapabilities(await adapter.capabilities());
  return context;
}

describe('checkC11ErrorSurface — alternate surfacing shapes', () => {
  it('accepts startSession itself rejecting as a valid way to surface an invalid model', async () => {
    const adapter = minimalAdapter({
      startSession: () => Promise.reject(new Error('unknown model id')),
    });
    const context = await buildContext(adapter);
    await expect(checkC11ErrorSurface(context)).resolves.toBeUndefined();
  });

  it('accepts SessionResult.error alone (no error event) as a valid way to surface an invalid model', async () => {
    const result: SessionResult = {
      sessionId: 's1',
      ok: false,
      finalText: '',
      usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
      durationMs: 0,
      changedFiles: [],
      controlTokens: [],
      error: { code: 'INVALID_MODEL', message: 'unknown model id' },
    };
    const adapter = minimalAdapter({
      startSession: () =>
        Promise.resolve({
          sessionId: 's1',
          events: {
            [Symbol.asyncIterator]: () => ({
              next: () => Promise.resolve({ done: true as const, value: undefined }),
            }),
          },
          stop: () => Promise.resolve(),
          result: () => Promise.resolve(result),
        }),
    });
    const context = await buildContext(adapter);
    await expect(checkC11ErrorSurface(context)).resolves.toBeUndefined();
  });
});

function completedSessionAdapter(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  const result: SessionResult = {
    sessionId: 's1',
    ok: true,
    finalText: 'done',
    usage: { inputTokens: 0, outputTokens: 0, turns: 5 },
    durationMs: 0,
    changedFiles: [],
    controlTokens: [],
  };
  return minimalAdapter({
    startSession: () =>
      Promise.resolve({
        sessionId: 's1',
        events: {
          [Symbol.asyncIterator]: () => {
            let done = false;
            return {
              next: () => {
                if (done) return Promise.resolve({ done: true as const, value: undefined });
                done = true;
                return Promise.resolve({
                  done: false as const,
                  value: { type: 'session.ended', reason: 'complete' } as const,
                });
              },
            };
          },
        },
        stop: () => Promise.resolve(),
        result: () => Promise.resolve(result),
      }),
    ...overrides,
  });
}

describe('checkC6Limits — real, live-verified capability gating (SPEC-QUESTIONS.md Q114, Q132)', () => {
  it('passes for an adapter that honestly reports turnLimitEnforcement: false, even though it ran the session to natural completion without ever respecting maxTurns', async () => {
    const adapter = completedSessionAdapter({
      capabilities: () => Promise.resolve({ ...CAPABILITIES, turnLimitEnforcement: false }),
    });
    const context = await buildContext(adapter);
    await expect(checkC6Limits(context)).resolves.toBeUndefined();
  });

  it('still fails for an adapter that reports turnLimitEnforcement: true but does not actually enforce it', async () => {
    const adapter = completedSessionAdapter({
      capabilities: () => Promise.resolve({ ...CAPABILITIES, turnLimitEnforcement: true }),
    });
    const context = await buildContext(adapter);
    await expect(checkC6Limits(context)).rejects.toThrow();
  });
});
