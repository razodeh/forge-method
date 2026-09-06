/**
 * Types for `@forge/extensions/agents` — `15` §15.3's agent customization surface.
 *
 * @see specs/15 §15.3
 * @see PLAN-M2.md P3
 */

/**
 * A project's own scale tier — `15` §15.3.3's "L1+"/"L2+" role-requirement notation, and `10`'s
 * `module.yaml` `levels: [...]`. A distinct axis from `@forge/extensions/resolve`'s `Layer`
 * (`SPEC-QUESTIONS.md` Q32 records why these are not the same type despite sharing notation): this is
 * "how elaborate a process this project runs," that is "which customization layer supplied a field."
 */
export const PROJECT_LEVEL_ORDER = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type ProjectLevel = (typeof PROJECT_LEVEL_ORDER)[number];

/** `15` §15.3.2's ceiling/grant shape, read off `19` §19.1's `module.yaml` worked example. */
export interface ToolGrant {
  readonly write?: boolean;
  readonly exec?: readonly string[];
  readonly network?: 'none' | 'allowlist' | 'full';
  readonly deploy?: boolean;
  readonly allowlistHosts?: readonly string[];
}

/** `15` §15.3.2's `security.toolCeilingEscalations` entry. */
export interface Escalation {
  readonly agent: string;
  readonly grant: ToolGrant;
  readonly reason: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly expires: string;
}

/** A role `15` §15.3.3 requires present (at or above `minLevel`) unless explicitly exempted. */
export interface RequiredRole {
  readonly role: string;
  readonly minLevel: ProjectLevel;
}
