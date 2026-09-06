/**
 * `validateMcpConfig` — `15` §15.5.2's structural rules that do not require a live session (secret
 * *resolution*, the injection *runtime* strip, and actual server handshakes all need a running
 * adapter and are out of scope here, per §15.5.1's own model paragraph).
 *
 * @see specs/15 §15.5.2
 * @see specs/15 §15.5.3
 * @see PLAN-M2.md P5
 * @see SPEC-QUESTIONS.md Q34
 */
import { SECRET_PATTERNS } from '../skills/patterns.ts';
import {
  SECRET_REFERENCE_PATTERN,
  mcpConfigSchema,
  type McpConfigShape,
  type McpServer,
} from './schema.ts';
import type { McpValidationFinding, McpValidationOutcome, ValidateMcpOptions } from './types.ts';

/**
 * `15` §15.5.2 rule 3: write-capable servers may never be granted to these roles — "the roles whose
 * value depends on them being observers." Matching a role's own `tools` capability class against a
 * write grant needs the agent roster (`@forge/extensions/agents`, P3), which this piece does not take
 * as input; only the absolute, roster-independent half of rule 3 is enforced here.
 */
const WRITE_DENIED_ROLES = new Set(['reviewer', 'critic', 'diagnostician']);

function isSecretShapedLiteral(value: string): boolean {
  if (SECRET_REFERENCE_PATTERN.test(value)) return false;
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function checkSecretLiterals(server: McpServer): McpValidationFinding[] {
  const findings: McpValidationFinding[] = [];
  if (server.transport === 'stdio') {
    for (const [key, value] of Object.entries(server.env ?? {})) {
      if (isSecretShapedLiteral(value)) {
        findings.push({
          severity: 'error',
          code: 'secret-literal',
          message: `Server "${server.id}" env "${key}" looks like a literal secret, not a "\${secret:<name>}" reference.`,
        });
      }
    }
    for (const arg of server.args ?? []) {
      if (isSecretShapedLiteral(arg)) {
        findings.push({
          severity: 'error',
          code: 'secret-literal',
          message: `Server "${server.id}" has an arg that looks like a literal secret, not a "\${secret:<name>}" reference.`,
        });
      }
    }
  }
  return findings;
}

/**
 * `15` §15.5.5's commands (`forge mcp grant <id>`, `forge mcp revoke <id>`) address a server by `id`
 * as a registry key — a second `servers` entry reusing an already-declared `id` is silently collapsed
 * by last-write-wins in a plain `Map`/object lookup, which could substitute a differently-configured
 * server (a wider `trust`, `readOnly: false`) for one an author or overlay believes is still in
 * effect, with nothing in the outcome to say so.
 */
function checkDuplicateServerIds(servers: readonly McpServer[]): McpValidationFinding[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const server of servers) {
    if (seen.has(server.id)) duplicates.add(server.id);
    seen.add(server.id);
  }
  return [...duplicates].map((id) => ({
    severity: 'error',
    code: 'duplicate-server-id',
    message: `Server id "${id}" is declared more than once in "servers".`,
  }));
}

function isActiveInEnvironment(server: McpServer, environment: string): boolean {
  if (server.environments !== undefined && !server.environments.includes(environment)) return false;
  if (environment === 'production' && !server.readOnly) return false;
  return true;
}

/**
 * Validates `config`, never throwing — the same "boundary input produces a typed outcome" precedent
 * `@forge/schemas` established (`SPEC-QUESTIONS.md` Q3) and P4's `validateSkill` reused.
 */
export function validateMcpConfig(
  config: unknown,
  options: ValidateMcpOptions,
): McpValidationOutcome {
  const parsed = mcpConfigSchema.safeParse(config);
  if (!parsed.success) {
    const findings: McpValidationFinding[] = parsed.error.issues.map((issue) => ({
      severity: 'error',
      code: 'schema',
      message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    }));
    return { valid: false, findings, effectiveGrants: {} };
  }

  return validateParsedConfig(parsed.data, options);
}

function validateParsedConfig(
  config: McpConfigShape,
  options: ValidateMcpOptions,
): McpValidationOutcome {
  const findings: McpValidationFinding[] = [...checkDuplicateServerIds(config.servers)];
  const servers = new Map(config.servers.map((server) => [server.id, server]));
  const grantMode = config.defaults?.grantMode ?? 'explicit';

  for (const server of config.servers) {
    findings.push(...checkSecretLiterals(server));
  }

  const effectiveGrants: Record<string, Record<string, readonly string[] | '*'>> = {};

  for (const [role, byServer] of Object.entries(config.grants ?? {})) {
    for (const [serverId, tools] of Object.entries(byServer)) {
      const server = servers.get(serverId);
      if (server === undefined) {
        findings.push({
          severity: 'error',
          code: 'unknown-server',
          message: `Role "${role}" is granted server "${serverId}", which is not declared in "servers".`,
        });
        continue;
      }

      if (tools === '*' && grantMode !== 'server-wide') {
        findings.push({
          severity: 'error',
          code: 'unauthorized-server-wide-grant',
          message: `Role "${role}" has a server-wide grant to "${serverId}", which requires "defaults.grantMode: server-wide".`,
        });
        continue;
      }

      if (!server.readOnly && WRITE_DENIED_ROLES.has(role)) {
        findings.push({
          severity: 'error',
          code: 'write-grant-denied',
          message: `Role "${role}" cannot be granted write-capable server "${serverId}" — its value depends on being an observer.`,
        });
        continue;
      }

      if (!isActiveInEnvironment(server, options.environment)) continue;

      effectiveGrants[role] ??= {};
      effectiveGrants[role][serverId] = tools;
    }
  }

  return {
    valid: !findings.some((finding) => finding.severity === 'error'),
    findings,
    effectiveGrants,
  };
}
