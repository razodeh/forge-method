/**
 * `createSystemTempPath` — the one, narrowly-exempted real source `runAndNormalize`'s pytest branch
 * injects rather than reading directly (`QUALITY-BAR.md` R10).
 *
 * @see PLAN-M8.md P3
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createSystemTempPath,
  systemTempRoot,
} from '../../../../src/commands/loop/test/system-temp.ts';

describe('systemTempRoot', () => {
  it('is a real, absolute path (R11: no `/`-literal assertion, see createSystemTempPath above)', () => {
    expect(path.isAbsolute(systemTempRoot())).toBe(true);
  });

  it('is exactly the directory createSystemTempPath builds its own paths directly under, not merely an ancestor of it', () => {
    // A critic round found a `startsWith` assertion here passes for ANY ancestor (`path.dirname(...)`,
    // even `/`), which is exactly the wrong-rooted-sweep regression `sweepOrphanedLauncherShims`'s own
    // use of this function needs this test to actually catch. `path.dirname` of the built path is the
    // one assertion that pins the direct-parent relationship, not merely a containment one.
    expect(path.dirname(createSystemTempPath('forge-test'))).toBe(systemTempRoot());
  });
});

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
