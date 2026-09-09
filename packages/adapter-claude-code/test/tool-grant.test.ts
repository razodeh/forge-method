/**
 * `mapToolGrantToAllowedTools`/`mapPermissionModeForCli`/`mapPermissionModeForSdk` — `07` §7.2's own
 * fail-closed tool-grant mapping.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see PLAN-M7.md P2, P3, P5
 */
import { describe, expect, it } from 'vitest';

import {
  mapPermissionModeForCli,
  mapPermissionModeForSdk,
  mapToolGrantToAllowedTools,
} from '../src/tool-grant.ts';
import type { SessionRequest } from '@forge/adapter-kit';

function grant(overrides: Partial<SessionRequest['tools']> = {}): SessionRequest['tools'] {
  return { read: false, write: false, exec: false, network: 'none', ...overrides };
}

describe('mapToolGrantToAllowedTools', () => {
  it('an all-denied grant produces an empty list, never omitting the flag entirely', () => {
    expect(mapToolGrantToAllowedTools(grant())).toEqual([]);
  });

  it('read:true includes Read', () => {
    expect(mapToolGrantToAllowedTools(grant({ read: true }))).toEqual(['Read']);
  });

  it('write:true includes Edit and Write', () => {
    expect(mapToolGrantToAllowedTools(grant({ write: true }))).toEqual(['Edit', 'Write']);
  });

  it("07 §7.3's own worked example: exec:['pnpm test*'] maps to Bash(pnpm test*)", () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: ['pnpm test*'] }))).toEqual([
      'Bash(pnpm test*)',
    ]);
  });

  it("07 §7.3's own second worked example: exec:['git diff*'] maps to Bash(git diff*)", () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: ['git diff*'] }))).toEqual(['Bash(git diff*)']);
  });

  it('multiple exec patterns each become their own Bash(...) rule', () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: ['pnpm test*', 'git diff*'] }))).toEqual([
      'Bash(pnpm test*)',
      'Bash(git diff*)',
    ]);
  });

  it("network:'full' includes WebFetch and WebSearch", () => {
    expect(mapToolGrantToAllowedTools(grant({ network: 'full' }))).toEqual([
      'WebFetch',
      'WebSearch',
    ]);
  });

  it("network:'allowlist' is treated fail-closed, identically to 'none' -- no confirmed per-host syntax exists", () => {
    expect(
      mapToolGrantToAllowedTools(grant({ network: 'allowlist', allowlistHosts: ['example.com'] })),
    ).toEqual([]);
  });

  it('extra tool names pass through verbatim', () => {
    expect(mapToolGrantToAllowedTools(grant({ extra: ['CustomTool'] }))).toEqual(['CustomTool']);
  });

  it('a crafted exec pattern containing a literal ")" is refused, not smuggled into a second rule', () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: ['echo hi) Edit('] }))).toEqual([]);
  });

  it('a crafted exec pattern containing a literal "(" is refused', () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: ['echo (hi'] }))).toEqual([]);
  });

  it('a full grant combines every category in a stable order', () => {
    const result = mapToolGrantToAllowedTools(
      grant({ read: true, write: true, exec: ['pnpm test*'], network: 'full' }),
    );
    expect(result).toEqual(['Read', 'Edit', 'Write', 'Bash(pnpm test*)', 'WebFetch', 'WebSearch']);
  });
});

describe('mapPermissionModeForCli', () => {
  it.each([
    ['deny-unlisted', 'dontAsk'],
    ['accept-edits', 'acceptEdits'],
    ['auto', 'auto'],
    ['manual', 'manual'],
  ] as const)('%s maps to the real, confirmed --permission-mode value %s', (mode, expected) => {
    expect(mapPermissionModeForCli(mode)).toBe(expected);
  });
});

describe('mapPermissionModeForSdk', () => {
  it.each([
    ['deny-unlisted', 'dontAsk'],
    ['accept-edits', 'acceptEdits'],
    ['auto', 'auto'],
  ] as const)(
    '%s maps to the same real, confirmed value as the CLI transport: %s',
    (mode, expected) => {
      expect(mapPermissionModeForSdk(mode)).toBe(expected);
    },
  );

  it("'manual' maps to the SDK's own real 'default' spelling, NOT the CLI transport's 'manual' -- the one real vocabulary difference between the two transports", () => {
    expect(mapPermissionModeForSdk('manual')).toBe('default');
    expect(mapPermissionModeForCli('manual')).toBe('manual');
  });
});
