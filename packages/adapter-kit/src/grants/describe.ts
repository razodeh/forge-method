/**
 * `describeGrant` — one deterministic, stable line summarising a `ToolGrant`, for `20` §20.9's own
 * "every tool-ceiling escalation... shown in the TUI header" and "every policy violation, blocked
 * injection... reportable" audit lines. Reads `grant`'s own named fields directly (never
 * `Object.keys`/`Object.entries`), so the output cannot depend on the grant object's own key insertion
 * order (R10) — there is nothing to depend on, since every field is addressed by name.
 *
 * List-valued fields (`exec`, `allowlistHosts`, `extra`) are `JSON.stringify`'d, not hand-joined with
 * `', '` — a gauntlet critic found the original `join(', ')` was not injective: `exec: ['a', 'b']` and
 * `exec: ['a, b']` (one pattern that happens to contain the literal text `", "`) both rendered as
 * `exec:[a, b]`, even though they are genuinely different permission grants (the second allows the
 * single command `"a, b"`; the first does not). The same unescaped join also let a crafted pattern's
 * own text look like it closed the array and started a *different* field (e.g. a pattern ending
 * `"] network:full extra:["` made the rendered line contain the literal substring `"network:full"`
 * even when the real `network` field was `'none'`) — a real risk for a string whose whole purpose is
 * to be a trustworthy audit/security log line. `JSON.stringify` on an array of strings is injective
 * (distinct string arrays always serialise to distinct JSON text, since every element's own quotes and
 * backslashes are escaped) and gives every field a real, unambiguous boundary.
 *
 * @see specs/20 §20.9
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P2
 */
import type { ToolGrant } from '../types/tool-grant.ts';

function describeExec(exec: ToolGrant['exec']): string {
  if (exec === false || exec.length === 0) return 'none';
  return JSON.stringify(exec);
}

function describeNetwork(grant: ToolGrant): string {
  if (grant.network !== 'allowlist') return grant.network;
  const hosts = grant.allowlistHosts ?? [];
  return hosts.length === 0 ? 'allowlist:[]' : `allowlist:${JSON.stringify(hosts)}`;
}

export function describeGrant(grant: ToolGrant): string {
  const parts = [
    `read:${grant.read ? 'yes' : 'no'}`,
    `write:${grant.write ? 'yes' : 'no'}`,
    `exec:${describeExec(grant.exec)}`,
    `network:${describeNetwork(grant)}`,
  ];
  if (grant.extra !== undefined && grant.extra.length > 0) {
    parts.push(`extra:${JSON.stringify(grant.extra)}`);
  }
  return parts.join(' ');
}
