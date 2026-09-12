# 07 — Platform Adapters

## 7.1 Purpose and boundary

An adapter turns FORGE's platform-neutral concept of "run an agent session with this prompt, these
tools, in this directory, and tell me what happened" into a concrete coding-agent runtime.

**Boundary rule:** nothing above `@forge/adapter-kit` may reference Claude Code, MCP, subagents, slash
commands, or any model name. Enforced by a lint rule that bans those identifiers outside
`packages/adapter-*`.

## 7.2 The `PlatformAdapter` interface (normative)

```ts
// @forge/adapter-kit
export interface PlatformAdapter {
  readonly id: string;                 // 'claude-code' | a generic-declarative-adapter id | ...
  readonly displayName: string;

  /** Static + probed capabilities. Called by doctor and by the scheduler. */
  capabilities(): Promise<AdapterCapabilities>;

  /** Verify the platform is installed, authenticated and usable. */
  preflight(ctx: PreflightContext): Promise<PreflightResult>;

  /** Models this platform can currently use, for tier mapping validation. */
  listModels(): Promise<ModelInfo[]>;

  /** Start a session. Returns a handle; the stream is consumed by the caller. */
  startSession(req: SessionRequest): Promise<SessionHandle>;

  /** Resume a previously started session if supported. */
  resumeSession(sessionId: string, req: ResumeRequest): Promise<SessionHandle>;

  /** Optional: write platform-native assets (agent files, commands) into the host project. */
  installAssets?(ctx: AssetContext): Promise<InstalledAsset[]>;

  /** Optional: one-shot structured completion for cheap utility tasks. */
  structured?<T>(req: StructuredRequest<T>): Promise<T>;

  /** Materialise the step's resolved skills into the session, scoped to the lane. See 15 §15.6. */
  provisionSkills?(skills: ResolvedSkill[], ctx: SessionContext): Promise<SkillProvisioning>;

  /** Configure only the MCP servers/tools granted to this step's role. See 15 §15.5. */
  provisionMcp?(servers: GrantedMcpServer[], ctx: SessionContext): Promise<McpProvisioning>;
}

export interface AdapterCapabilities {
  streaming: boolean;                  // incremental events
  partialText: boolean;                // token-level deltas
  sessionResume: boolean;
  interject: boolean;                  // send a message into a live session
  structuredOutput: boolean;           // schema-constrained output
  toolAllowlist: boolean;              // can restrict tools per session
  permissionModes: string[];           // adapter-native mode names, mapped from FORGE modes
  subagents: boolean;                  // platform can spawn its own nested agents
  mcp: boolean;
  costReporting: 'none' | 'per-session' | 'per-turn';
  tokenReporting: boolean;
  maxConcurrentSessions: number;       // 0 = unknown/unlimited
  cwdIsolation: boolean;               // supports arbitrary cwd (required for lanes)
  systemPromptControl: 'none' | 'append' | 'replace';
  fileEditing: boolean;
  bash: boolean;
  network: 'none' | 'allowlist' | 'full';
  bareMode: boolean;                   // can run ignoring host-machine config for reproducibility
  skills: 'native' | 'inline' | 'none';// platform-level progressive-disclosure support (see 15 §15.6)
  toolProxy: boolean;                  // adapter can expose FORGE-brokered tools into the session
}

export interface SessionRequest {
  runId: string;
  stepId: string;
  cwd: string;                         // lane worktree
  systemPrompt: { mode: 'append' | 'replace'; text: string };
  prompt: string;                      // the step brief (already context-packed)
  model: string;                       // resolved from tier
  thinking?: 'none' | 'low' | 'medium' | 'high';
  tools: ToolGrant;                    // FORGE-neutral grant; adapter maps it
  permissionMode: 'manual' | 'accept-edits' | 'deny-unlisted' | 'auto';
  limits: { maxTurns?: number; wallClockMs?: number; maxCostUsd?: number };
  env: Record<string, string>;         // never includes secrets not explicitly granted
  outputSchema?: JSONSchema;           // when structured output is required
  attachments?: { path: string; role: 'input' | 'reference' }[];
  abortSignal: AbortSignal;
}

export interface SessionHandle {
  sessionId: string;
  events: AsyncIterable<AdapterEvent>;
  interject?(text: string): Promise<void>;
  stop(reason: string): Promise<void>;
  result(): Promise<SessionResult>;    // resolves after the stream ends
}

export type AdapterEvent =
  | { type: 'session.started'; sessionId: string; model: string; tools: string[]; meta: Record<string, unknown> }
  | { type: 'text'; text: string; partial: boolean; agentPath?: string[] }
  | { type: 'thinking'; text: string }
  | { type: 'tool.call'; id: string; name: string; input: unknown; agentPath?: string[] }
  | { type: 'tool.result'; id: string; ok: boolean; summary: string; bytes?: number }
  | { type: 'file.changed'; path: string; change: 'created' | 'modified' | 'deleted' }
  | { type: 'control'; token: ForgeControlToken; payload: unknown }   // parsed FORGE_* tokens
  | { type: 'retry'; attempt: number; maxRetries: number; reason: string; delayMs: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; costUsd?: number }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'session.ended'; reason: 'complete' | 'aborted' | 'error' | 'limit'; };

export interface SessionResult {
  sessionId: string;
  ok: boolean;
  finalText: string;
  structured?: unknown;
  usage: { inputTokens: number; outputTokens: number; costUsd?: number; turns: number };
  durationMs: number;
  changedFiles: string[];
  controlTokens: ParsedControlToken[];
  error?: { code: string; message: string };
}
```

