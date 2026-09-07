/**
 * `isExecAllowed` — `07` §7.2's own tool-grant-mapping mandate ("Adapters MUST fail closed") over
 * `ToolGrant.exec` specifically: a shared, single implementation any concrete adapter (M7, M11) calls
 * rather than reimplementing its own command-pattern matching.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P2
 */
import type { ToolGrant } from '../types/tool-grant.ts';

/** A single trailing-`*`-wildcard prefix match (`"pnpm test*"` matches any command starting `"pnpm
 * test"`); a pattern with no `*` must match exactly — `07` §7.2's own two worked examples (`"pnpm
 * test*"`, `"git diff*"`) are both this shape and neither needs more (`SPEC-QUESTIONS.md` Q58 point
 * 13). A `*` anywhere but the final character is treated as a literal character, not a wildcard — this
 * is a prefix match, not a general glob engine.
 *
 * A pattern that is exactly `"*"` is the degenerate case of this same rule (an empty prefix, which
 * every command starts with) and therefore matches every command unconditionally — an adapter author
 * granting `exec: ['*']` is granting unrestricted exec, not some narrower single-character match. This
 * is intentional (the natural reading of "trailing `*` = prefix wildcard"), not a bypass, but is called
 * out here because this module exists to draw a security boundary and the degenerate case is easy to
 * grant by accident. */
function matchesExecPattern(pattern: string, command: string): boolean {
  if (pattern.endsWith('*')) return command.startsWith(pattern.slice(0, -1));
  return command === pattern;
}

/** `false` denies every command (`ToolGrant.exec === false`); an empty pattern list denies every
 * command too — the same fail-closed reading `07` §7.2 mandates for a grant that "cannot be expressed,"
 * not "everything is implicitly allowed." Otherwise, `true` when `command` matches at least one
 * pattern in `grant.exec`. */
export function isExecAllowed(grant: ToolGrant, command: string): boolean {
  if (grant.exec === false) return false;
  return grant.exec.some((pattern) => matchesExecPattern(pattern, command));
}
