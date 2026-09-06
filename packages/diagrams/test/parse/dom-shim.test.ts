/**
 * `installDomShim` — idempotent installation, per `PLAN-M3.md` P1's own Check.
 *
 * @see PLAN-M3.md P1
 */
import { describe, expect, it } from 'vitest';

import { installDomShim } from '../../src/parse/dom-shim.ts';

describe('installDomShim', () => {
  it('is safe to call more than once in the same process', () => {
    // Already installed once at module load (dom-shim.ts's own bottom-of-file call, and by every
    // other test importing `parse.ts`) — calling it again here must not throw (a plain reassignment
    // of `globalThis.navigator` throws on Node, which is exactly the bug this guard exists to avoid).
    expect(() => {
      installDomShim();
      installDomShim();
    }).not.toThrow();
    expect(globalThis.document).toBeDefined();
  });
});
