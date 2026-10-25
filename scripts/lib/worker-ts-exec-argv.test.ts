/**
 * `getWorkerTsExecArgv()`'s own real shape -- pinned directly (critic B's own non-blocking finding:
 * no dedicated version-boundary test existed for this export before this file).
 *
 * @see scripts/lib/worker-ts-exec-argv.mjs
 * @see SPEC-QUESTIONS.md Q340
 */
import { describe, expect, it } from 'vitest';

import { SUPPORTS_NATIVE_STRIP_TYPES } from './node-version.mjs';
import { getWorkerTsExecArgv } from './worker-ts-exec-argv.mjs';

describe('getWorkerTsExecArgv — resolved for the real, currently running process', () => {
  it('is exactly [the bare native flag] when supported, or [a real file:// --import=] when not', () => {
    const argv = getWorkerTsExecArgv();
    expect(argv).toHaveLength(1);
    if (SUPPORTS_NATIVE_STRIP_TYPES) {
      expect(argv[0]).toBe('--experimental-strip-types');
    } else {
      expect(argv[0]!.startsWith('--import=')).toBe(true);
      const importValue = argv[0]!.slice('--import='.length);
      // A real file:// URL, never a bare specifier (breaks against the SPAWNED CHILD's own cwd) and
      // never a plain OS-native path (breaks on Windows -- the identical two Q340 critic findings
      // `node-ts-flag.test.ts` already pins for TS_NODE_FLAG).
      expect(new URL(importValue).protocol).toBe('file:');
      expect(importValue.endsWith('worker-ts-strip-loader.mjs')).toBe(true);
    }
  });

  it('memoizes: two calls return the identical array, not two freshly-resolved ones', () => {
    expect(getWorkerTsExecArgv()).toBe(getWorkerTsExecArgv());
  });
});
