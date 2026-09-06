/**
 * `validateMcpConfig` — `15` §15.5.2's structural rules.
 *
 * @see specs/15 §15.5.2
 * @see PLAN-M2.md P5
 */
import { describe, expect, it } from 'vitest';

import { validateMcpConfig } from '../../src/mcp/validate.ts';

const JIRA = {
  id: 'acme-jira',
  transport: 'stdio' as const,
  command: 'npx',
  args: ['-y', '@acme/jira-mcp'],
  env: { JIRA_TOKEN: '${secret:jira_token}' },
  trust: 'internal' as const,
  readOnly: true,
};

const POSTGRES_STAGING = {
  id: 'acme-postgres-staging',
  transport: 'stdio' as const,
  command: 'mcp-postgres',
  args: ['--url', '${secret:staging_ro_dsn}'],
  trust: 'internal' as const,
  readOnly: false,
  environments: ['dev', 'staging'],
};

describe('validateMcpConfig — schema boundary', () => {
  it('never throws on structurally invalid input, returning schema findings', () => {
    const outcome = validateMcpConfig({ servers: 'not-an-array' }, { environment: 'dev' });
    expect(outcome.valid).toBe(false);
    expect(outcome.findings.some((f) => f.code === 'schema')).toBe(true);
    expect(outcome.effectiveGrants).toEqual({});
  });

  it('accepts a config with no grants at all', () => {
    const outcome = validateMcpConfig({ servers: [JIRA] }, { environment: 'dev' });
    expect(outcome.valid).toBe(true);
    expect(outcome.effectiveGrants).toEqual({});
  });

  it('reports a root-level schema finding (empty path) for a stray top-level field', () => {
    const outcome = validateMcpConfig({ servers: [], extraField: true }, { environment: 'dev' });
    expect(outcome.valid).toBe(false);
    const finding = outcome.findings.find((f) => f.code === 'schema');
    expect(finding?.message).toMatch(/^\(root\):/);
  });
});

describe('validateMcpConfig — unknown-server', () => {
  it('flags a grant naming a server not in "servers"', () => {
    const outcome = validateMcpConfig(
      { servers: [JIRA], grants: { pm: { 'acme-confluence': ['search'] } } },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.findings).toContainEqual(
      expect.objectContaining({ code: 'unknown-server', severity: 'error' }),
    );
  });
});

