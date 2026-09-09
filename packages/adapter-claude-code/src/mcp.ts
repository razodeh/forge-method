/**
 * `mapGrantedMcpServersToConfig`/`mapGrantedMcpServersToAllowedTools`/`findMissingGrantedServers` —
 * `15` §15.6's own MCP-grant path made concrete: which real Claude Code primitives express "only
 * these servers, only these tools," and how a session's own real `system/init` event is checked
 * against what was actually granted.
 *
 * `Options.mcpServers: Record<string, McpServerConfig>` and its real CLI equivalent, `--mcp-config
 * <configs...>` ("Load MCP servers from JSON files **or strings**," confirmed against the real,
 * installed CLI's own `--help` text) are the *server* half — this file's own `mapGrantedMcpServersToConfig`.
 * The *tool* half (`GrantedMcpServer.grantedTools`) has no equivalent field on `McpStdioServerConfig`
 * at all (`McpSSEServerConfig`/`McpHttpServerConfig` do carry a `tools?: McpServerToolPolicy[]`, but
 * that is a *permission-policy* override -- `always_allow`/`always_ask`/`always_deny` -- not a grant/
 * deny allowlist, and stdio servers have no such field regardless). The real, confirmed mechanism for
 * granting a *specific* MCP tool is the same permission-rule system `tool-grant.ts` already builds
 * on: Anthropic's own official permissions docs (`code.claude.com/docs/en/permissions`, fetched
 * during this piece) confirm "Permissions... apply to Bash, Read, Edit, WebFetch, MCP, and every
 * other tool," with a real, documented `mcp__<server>__<tool>` naming convention (`mcp__puppeteer`
 * matches any tool from that server; `mcp__puppeteer__*` matches all its tools;
 * `mcp__puppeteer__puppeteer_navigate` matches one specific tool). `mapGrantedMcpServersToAllowedTools`
 * (below) is this file's own second half, producing entries `ClaudeCodeAdapter` merges into the same
 * `--allowedTools`/`Options.allowedTools` value `mapToolGrantToAllowedTools` (`tool-grant.ts`) already
 * builds, not a second, separate permission channel.
 *
 * `mergeSdkForgeMcpServer` (P8) is this file's own third piece, added alongside the above rather than
 * in `forge-mcp/`: it produces the identical `McpSessionExtras` shape this file already owns, just
 * with one more, adapter-internal server folded in -- `forge-mcp/` itself has no reason to know that
 * shape exists, or to depend on this package's own `@anthropic-ai/claude-agent-sdk` dependency at all
 * (it is built to work against any real MCP client, Claude Code included but not exclusively).
 *
 * @see specs/07 §7.3
 * @see specs/15 §15.5
 * @see specs/15 §15.6
 * @see SPEC-QUESTIONS.md Q119
 * @see SPEC-QUESTIONS.md Q120
 * @see PLAN-M7.md P7
 * @see PLAN-M7.md P8
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { GrantedMcpServer } from '@forge/adapter-kit';

/**
 * What `startOnTransport` (`adapter.ts`, P7) actually threads into whichever transport builder is
 * active, once for the whole session -- both `buildCliArgs` (CLI) and `buildSdkOptions` (SDK) take
 * this as an optional parameter, since only each builder's own code knows exactly where its own
 * `--allowedTools`/`Options.allowedTools` value needs the extra MCP-tool rules inserted (a real
 * argv-ordering constraint for the CLI transport specifically: everything must come before the
 * trailing `--`/prompt, which only `buildCliArgs` itself controls). `undefined` (the default, no
 * `provisionMcp` call ever ran for this session's own `cwd`) means neither builder adds anything MCP-
 * related at all -- the identical shape a session with zero granted servers would produce, so a
 * caller that never provisions MCP for a given session sees no behavioural difference from before
 * this piece existed.
 */
export interface McpSessionExtras {
  readonly allowedTools: readonly string[];
  readonly serverConfig: Readonly<Record<string, McpServerConfig>>;
  /** `true` unless `config.mcp.adoptHostServers` -- maps to the real, confirmed `--strict-mcp-config`
   * CLI flag / `Options.strictMcpConfig` SDK field (confirmed identical: the SDK's own doc comment
   * says the field "Maps to the CLI `--strict-mcp-config` flag" verbatim). */
  readonly strict: boolean;
}

