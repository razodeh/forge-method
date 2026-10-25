#!/usr/bin/env node
/**
 * A real, minimal MCP stdio server — C16 (MCP grant fidelity)'s own fixture. Run directly as a
 * genuine, separate OS subprocess via `TS_NODE_FLAG` (referenced from `GrantedMcpServer.command`/
 * `args` in `fixture-options.ts`, never via this file's own shebang line, which cannot be made
 * Node-version-aware -- `Q340`), never imported from another TypeScript module and never run as a
 * vitest suite itself — the identical "real child process, run via a real type-stripping `node`
 * invocation, typechecked by `test/**\/*.ts` but not collected as a test" shape
 * `packages/cli/test/commands/run/fixtures/run-child.ts` already establishes (a fresh critic round,
 * P9, found the first draft of this file was a plain, untyped `.mjs` script instead, which got no
 * compiler safety net anywhere in this repository — fixed to match that established precedent).
 *
 * Two tools only: `forge_conformance_allowed` (the session's own grant permits it) and
 * `forge_conformance_denied` (it does not) — both trivial, harmless, and side-effect-free, so this
 * fixture's only real purpose is proving the grant/deny boundary itself, not exercising any other
 * behaviour.
 *
 * @see specs/07 §7.6
 * @see PLAN-M7.md P9
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'forge-conformance-mcp-fixture', version: '0.0.0' });

server.registerTool(
  'forge_conformance_allowed',
  { description: 'A harmless conformance-fixture tool a granted session is allowed to call.' },
  () => ({ content: [{ type: 'text', text: 'forge-conformance-allowed-tool-ok' }] }),
);

server.registerTool(
  'forge_conformance_denied',
  {
    description:
      'A harmless conformance-fixture tool an ungranted session must not be able to call successfully.',
  },
  () => ({ content: [{ type: 'text', text: 'forge-conformance-denied-tool-ok' }] }),
);

await server.connect(new StdioServerTransport());
