/**
 * `mapGrantedMcpServersToConfig`/`mapGrantedMcpServersToAllowedTools`/`findMissingGrantedServers` —
 * `15` §15.6's own MCP-grant path.
 *
 * @see specs/07 §7.3
 * @see specs/15 §15.6
 * @see PLAN-M7.md P7
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import type { GrantedMcpServer } from '@forge/adapter-kit';

import {
  FORGE_MCP_SERVER_ID,
  findMissingGrantedServers,
  mapGrantedMcpServersToAllowedTools,
  mapGrantedMcpServersToConfig,
  mergeSdkForgeMcpServer,
  readMcpServerNames,
} from '../src/mcp.ts';

type StdioOverrides = Partial<{
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly grantedTools: readonly string[] | '*';
}>;

function stdioServer(overrides: StdioOverrides = {}): GrantedMcpServer {
  return {
    id: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    grantedTools: ['get_issue'],
    ...overrides,
  };
}

function stdioServerWithoutArgs(overrides: StdioOverrides = {}): GrantedMcpServer {
  return {
    id: 'github',
    transport: 'stdio',
    command: 'npx',
    grantedTools: ['get_issue'],
    ...overrides,
  };
}

describe('mapGrantedMcpServersToConfig', () => {
  it('maps a stdio server to the real McpStdioServerConfig shape, keyed by id', () => {
    const config = mapGrantedMcpServersToConfig([stdioServer()]);
    expect(config).toEqual({
      github: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
    });
  });

  it('maps env through when present, and omits args/env entirely when absent', () => {
    const withEnv = mapGrantedMcpServersToConfig([stdioServerWithoutArgs({ env: { TOKEN: 'x' } })]);
    expect(withEnv['github']).toEqual({ type: 'stdio', command: 'npx', env: { TOKEN: 'x' } });

    const bare = mapGrantedMcpServersToConfig([
      { id: 'bare', transport: 'stdio', command: 'node', grantedTools: '*' },
    ]);
    expect(bare['bare']).toEqual({ type: 'stdio', command: 'node' });
  });

  it('maps http and sse servers to {type, url}, dropping grantedTools entirely (config is server-only)', () => {
    const config = mapGrantedMcpServersToConfig([
      { id: 'remote-http', transport: 'http', url: 'https://example.com/mcp', grantedTools: '*' },
      { id: 'remote-sse', transport: 'sse', url: 'https://example.com/sse', grantedTools: ['a'] },
    ]);
    expect(config).toEqual({
      'remote-http': { type: 'http', url: 'https://example.com/mcp' },
      'remote-sse': { type: 'sse', url: 'https://example.com/sse' },
    });
  });

  it('multiple servers each get their own keyed entry', () => {
    const config = mapGrantedMcpServersToConfig([
      stdioServer({ id: 'a' }),
      stdioServer({ id: 'b' }),
    ]);
    expect(Object.keys(config)).toEqual(['a', 'b']);
  });

  it('a server whose id contains "(", ")", or "," is dropped entirely, not given a config an unqualified mcp__* rule could still reach', () => {
    for (const id of ['evil)Bash(', 'evil,server']) {
      const config = mapGrantedMcpServersToConfig([stdioServer({ id })]);
      expect(config).toEqual({});
    }
  });

  it('a server id of exactly "__proto__" becomes a normal, safe own key rather than silently vanishing -- a fresh critic round found a plain {} accumulator would invoke Object.prototype\'s own legacy __proto__ setter here instead of adding an entry', () => {
    const config = mapGrantedMcpServersToConfig([
      { id: '__proto__', transport: 'stdio', command: 'server-proto', grantedTools: '*' },
    ]);
    // The map itself must not have actually had its own prototype reassigned by that key.
    expect(Object.getPrototypeOf(config)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(config, '__proto__')).toBe(true);
    expect(config['__proto__']).toEqual({ type: 'stdio', command: 'server-proto' });
  });
});

describe('mapGrantedMcpServersToAllowedTools', () => {
  it('a specific granted tool produces one mcp__<id>__<tool> rule, matching the real, documented Claude Code naming convention', () => {
    expect(
      mapGrantedMcpServersToAllowedTools([stdioServer({ grantedTools: ['get_issue'] })]),
    ).toEqual(['mcp__github__get_issue']);
  });

  it("grantedTools: '*' produces mcp__<id>__*, the real documented wildcard-all-tools form", () => {
    expect(mapGrantedMcpServersToAllowedTools([stdioServer({ grantedTools: '*' })])).toEqual([
      'mcp__github__*',
    ]);
  });

  it('multiple tools on one server, and multiple servers, each get their own rule in order', () => {
    const result = mapGrantedMcpServersToAllowedTools([
      stdioServer({ id: 'a', grantedTools: ['t1', 't2'] }),
      stdioServer({ id: 'b', grantedTools: ['t3'] }),
    ]);
    expect(result).toEqual(['mcp__a__t1', 'mcp__a__t2', 'mcp__b__t3']);
  });

  it('a crafted server id or tool name containing "(", ")", or "," is refused -- never smuggled into the rule string', () => {
    expect(mapGrantedMcpServersToAllowedTools([stdioServer({ id: 'evil)Bash(*' })])).toEqual([]);
    expect(
      mapGrantedMcpServersToAllowedTools([stdioServer({ grantedTools: ['a) Bash(rm -rf /'] })]),
    ).toEqual([]);
  });

  it('zero granted servers produces an empty list', () => {
    expect(mapGrantedMcpServersToAllowedTools([])).toEqual([]);
  });
});

describe('findMissingGrantedServers', () => {
  it("07 §7.3's own first worked example: granted [a], reported [a, b] (host adopted more than granted) -- accepted, nothing missing", () => {
    expect(findMissingGrantedServers([stdioServer({ id: 'a' })], ['a', 'b'])).toEqual([]);
  });

  it("07 §7.3's own second worked example: granted [a, b], reported only [a] -- b is missing, named specifically", () => {
    expect(
      findMissingGrantedServers([stdioServer({ id: 'a' }), stdioServer({ id: 'b' })], ['a']),
    ).toEqual(['b']);
  });

  it('granted and reported lists that match exactly report nothing missing', () => {
    expect(
      findMissingGrantedServers([stdioServer({ id: 'a' }), stdioServer({ id: 'b' })], ['a', 'b']),
    ).toEqual([]);
  });

  it('every granted server missing is reported, in the granted order', () => {
    expect(
      findMissingGrantedServers([stdioServer({ id: 'a' }), stdioServer({ id: 'b' })], []),
    ).toEqual(['a', 'b']);
  });

  it('no granted servers at all reports nothing missing, regardless of what the host reports', () => {
    expect(findMissingGrantedServers([], ['a', 'b'])).toEqual([]);
  });
});

describe('readMcpServerNames', () => {
  it('extracts every name from the real, confirmed {name, status}[] shape', () => {
    expect(
      readMcpServerNames({
        mcp_servers: [
          { name: 'github', status: 'connected' },
          { name: 'puppeteer', status: 'connected' },
        ],
      }),
    ).toEqual(['github', 'puppeteer']);
  });

  it('mcp_servers entirely absent from meta reads as no names reported, not a throw', () => {
    expect(readMcpServerNames({})).toEqual([]);
    expect(readMcpServerNames({ session_id: 'x', model: 'm' })).toEqual([]);
  });

  it('mcp_servers present but not an array reads as no names reported', () => {
    expect(readMcpServerNames({ mcp_servers: 'not-an-array' })).toEqual([]);
    expect(readMcpServerNames({ mcp_servers: { name: 'github' } })).toEqual([]);
    expect(readMcpServerNames({ mcp_servers: null })).toEqual([]);
  });

  it('non-object array entries are skipped rather than throwing, and any well-formed siblings still come through', () => {
    expect(
      readMcpServerNames({
        mcp_servers: [null, 'github', 42, ['nested'], { name: 'puppeteer', status: 'connected' }],
      }),
    ).toEqual(['puppeteer']);
  });

  it('an entry whose name is missing or non-string is skipped rather than throwing', () => {
    expect(
      readMcpServerNames({
        mcp_servers: [{ status: 'connected' }, { name: 42, status: 'connected' }, { name: 'ok' }],
      }),
    ).toEqual(['ok']);
  });

  it('an empty mcp_servers array reads as no names reported', () => {
    expect(readMcpServerNames({ mcp_servers: [] })).toEqual([]);
  });
});

describe('mergeSdkForgeMcpServer', () => {
  it('starts a fresh McpSessionExtras (allowedTools/serverConfig both containing only the forge entry) when no prior extras exist at all', () => {
    const forgeServer = new McpServer({ name: 'forge', version: '0.0.0' });
    const merged = mergeSdkForgeMcpServer(undefined, forgeServer, true);
    expect(merged.allowedTools).toEqual(['mcp__forge__*']);
    expect(Object.keys(merged.serverConfig)).toEqual([FORGE_MCP_SERVER_ID]);
    expect(merged.serverConfig[FORGE_MCP_SERVER_ID]).toEqual({
      type: 'sdk',
      name: FORGE_MCP_SERVER_ID,
      instance: forgeServer,
    });
    expect(merged.strict).toBe(true);
  });

  it("preserves an existing grant's own allowedTools/serverConfig entries, adding the forge entry alongside rather than replacing them", () => {
    const forgeServer = new McpServer({ name: 'forge', version: '0.0.0' });
    const existing = mapGrantedMcpServersToConfig([
      { id: 'github', transport: 'stdio', command: 'npx', grantedTools: ['get_issue'] },
    ]);
    const merged = mergeSdkForgeMcpServer(
      {
        allowedTools: ['mcp__github__get_issue'],
        serverConfig: existing,
        strict: false,
      },
      forgeServer,
      false,
    );
    expect(merged.allowedTools).toEqual(['mcp__github__get_issue', 'mcp__forge__*']);
    expect(Object.keys(merged.serverConfig).sort()).toEqual(['forge', 'github']);
    expect(merged.serverConfig['github']).toEqual(existing['github']);
    expect(merged.strict).toBe(false);
  });

  it("the reserved 'forge' id silently supersedes a same-named entry an existing grant already had, rather than merging or throwing", () => {
    const forgeServer = new McpServer({ name: 'forge', version: '0.0.0' });
    const merged = mergeSdkForgeMcpServer(
      {
        allowedTools: [],
        serverConfig: { forge: { type: 'stdio', command: 'a-caller-supplied-binary' } },
        strict: true,
      },
      forgeServer,
      true,
    );
    expect(merged.serverConfig['forge']).toEqual({
      type: 'sdk',
      name: FORGE_MCP_SERVER_ID,
      instance: forgeServer,
    });
  });

  it('passes strict through verbatim, independent of whatever the prior extras carried', () => {
    const forgeServer = new McpServer({ name: 'forge', version: '0.0.0' });
    expect(
      mergeSdkForgeMcpServer(
        { allowedTools: [], serverConfig: {}, strict: false },
        forgeServer,
        true,
      ).strict,
    ).toBe(true);
    expect(
      mergeSdkForgeMcpServer(
        { allowedTools: [], serverConfig: {}, strict: true },
        forgeServer,
        false,
      ).strict,
    ).toBe(false);
  });
});