/**
 * A crafted `id`/tool name containing a literal `(`, `)`, or `,` is refused (the whole server is
 * dropped from both the config map and the allowed-tools list) rather than smuggled into the rule
 * string -- the identical fail-closed reasoning `tool-grant.ts`'s own `safeBashRule`/
 * `safeWebFetchDomainRule` already apply to a sibling risk (`SPEC-QUESTIONS.md` Q117/Q118): unlike an
 * `exec` pattern or a domain, neither a real MCP server id nor a real MCP tool name has any
 * legitimate reason to contain any of these three characters, so refusing costs nothing genuine.
 * `GrantedMcpServer.id`/tool names are expected to come from FORGE's own MCP-server registry
 * configuration, not directly from untrusted model output -- lower realistic risk than an `exec`
 * pattern -- but this file applies the same discipline anyway rather than trusting that boundary to
 * hold forever.
 */
function isSafeMcpNameSegment(segment: string): boolean {
  return (
    segment.length > 0 && !segment.includes('(') && !segment.includes(')') && !segment.includes(',')
  );
}

function mcpToolRule(serverId: string, tool: string): string | undefined {
  if (!isSafeMcpNameSegment(serverId) || !isSafeMcpNameSegment(tool)) return undefined;
  return `mcp__${serverId}__${tool}`;
}

/**
 * The server half: one real `McpServerConfig` entry per granted server, keyed by `server.id`
 * (`Options.mcpServers`'s own real shape, confirmed against `sdk.d.ts` -- a plain object map, not an
 * array). A server whose own `id` is unsafe (see `isSafeMcpNameSegment`) is dropped entirely, not
 * given a config a caller could still reach via a bare, unqualified `mcp__*` allow rule.
 *
 * `Object.create(null)`, not a `{}` literal -- a fresh critic round noted `isSafeMcpNameSegment`
 * rejects `(`/`)`/`,` but not the string `'__proto__'`, and `config[server.id] = ...` on an ordinary
 * object literal with that exact id would never create an own property at all: it would invoke
 * `Object.prototype`'s own legacy `__proto__` setter instead, silently reassigning `config`'s own
 * prototype rather than adding an entry. Both real consumers (`JSON.stringify` in `build-args.ts`,
 * object-spread in `build-options.ts`) only ever read own-enumerable keys, so nothing already leaked
 * from this -- a server planted this way was never actually sent to Claude Code, so
 * `findMissingGrantedServers` would already, correctly, fail the session closed for it being absent --
 * but a null-prototype object closes the gap directly rather than relying on every future consumer of
 * this map happening to stay prototype-agnostic forever.
 */
export function mapGrantedMcpServersToConfig(
  servers: readonly GrantedMcpServer[],
): Record<string, McpServerConfig> {
  const config = Object.create(null) as Record<string, McpServerConfig>;
  for (const server of servers) {
    if (!isSafeMcpNameSegment(server.id)) continue;
    config[server.id] =
      server.transport === 'stdio'
        ? {
            type: 'stdio',
            command: server.command,
            ...(server.args === undefined ? {} : { args: [...server.args] }),
            ...(server.env === undefined ? {} : { env: { ...server.env } }),
          }
        : { type: server.transport, url: server.url };
  }
  return config;
}

/**
 * The tool half: one `mcp__<id>__<tool>` rule per granted tool (`mcp__<id>__*` for the real,
 * documented `'*'` wildcard form) -- merged by the caller into the same `--allowedTools`/
 * `Options.allowedTools` value `mapToolGrantToAllowedTools` already builds from the session's own
 * plain `ToolGrant`, not returned or applied separately.
 */
export function mapGrantedMcpServersToAllowedTools(
  servers: readonly GrantedMcpServer[],
): readonly string[] {
  const tools: string[] = [];
  for (const server of servers) {
    if (server.grantedTools === '*') {
      const rule = mcpToolRule(server.id, '*');
      if (rule !== undefined) tools.push(rule);
    } else {
      for (const tool of server.grantedTools) {
        const rule = mcpToolRule(server.id, tool);
        if (rule !== undefined) tools.push(rule);
      }
    }
  }
  return tools;
}

