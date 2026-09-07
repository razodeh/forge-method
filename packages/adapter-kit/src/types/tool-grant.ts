/**
 * `ToolGrant` — `07` §7.2's own FORGE-neutral permission grant, verbatim; a concrete adapter maps this
 * onto its own platform's permission syntax (`@forge/adapter-kit/grants` gives generic helpers for
 * doing so — `SPEC-QUESTIONS.md` Q58 point 13 for `exec`'s own pattern language).
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P1
 */
export interface ToolGrant {
  readonly read: boolean;
  readonly write: boolean;
  /** `false` denies every command; otherwise a list of patterns (`SPEC-QUESTIONS.md` Q58 point 13:
   * an exact match, or a single trailing `*` as a prefix wildcard — not a full glob engine). */
  readonly exec: readonly string[] | false;
  readonly network: 'none' | 'allowlist' | 'full';
  readonly allowlistHosts?: readonly string[];
  /** Adapter-specific tool names, escape hatch — `07` §7.2's own words. */
  readonly extra?: readonly string[];
}
