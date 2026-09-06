/**
 * Shared types for `@forge/extensions/mcp` — `15` §15.5's MCP registry and grants.
 *
 * @see specs/15 §15.5
 * @see PLAN-M2.md P5
 */
export type McpFindingSeverity = 'warning' | 'error';

export type McpFindingCode =
  | 'schema'
  | 'duplicate-server-id'
  | 'unknown-server'
  | 'write-grant-denied'
  | 'unauthorized-server-wide-grant'
  | 'secret-literal';

export interface McpValidationFinding {
  readonly severity: McpFindingSeverity;
  readonly code: McpFindingCode;
  readonly message: string;
}

/** A role's resolved per-server tool grants, after environment scoping (`15` §15.5.2 rule 4). */
export type EffectiveGrants = Readonly<
  Record<string, Readonly<Record<string, readonly string[] | '*'>>>
>;

export interface ValidateMcpOptions {
  /** The run's target environment (e.g. `'dev'`, `'staging'`, `'production'`) — never inferred. */
  readonly environment: string;
}

export interface McpValidationOutcome {
  readonly valid: boolean;
  readonly findings: readonly McpValidationFinding[];
  readonly effectiveGrants: EffectiveGrants;
}
