/**
 * `@forge/extensions/mcp` — MCP server registry parsing and grant validation, per `15` §15.5.
 *
 * @see specs/15 §15.5
 * @see PLAN-M2.md P5
 */
export {
  SECRET_REFERENCE_PATTERN,
  mcpConfigSchema,
  mcpGrantsSchema,
  mcpServerSchema,
  secretReferenceSchema,
  type McpConfigShape,
  type McpGrants,
  type McpServer,
  type ToolGrantValue,
} from './schema.ts';
export {
  type EffectiveGrants,
  type McpFindingCode,
  type McpFindingSeverity,
  type McpValidationFinding,
  type McpValidationOutcome,
  type ValidateMcpOptions,
} from './types.ts';
export { validateMcpConfig } from './validate.ts';
