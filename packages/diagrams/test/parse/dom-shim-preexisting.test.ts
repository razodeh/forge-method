/**
 * `installDomShim` — must not overwrite an already-present `document`, per `dom-shim.ts`'s own doc
 * comment. A separate file from `dom-shim.test.ts` deliberately: this assertion only means anything
 * if `globalThis.document` is unset before `installDomShim` is ever imported, which requires this
 * file's own fresh module registry (vitest's per-file fork isolation).
 *
 * @see PLAN-M3.md P1
 */
import { afterEach, describe, expect, it } from 'vitest';

describe('installDomShim — a pre-existing document', () => {
  afterEach(() => {
    // `unstubGlobals` (vitest.config.ts) does not cover a plain `Object.defineProperty` assignment.
    Reflect.deleteProperty(globalThis, 'document');
  });

  it('is left untouched rather than overwritten', async () => {
    const sentinel = { sentinel: true };
    expect(globalThis.document).toBeUndefined();
    Object.defineProperty(globalThis, 'document', { value: sentinel, configurable: true });

    const { installDomShim } = await import('../../src/parse/dom-shim.ts');
    installDomShim();

    expect(globalThis.document).toBe(sentinel);
  });
});