### Tool grant mapping

```ts
export interface ToolGrant {
  read: boolean;
  write: boolean;
  exec: string[] | false;    // command patterns, e.g. "pnpm test*", "git diff*"
  network: 'none' | 'allowlist' | 'full';
  allowlistHosts?: string[];
  extra?: string[];          // adapter-specific tool names, escape hatch
}
```

Adapters MUST fail closed: if a grant cannot be expressed in the platform's permission system, the
adapter reports `unsupported` and the engine refuses to run that step rather than running it with
broader permissions.

## 7.3 Claude Code adapter

Package: `@forge/adapter-claude-code`.

### Transport

Two modes, selected by config (`platform.claudeCode.transport`):

| Mode | Mechanism | When |
|---|---|---|
| `sdk` *(default)* | `@anthropic-ai/claude-agent-sdk` — `query({ prompt, options })` async iterator, in-process | Best fidelity: hooks, streaming, structured output, session control |
| `cli` | Spawn `claude -p ... --output-format stream-json --verbose` and parse NDJSON | When the SDK isn't installable, or the user wants their existing CLI auth/config |

The adapter MUST implement both and select automatically with a documented preference order, because
users' environments differ (subscription auth vs API key, corporate proxies, Bedrock/Vertex).

### Mapping table

| FORGE concept | Claude Code mapping |
|---|---|
| `startSession` | SDK `query()` / CLI `claude -p` |
| `cwd` | SDK `options.cwd` / process cwd |
| `systemPrompt.append` | `--append-system-prompt` / `options.systemPrompt` append form |
| `systemPrompt.replace` | `--system-prompt` / preset-less `systemPrompt` |
| `model` | `--model` / `options.model` (resolved from `listModels`) |
| `tools.read/write/exec` | `--allowedTools` with permission-rule syntax, e.g. `Read`, `Edit`, `Bash(pnpm test *)` |
| `permissionMode: deny-unlisted` | `--permission-mode dontAsk` |
| `permissionMode: accept-edits` | `--permission-mode acceptEdits` |
| `permissionMode: auto` | `--permission-mode auto` |
| `permissionMode: manual` | default; requires interactive approval → engine surfaces prompts |
| `limits.maxTurns` | `--max-turns` |
| `outputSchema` | `--output-format json --json-schema <schema>` → `structured_output` |
| streaming | `--output-format stream-json --verbose` (+ `--include-partial-messages` for deltas) |
| session resume | `--resume <sessionId>` / `options.resume` |
| reproducible runs | `--bare` (skips hooks/plugins/MCP/CLAUDE.md auto-discovery) |
| nested agent visibility | forward subagent messages so nested transcripts can be rebuilt |
| cost/usage | `result` message `total_cost_usd`, per-model breakdown, token counts |
| retry visibility | `system/api_retry` events → `AdapterEvent{type:'retry'}` |
| init metadata | `system/init` event → model, tools, MCP servers, plugin/MCP load errors |

