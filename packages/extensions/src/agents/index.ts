/**
 * `@forge/extensions/agents` — agent overlays, roster composition, tool ceilings, per `15` §15.3.
 *
 * @see specs/15 §15.3
 * @see PLAN-M2.md P3
 */
export {
  checkToolCeiling,
  isEscalationRefused,
  mergeGrants,
  type CeilingResult,
  type CeilingViolation,
} from './ceiling.ts';
export {
  REQUIRED_ROLES,
  checkCustomAgents,
  checkRequiredRoles,
  checkSplitFileOwnership,
  isLevelAtLeast,
  type RoleViolation,
} from './roles.ts';
export {
  agentOverlaySchema,
  rosterConfigSchema,
  type AgentOverlay,
  type CustomAgent,
  type RosterConfig,
  type SplitSibling,
  type ToolGrantInput,
} from './schema.ts';
export {
  PROJECT_LEVEL_ORDER,
  type Escalation,
  type ProjectLevel,
  type RequiredRole,
  type ToolGrant,
} from './types.ts';
