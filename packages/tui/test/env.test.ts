/**
 * `detectRenderMode` — `04` §4.7's own literal degradation-mode precedence, made concrete.
 *
 * @see specs/04 §4.7
 * @see PLAN-M9.md P1
 */
import { describe, expect, it } from 'vitest';

import { detectRenderMode } from '../src/env.ts';

function env(overrides: Readonly<Record<string, string | undefined>> = {}) {
  return overrides;
}

describe('detectRenderMode', () => {
  it('colour defaults to whatever isTty says, ascii/linear default off, and the size floor is 80x24, when no env var or flag is set', () => {
    expect(detectRenderMode(env(), [], true)).toEqual({
      color: true,
      ascii: false,
      linear: false,
      columns: 80,
      lines: 24,
    });
    expect(detectRenderMode(env(), [], false).color).toBe(false);
  });

  it('--ascii on argv turns on ascii mode', () => {
    const mode = detectRenderMode(env(), ['--ascii'], true);
    expect(mode.ascii).toBe(true);
  });

  it('FORGE_ASCII=1 turns on ascii mode identically to the --ascii flag', () => {
    const mode = detectRenderMode(env({ FORGE_ASCII: '1' }), [], true);
    expect(mode.ascii).toBe(true);
  });

  it('FORGE_ASCII set to anything other than "1" does not turn on ascii mode', () => {
    const mode = detectRenderMode(env({ FORGE_ASCII: '0' }), [], true);
    expect(mode.ascii).toBe(false);
  });

  it('--linear on argv turns on linear mode', () => {
    const mode = detectRenderMode(env(), ['--linear'], true);
    expect(mode.linear).toBe(true);
  });

  it('NO_COLOR set to any value (including an empty string, the real documented convention) turns colour off regardless of isTty', () => {
    expect(detectRenderMode(env({ NO_COLOR: '1' }), [], true).color).toBe(false);
    expect(detectRenderMode(env({ NO_COLOR: '' }), [], true).color).toBe(false);
  });

  it('FORCE_COLOR overrides a false isTty (the real "colour even though this is piped/non-interactive" case)', () => {
    const mode = detectRenderMode(env({ FORCE_COLOR: '1' }), [], false);
    expect(mode.color).toBe(true);
  });

  it('NO_COLOR overrides FORCE_COLOR when both are set', () => {
    const mode = detectRenderMode(env({ FORCE_COLOR: '1', NO_COLOR: '1' }), [], true);
    expect(mode.color).toBe(false);
  });

  it('TERM=dumb turns off colour AND turns on linear mode, even with isTty true and no other flags set', () => {
    const mode = detectRenderMode(env({ TERM: 'dumb' }), [], true);
    expect(mode.color).toBe(false);
    expect(mode.linear).toBe(true);
  });

  it('TERM=dumb still wins over an explicit FORCE_COLOR -- a dumb terminal cannot render colour regardless of what the user asks for', () => {
    const mode = detectRenderMode(env({ TERM: 'dumb', FORCE_COLOR: '1' }), [], true);
    expect(mode.color).toBe(false);
  });

  it('COLUMNS/LINES env vars are parsed as the real terminal size when set', () => {
    const mode = detectRenderMode(env({ COLUMNS: '132', LINES: '50' }), [], true);
    expect(mode.columns).toBe(132);
    expect(mode.lines).toBe(50);
  });

  it('a non-numeric or non-positive COLUMNS/LINES value falls back to the real 80x24 floor rather than propagating NaN or a nonsensical size', () => {
    expect(
      detectRenderMode(env({ COLUMNS: 'not-a-number', LINES: 'also-not' }), [], true),
    ).toMatchObject({ columns: 80, lines: 24 });
    expect(detectRenderMode(env({ COLUMNS: '0', LINES: '-5' }), [], true)).toMatchObject({
      columns: 80,
      lines: 24,
    });
  });

  it('a partially-numeric value (a real Number.parseInt trap -- it stops at the first non-digit rather than rejecting the rest) falls back to the real 80x24 floor, not a silently-truncated prefix', () => {
    // A fresh critic round reproduced this directly: naive Number.parseInt('1e10', 10) silently
    // returns 1, and Number.parseInt('80px', 10) silently returns 80 -- neither value the caller
    // actually supplied, and the latter happens to look "correct" purely by accident.
    expect(detectRenderMode(env({ COLUMNS: '1e10' }), [], true)).toMatchObject({ columns: 80 });
    expect(detectRenderMode(env({ COLUMNS: '80px' }), [], true)).toMatchObject({ columns: 80 });
  });

  it('an absurdly large, purely-digit COLUMNS/LINES value (no real terminal is remotely this size) falls back to the real 80x24 floor rather than an unbounded number', () => {
    expect(detectRenderMode(env({ COLUMNS: '99999999999999999999' }), [], true)).toMatchObject({
      columns: 80,
    });
    expect(detectRenderMode(env({ COLUMNS: '100001' }), [], true)).toMatchObject({ columns: 80 });
    // Just inside the real bound is accepted verbatim -- this is a sanity cap, not a narrower floor.
    expect(detectRenderMode(env({ COLUMNS: '100000' }), [], true)).toMatchObject({
      columns: 100_000,
    });
  });

  it('is a pure function of its own three parameters -- the identical input always produces the identical output', () => {
    const a = detectRenderMode(env({ NO_COLOR: '1' }), [], true);
    const b = detectRenderMode(env({ NO_COLOR: '1' }), [], true);
    expect(a).toEqual(b);
  });
});
