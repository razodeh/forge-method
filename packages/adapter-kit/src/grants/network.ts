/**
 * `isHostAllowed` — `07` §7.2's own tool-grant-mapping mandate over `ToolGrant.network`/
 * `allowlistHosts` specifically.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P2
 */
import type { ToolGrant } from '../types/tool-grant.ts';

/** `'none'` denies every host; `'full'` allows every host; `'allowlist'` allows only a host named in
 * `grant.allowlistHosts` — an absent (or empty) `allowlistHosts` under `'allowlist'` denies every host,
 * fail-closed, never silently permissive.
 *
 * Compared case-insensitively (`.toLowerCase()` on both sides): a gauntlet critic found the original
 * exact-string comparison meant a hand-authored allowlist entry like `'API.example.com'` would
 * silently, permanently deny the DNS-identical host `'api.example.com'` — DNS hostnames are themselves
 * case-insensitive (RFC 4343), so two spellings differing only in case name the same real-world host;
 * treating them as different hosts denies real, intended traffic rather than granting anything a
 * case-sensitive comparison would not already have covered under the "same host, different case"
 * reading. This widens what a given `allowlistHosts` entry matches, but only along the one dimension
 * (letter case) that does not change *which real host* is being named — it is not a new capability. */
export function isHostAllowed(grant: ToolGrant, host: string): boolean {
  if (grant.network === 'none') return false;
  if (grant.network === 'full') return true;
  const target = host.toLowerCase();
  return (grant.allowlistHosts ?? []).some((allowed) => allowed.toLowerCase() === target);
}
