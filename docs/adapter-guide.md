# Platform adapters

An **adapter** turns FORGE's platform-neutral concept — "run an agent session with this prompt,
these tools, in this directory, and tell me what happened" — into a concrete coding-agent runtime.
This is the seam that lets FORGE drive Claude Code today and, in principle, any other CLI coding
tool a user configures, without the method, the workflow engine, or the Knowledge Body knowing which
one.

**Boundary rule (enforced by lint, not just convention):** nothing above `@forge/adapter-kit` may
reference Claude Code, MCP, subagents, slash commands, or any model name by identifier.
`packages/cli/src/bin.ts` itself never imports an adapter package directly or names a platform as a
string literal — it loads adapters dynamically through `@forge/adapter-kit/registry`'s
`KNOWN_ADAPTER_MODULES`/`loadAdapterFactory`, from a specifier built from configuration.

Two real adapters ship today: `@forge/adapter-claude-code` and `@forge/adapter-generic`.

## The `PlatformAdapter` contract

Every adapter implements the same interface (`specs/07` §7.2): `capabilities()`, `preflight()`,
`listModels()`, `startSession()`/`resumeSession()`, and the optional `installAssets`, `structured`,
`provisionSkills`, `provisionMcp`. A session emits a typed stream of `AdapterEvent`s (`text`,
`tool.call`/`tool.result`, `file.changed`, `usage`, `retry`, `error`, `session.ended`, …) and
resolves to a `SessionResult` with usage, changed files and any parsed control tokens.

Adapters **must fail closed**: if a tool grant can't be expressed in the platform's own permission
system, the adapter reports it as unsupported and the engine refuses to run that step, rather than
running it with broader permissions than were granted.

Both real adapters are checked against the same 16-test conformance suite
(`@forge/adapter-kit/conformance`, `specs/07` §7.6) — session lifecycle, cwd isolation, tool
restriction, exec allowlisting, abort, limits, usage reporting, control tokens, concurrency, no
secret leakage, and (where applicable) resume/structured-output. Failing C2, C5, C13, C14 or C16
gets an adapter rejected at load time — those five are safety-critical.

## `@forge/adapter-claude-code`

The adapter `forge init` selects by default (and, as of this milestone, the _only_ one the CLI
dispatcher can construct automatically — see [below](#the-generic-adapter-and-the-cli-today)).

**Transport:** two modes, selected by `platform.adapterConfig['claude-code'].transport`:

| Mode              | Mechanism                                                                   | When                                                                      |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `sdk` _(default)_ | `@anthropic-ai/claude-agent-sdk`, in-process                                | Best fidelity: hooks, streaming, structured output, session control       |
| `cli`             | Spawns `claude -p ... --output-format stream-json --verbose`, parses NDJSON | When the SDK isn't installable, or you want your existing CLI auth/config |

**Bare mode (`bare: true`, the default):** every FORGE-driven session runs with `--bare`, which
skips hooks, plugins, MCP auto-discovery and your personal `CLAUDE.md` — this is what makes a FORGE
run reproducible across machines. The real cost: bare mode never reads OAuth/keychain credentials,
so it requires `ANTHROPIC_API_KEY` (or a Bedrock/Vertex/Foundry credential) to be present in your
environment, confirmed by `preflight()` before any session starts. Set `bare: false` to let your
project's own config/hooks apply instead (at the cost of machine-dependent runs):

```yaml
# .forge/config.yaml
platform:
  primary: claude-code
  adapterConfig:
    claude-code:
      bare: false # allow ambient subscription/OAuth login instead of requiring ANTHROPIC_API_KEY
      transport: cli # optional: pin a transport instead of auto-detecting
```

**`forge doctor` is the diagnostic entry point** — it reports exactly which of `claude` on `PATH`,
minimum version, and a usable credential is missing, with the concrete remedy (install Claude Code,
run `claude update`, run `claude auth login`, or set `ANTHROPIC_API_KEY`), rather than a generic
failure.

**Skills and MCP:** Claude Code reports `skills: 'native'` and `mcp: true`. The adapter materialises
a step's resolved skill packets into the platform's skill directory _inside the lane worktree_ (so
skills never leak across lanes or into your global configuration), and passes only the step's
granted MCP server subset — a granted server that fails to load fails the step rather than silently
degrading what the agent can reach. `mcp.adoptHostServers: true` opts into your ambient `.mcp.json`
instead, loudly (`specs/07` §7.3, `specs/15` §15.5.2).

## The generic declarative CLI adapter — `@forge/adapter-generic`

`@forge/adapter-generic` lets you support a new platform **without writing TypeScript**, by
describing its CLI surface in one `adapter.yaml`. This mechanism is real, already built, and already
covered by the same conformance suite as the Claude Code adapter (shipped in M11) — see
`packages/adapter-generic/src/` and its tests for the implementation.

```yaml
# canonical shape — adapters/<id>/adapter.yaml (`specs/07` §7.5)
id: my-platform
displayName: My Platform
binary: myagent
minimumVersion: '1.4.0'
versionCommand: ['--version']
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
    - '--prompt-file'
    - '{{promptFile}}'
    - '--cwd'
    - '{{cwd}}'
    - '--model'
    - '{{model}}'
  when:
    - if: 'tools.write == false'
      args: ['--read-only']
    - if: 'limits.maxTurns'
      args: ['--max-steps', '{{limits.maxTurns}}']
  stdin: none
  env:
    MYAGENT_NO_COLOR: '1'

events:
  format: ndjson
  map:
    - match: { type: 'message', role: 'assistant' }
      emit: { type: 'text', text: '{{.content}}' }
    - match: { type: 'tool_call' }
      emit: { type: 'tool.call', name: '{{.tool}}', input: '{{.args}}' }
    - match: { type: 'done' }
      emit: { type: 'session.ended', reason: 'complete' }

result:
  successExitCodes: [0]
  finalTextFrom: lastAssistantText

files:
  changeDetection: git-status # or fs-watch
```

Field-by-field: `binary`/`minimumVersion`/`versionCommand`/`versionRegex` drive `preflight()`;
`invoke.args` is a template rendered per session, with `invoke.when` adding conditional args from
the real `SessionRequest` (tool grants, limits); `events.map` translates the external tool's own
NDJSON vocabulary onto real `AdapterEvent`s (you can map any number of source shapes onto `text`,
`tool.call`, `tool.result`, `usage`, `error`, `session.ended`, etc. — the worked example's three
entries are the minimum to illustrate the mechanism, not a closed list); `result.finalTextFrom`
picks how the adapter recovers the session's final answer (`lastAssistantText`, `stdout`, or
`file:{{outFile}}`); `files.changeDetection` picks how FORGE learns which files a session touched.
`events.format: text` (regex-based extraction) is named in the spec as a lossy fallback but has no
field-level schema anywhere in the spec pack — `@forge/adapter-generic` honestly does not implement
it; use `ndjson`.

`@forge/adapter-generic`'s own package (`parseAdapterConfig`, `adapterYamlConfigSchema`,
`GenericAdapter`) parses and validates this file, and `GenericAdapter` — given a parsed config —
implements the full `PlatformAdapter` interface and passes the same conformance suite the Claude
Code adapter does.

