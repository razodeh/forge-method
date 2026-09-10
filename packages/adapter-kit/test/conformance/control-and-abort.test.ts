/**
 * `checkC5Abort` — when the event stream settles with no `session.ended` event at all (a stream that
 * simply closes), the check must not assume one exists; the main conformance suite test only exercises
 * the "an ended event with reason 'aborted' exists" shape.
 *
 * @see specs/07 §7.6
 * @see PLAN-M4.md P4
 */
import { describe, expect, it } from 'vitest';

import { checkC5Abort } from '../../src/conformance/control-and-abort.ts';
import { createConformanceContext } from '../../src/conformance/context.ts';
import type { ConformanceOptions } from '../../src/conformance/fixtures.ts';
import type { AdapterCapabilities, PlatformAdapter } from '../../src/types/index.ts';

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

describe('checkC5Abort — stream closes cleanly with no session.ended event', () => {
  it('does not assume a session.ended event exists, and still passes on a clean, eventless close', async () => {
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: () =>
        Promise.resolve({
          sessionId: 's1',
          // Closes immediately, with no events at all — a legitimate (if minimal) clean shutdown.
          events: {
            [Symbol.asyncIterator]: () => ({
              next: () => Promise.resolve({ done: true as const, value: undefined }),
            }),
          },
          stop: () => Promise.resolve(),
          result: () =>
            Promise.resolve({
              sessionId: 's1',
              ok: false,
              finalText: '',
              usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
              durationMs: 0,
              changedFiles: [],
              controlTokens: [],
            }),
        }),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const { context, setAdapter, setCapabilities } = createConformanceContext(stubOptions());
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC5Abort(context)).resolves.toBeUndefined();
  });
});
