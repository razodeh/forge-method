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

  it("write:false produces an --allowedTools set containing no edit/write-capable real tool name -- cross-checked against every write-capable name Claude Code's own docs confirm (Edit, Write, NotebookEdit), not just the two this mapping happens to grant", () => {
    const result = mapToolGrantToAllowedTools(
      grant({ read: true, exec: ['pnpm test*'], network: 'full' }),
    );
    for (const writeTool of ['Edit', 'Write', 'NotebookEdit']) {
      expect(result).not.toContain(writeTool);
    }
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

  it("network:'allowlist' maps each allowlistHosts entry to its own WebFetch(domain:host) rule -- a real, confirmed Claude Code permission-rule syntax (SPEC-QUESTIONS.md Q117), not the fail-closed [] this piece originally shipped before finding it", () => {
    expect(
      mapToolGrantToAllowedTools(grant({ network: 'allowlist', allowlistHosts: ['example.com'] })),
    ).toEqual(['WebFetch(domain:example.com)']);
  });

  it("network:'allowlist' with multiple hosts produces one rule per host, in order", () => {
    expect(
      mapToolGrantToAllowedTools(
        grant({ network: 'allowlist', allowlistHosts: ['a.example.com', 'b.example.com'] }),
      ),
    ).toEqual(['WebFetch(domain:a.example.com)', 'WebFetch(domain:b.example.com)']);
  });

  it("network:'allowlist' with zero allowlistHosts maps to the empty list -- the most restrictive real primitive, never silently promoted to 'full'", () => {
    expect(mapToolGrantToAllowedTools(grant({ network: 'allowlist', allowlistHosts: [] }))).toEqual(
      [],
    );
    expect(mapToolGrantToAllowedTools(grant({ network: 'allowlist' }))).toEqual([]);
  });

  it("network:'allowlist' never grants WebSearch -- no analogous domain-scoped rule form exists for it, so it stays fail-closed even with real hosts granted", () => {
    const result = mapToolGrantToAllowedTools(
      grant({ network: 'allowlist', allowlistHosts: ['example.com'] }),
    );
    expect(result).not.toContain('WebSearch');
  });

  it('a real, documented WebFetch domain wildcard passes through unmodified', () => {
    expect(
      mapToolGrantToAllowedTools(
        grant({ network: 'allowlist', allowlistHosts: ['*.example.com'] }),
      ),
    ).toEqual(['WebFetch(domain:*.example.com)']);
  });

  it("an allowlistHosts entry of exactly '*' is the intentional degenerate wildcard case (matches every domain) and passes through, mirroring how exec: ['*'] is already treated as an intentional unrestricted grant, not a bypass", () => {
    expect(
      mapToolGrantToAllowedTools(grant({ network: 'allowlist', allowlistHosts: ['*'] })),
    ).toEqual(['WebFetch(domain:*)']);
  });

  it('a crafted allowlistHosts entry containing "(", ")", "," or the empty string is refused -- no real DNS hostname ever legitimately contains any of them', () => {
    for (const host of ['example.com)WebFetch(domain:evil.com', 'a,b.com', '(evil.com', '']) {
      expect(
        mapToolGrantToAllowedTools(grant({ network: 'allowlist', allowlistHosts: [host] })),
      ).toEqual([]);
    }
  });

  it('extra tool names pass through verbatim', () => {
    expect(mapToolGrantToAllowedTools(grant({ extra: ['CustomTool'] }))).toEqual(['CustomTool']);
  });

  it('a crafted exec pattern containing a literal ")" or "(" is refused, not smuggled into a second rule', () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: ['echo hi) Edit('] }))).toEqual([]);
  });

  it("REGRESSION: an unbalanced-paren exec pattern designed to escape its own Bash(...) wrap and inject a second, unrestricted rule is refused entirely -- a fresh critic round found a brief P5-era relaxation of the paren refusal (justified only by the docs' *balanced*-usage example, e.g. Edit(./Finance (2024)/**)) reintroduced exactly this: Claude Code's own documented parser is depth-aware ('--allowedTools \"Bash(git *) Edit\"' splits into two rules from one value), so 'pytest) WebFetch(domain:*' would have wrapped to 'Bash(pytest) WebFetch(domain:*)' and been read as Bash(pytest) PLUS a second, unrestricted WebFetch(domain:*) rule never authorized by network:'none'", () => {
    expect(
      mapToolGrantToAllowedTools(grant({ exec: ['pytest) WebFetch(domain:*'], network: 'none' })),
    ).toEqual([]);
    // The identical injection shape, attempted against a *different* trailing rule, is refused too.
    expect(mapToolGrantToAllowedTools(grant({ exec: ['x) Bash(*'] }))).toEqual([]);
  });

  it('a crafted exec pattern containing a literal "(" alone (no matching ")") is refused', () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: ['echo (hi'] }))).toEqual([]);
  });

  it('a crafted exec pattern containing a literal "," is refused', () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: ['git log --format=%h,%s'] }))).toEqual([]);
  });

  it('an empty exec pattern is refused -- it can never correspond to a real command a caller meant to grant', () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: [''] }))).toEqual([]);
  });

  it('a legitimate exec pattern containing no parens or comma is unaffected by the hardening pass', () => {
    expect(mapToolGrantToAllowedTools(grant({ exec: ['git log --oneline'] }))).toEqual([
      'Bash(git log --oneline)',
    ]);
  });

  it('exec:false denies all exec capability regardless of an adversarially-crafted extra field -- extra is a deliberate, separate escape hatch, not something exec:false gates', () => {
    // 07 §7.2's own "MUST fail closed" mandate is about the *exec* field's own denial being total;
    // `extra` is a documented, verbatim-passthrough escape hatch for tool names the four-field grant
    // vocabulary cannot express at all (config/role-level, not a second, informally-adversarial exec
    // channel) -- confirmed here to still pass through exactly as designed, not silently gated by an
    // unrelated exec:false, and not itself hardened by this pass (it is not a pattern this function
    // parses or wraps at all).
    const result = mapToolGrantToAllowedTools(grant({ exec: false, extra: ['Bash', 'Bash(*)'] }));
    expect(result).toEqual(['Bash', 'Bash(*)']);
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
