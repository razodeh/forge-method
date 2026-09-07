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

import { checkC11ErrorSurface } from '../../src/conformance/session-basics.ts';
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
