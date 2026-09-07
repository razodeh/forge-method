/**
 * `createConformanceContext` — the `getAdapter()`/`getCapabilities()` guards against being called
 * before `beforeAll` assigns them (a real misuse this defensive check exists to catch, not a
 * structurally unreachable branch).
 *
 * @see PLAN-M4.md P4
 */
import { describe, expect, it } from 'vitest';

import { createConformanceContext } from '../../src/conformance/context.ts';

function stubOptions() {
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

describe('createConformanceContext', () => {
  it('getAdapter() throws a clear error when called before setAdapter()', () => {
    const { context } = createConformanceContext(stubOptions());
    expect(() => context.getAdapter()).toThrow(/before beforeAll assigned it/);
  });

  it('getCapabilities() throws a clear error when called before setCapabilities()', () => {
    const { context } = createConformanceContext(stubOptions());
    expect(() => context.getCapabilities()).toThrow(/before beforeAll assigned it/);
  });
});
