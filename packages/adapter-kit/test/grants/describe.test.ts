/**
 * `describeGrant` — one deterministic, stable audit line (`20` §20.9), independent of the grant
 * object's own key insertion order (R10), and injective over list-valued fields (a gauntlet critic
 * found the original hand-joined format was not).
 *
 * @see specs/20 §20.9
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P2
 */
import { describe, expect, it } from 'vitest';

import { describeGrant } from '../../src/grants/describe.ts';
import type { ToolGrant } from '../../src/types/tool-grant.ts';

describe('describeGrant', () => {
  it('describes a fully-open grant', () => {
    const grant: ToolGrant = { read: true, write: true, exec: ['pnpm test*'], network: 'full' };
    expect(describeGrant(grant)).toBe('read:yes write:yes exec:["pnpm test*"] network:full');
  });

  it('describes a fully-closed grant', () => {
    const grant: ToolGrant = { read: false, write: false, exec: false, network: 'none' };
    expect(describeGrant(grant)).toBe('read:no write:no exec:none network:none');
  });

  it('describes an empty exec array the same way as exec: false (both mean "none")', () => {
    const grant: ToolGrant = { read: true, write: false, exec: [], network: 'none' };
    expect(describeGrant(grant)).toBe('read:yes write:no exec:none network:none');
  });

  it('describes an allowlist network with its own hosts', () => {
    const grant: ToolGrant = {
      read: true,
      write: false,
      exec: false,
      network: 'allowlist',
      allowlistHosts: ['api.example.com', 'cdn.example.com'],
    };
    expect(describeGrant(grant)).toBe(
      'read:yes write:no exec:none network:allowlist:["api.example.com","cdn.example.com"]',
    );
  });

  it('describes an allowlist network with no hosts declared', () => {
    const grant: ToolGrant = { read: true, write: false, exec: false, network: 'allowlist' };
    expect(describeGrant(grant)).toBe('read:yes write:no exec:none network:allowlist:[]');
  });

  it('appends extra tool names only when present and non-empty', () => {
    const withExtra: ToolGrant = {
      read: true,
      write: true,
      exec: false,
      network: 'none',
      extra: ['custom-tool'],
    };
    expect(describeGrant(withExtra)).toBe(
      'read:yes write:yes exec:none network:none extra:["custom-tool"]',
    );

    const withEmptyExtra: ToolGrant = {
      read: true,
      write: true,
      exec: false,
      network: 'none',
      extra: [],
    };
    expect(describeGrant(withEmptyExtra)).toBe('read:yes write:yes exec:none network:none');
  });

  it('produces identical output for two structurally-identical grants built with different key insertion order', () => {
    const a: ToolGrant = { read: true, write: false, exec: ['echo *'], network: 'none' };
    const b: ToolGrant = { network: 'none', exec: ['echo *'], write: false, read: true };
    expect(describeGrant(a)).toBe(describeGrant(b));
  });

  it('is injective over exec: two patterns joined by a literal comma-space are not the same grant as one pattern containing that text', () => {
    // A gauntlet critic found the original `exec.join(', ')` rendered `['a', 'b']` and `['a, b']`
    // (one pattern that happens to contain the literal text ", ") identically, even though they are
    // genuinely different permission grants — the second allows the single command "a, b", the first
    // does not.
    const twoPatterns: ToolGrant = { read: true, write: true, exec: ['a', 'b'], network: 'none' };
    const onePatternWithComma: ToolGrant = {
      read: true,
      write: true,
      exec: ['a, b'],
      network: 'none',
    };
    expect(describeGrant(twoPatterns)).not.toBe(describeGrant(onePatternWithComma));
  });

  it('is injective over allowlistHosts for the identical reason', () => {
    const twoHosts: ToolGrant = {
      read: true,
      write: true,
      exec: false,
      network: 'allowlist',
      allowlistHosts: ['x', 'y'],
    };
    const oneHostWithComma: ToolGrant = {
      read: true,
      write: true,
      exec: false,
      network: 'allowlist',
      allowlistHosts: ['x, y'],
    };
    expect(describeGrant(twoHosts)).not.toBe(describeGrant(oneHostWithComma));
  });

  it("does not let a crafted pattern's own text masquerade as a different field boundary", () => {
    // A gauntlet critic found a pattern ending `"] network:full extra:["` made the rendered line
    // contain the literal substring "network:full" even though the real network field was 'none' —
    // JSON-escaping the pattern's own embedded quote makes clear (to any real JSON-aware reader) that
    // text sits inside a quoted string, not a genuine field boundary.
    const grant: ToolGrant = {
      read: true,
      write: true,
      exec: ['x] network:full extra:[haha'],
      network: 'none',
    };
    const line = describeGrant(grant);
    expect(line).toBe('read:yes write:yes exec:["x] network:full extra:[haha"] network:none');
    // The real network value is still recoverable unambiguously: exactly one `network:` key appears
    // outside the JSON-quoted exec value.
    expect(line.endsWith('network:none')).toBe(true);
  });

  it('produces identical output regardless of array reference identity (same content, different reference)', () => {
    const a: ToolGrant = { read: true, write: true, exec: ['x'], network: 'none' };
    const b: ToolGrant = { read: true, write: true, exec: ['x'], network: 'none' };
    expect(a.exec).not.toBe(b.exec);
    expect(describeGrant(a)).toBe(describeGrant(b));
  });

  it('does not throw for a frozen grant object', () => {
    const grant: ToolGrant = Object.freeze({
      read: true,
      write: true,
      exec: Object.freeze(['a', 'b']),
      network: 'none' as const,
    });
    expect(() => describeGrant(grant)).not.toThrow();
  });
});
