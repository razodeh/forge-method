/**
 * `@forge/adapter-kit/types` — `07` §7.2's `PlatformAdapter` interface and every type it references.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P1
 */
export type { PlatformAdapter } from './adapter.ts';
export type { AssetContext, InstalledAsset } from './assets.ts';
export type { AdapterCapabilities } from './capabilities.ts';
export {
  FORGE_CONTROL_TOKENS,
  type ForgeControlToken,
  type ParsedControlToken,
} from './control-tokens.ts';
export type { AdapterEvent } from './events.ts';
export type { JSONSchema } from './json-schema.ts';
export type { ModelInfo, PreflightContext, PreflightIssue, PreflightResult } from './preflight.ts';
export type {
  GrantedMcpServer,
  McpProvisioning,
  ResolvedSkill,
  SessionContext,
  SkillProvisioning,
} from './provisioning.ts';
export type {
  ResumeRequest,
  SessionAttachment,
  SessionHandle,
  SessionLimits,
  SessionRequest,
  SessionResult,
  SessionUsage,
} from './session.ts';
export type { StructuredRequest } from './structured.ts';
export type { ToolGrant } from './tool-grant.ts';
