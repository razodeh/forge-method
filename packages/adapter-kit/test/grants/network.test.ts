/**
 * `isHostAllowed` — `07` §7.2's own fail-closed mandate over `network`/`allowlistHosts`.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P2
 */
import { describe, expect, it } from 'vitest';

import { isHostAllowed } from '../../src/grants/network.ts';
import type { ToolGrant } from '../../src/types/tool-grant.ts';

function grant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return { read: true, write: true, exec: false, network: 'none', ...overrides };
}

describe('isHostAllowed', () => {
  it('denies every host when network is none', () => {
    expect(isHostAllowed(grant({ network: 'none' }), 'api.example.com')).toBe(false);
  });

  it('allows every host when network is full', () => {
    expect(isHostAllowed(grant({ network: 'full' }), 'anything.example.com')).toBe(true);
  });

  it('allows a host named in allowlistHosts under allowlist', () => {
    const g = grant({ network: 'allowlist', allowlistHosts: ['api.example.com'] });
    expect(isHostAllowed(g, 'api.example.com')).toBe(true);
  });

  it('denies a host not named in allowlistHosts under allowlist', () => {
    const g = grant({ network: 'allowlist', allowlistHosts: ['api.example.com'] });
    expect(isHostAllowed(g, 'evil.example.com')).toBe(false);
  });

  it('denies every host under allowlist when allowlistHosts is absent (fail closed)', () => {
    expect(isHostAllowed(grant({ network: 'allowlist' }), 'api.example.com')).toBe(false);
  });

  it('denies every host under allowlist when allowlistHosts is an empty array', () => {
    const g = grant({ network: 'allowlist', allowlistHosts: [] });
    expect(isHostAllowed(g, 'api.example.com')).toBe(false);
  });

  it('matches a host case-insensitively (DNS hostnames are case-insensitive, RFC 4343)', () => {
    // A gauntlet critic found the original exact-string comparison would silently, permanently deny
    // the DNS-identical host 'api.example.com' against an allowlist entry spelled 'API.example.com'.
    const g = grant({ network: 'allowlist', allowlistHosts: ['API.example.com'] });
    expect(isHostAllowed(g, 'api.example.com')).toBe(true);
    expect(isHostAllowed(g, 'API.EXAMPLE.COM')).toBe(true);
    expect(isHostAllowed(g, 'ApI.eXaMpLe.CoM')).toBe(true);
  });

  it('denies a host that is a substring of an allowlisted one', () => {
    const g = grant({ network: 'allowlist', allowlistHosts: ['api.example.com'] });
    expect(isHostAllowed(g, 'api.example')).toBe(false);
  });

  it('denies a host that is a superstring of an allowlisted one', () => {
    const g = grant({ network: 'allowlist', allowlistHosts: ['api.example.com'] });
    expect(isHostAllowed(g, 'evil-api.example.com')).toBe(false);
    expect(isHostAllowed(g, 'api.example.com.evil.com')).toBe(false);
  });
});