**Normative implementation notes:**

- Treat cost figures as **client-side estimates**; the ledger labels them as such.
- Use `--bare` for all FORGE-driven steps by default (`platform.claudeCode.bare: true`) so runs are
  reproducible across machines and unaffected by a user's personal hooks/CLAUDE.md. Provide
  `bare: false` for users who *want* their project's own config to apply, and warn that runs become
  machine-dependent. Note that in bare mode OAuth/keychain credentials are not read, so
  `ANTHROPIC_API_KEY` (or Bedrock/Vertex/Foundry provider credentials) must be present — surface this
  in `forge doctor` with an exact remedy.
- Do not rely on the presence of any specific CLI flag without probing: `preflight()` MUST run
  `claude --version`, parse it, and compare against a `minimumVersion` constant; unknown/older
  versions degrade capabilities rather than crashing. **Feature-detect via the `capabilities` array
  in the `system/init` event where available rather than comparing version strings.**
- Never pass secrets in `prompt`. Secrets reach the session only via `env` and only when the step's
  grant includes them.
- Piped stdin is size-capped; large inputs MUST be written to files inside the worktree and
  referenced by path, never piped.
- Handle background-task drain semantics: after the final result, allow the documented grace period
  before considering the process hung; treat SIGTERM exit code 143 as a clean abort.

### Skills and MCP on this adapter

Claude Code reports `skills: 'native'` and `mcp: true`. The adapter therefore:

- materialises the step's resolved skill packets into the platform's skill directory **inside the
  lane worktree**, so progressive disclosure is the platform's job and skills never leak across lanes
  or into the user's global configuration;
- passes only the granted MCP server subset as the session's MCP configuration, then reads the
  session's init metadata to confirm each granted server actually loaded — a granted server that
  failed to load fails the step rather than silently degrading the agent's reach;
- keeps `--bare` on by default precisely so the session's skill and MCP surface is the one FORGE
  declared, not whatever happens to sit in the user's home directory or the repo's `.mcp.json`.
  `mcp.adoptHostServers: true` opts out, loudly (see `15` §15.5.2).

### Optional: FORGE MCP server

The adapter MAY register an in-process MCP server exposing FORGE-native tools to the session:

| Tool | Purpose |
|---|---|
| `forge_kb_search(query)` | Retrieve KB entries by relevance, with IDs |
| `forge_kb_get(id)` | Fetch a KB entry or artifact verbatim |
| `forge_spec_get(id)` | Fetch a spec artifact |
| `forge_ask(question, options)` | Escalate a question to the human through the TUI |
| `forge_assume(text, confidence, impact)` | Record an assumption |
| `forge_handoff(role, reason)` | Request a handoff |
| `forge_request_change(target, reason)` | Request a change to a frozen contract |
| `forge_report(kind, payload)` | Emit structured findings (review, RCA, test plan) |
| `forge_skill_load(id)` | Load a skill body on demand (progressive disclosure fallback) |

This is strictly better than parsing `FORGE_*` tokens out of prose, and MUST be preferred when the
adapter reports `mcp: true`. The token parser remains as the universal fallback.

## 7.4 CodeMachine adapter — descoped

An earlier revision of this spec planned `@forge/adapter-codemachine`, a declarative binding for a
third-party tool called CodeMachine, built defensively (capability-probing, config-declared) because
its CLI surface was never pinned down. **This has been dropped, deliberately, not merely deferred.**
FORGE's own scope is a CLI tool/framework that drives a real coding-agent runtime; Claude Code (§7.3)
plus the generic declarative adapter (§7.5) already cover that without needing a second, named
third-party binding whose own interface was never confirmed to exist as described. No
`@forge/adapter-codemachine` package is planned. A user who wants to drive some other CLI coding tool
through FORGE does so via §7.5's own generic mechanism directly — that is the general answer this
section's own removal leaves in place, not a gap.

The section number is kept (not renumbered) so existing cross-references to "`07` §7.4" land on this
explanation rather than silently landing on unrelated content.

## 7.5 Generic declarative CLI adapter

`@forge/adapter-generic` lets a user support a new platform without writing TypeScript.

