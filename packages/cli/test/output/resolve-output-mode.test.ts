/**
 * `resolveOutputMode` — `03` §3.5's four-mode table.
 *
 * @see specs/03 §3.5
 */
import { describe, expect, it } from 'vitest';

import { parseGlobalFlags } from '../../src/entry/parse-global-flags.ts';
import { resolveOutputMode } from '../../src/output/resolve-output-mode.ts';

describe('resolveOutputMode', () => {
  it('selects json whenever --json is set, regardless of TTY', () => {
    expect(resolveOutputMode(parseGlobalFlags(['--json']), true)).toBe('json');
    expect(resolveOutputMode(parseGlobalFlags(['--json']), false)).toBe('json');
  });

  it('selects json over quiet when both are set', () => {
    expect(resolveOutputMode(parseGlobalFlags(['--json', '--quiet']), true)).toBe('json');
  });

  it('selects quiet when --quiet is set without --json', () => {
    expect(resolveOutputMode(parseGlobalFlags(['--quiet']), true)).toBe('quiet');
  });

  it('selects stream when --no-tui is set', () => {
    expect(resolveOutputMode(parseGlobalFlags(['--no-tui']), true)).toBe('stream');
  });

  it('selects stream for a non-TTY invocation with no relevant flags', () => {
    expect(resolveOutputMode(parseGlobalFlags([]), false)).toBe('stream');
  });

  it('selects tui only for a TTY invocation with none of --json/--quiet/--no-tui', () => {
    expect(resolveOutputMode(parseGlobalFlags([]), true)).toBe('tui');
  });
});
