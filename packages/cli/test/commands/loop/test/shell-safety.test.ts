/**
 * `containsShellChaining` — a fresh critic round's own reproduction case (PLAN-M8.md P4) made real.
 *
 * @see PLAN-M8.md P3, P4
 */
import { describe, expect, it } from 'vitest';

import { containsShellChaining } from '../../../../src/commands/loop/test/shell-safety.ts';

describe('containsShellChaining', () => {
  it('detects &&', () => {
    expect(containsShellChaining('eslint . && echo done')).toBe(true);
  });

  it('detects ||, ;, and a single pipe', () => {
    expect(containsShellChaining('a || b')).toBe(true);
    expect(containsShellChaining('a; b')).toBe(true);
    expect(containsShellChaining('a | b')).toBe(true);
  });

  it('detects redirection and command substitution', () => {
    expect(containsShellChaining('a > out.txt')).toBe(true);
    expect(containsShellChaining('a < in.txt')).toBe(true);
    expect(containsShellChaining('echo `date`')).toBe(true);
    expect(containsShellChaining('echo $(date)')).toBe(true);
  });

  it('reports false for a plain, single invocation with ordinary flags', () => {
    expect(containsShellChaining('eslint . --max-warnings 0')).toBe(false);
    expect(containsShellChaining('vitest run --root .')).toBe(false);
  });
});
