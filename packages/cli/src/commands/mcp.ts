/**
 * `forge mcp validate` — `03` §3.2.8, a thin wrapper over `@forge/extensions/mcp`'s own already-built
 * `validateMcpConfig` (M2).
 *
 * `.forge/config.yaml`'s own top-level `mcp` field (`@forge/schemas/config`'s own `mcpSchema`) is
 * deliberately left open (`servers: z.array(z.unknown())`) — the real, precise per-server shape lives
 * only in `@forge/extensions/mcp`'s own `mcpConfigSchema`, which this command validates the raw field
 * against. `forge mcp list/add` (any real mutation of the registered-server list) has no real
 * mechanism to wrap: `@forge/extensions/mcp` only ever parses+validates, it never lists or writes a
 * project's own configured servers — a real gap, documented rather than fabricated.
 *
 * @see specs/03 §3.2.8
 * @see specs/15 §15.5
 */
import { ForgeError, pathExists, readTextFile, type ProjectPaths } from '@forge/core';
import { configSchema } from '@forge/schemas/config';
import { validateMcpConfig, type McpValidationOutcome } from '@forge/extensions/mcp';
import * as YAML from 'yaml';

export interface McpCommandContext {
  readonly paths: ProjectPaths;
}

const CONFIG_REL_PATH = '.forge/config.yaml';

/** `validate --environment <env>` — the real, currently-configured `mcp` section, checked against
 * `@forge/extensions/mcp`'s own real structural rules for `environment`. */
export async function mcpValidate(
  ctx: McpCommandContext,
  environment: string,
): Promise<McpValidationOutcome> {
  // A critic round caught this reading straight through to `readTextFile` with no existence guard —
  // a project with no real `.forge/config.yaml` yet got a generic `RUN-034` I/O failure instead of
  // `config.ts`'s own real, specific `CFG-020` for the identical precondition on the identical file.
  if (!(await pathExists(ctx.paths.resolveWithin(CONFIG_REL_PATH)))) {
    throw new ForgeError('CFG-020', undefined);
  }
  const raw: unknown = YAML.parse(await readTextFile(ctx.paths.resolveWithin(CONFIG_REL_PATH)));
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ForgeError('CFG-001', { path: CONFIG_REL_PATH, line: 0 });
  }
  // `@forge/extensions/mcp`'s own `mcpConfigSchema` is `.strict()` over exactly `{servers, grants,
  // defaults}` -- `config.mcp`'s own real `adoptHostServers` field (a `.forge/config.yaml`-only
  // concept, not part of `15` §15.5.1's document shape) is dropped here rather than passed through,
  // so a real, otherwise-valid `mcp` section is not reported as schema-invalid over a field
  // `mcpConfigSchema` was never meant to know about.
  const { servers, grants, defaults } = result.data.mcp;
  return validateMcpConfig({ servers, grants, defaults }, { environment });
}

/** `list`/`add <server>` — no real mechanism exists anywhere in this codebase to enumerate or mutate a
 * project's own configured MCP servers beyond `forge config get/set mcp.servers` (raw YAML, already
 * real via `config.ts`); a dedicated, structured `forge mcp` mutation surface is a real, deliberate
 * gap this piece does not fabricate. */
export function mcpList(): never {
  throw new ForgeError('USR-003', { feature: 'mcp list' });
}
