/**
 * `unsafeDeclaredPathReason`/`unsafeOverlaySourceReason` (specs/22 M16 P2) — `13` F-TEST-9's path
 * safety rule for a declared output path and an overlay destination: relative, no `..` component,
 * outside `.git` and `.forge`. `QUALITY-BAR.md` R11: a Windows-shaped path and a `..`/absolute escape
 * each need a test.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see QUALITY-BAR.md R11
 */
import { describe, expect, it } from 'vitest';

import {
  unsafeDeclaredPathReason,
  unsafeOverlaySourceReason,
} from '../../../src/commands/parity/paths.ts';

describe('unsafeDeclaredPathReason (specs/22 M16 P2)', () => {
  it('accepts an ordinary relative path', () => {
    expect(unsafeDeclaredPathReason('out/result.txt')).toBeUndefined();
  });

  it('refuses an empty path', () => {
    expect(unsafeDeclaredPathReason('')).toBe('empty');
    expect(unsafeDeclaredPathReason('   ')).toBe('empty');
  });

  it('refuses a POSIX absolute path (R11)', () => {
    expect(unsafeDeclaredPathReason('/etc/passwd')).toBe('absolute');
  });

  it('refuses a Windows drive-absolute path, either slash style (R11)', () => {
    expect(unsafeDeclaredPathReason('C:\\Windows\\system32')).toBe('absolute');
    expect(unsafeDeclaredPathReason('C:/Windows/system32')).toBe('absolute');
  });

  it('refuses a Windows UNC path (R11)', () => {
    expect(unsafeDeclaredPathReason('\\\\server\\share\\file')).toBe('absolute');
  });

  it('refuses a relative path that merely contains a backslash (not absolute)', () => {
    expect(unsafeDeclaredPathReason('sub\\dir\\file.txt')).toBe('backslash');
  });

  it('refuses a ".." parent-segment escape (R11)', () => {
    expect(unsafeDeclaredPathReason('../escape.txt')).toBe('parent-segment');
    expect(unsafeDeclaredPathReason('a/../../escape.txt')).toBe('parent-segment');
  });

  it('refuses a single "." segment too', () => {
    expect(unsafeDeclaredPathReason('./a/./b')).toBe('parent-segment');
  });

  it('refuses a path under .git', () => {
    expect(unsafeDeclaredPathReason('.git/config')).toBe('under-git');
  });

  it('refuses a path under .forge', () => {
    expect(unsafeDeclaredPathReason('.forge/parity/x.json')).toBe('under-forge');
  });

  it('matches .git/.forge case-insensitively (Windows and macOS APFS are both case-insensitive)', () => {
    expect(unsafeDeclaredPathReason('.GIT/config')).toBe('under-git');
    expect(unsafeDeclaredPathReason('.Forge/x')).toBe('under-forge');
  });

  it('does not flag a sibling that merely starts with the same letters', () => {
    expect(unsafeDeclaredPathReason('.gitkeep')).toBeUndefined();
    expect(unsafeDeclaredPathReason('.forge-backup/x')).toBeUndefined();
  });

  it('only checks the first segment for .git/.forge, not a path that merely contains them later', () => {
    expect(unsafeDeclaredPathReason('out/.git/x')).toBeUndefined();
  });
});

describe('unsafeOverlaySourceReason (specs/22 M16 P2)', () => {
  it('accepts a source legitimately under .forge/parity/ (unlike a declared output destination)', () => {
    expect(unsafeOverlaySourceReason('.forge/parity/fixtures/input.txt')).toBeUndefined();
  });

  it('still refuses an absolute or escaping source path', () => {
    expect(unsafeOverlaySourceReason('/etc/passwd')).toBe('absolute');
    expect(unsafeOverlaySourceReason('../escape.txt')).toBe('parent-segment');
    expect(unsafeOverlaySourceReason('')).toBe('empty');
  });
});