`# canonical` — `adapters/<id>/adapter.yaml`

```yaml
id: my-platform
displayName: My Platform
binary: myagent
minimumVersion: "1.4.0"
versionCommand: ["--version"]
versionRegex: "v?(\\d+\\.\\d+\\.\\d+)"

capabilities:
  streaming: true
  sessionResume: false
  structuredOutput: false
  toolAllowlist: true
  cwdIsolation: true
  costReporting: none

invoke:
  args:
    - "--prompt-file"
    - "{{promptFile}}"
    - "--cwd"
    - "{{cwd}}"
    - "--model"
    - "{{model}}"
  # conditional args
  when:
    - if: "tools.write == false"
      args: ["--read-only"]
    - if: "limits.maxTurns"
      args: ["--max-steps", "{{limits.maxTurns}}"]
  stdin: none | prompt
  env:
    MYAGENT_NO_COLOR: "1"

events:
  format: ndjson | text
  # for ndjson: map source fields onto AdapterEvent
  map:
    - match: { type: "message", role: "assistant" }
      emit: { type: "text", text: "{{.content}}" }
    - match: { type: "tool_call" }
      emit: { type: "tool.call", name: "{{.tool}}", input: "{{.args}}" }
    - match: { type: "done" }
      emit: { type: "session.ended", reason: "complete" }
  # for text: regex-based extraction (lossy; capabilities.streaming should be false)

result:
  successExitCodes: [0]
  finalTextFrom: lastAssistantText | stdout | file:{{outFile}}

files:
  changeDetection: git-status | fs-watch     # how FORGE learns which files changed
```

The generic adapter MUST run the same conformance suite and report honest capabilities.

## 7.6 Adapter conformance suite

`@forge/adapter-kit/conformance` exports a vitest suite any adapter must pass. Run via
`forge doctor --adapter <id> --conformance` or in CI with a fixture project.

| # | Test | Asserts |
|---|---|---|
| C1 | Hello session | Session starts, streams ≥1 text event, ends `complete`, `result().ok === true` |
| C2 | cwd isolation | A file written by the session appears in the given cwd only |
| C3 | Tool restriction | With `write:false`, an instruction to write a file results in no file change and a refusal/error rather than a write |
| C4 | Exec allowlist | `exec:["echo *"]` permits `echo hi`, blocks `rm -rf` |
| C5 | Abort | `abortSignal` aborts within 5 s; no orphan child processes remain |
| C6 | Limits | `maxTurns` respected; session ends with reason `limit` |
| C7 | Usage reporting | `usage` event(s) present with non-negative token counts |
| C8 | Structured output | If `structuredOutput`, output validates against a supplied schema |
| C9 | Resume | If `sessionResume`, a resumed session retains prior context (probe question) |
| C10 | Control tokens | A prompt instructing `FORGE_ASK` produces a parsed `control` event |
| C11 | Error surface | Invalid model id produces a typed, non-retryable `error` event, not a hang |
| C12 | Concurrency | N=3 concurrent sessions in distinct cwds complete without cross-talk |
| C13 | No secret leak | Env vars not in the grant are absent from the child process environment |
| C14 | Determinism of reporting | `changedFiles` matches `git status --porcelain` in the worktree |
| C15 | Skill scoping | A provisioned skill is visible to the session and does not leak into other lanes or the user's global config; the declared degradation strategy is applied when `skills !== 'native'` |
| C16 | MCP grant fidelity | Granted tools `[a]` of a server exposing `[a,b]`: `a` succeeds, `b` is denied; ungranted servers are absent from the session's reported server list |

Adapters that fail C2, C5, C13, C14 or C16 MUST be rejected at load time — these are
safety-critical.

## 7.7 Adapter selection and fallback

```yaml
platform:
  primary: claude-code
  fallback: my-generic-adapter   # a §7.5 generic-declarative-adapter id; used when primary preflight
                                  # fails or hits provider outage
  perAgent:                      # optional routing
    diagnostician: claude-code
    sdet: my-generic-adapter
  routing:
    onRateLimit: fallback        # fallback | wait | fail
    onOutage: fallback
```

Fallback switching mid-run is allowed only at step boundaries and is recorded as an event, because
context does not transfer between platforms. The engine re-packs context for the new platform.
