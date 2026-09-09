# PLAN-M7 — Claude Code adapter and the first real run

Source: `specs/22` M7. **Build:** `@forge/adapter-claude-code` — both transports (`sdk` and `cli`), the
full mapping table from `07` §7.3, skill provisioning scoped to the lane worktree, MCP grant
provisioning with load verification, the FORGE MCP server (including `forge_skill_load`), cost/usage
extraction, retry and rate-limit event mapping, version probing with capability feature-detection.
**Do not build:** `@forge/adapter-codemachine` (`07` §7.4) or `@forge/adapter-generic` (`07` §7.5) —
neither appears in M7's own Build line in `specs/22`; both are real, already-anticipated boundary-graph
entries (`tools/eslint-plugin-forge-boundaries/src/graph.mjs` already declares
`adapter-codemachine`/`adapter-generic` edges) for a later milestone.

This is the first milestone whose own Acceptance criterion cannot be fully self-certified inside an
unattended build session: "Passes all 16 conformance tests against real Claude Code, both transports"
and the live-smoke exit test both make real, billed calls to Anthropic's API. Per the coordinator's own
explicit direction: build the whole adapter and the whole conformance/live-smoke test surface now (zero
cost — everything is written so it *can* run live, gated behind `FORGE_LIVE=1` plus a real credential
probe), but the actual live run is a separate, explicit step the coordinator (or whoever holds
`ANTHROPIC_API_KEY`) triggers themselves. The coordinator has confirmed both auth modes must be real,
first-class, and dual-tested — not just one:
- **bare + API key** (`platform.claudeCode.bare: true`, the spec's own default): reproducible,
  machine-independent, requires `ANTHROPIC_API_KEY` (or Bedrock/Vertex/Foundry credentials) since bare
  mode does not read OAuth/keychain credentials.
- **non-bare + subscription** (`bare: false`): uses the already-installed `claude` CLI's own ambient
  OAuth/keychain login (a Claude subscription, not an API key) — machine-dependent, explicitly named in
  `07` §7.3's own normative notes as a supported user choice, not a fallback of last resort.

**Real, already-built surface this milestone reuses rather than re-invents** (confirmed by direct
inspection):
- `@forge/adapter-kit`'s own full `PlatformAdapter`/`SessionRequest`/`SessionHandle`/`SessionResult`/
  `AdapterEvent`/`AdapterCapabilities`/`ToolGrant`/`ResolvedSkill`/`GrantedMcpServer`/`McpProvisioning`
  interfaces (M4, all already stable — every field this milestone needs already has a real type; no
  interface work of this milestone's own is needed).
- `@forge/adapter-kit/conformance`'s `runAdapterConformanceSuite` (M4 P4) — the real, generic 16-test
  vitest suite (`07` §7.6) this milestone runs against the real adapter; this milestone supplies
  `ConformanceOptions`'s own real fixtures (prompts, a real scratch-dir factory, a real secret probe),
  not a second test suite.
- `@forge/adapter-kit/grants`'s `isExecAllowed`/`describeGrant` (M4 P2) — already written with this
  milestone in mind ("any concrete adapter (M7, M11) calls this rather than reimplementing its own
  command-pattern matching").
- `@forge/adapter-kit/events`'s `normalizeAdapterEvent`/`adapterEventSchema` (M4 P1) — validates a raw,
  adapter-produced object against the real `AdapterEvent` shape; this milestone's own CLI/SDK event
  mappers produce candidate objects and run them through this, rather than hand-rolling a second
  validation pass.
- `@forge/adapter-kit/control-tokens`'s `parseControlTokens`/`stripControlTokens` (M4 P3) — `FORGE_*`
  token parsing already exists generically; this milestone's own transports feed raw session text
  through it for `SessionResult.controlTokens`, they do not re-parse.
- `@forge/schemas/config`'s `platformSchema.adapterConfig` (M1, `Record<string, Record<string, unknown>>`
  keyed by opaque platform id, per `SPEC-QUESTIONS.md` Q16/Q25) — this package's own config lives at
  `adapterConfig['claude-code']`, an opaque blob `@forge/schemas` cannot and does not know the shape of;
  this milestone defines and validates that shape itself.
- `@anthropic-ai/claude-agent-sdk` (confirmed real and installable, latest `0.3.266`) — `query({prompt,
  options}): Query` (`Query extends AsyncGenerator<SDKMessage, void>`, plus `interrupt()`/
  `setPermissionMode()`/`setMcpPermissionModeOverride()`); `SDKMessage` is a large real discriminated
  union (`SDKAssistantMessage`, `SDKResultMessage` = `SDKResultSuccess | SDKResultError` carrying
  `total_cost_usd`/`usage`/`modelUsage`, `SDKSystemMessage`, `SDKAPIRetryMessage`, `SDKRateLimitEvent`,
  many more) — confirmed by unpacking the real published package's own `.d.ts` files, not assumed from
  the spec's one-line description.
- `@modelcontextprotocol/sdk` (confirmed real and installable, latest `1.30.0`) — the real MCP server
  library the FORGE MCP server piece hosts its 9 tools through, not a hand-rolled protocol
  implementation.

**Package dependency note**: `tools/eslint-plugin-forge-boundaries/src/graph.mjs` already declares
`'adapter-claude-code': ['adapter-kit', 'schemas', 'telemetry']` — no edge to `@forge/kb`, `@forge/agents`,
or `@forge/engine`. Several of the FORGE MCP server's own 9 tools (`forge_kb_search`, `forge_handoff`,
...) need real backing from exactly those packages. Resolved the identical way M6 A4/A5/A6 resolved the
same class of gap: the MCP server piece (P8) accepts an injected `ForgeMcpBackend` interface (one method
per tool) rather than importing `@forge/kb`/`@forge/agents` directly — wiring real KB/handoff/etc logic
into that backend is a *later* piece's job (wherever the real boundary edge exists, likely
`@forge/engine` or a future `@forge/sessions`), not this milestone's. This milestone's own job is a
real, protocol-correct MCP server that calls whatever backend it's given.

