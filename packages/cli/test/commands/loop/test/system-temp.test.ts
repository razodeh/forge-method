/**
 * `createSystemTempPath` — the one, narrowly-exempted real source `runAndNormalize`'s pytest branch
 * injects rather than reading directly (`QUALITY-BAR.md` R10).
 *
 * @see PLAN-M8.md P3
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSystemTempPath } from '../../../../src/commands/loop/test/system-temp.ts';

describe('createSystemTempPath', () => {
  it('produces a real, absolute path under the OS temp directory', () => {
    // `path.isAbsolute`, not a `/`-literal check: `os.tmpdir()` returns a backslash, drive-lettered
    // path on Windows (`C:\Users\...\Temp`) — a `/`-literal assertion would fail there, which is
    // exactly R11's own proof condition ("no `/`-literal separator on a disk path"), not merely an
    // absent Windows case.
    const value = createSystemTempPath('forge-test');
    expect(path.isAbsolute(value)).toBe(true);
    expect(value).toContain('forge-test');
  });

  it('produces a genuinely different path on every call', () => {
    const a = createSystemTempPath('forge-test');
    const b = createSystemTempPath('forge-test');
    expect(a).not.toBe(b);
  });
});
