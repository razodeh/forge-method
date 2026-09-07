/**
 * `isExecAllowed` — `07` §7.2's own fail-closed mandate: exact match, prefix-wildcard match, `false`
 * denies everything, an empty allowlist denies everything too.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P2
 */
import { describe, expect, it } from 'vitest';

import { isExecAllowed } from '../../src/grants/exec.ts';
import type { ToolGrant } from '../../src/types/tool-grant.ts';

function grant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return { read: true, write: true, exec: [], network: 'none', ...overrides };
}

describe('isExecAllowed', () => {
  it('allows an exact match', () => {
    expect(isExecAllowed(grant({ exec: ['git status'] }), 'git status')).toBe(true);
  });

  it('denies a near-miss that is not an exact match (no trailing wildcard)', () => {
    expect(isExecAllowed(grant({ exec: ['git status'] }), 'git status --short')).toBe(false);
  });

  it('allows a prefix-wildcard match', () => {
    expect(isExecAllowed(grant({ exec: ['pnpm test*'] }), 'pnpm test -- packages/kb')).toBe(true);
  });

  it('allows the exact prefix itself when the pattern has a trailing wildcard', () => {
    expect(isExecAllowed(grant({ exec: ['git diff*'] }), 'git diff')).toBe(true);
  });

  it('denies a command the wildcard prefix does not actually match', () => {
    expect(isExecAllowed(grant({ exec: ['pnpm test*'] }), 'pnpm install')).toBe(false);
  });

  it('denies everything when exec is false', () => {
    expect(isExecAllowed(grant({ exec: false }), 'echo hi')).toBe(false);
  });

  it('denies everything when exec is an empty array (fail closed, not "everything")', () => {
    expect(isExecAllowed(grant({ exec: [] }), 'echo hi')).toBe(false);
  });

  it('allows a command matching any one of several patterns', () => {
    const g = grant({ exec: ['pnpm test*', 'git diff*', 'echo hi'] });
    expect(isExecAllowed(g, 'git diff --stat')).toBe(true);
    expect(isExecAllowed(g, 'echo hi')).toBe(true);
    expect(isExecAllowed(g, 'rm -rf /')).toBe(false);
  });

  it('treats a `*` in the middle of a pattern as a literal character, not a wildcard', () => {
    // Not a general glob engine (SPEC-QUESTIONS.md Q58 point 13) — only a trailing `*` is a wildcard.
    expect(isExecAllowed(grant({ exec: ['a*b'] }), 'axb')).toBe(false);
    expect(isExecAllowed(grant({ exec: ['a*b'] }), 'a*b')).toBe(true);
  });

  it('is case-sensitive (unlike host matching — a shell command is not case-insensitive the way a DNS hostname is)', () => {
    expect(isExecAllowed(grant({ exec: ['pnpm test*'] }), 'Pnpm Test')).toBe(false);
    expect(isExecAllowed(grant({ exec: ['PNPM TEST*'] }), 'pnpm test foo')).toBe(false);
  });

  it('treats every pattern as a plain string, never a RegExp — regex metacharacters match only literally', () => {
    // A pattern with no trailing `*` must match exactly; none of these regex-special characters give
    // it any special meaning, confirming this is genuinely string comparison, not new RegExp(pattern).
    expect(isExecAllowed(grant({ exec: ['a.b'] }), 'axb')).toBe(false);
    expect(isExecAllowed(grant({ exec: ['a.b'] }), 'a.b')).toBe(true);
    expect(isExecAllowed(grant({ exec: ['a(b|c)'] }), 'ab')).toBe(false);
    expect(isExecAllowed(grant({ exec: ['a(b|c)'] }), 'a(b|c)')).toBe(true);
    expect(isExecAllowed(grant({ exec: ['a[bc]+*'] }), 'abbbb')).toBe(false);
    expect(isExecAllowed(grant({ exec: ['a[bc]+*'] }), 'a[bc]+xyz')).toBe(true);
  });

  it('never throws for a pattern that would be an invalid RegExp if ever passed to new RegExp() (proof it never is)', () => {
    expect(() => isExecAllowed(grant({ exec: ['a+*('] }), 'a+*(')).not.toThrow();
    expect(isExecAllowed(grant({ exec: ['a+*('] }), 'a+*(')).toBe(true);
  });

  it('treats a bare "*" pattern as an empty prefix, granting unrestricted exec (degenerate case of the trailing-wildcard rule, not a bypass — a gauntlet verify pass flagged this as worth making explicit)', () => {
    const g = grant({ exec: ['*'] });
    expect(isExecAllowed(g, 'rm -rf /')).toBe(true);
    expect(isExecAllowed(g, '')).toBe(true);
    expect(isExecAllowed(g, 'anything at all')).toBe(true);
  });
});