Nine pieces, dependency-ordered. Production-code budget is ≤ ~400 lines per piece for genuinely new
logic, per `BUILD-PROMPT.md`.

---

## P1 — Package scaffold, adapter config schema, version probing, auth-mode detection

**Mandate:** everything the rest of the package needs before a single session can be started: the real
package skeleton, this adapter's own config shape, `claude --version` probing against a minimum-version
constant, and detecting which of the two coordinator-mandated auth modes (bare+API-key vs.
non-bare+subscription) is actually available in the current environment.

**Spec:** `07` §7.3's own normative implementation notes (version probing, `--bare` default,
`ANTHROPIC_API_KEY` requirement in bare mode).

**Surface:** `@forge/adapter-claude-code`
- `claudeCodeAdapterConfigSchema` (zod) — `transport?: 'sdk' | 'cli'` (undefined = auto-select, P4's
  own job), `bare?: boolean` (default `true`), `mcp?: { adoptHostServers?: boolean }` (`15` §15.5.2's
  own named opt-out). Parses the opaque `adapterConfig['claude-code']` blob `@forge/schemas/config`
  hands off unexamined.
- `MINIMUM_CLAUDE_CLI_VERSION` (a real, documented constant) and `probeCliVersion(env):
  Promise<{ ok: boolean; version?: string }>` — runs `claude --version`, parses via a real regex
  (`07` §7.3: "MUST run `claude --version`, parse it, and compare against a `minimumVersion`
  constant"), never throws for a missing/unparseable binary (returns `ok: false` instead — `preflight`,
  P4, is what turns this into a `PreflightIssue`).
