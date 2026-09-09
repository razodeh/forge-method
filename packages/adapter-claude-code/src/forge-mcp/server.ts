/**
 * `createForgeMcpServer` — `07` §7.3's own 9-tool table, made real: a genuine
 * `@modelcontextprotocol/sdk` `McpServer`, each tool's real, Zod-validated input schema and tool name
 * taken verbatim from the spec table, each handler delegating straight to the matching
 * `ForgeMcpBackend` method (`backend.ts`, this same directory).
 *
 * **Error handling needs no `try`/`catch` here, by design, not by omission.** Confirmed directly
 * against the real, installed `@modelcontextprotocol/sdk@1.30.0`'s own implementation
 * (`dist/esm/server/mcp.js`, `setToolRequestHandlers`): every registered tool's request is already
 * dispatched inside the SDK's own `try { ... } catch (error) { return this.createToolError(...) }`
 * block, which catches a handler's synchronous throw *and* a rejected promise (the handler is awaited
 * inside that same `try`) and converts either into a real `{content: [...], isError: true}` result --
 * never an uncaught rejection that could kill the server. A backend method throwing is exactly this
 * case: nothing in this file needs to guard against it a second time. `test/forge-mcp/server.test.ts`
 * proves this end to end against a real client, not just by reading the SDK's own source.
 *
 * `structuredContent` is always an object (never a bare array/primitive) -- confirmed against the real
 * `CallToolResultSchema`: the field's own real type is `z.record(z.string(), z.unknown())`, a plain
 * object, not `z.unknown()`. `forge_kb_search`'s own naturally array-shaped result is wrapped as
 * `{hits: [...]}` for exactly this reason.
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q120
 * @see PLAN-M7.md P8
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { ForgeMcpBackend } from './backend.ts';

/** This package's own `package.json` is `"private": true, "version": "0.0.0"` (never published, so
 * there is no real semver to report here beyond that literal) -- matches it verbatim rather than
 * inventing a different-looking version string for this one server identity. */
const FORGE_MCP_SERVER_VERSION = '0.0.0';

function structuredResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

export function createForgeMcpServer(backend: ForgeMcpBackend): McpServer {
  const server = new McpServer({ name: 'forge', version: FORGE_MCP_SERVER_VERSION });

  server.registerTool(
    'forge_kb_search',
    {
      description: 'Retrieve KB entries by relevance, with IDs.',
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      const hits = await backend.kbSearch(query);
      return structuredResult({ hits: [...hits] });
    },
  );

  server.registerTool(
    'forge_kb_get',
    {
      description: 'Fetch a KB entry or artifact verbatim.',
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const entry = await backend.kbGet(id);
      return structuredResult(entry === undefined ? { found: false } : { found: true, entry });
    },
  );

  server.registerTool(
    'forge_spec_get',
    {
      description: 'Fetch a spec artifact.',
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const entry = await backend.specGet(id);
      return structuredResult(entry === undefined ? { found: false } : { found: true, entry });
    },
  );

  server.registerTool(
    'forge_ask',
    {
      description: 'Escalate a question to the human through the TUI.',
      inputSchema: { question: z.string().min(1), options: z.array(z.string()).optional() },
    },
    async ({ question, options }) => {
      const result = await backend.ask(question, options ?? []);
      return structuredResult({ answer: result.answer });
    },
  );

  server.registerTool(
    'forge_assume',
    {
      description: 'Record an assumption.',
      inputSchema: {
        text: z.string().min(1),
        confidence: z.enum(['low', 'medium', 'high']),
        impact: z.string().min(1),
      },
    },
    async ({ text, confidence, impact }) => {
      const result = await backend.assume(text, confidence, impact);
      return structuredResult({ acknowledged: result.acknowledged });
    },
  );

  server.registerTool(
    'forge_handoff',
    {
      description: 'Request a handoff.',
      inputSchema: { role: z.string().min(1), reason: z.string().min(1) },
    },
    async ({ role, reason }) => {
      const result = await backend.handoff(role, reason);
      return structuredResult({ acknowledged: result.acknowledged });
    },
  );

  server.registerTool(
    'forge_request_change',
    {
      description: 'Request a change to a frozen contract.',
      inputSchema: { target: z.string().min(1), reason: z.string().min(1) },
    },
    async ({ target, reason }) => {
      const result = await backend.requestChange(target, reason);
      return structuredResult({ acknowledged: result.acknowledged });
    },
  );

  server.registerTool(
    'forge_report',
    {
      description: 'Emit structured findings (review, RCA, test plan).',
      inputSchema: { kind: z.string().min(1), payload: z.unknown() },
    },
    async ({ kind, payload }) => {
      const result = await backend.report(kind, payload);
      return structuredResult({ acknowledged: result.acknowledged });
    },
  );

  server.registerTool(
    'forge_skill_load',
    {
      description: 'Load a skill body on demand (progressive disclosure fallback).',
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const skill = await backend.skillLoad(id);
      return structuredResult(
        skill === undefined ? { found: false } : { found: true, body: skill.body },
      );
    },
  );

  return server;
}