### The generic adapter and the CLI, today

Be precise about what's wired versus what's real-but-not-yet-reachable from `forge`:

- **Real and tested:** the `adapter.yaml` schema, the parser, `GenericAdapter` itself, and the
  conformance suite passing against it (scripted-binary fixtures in
  `packages/adapter-generic/test/fixtures/`).
- **Not yet wired:** `@forge/adapter-kit/registry`'s `KNOWN_ADAPTER_MODULES` — the list
  `packages/cli/src/bin.ts` uses to auto-detect and construct candidate adapters for `forge init`/
  `forge run` — lists only `claude-code`. `@forge/adapter-generic` is deliberately not in that list:
  a `GenericAdapter` needs a real, already-parsed `adapter.yaml` to construct from, and no project
  template in this workspace ships a default one for the dispatcher to read. This is a disclosed,
  deliberate gap (`SPEC-QUESTIONS.md` Q184), not an oversight. In concrete terms: **you cannot yet
  run `forge init --platform my-platform` or configure a generic adapter as `platform.primary`
  purely through the `forge` CLI.** The package is the real, correct place to build against if
  you're integrating FORGE with another coding-agent CLI programmatically (construct a
  `GenericAdapter` directly with a parsed config and pass it wherever a `PlatformAdapter` is
  expected), while the CLI's own adapter-selection surface catches up in a later milestone.

## CodeMachine adapter — deliberately descoped, not a gap

An earlier spec revision planned `@forge/adapter-codemachine`, a defensive binding for a third-party
tool whose own CLI surface was never pinned down. **This was dropped, deliberately, not merely
deferred** (`specs/07` §7.4). No such package exists, and none is planned. If you want to drive some
other CLI coding tool through FORGE, the generic declarative adapter above is the general mechanism
for that — not a stopgap pending a codemachine-specific binding, but the actual, intended answer.

## The fake adapter is strict

`@forge/testkit`'s `FakePlatformAdapter` refuses, by default, a session whose prompt is empty, a
bare path, or lacks the nine blocks of `05` §5.3 with the verbatim operating contract in block [1]
(`STRICT_PROMPT_VIOLATION`). A module or adapter test that dispatches through the engine should stay
strict; a test that hand-builds requests passes `{ strict: false }` (`HAND_BUILT_REQUESTS`).

## Selection, fallback and routing

```yaml
# .forge/config.yaml
platform:
  primary: claude-code
  fallback: my-generic-adapter # used when primary preflight fails or hits a provider outage
  perAgent: # optional per-role routing
    diagnostician: claude-code
  routing:
    onRateLimit: fallback # fallback | wait | fail
    onOutage: fallback
```

Fallback switching mid-run is allowed only at step boundaries and is recorded as an event, since
context does not transfer between platforms — the engine re-packs context for the new platform
(`specs/07` §7.7). `forge init` writes this block with `primary: claude-code`, empty `perAgent`, and
`fallback: null` by default; edit `.forge/config.yaml` directly (or
`forge config set platform.fallback <id>`) to change it.