- `interface AuthAvailability { readonly apiKey: boolean; readonly subscription: boolean }` and
  `probeAuthAvailability(env, execCommand?): Promise<AuthAvailability>` — **not** a mutually-exclusive
  enum (an earlier draft of this plan assumed one; corrected after actually running `claude --help`/
  `claude auth status --json` in this environment rather than inferring from the spec's prose alone):
  `apiKey` is `true` when `ANTHROPIC_API_KEY` (or a documented Bedrock/Vertex/Foundry credential env
  var) is present in `env`; `subscription` is `true` when the real, confirmed-real `claude auth status
  --json` command (JSON is CLI's own default output) reports `loggedIn: true`. The two are independent
  facts, not alternatives: `claude --help`'s own real, verbatim `--bare` description confirms bare
  mode's auth is "strictly `ANTHROPIC_API_KEY` or `apiKeyHelper`... OAuth and keychain are never read,"
  while non-bare (default) mode can use *either* a real subscription login or an API key — so a
  environment can have both real credentials available at once (this environment does, confirmed
  directly), and `preflight`/P9's own conformance matrix each need to know both facts independently,
  not collapse them into one. Never logs or persists the real `email`/`orgId`/`orgName` fields
  `claude auth status` returns — only the boolean `loggedIn` field is read.

**Checks:**
- `claudeCodeAdapterConfigSchema` accepts the real worked shape from `07` §7.3 (`transport: 'sdk'`,
  `bare: true`) and rejects an unknown extra key.
- `probeCliVersion` against a real, installed `claude` binary in this environment returns a real,
  correctly-parsed version string that compares as `ok: true` against `MINIMUM_CLAUDE_CLI_VERSION`; a
  fixture that points `env.PATH` at an empty directory (no `claude` binary reachable) returns
  `ok: false`, not a thrown error.
- `probeAuthAvailability` against a fixture env carrying `ANTHROPIC_API_KEY` reports `apiKey: true`
  regardless of the injected `execCommand`'s own answer (the two facts are independently checked, per
  the corrected design above) and, separately, against a real invocation of `claude auth status --json`
  in this environment reports `subscription: true` (a real, live-but-free probe — no API usage, no
  cost, so this one check runs unconditionally, not gated behind `FORGE_LIVE`).

**Depends on:** none (first piece).

---

## P2 — CLI transport: process spawn and NDJSON event mapping

**Mandate:** `07` §7.3's own `cli` transport row — spawn `claude -p ... --output-format stream-json
--verbose` and parse NDJSON into the real `AdapterEvent` stream.

**Spec:** `07` §7.3's mapping table (every row addressable from the CLI's own flag surface); `07` §7.2's
own `AdapterEvent` union (already built, M4 — this piece maps *into* it, not a second copy of it).

**Surface:** `@forge/adapter-claude-code/cli`
- `buildCliArgs(req: SessionRequest, config: ClaudeCodeAdapterConfig): readonly string[]` — pure
  function, the whole mapping table's own CLI column (`--model`, `--allowedTools`, `--permission-mode`,
  `--max-turns`, `--output-format stream-json --verbose --include-partial-messages`, `--resume`,
  `--bare`, `--append-system-prompt`/`--system-prompt`, `--output-format json --json-schema` when
  `outputSchema` is set). Tool-grant → `--allowedTools` permission-rule syntax (`Read`, `Edit`,
  `Bash(pnpm test *)`) is real, non-trivial logic of its own — built and tested here as its own pure
  sub-function (`mapToolGrantToAllowedTools`), not inlined.
- `parseCliEventLine(line: string): AdapterEvent | undefined` — pure function, one raw NDJSON line
  (a `system/init`, `assistant`, `user`, `result`, `stream_event`, or `system/api_retry`-shaped object)
  mapped to zero or one real `AdapterEvent`, run through `normalizeAdapterEvent` (M4) before being
  trusted. Cost/usage (`result.total_cost_usd`/`usage`/per-model breakdown) and retry visibility
  (`system/api_retry` → `AdapterEvent{type:'retry'}`) are real cases in this same mapping, not a
  separate piece — `07` §7.3's own table lists them as more mapping-table rows, not new mechanism.
- `spawnClaudeCli(args, options): { events: AsyncIterable<AdapterEvent>; stop(): void; exitCode:
  Promise<number> }` — the actual `execa`-backed process spawn, feeding each stdout line through
  `parseCliEventLine`; the one part of this piece that is genuinely only provable against a real
  `claude` binary (present in this environment) rather than a fixture.

**Checks:**
- `buildCliArgs` against `07` §7.3's own worked mapping-table rows (a fixture `SessionRequest` per row)
  produces the exact documented flag, including the two named worked examples
  (`Bash(pnpm test *)`-shaped exec grants).
- `parseCliEventLine` against real, recorded NDJSON line fixtures (one literal line per message shape
  named in the mapping table, captured from this piece's own real `spawnClaudeCli` runs during
  development, not invented) produces the documented `AdapterEvent`, including a `result` line with
  `total_cost_usd` producing a real, non-negative-costUsd `usage` event, and an `api_retry`-shaped line
  producing a real `retry` event with `attempt`/`maxRetries`/`delayMs` populated.
- `spawnClaudeCli` against the real, installed `claude` binary in this environment, given a trivial
  real prompt, produces a real event stream ending `session.ended` — the one test in this piece that is
  a genuine live call (small, cheap, `--model` pinned to the fastest tier); gated behind the same
  `FORGE_LIVE=1` + credential-probe convention P9 establishes formally, so a normal (non-live) run of
  this piece's own suite never makes a network call.

**Depends on:** P1 (config shape, auth-mode detection for whether this test can run live at all).

---

## P3 — SDK transport: `query()` wrapper and `SDKMessage` event mapping

**Mandate:** `07` §7.3's own `sdk` transport row (the default) — wrap `@anthropic-ai/claude-agent-sdk`'s
real `query()` into the identical `AsyncIterable<AdapterEvent>` shape P2 produces for CLI, so P4's own
`startSession` is transport-agnostic beyond construction.

**Spec:** `07` §7.3's mapping table, SDK column; `07` §7.2's own `AdapterEvent` union.

**Surface:** `@forge/adapter-claude-code/sdk`
- `buildSdkOptions(req: SessionRequest, config: ClaudeCodeAdapterConfig): Options` — the mapping
  table's own SDK-column equivalent of P2's `buildCliArgs` (`options.cwd`, `options.model`,
  `options.systemPrompt` append/replace, tool/permission mapping reusing the identical
  `mapToolGrantToAllowedTools` pure function P2 already built — one implementation, not two that could
  disagree between transports), resume via `options.resume`.
- `mapSdkMessage(message: SDKMessage): readonly AdapterEvent[]` — pure function, one real `SDKMessage`
  union member mapped to zero, one, or more `AdapterEvent`s (a single SDK message can plausibly need
  more than one FORGE event, e.g. a result message carrying both the final text and a usage report),
  every output run through `normalizeAdapterEvent`. Handles `SDKResultMessage`'s own
  `SDKResultSuccess`/`SDKResultError` split, `SDKSystemMessage` (init metadata: model, tools, MCP
  servers, plugin/MCP load errors — feeds P7's own load-verification), `SDKAPIRetryMessage`,
  `SDKRateLimitEvent`.
- `runSdkQuery(params, options): { events: AsyncIterable<AdapterEvent>; interrupt(): Promise<void> }` —
  wraps the real `query()` call, consuming its `AsyncGenerator<SDKMessage>` through `mapSdkMessage`;
  `interrupt()` calls the real `Query.interrupt()` (the SDK's own abort mechanism, distinct from the CLI
  transport's process-kill).

**Checks:**
- `buildSdkOptions` produces the documented `Options` fields for the same fixture `SessionRequest`s P2's
  own `buildCliArgs` test uses, and — critically — `mapToolGrantToAllowedTools` is asserted to be the
  *same function reference* P2 exports, not a second, potentially-diverging copy.
- `mapSdkMessage` against real `SDKMessage`-shaped fixtures (one per variant named in the mapping table,
  built from the real package's own `.d.ts` shapes) produces the documented `AdapterEvent`(s),
  mirroring P2's own fixture-per-row discipline.
- `runSdkQuery` against the real SDK, given a trivial real prompt, produces a real event stream ending
  `session.ended` — genuinely live, gated identically to P2's own live test.

**Depends on:** P1, P2 (reuses `mapToolGrantToAllowedTools` directly — confirmed a real, deliberate
shared dependency, not a coincidence, so a future change to grant-mapping logic cannot silently diverge
between transports).

---

## P4 — `ClaudeCodeAdapter`: transport selection, `startSession`/`resumeSession`, `capabilities`,
`preflight`, `listModels`

**Mandate:** the real `PlatformAdapter` implementation tying P1-P3 together — the one class every other
piece's own `provisionSkills`/`provisionMcp` methods attach to.

**Spec:** `07` §7.2 (the interface, already built by `@forge/adapter-kit`, M4 — this piece is the first
real *implementation* of it in this codebase); `07` §7.3's own transport-selection mandate ("MUST
implement both and select automatically with a documented preference order").

**Surface:** `@forge/adapter-claude-code`
- `class ClaudeCodeAdapter implements PlatformAdapter` — constructed with a config (P1's own schema) and
  an environment snapshot. `capabilities()` returns real, probed `AdapterCapabilities` (not a static
  constant): `bareMode: true`, `skills: 'native'`, `mcp: true`, `costReporting: 'per-turn'`, etc., with
  `sessionResume`/`structuredOutput`/others feature-detected from the real `system/init` capabilities
  array where the transport has already started at least one session this process lifetime (`07` §7.3:
  "Feature-detect via the `capabilities` array in the `system/init` event where available rather than
  comparing version strings"), falling back to a documented, conservative static default before any
  session has run.
- `preflight(ctx)` — real `PreflightResult`: runs P1's `probeCliVersion`/`probeAuthAvailability`,
  returns a `PreflightIssue` naming the exact remedy when `config.bare && !apiKey` (bare mode's own
  strict requirement) or `!config.bare && !apiKey && !subscription` (non-bare mode's own broader, but
  still non-empty, requirement) — `07` §7.3: "surface this in `forge doctor` with an exact remedy," this
  piece is that surfacing (`forge doctor` itself, C6, M6, is already built and is a later caller of
  this).
- **Transport preference order** (a real, documented policy, not left to chance): prefer `sdk` unless
  `config.transport === 'cli'` is explicitly set, or the SDK package fails to resolve/import at
  construction time (`"When the SDK isn't installable"`, `07` §7.3) — recorded as a real
  `SPEC-QUESTIONS.md` entry with the concrete fallback condition, since the spec names the *reason* for
  falling back without naming the exact detection mechanism.
- `startSession(req)` — constructs a real `SessionHandle` over whichever transport was selected;
  `--bare`/non-bare branches on `config.bare`, and non-bare mode is a real, first-class path (not merely
  accepted-but-untested) per the coordinator's own explicit dual-mode requirement.
- `resumeSession(sessionId, req)` — CLI `--resume`/SDK `options.resume`, whichever transport the
  original session used (tracked per adapter instance, since a resume must use the same transport the
  original session ran on — recorded as a real design decision, not assumed).
- `listModels()` — a real, small static table for now (Claude Code's own model ids), since neither
  transport exposes a "list available models" call of its own; documented as such rather than faked.

**Checks:**
- `capabilities()` before any session has run returns the documented conservative static defaults;
  after a real `system/init` event has been observed (a live test), reflects the real, probed
  capability set.
- `preflight()` against a fixture env with no `claude` binary on `PATH` and no credentials returns
  `ok: false` with two distinct, correctly-worded issues (missing binary; missing credentials) — not
  one vague failure.
- Transport selection: a fixture that makes the SDK import throw falls back to CLI, provably (the
  resulting session actually goes through `spawnClaudeCli`, not `runSdkQuery` — checked via a spy/marker,
  not merely "no error was thrown").
- `resumeSession` against a session started under the CLI transport uses the CLI transport again, even
  when the adapter's own default preference is SDK — a fixture proves this concretely, not just that
  resume "works."
- A live test (gated) starts a real session under `bare: true` when `probeAuthAvailability().apiKey` is
  real, and a second live test starts one under `bare: false` when `.subscription` is real (this
  environment, confirmed directly, already has a real subscription login — `.apiKey` becomes real once
  the coordinator sets `ANTHROPIC_API_KEY`) — the coordinator's own "test both scenarios" requirement,
  honoured as two genuinely independent live tests, not one test with a mode switch.

**Depends on:** P1, P2, P3.

---

## P5 — Tool grant and permission-mode mapping fidelity (dedicated fixture-driven test hardening)

**Mandate:** `mapToolGrantToAllowedTools`/permission-mode mapping (built inside P2, shared by P3) is
security-relevant per `07` §7.2's own "Adapters MUST fail closed" mandate — this piece is a dedicated
hardening pass with adversarial fixtures, not new production surface. Folded in as its own piece
(rather than left as "just part of P2's tests") specifically because `@forge/adapter-kit/grants`'
own `describeGrant` doc comment already records a real, previously-shipped bug class in string-based
grant serialisation (unescaped-join ambiguity) — the identical risk class applies to building a
*permission-rule string* from a grant, and deserves the same adversarial scrutiny before this milestone
ships it.

**Spec:** `07` §7.2 ("Adapters MUST fail closed: if a grant cannot be expressed in the platform's
permission system, the adapter reports `unsupported`..."); `07` §7.3's own two worked examples.

**Surface:** no new public surface — hardens `mapToolGrantToAllowedTools` (P2) directly.

**Checks:**
- `exec: false` (deny all) never produces an `--allowedTools` entry that could be misread as an
  allowance, for any adversarially-crafted `extra`/pattern content.
- A crafted exec pattern containing characters meaningful to Claude Code's own permission-rule syntax
  (parentheses, commas) is escaped/rejected rather than silently producing a *different*, broader rule
  than the one the grant actually describes — the same "a crafted pattern's own text looks like it
  closed the rule and started a different one" risk `describeGrant`'s own doc comment already names for
  a different string-building function in this same package family.
- `network: 'allowlist'` with zero `allowlistHosts` maps to the most restrictive real Claude Code
  primitive available (never silently promoted to `'full'`), and this piece names in
  `SPEC-QUESTIONS.md` whatever real fidelity gap exists between FORGE's three-value `network` grant and
  Claude Code's own actual network-control primitives (Claude Code may have none at the CLI/SDK layer at
  all — checked directly against the real package's own `Options`/CLI flags, not assumed).
- `tools.write: false` maps to an `--allowedTools` set containing no edit/write-capable tool name, cross-
  checked against the real tool names Claude Code's own `--allowedTools` syntax recognises (`Read`,
  `Edit`, `Write`, `Bash`, ... — confirmed from the real CLI's own `--help`/SDK types, not guessed).

**Depends on:** P2 (the function under hardening), P3 (confirms the shared function is genuinely shared).

---

## P6 — Skill provisioning (`provisionSkills`), scoped to the lane worktree

**Mandate:** `15` §15.6's own native-skills path for an adapter reporting `skills: 'native'` — real
filesystem materialisation of resolved skills into Claude Code's own skill directory, confined to the
step's lane worktree so skills never leak across lanes or into the user's global config.

**Spec:** `07` §7.3's own "Skills and MCP on this adapter" subsection; `15` §15.6.

**Surface:** `@forge/adapter-claude-code`
- `ClaudeCodeAdapter.provisionSkills(skills, ctx)` — writes each `ResolvedSkill`'s own `body` into a
  real file under `<ctx.cwd>/.claude/skills/<id>/SKILL.md` (or whatever the real, confirmed Claude Code
  skill-directory convention is — checked directly against the real CLI's own documented layout, not
  assumed) using `@forge/core/fs`'s own `writeFileAtomic`/`ensureDir` (this package already has a real
  boundary edge to `@forge/core`... **checked directly**: the boundary graph gives
  `adapter-claude-code: ['adapter-kit', 'schemas', 'telemetry']` — no `core` edge. Resolved the same way
  every other no-edge gap this build has hit was resolved: this piece writes files with Node's own
  `node:fs/promises` directly (not `@forge/core/fs`), since `@forge/core`'s own containment/atomicity
  guarantees exist to protect *host-project* artifact writes, not an adapter's own scratch materialised-
  skills directory inside a lane worktree it was already handed exclusive access to.
- Returns `{ strategy: 'native', provisionedSkillIds: [...] }` (the real `SkillProvisioning` shape, M4).

**Checks:**
- A provisioned skill's own body is a real, readable file at the documented path inside `ctx.cwd`.
- Two sequential calls with different `ctx.cwd` values (two different lanes) never write into each
  other's directory — proven with two real temp directories, not asserted from code reading alone.
- No write ever lands outside `ctx.cwd` (a path-traversal-shaped skill id, if the upstream `ResolvedSkill`
  schema ever allowed one, is rejected rather than escaping the lane) — C15's own "does not leak into
  other lanes or the user's global config" made a real, adversarial test.

**Depends on:** P4 (the adapter class this method attaches to).

---

## P7 — MCP grant provisioning (`provisionMcp`) with real load verification

**Mandate:** `15` §15.6's own MCP-grant path — configure only the granted server subset into the
session, then cross-check the real `system/init` event's own reported server list to confirm each one
actually loaded; a granted server that failed to load fails the step.

**Spec:** `07` §7.3's own "Skills and MCP on this adapter" subsection (the load-verification sentence);
`15` §15.5/§15.6.

**Surface:** `@forge/adapter-claude-code`
- `ClaudeCodeAdapter.provisionMcp(servers, ctx)` — builds the real MCP server configuration for whichever
  transport is active (CLI: a `--mcp-config` file scoped to `ctx.cwd`; SDK: `options.mcpServers`), scoped
  to only the granted subset, never adopting the user's own ambient `.mcp.json` unless
  `config.mcp.adoptHostServers` is explicitly set (`15` §15.5.2) — returns `{ loadedServerIds: [] }`
  provisionally; the *real* loaded-server list is only knowable once a session's own `system/init` event
  has actually arrived.
- A real design decision, recorded in `SPEC-QUESTIONS.md`: since `provisionMcp` itself runs *before* a
  session starts and has no session to read `system/init` from yet, the actual "granted-but-failed-to-
  load fails the step" enforcement lives in `startSession`'s own post-init check (P4), which compares the
  granted server id set against the real `system/init` event's own reported server list and, on a
  mismatch, ends the session with a real, typed `ADP-02x`-class error rather than letting it proceed —
  `provisionMcp`'s own returned `loadedServerIds` is populated retroactively once that check runs, for a
  caller that inspects it after the fact.

**Checks:**
- A session granted server `[a]` where the real init event reports `[a, b]` (the host adopted more than
  granted) is accepted — extra, unrequested servers are not this check's concern, only missing ones are.
- A session granted server `[a, b]` where the real init event reports only `[a]` (b failed to load) ends
  the step with a real, typed error naming `b` specifically, not a generic failure.
- `adoptHostServers` defaults to `false`/absent, and a fixture proves the ambient `.mcp.json` (if any
  exists in a test fixture project) is never read when it is absent.

**Depends on:** P4.

---

## P8 — The FORGE MCP server (in-process, 9 tools, injected backend)

**Mandate:** `07` §7.3's own "Optional: FORGE MCP server" subsection — named directly in M7's own
`specs/22` Build line, so built for real here despite the per-adapter spec text marking it optional.

**Spec:** `07` §7.3's own 9-tool table, verbatim.

**Surface:** `@forge/adapter-claude-code/forge-mcp`
- `interface ForgeMcpBackend` — one method per tool (`kbSearch(query)`, `kbGet(id)`, `specGet(id)`,
  `ask(question, options)`, `assume(text, confidence, impact)`, `handoff(role, reason)`,
  `requestChange(target, reason)`, `report(kind, payload)`, `skillLoad(id)`), each returning real,
  typed data this piece defines the shape of from the tool's own one-line spec purpose — no boundary
  edge to `@forge/kb`/`@forge/agents` exists (checked directly against `graph.mjs`: `agent-claude-code`
  has none), so every method is injected, not implemented against a real backend here; a later piece
  (wherever the real edge exists) supplies the real implementation.
- `createForgeMcpServer(backend: ForgeMcpBackend): McpServer` — a real `@modelcontextprotocol/sdk`
  server instance, registering all 9 tools with real, schema-validated input shapes per the table, each
  handler delegating to the matching `backend` method and mapping its result into a real MCP tool-result
  payload (including a real error payload, not a thrown exception, when the backend itself throws —
  MCP's own protocol contract).
- Wired into both transports (CLI: written as a real stdio MCP server the CLI connects to via
  `--mcp-config`; SDK: registered via `options.mcpServers`) whenever the adapter reports `mcp: true`,
  preferred over raw `FORGE_*` token parsing per `07` §7.3's own "MUST be preferred" line — the token
  parser (`@forge/adapter-kit/control-tokens`, M4) remains wired as the universal fallback for whichever
  tools/situations the MCP path does not cover.

**Checks:**
- All 9 tools are registered with a real, connecting MCP client (an in-process test client from
  `@modelcontextprotocol/sdk`'s own SDK, not Claude Code itself) and each round-trips a real call to its
  injected backend method and back.
- A backend method that throws produces a real MCP error result, not an uncaught rejection that kills
  the server.
- `forge_skill_load`'s own real behaviour (`15` §15.4.3's progressive-disclosure fallback) is proven
  against a fixture backend that returns a real skill body, confirming the tool's own JSON schema
  accepts exactly a skill id and nothing else.

**Depends on:** P4.

---

## P9 — Adapter conformance suite wiring, both transports, dual auth-mode aware

**Mandate:** `07` §7.6's own generic 16-test suite, run for real against this milestone's own
`ClaudeCodeAdapter` — the concrete deliverable M7's own Acceptance line names first.

**Spec:** `07` §7.6 (the full table, already implemented generically by M4 — this piece supplies real
fixtures, it does not re-describe the 16 tests).

**Surface:** `packages/adapter-claude-code/test/conformance/`
- Two real fixture files (one per transport: `sdk.conformance.test.ts`, `cli.conformance.test.ts`), each
  calling `runAdapterConformanceSuite(() => new ClaudeCodeAdapter(...), options)` with real
  `ConformanceOptions` (real natural-language prompts for `helloPrompt`/`writeFilePrompt`/
  `manyTurnsPrompt`/`execPrompt`/`controlTokenPrompt`, a real `secretProbe` fixture, real `structured`/
  `resume`/`mcp`/`skill` fixtures wired to this milestone's own P6/P7/P8 surfaces).
- A real, shared `planLiveRuns(): readonly { readonly bare: boolean; readonly reason: string }[]` gate —
  returns one entry per auth mode this environment can *actually* exercise right now (`{bare: true}`
  when `probeAuthAvailability().apiKey`; `{bare: false}` when `.subscription`), or an empty array when
  `process.env.FORGE_LIVE !== '1'` or neither credential is real. Every conformance `describe` block is
  driven by this list (`describe.skipIf(runs.length === 0)`, and `it.each(runs)` for the pieces that
  genuinely differ by mode), so `pnpm test` (no `FORGE_LIVE`) never attempts a network call, and a
  developer running `FORGE_LIVE=1` with no real credentials configured gets a clear, actionable skip
  message rather than a confusing hang or a wall of auth-failure errors.
- When both auth modes have real credentials available in the same environment (the coordinator's own
  stated intent — "provide api key also so we can test both scenarios"), the suite runs once under each
  mode (a real config-matrix `it.each`/nested `describe`, not merely "whichever one happens to be
  configured"), so both are genuinely exercised, not just the first one found.

**Checks:**
- Every one of the 16 tests (C1-C16) is real and wired to a real fixture — no test is a placeholder or
  an assertion against a mock standing in for Claude Code.
- The five safety-critical ids (`C2`, `C5`, `C13`, `C14`, `C16`, `SAFETY_CRITICAL_CONFORMANCE_IDS` from
  M4) are asserted, in a real (non-live) unit test of `shouldRunLive`'s own gating logic, to never be
  silently skipped by anything *other* than the documented `FORGE_LIVE`/credential gate — i.e., no
  piece of this milestone's own code additionally special-cases them away.
- Without `FORGE_LIVE=1` set, running this piece's own test file completes in well under a second with
  every test reporting `skipped` and the real reason printed — proven directly (no network call
  attempted, checked by a test-local network-call counter/spy, not merely "it finished fast").

**Depends on:** P1 through P8 (this is the integration point for the whole package).

---

Live-run verification of P9's own suite (`FORGE_LIVE=1`, both transports, both auth modes once real
credentials exist) and M7's own second exit test (`FORGE_LIVE=1 pnpm test -- --grep "live smoke"` — one
real init + one story via `@forge/engine`'s already-built `runEngine`, artifacts validated) are the
milestone's own explicit checkpoint: *"Stop, run a genuine project through it, and let that experience
inform M8+."* Per the coordinator's own direction, that live run is a deliberate, explicit, jointly-
supervised step taken once real credentials are available — not something this plan's own pieces
attempt unsupervised. A tenth piece (the live-smoke test itself, likely living at the repo root
alongside M6's own cross-package e2e precedent) is written once P1-P9 are committed, gated identically,
and is the one piece whose own real, live pass/fail this plan defers to that joint step rather than to
an unattended critic round.