/**
 * `07` §7.3's own load-verification mandate: which granted server ids are genuinely absent from the
 * real `system/init` event's own reported list -- checked by presence alone (`SPEC-QUESTIONS.md`
 * Q119 records why not also by the real event's own per-server `status` field: this milestone has no
 * live-captured evidence of what a real failed server's own `status` string actually reads, having
 * never granted a real MCP server in any of its live calls, so checking presence-by-name is the
 * honest, evidence-grounded half of the real mandate this piece can actually implement). Extra,
 * unrequested servers the host reports beyond what was granted are never this function's concern --
 * `07` §7.3's own Check explicitly names only missing servers as a failure.
 */
export function findMissingGrantedServers(
  granted: readonly GrantedMcpServer[],
  reportedNames: readonly string[],
): readonly string[] {
  const reported = new Set(reportedNames);
  return granted.filter((server) => !reported.has(server.id)).map((server) => server.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Defensive extraction of the real `system/init` event's own `mcp_servers` field (confirmed shape:
 * `{name: string, status: string}[]`, `sdk.d.ts` line ~5188) out of a `session.started` event's own
 * `meta` -- which both transports populate with the *entire* raw, untyped message object
 * (`parse-event.ts`/`map-message.ts`'s own `meta: message`), never a shape either transport's mapping
 * code validates itself. Anything other than the exact confirmed shape (field absent entirely,
 * non-array, non-object elements, a `name` that isn't a string) reads as "no name reported" rather
 * than throwing -- `drainAndTrack` (`adapter.ts`) uses this to decide whether a granted MCP server
 * genuinely loaded, and a malformed or absent field must never crash a live session outright.
 */
export function readMcpServerNames(meta: Readonly<Record<string, unknown>>): readonly string[] {
  const raw = meta['mcp_servers'];
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const entry of raw) {
    if (isRecord(entry) && typeof entry['name'] === 'string') {
      names.push(entry['name']);
    }
  }
  return names;
}

/** Reserved: the server id `mergeSdkForgeMcpServer` (below) always uses for the adapter-internal
 * forge-mcp server -- a caller-granted `GrantedMcpServer` happening to use this exact id is silently
 * superseded by it (see that function's own doc comment), never merged or reported as a conflict. */
export const FORGE_MCP_SERVER_ID = 'forge';

/**
 * `PLAN-M7.md` P8's own "wired into both transports... whenever the adapter reports `mcp: true`"
 * mandate, for the `sdk` transport specifically: folds an already-constructed, real, in-process
 * `McpServer` (`forge-mcp/server.ts`'s own `createForgeMcpServer`) into whatever `McpSessionExtras`
 * `provisionMcp`'s own caller-granted servers already produced (`extras`, possibly `undefined`).
 *
 * The real, confirmed `McpSdkServerConfigWithInstance` variant ("MCP SDK server config with an actual
 * McpServer instance... Not serializable - contains a live McpServer object," `sdk.d.ts`) is exactly
 * this: no subprocess, no URL, no JSON -- the SDK transport hosts it directly, in this same process.
 * `McpServerConfig` (the type `McpSessionExtras.serverConfig`'s own values are already typed as)
 * already includes this variant, confirmed directly against `sdk.d.ts` -- nothing about
 * `McpSessionExtras` itself needed to change to carry it.
 *
 * This function is deliberately never called for the `cli` transport: a live `McpServer` instance
 * cannot cross a real OS process boundary (`JSON.stringify`-ing it for `--mcp-config` would not
 * produce a working server, and likely not even valid JSON at all, given the object's own internal
 * circular references) -- `adapter.ts`'s own `startOnTransport` only calls this from its `sdk` branch,
 * an honest, real asymmetry recorded in `SPEC-QUESTIONS.md` Q120, not something this function itself
 * tries to paper over.
 *
 * All 9 forge-mcp tools are allowed unconditionally (`mcp__forge__*`) whenever this runs -- unlike a
 * caller's own `provisionMcp` grant, there is no "subset of first-party FORGE tools" concept for this
 * adapter to enforce a narrower allowlist against.
 */
export function mergeSdkForgeMcpServer(
  extras: McpSessionExtras | undefined,
  forgeServer: McpServer,
  strict: boolean,
): McpSessionExtras {
  return {
    allowedTools: [...(extras?.allowedTools ?? []), `mcp__${FORGE_MCP_SERVER_ID}__*`],
    serverConfig: {
      ...extras?.serverConfig,
      [FORGE_MCP_SERVER_ID]: { type: 'sdk', name: FORGE_MCP_SERVER_ID, instance: forgeServer },
    },
    strict,
  };
}