describe('validateMcpConfig — write-grant-denied', () => {
  it('refuses a write-capable server granted to reviewer', () => {
    const outcome = validateMcpConfig(
      {
        servers: [{ ...POSTGRES_STAGING, environments: undefined }],
        grants: { reviewer: { 'acme-postgres-staging': ['explain_query'] } },
      },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.findings).toContainEqual(
      expect.objectContaining({ code: 'write-grant-denied', severity: 'error' }),
    );
  });

  it('refuses the same for critic and diagnostician', () => {
    for (const role of ['critic', 'diagnostician']) {
      const outcome = validateMcpConfig(
        {
          servers: [{ ...POSTGRES_STAGING, environments: undefined }],
          grants: { [role]: { 'acme-postgres-staging': ['explain_query'] } },
        },
        { environment: 'dev' },
      );
      expect(outcome.valid).toBe(false);
    }
  });

  it('allows a read-only server granted to reviewer', () => {
    const outcome = validateMcpConfig(
      { servers: [JIRA], grants: { reviewer: { 'acme-jira': ['search_issues'] } } },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(true);
  });

  it('allows a write-capable server granted to a non-denied role', () => {
    const outcome = validateMcpConfig(
      {
        servers: [{ ...POSTGRES_STAGING, environments: undefined }],
        grants: { 'data-architect': { 'acme-postgres-staging': ['explain_query'] } },
      },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(true);
  });
});

describe('validateMcpConfig — server-wide grants', () => {
  it('refuses "*" under the default grantMode: explicit', () => {
    const outcome = validateMcpConfig(
      { servers: [JIRA], grants: { pm: { 'acme-jira': '*' } } },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.findings).toContainEqual(
      expect.objectContaining({ code: 'unauthorized-server-wide-grant' }),
    );
  });

  it('accepts "*" under grantMode: server-wide', () => {
    const outcome = validateMcpConfig(
      {
        servers: [JIRA],
        grants: { pm: { 'acme-jira': '*' } },
        defaults: { grantMode: 'server-wide' },
      },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(true);
    expect(outcome.effectiveGrants['pm']?.['acme-jira']).toBe('*');
  });

  it('rejects "*" smuggled inside a tool array — it cannot bypass the grantMode gate this way', () => {
    const outcome = validateMcpConfig(
      { servers: [JIRA], grants: { pm: { 'acme-jira': ['*'] } } },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.findings.some((f) => f.code === 'schema')).toBe(true);
  });

  it('rejects "*" mixed with real tool names inside an array', () => {
    const outcome = validateMcpConfig(
      { servers: [JIRA], grants: { pm: { 'acme-jira': ['search_issues', '*'] } } },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(false);
  });
});

describe('validateMcpConfig — duplicate-server-id', () => {
  it('flags two servers declaring the same id', () => {
    const outcome = validateMcpConfig(
      {
        servers: [JIRA, { ...JIRA, readOnly: false }],
        grants: { pm: { 'acme-jira': ['search_issues'] } },
      },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.findings).toContainEqual(
      expect.objectContaining({ code: 'duplicate-server-id', severity: 'error' }),
    );
  });

  it('does not flag distinct server ids', () => {
    const outcome = validateMcpConfig(
      { servers: [JIRA, POSTGRES_STAGING] },
      { environment: 'dev' },
    );
    expect(outcome.findings.some((f) => f.code === 'duplicate-server-id')).toBe(false);
  });
});

describe('validateMcpConfig — environment scoping', () => {
  it('drops a grant for a server whose environments excludes the target', () => {
    const outcome = validateMcpConfig(
      {
        servers: [POSTGRES_STAGING],
        grants: { 'data-architect': { 'acme-postgres-staging': ['list_schemas'] } },
      },
      { environment: 'production' },
    );
    expect(outcome.valid).toBe(true);
    expect(outcome.effectiveGrants).toEqual({});
  });

  it('keeps the grant when the target environment is in the list', () => {
    const outcome = validateMcpConfig(
      {
        servers: [POSTGRES_STAGING],
        grants: { 'data-architect': { 'acme-postgres-staging': ['list_schemas'] } },
      },
      { environment: 'staging' },
    );
    expect(outcome.effectiveGrants['data-architect']?.['acme-postgres-staging']).toEqual([
      'list_schemas',
    ]);
  });

  it('drops a write-capable server with no declared environments when targeting production', () => {
    const outcome = validateMcpConfig(
      {
        servers: [{ ...POSTGRES_STAGING, environments: undefined }],
        grants: { 'data-architect': { 'acme-postgres-staging': ['list_schemas'] } },
      },
      { environment: 'production' },
    );
    expect(outcome.valid).toBe(true);
    expect(outcome.effectiveGrants).toEqual({});
  });

  it('keeps a read-only server with no declared environments when targeting production', () => {
    const outcome = validateMcpConfig(
      { servers: [JIRA], grants: { pm: { 'acme-jira': ['search_issues'] } } },
      { environment: 'production' },
    );
    expect(outcome.effectiveGrants['pm']?.['acme-jira']).toEqual(['search_issues']);
  });
});

describe('validateMcpConfig — secret-shaped literals', () => {
  it('flags an AWS-key-shaped env value that is not a ${secret:...} reference', () => {
    const outcome = validateMcpConfig(
      {
        servers: [
          {
            ...JIRA,
            env: { JIRA_TOKEN: 'AKIAABCDEFGHIJKLMNOP' },
          },
        ],
      },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.findings).toContainEqual(
      expect.objectContaining({ code: 'secret-literal', severity: 'error' }),
    );
  });

  it('flags a secret-shaped literal in args', () => {
    const outcome = validateMcpConfig(
      { servers: [{ ...JIRA, args: ['--token', 'ghp_' + 'a'.repeat(36)] }] },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(false);
  });

  it('does not scan args when a stdio server declares none at all', () => {
    const outcome = validateMcpConfig(
      { servers: [{ ...JIRA, args: undefined }] },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(true);
  });

  it('does not flag a ${secret:...} reference', () => {
    const outcome = validateMcpConfig({ servers: [JIRA] }, { environment: 'dev' });
    expect(outcome.findings.some((f) => f.code === 'secret-literal')).toBe(false);
  });

  it('does not scan http/sse servers for secret literals (no env/args field exists)', () => {
    const outcome = validateMcpConfig(
      {
        servers: [
          {
            id: 'figma',
            transport: 'http',
            url: 'https://mcp.figma.example/sse',
            trust: 'vendor',
            readOnly: true,
          },
        ],
      },
      { environment: 'dev' },
    );
    expect(outcome.valid).toBe(true);
  });
});
