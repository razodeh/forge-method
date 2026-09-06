/**
 * `mcpServerSchema`, `mcpGrantsSchema`, `secretReferenceSchema` — `15` §15.5.1's document shapes.
 *
 * @see specs/15 §15.5.1
 * @see PLAN-M2.md P5
 */
import { describe, expect, it } from 'vitest';

import { mcpGrantsSchema, mcpServerSchema, secretReferenceSchema } from '../../src/mcp/schema.ts';

describe('mcpServerSchema', () => {
  it('accepts a stdio server with command/args/env', () => {
    const result = mcpServerSchema.safeParse({
      id: 'acme-jira',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@acme/jira-mcp'],
      env: { JIRA_BASE_URL: 'https://acme.atlassian.net', JIRA_TOKEN: '${secret:jira_token}' },
      timeoutMs: 30000,
      trust: 'internal',
      readOnly: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an http server with a url', () => {
    const result = mcpServerSchema.safeParse({
      id: 'figma',
      transport: 'http',
      url: 'https://mcp.figma.example/sse',
      trust: 'vendor',
      readOnly: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an sse server with environments scoping', () => {
    const result = mcpServerSchema.safeParse({
      id: 'acme-postgres-staging',
      transport: 'sse',
      url: 'https://mcp.acme.example/pg',
      trust: 'internal',
      readOnly: true,
      environments: ['dev', 'staging'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a stdio server missing command', () => {
    const result = mcpServerSchema.safeParse({
      id: 'broken',
      transport: 'stdio',
      trust: 'internal',
      readOnly: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an http server carrying stdio-only fields', () => {
    const result = mcpServerSchema.safeParse({
      id: 'broken',
      transport: 'http',
      url: 'https://example.com',
      command: 'npx',
      trust: 'vendor',
      readOnly: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown trust value', () => {
    const result = mcpServerSchema.safeParse({
      id: 'acme-jira',
      transport: 'stdio',
      command: 'npx',
      trust: 'partner',
      readOnly: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('secretReferenceSchema', () => {
  it('accepts ${secret:<name>} syntax', () => {
    expect(secretReferenceSchema.safeParse('${secret:jira_token}').success).toBe(true);
  });

  it('rejects a literal value', () => {
    expect(secretReferenceSchema.safeParse('sk-live-abc123').success).toBe(false);
  });
});

describe('mcpGrantsSchema', () => {
  it('accepts tool-level grants with defaults', () => {
    const result = mcpGrantsSchema.safeParse({
      grants: {
        pm: { 'acme-jira': ['search_issues', 'get_issue', 'create_issue'] },
        po: { 'acme-jira': ['search_issues', 'get_issue'] },
      },
      defaults: { grantMode: 'explicit', injectionPosture: 'untrusted-content' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a server-wide grant written as "*"', () => {
    const result = mcpGrantsSchema.safeParse({
      grants: { sre: { 'acme-postgres-staging': '*' } },
      defaults: { grantMode: 'server-wide' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects "*" as an element of a tool-name array — it is the server-wide sentinel, not a tool name', () => {
    const result = mcpGrantsSchema.safeParse({ grants: { pm: { 'acme-jira': ['*'] } } });
    expect(result.success).toBe(false);
  });

  it('defaults grantMode to explicit and injectionPosture to untrusted-content', () => {
    const result = mcpGrantsSchema.safeParse({ defaults: {} });
    expect(result.success && result.data.defaults).toEqual({
      grantMode: 'explicit',
      injectionPosture: 'untrusted-content',
    });
  });

  it('rejects an unrecognised top-level field', () => {
    const result = mcpGrantsSchema.safeParse({ grants: {}, wat: true });
    expect(result.success).toBe(false);
  });
});
