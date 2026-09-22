# 02 — System Architecture and Technology Stack (of FORGE itself)

## 2.1 Runtime tech decisions (normative)

| Concern | Decision | Rationale / constraints |
|---|---|---|
| Language | **TypeScript 5.6+**, strict, ESM only | Ecosystem alignment with Claude Code/npx; type-driven schemas |
| Runtime | **Node.js ≥ 20.10** (LTS), tested on 20/22/24 | `node:test` not used; native fetch, `AbortSignal.timeout`, stable ESM |
| Package manager (dev) | **pnpm ≥ 9** with workspaces | Fast, strict node_modules, good monorepo story |
| Task runner | **Turborepo** | Cached builds across packages |
| Bundler | **tsup** (esbuild) per package; CLI bundled to a single ESM file | Fast npx cold start |
| CLI parsing | **commander@12** + zod validation of parsed args | Mature, good help output |
| TUI | **Ink 5** (React 18 renderer for terminals) | Component model, testable via `ink-testing-library`; large ecosystem |
| TUI extras | `ink-text-input`, `ink-select-input` (or hand-rolled), `cli-boxes`, `ansi-escapes` | Avoid heavy deps; hand-roll where a dep is <100 LOC |
| Validation/schema | **zod 3** as source of truth; JSON Schema emitted via `zod-to-json-schema` | Single definition, runtime + editor validation |
| YAML | `yaml` (eemeli) with source-position retention | Needed for precise error messages on user-authored files |
| Front-matter | `gray-matter` | Markdown artifacts with YAML front matter |
| Templating | **Handlebars** (strict mode, no `eval`, custom helper set) | Deterministic, no arbitrary code |
| Diagram validation | **`mermaid` parser** (pure JS, no browser) | Must be cheap enough to run on every gate; no Puppeteer in the default path |
| Diagram rendering | Optional local renderer; default fallback = self-contained HTML with a bundled Mermaid script | Rendering must never require a network call or a heavy install (see `08` §8.11.8) |
| PlantUML / D2 (opt-in) | Shell out to a locally installed binary if present; otherwise the notation is reported unavailable | Never bundled; never a hosted service by default |
| Git | `simple-git` for porcelain + direct `git` subprocess for worktrees | Worktree support in libs is weak |
| Process exec | `execa@9` | Streams, abort signals, cross-platform |
| Local DB (derived) | **better-sqlite3** for the run ledger/index | Synchronous, embedded, fast; MUST be rebuildable from event log |
| Logging | **pino** → NDJSON file; TUI reads a ring buffer | Structured, greppable |
| Testing | **vitest** + `ink-testing-library` + `memfs` for FS isolation | Fast, ESM-native |
| Lint/format | **eslint 9 flat config** + **prettier** | — |
| Versioning/release | **changesets**, semver, `latest`/`next` dist-tags | Mirrors BMAD's `@next` prerelease UX |
| Node API surface | No native addons except `better-sqlite3`; ship a pure-JS fallback (`node:sqlite` if available, else JSON index) | npx must work everywhere |

**Cold-start budget:** `npx forge-method --version` MUST complete in < 1.5 s warm cache;
`forge status` MUST render first frame in < 400 ms on a 100-artifact project.

## 2.2 Monorepo layout

```
forge/
├─ package.json                # workspace root, private
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
├─ .changeset/
├─ packages/
│  ├─ cli/                     # @forge/cli  → published as `forge-method`, bin: forge
│  ├─ core/                    # @forge/core          domain model, artifacts, spec graph, IDs
│  ├─ schemas/                 # @forge/schemas       zod schemas + JSON Schema emit + migrations
│  ├─ kb/                      # @forge/kb            Knowledge Body store, index, retrieval, lint
│  ├─ engine/                  # @forge/engine        workflow interpreter, scheduler, gates, runs
│  ├─ agents/                  # @forge/agents        agent registry, persona compilation, handoffs
│  ├─ adapter-kit/             # @forge/adapter-kit   Platform interface + conformance suite
│  ├─ adapter-claude-code/     # @forge/adapter-claude-code
│  ├─ adapter-generic/         # @forge/adapter-generic  (YAML-declared CLI adapters)
│  ├─ vcs/                     # @forge/vcs           git, worktrees, branches, merge queue
│  ├─ methods/                 # @forge/methods       decision frameworks, rubrics, level selection
│  ├─ catalog/                 # @forge/catalog       technology catalog data + selection engine
│  ├─ diagrams/                # @forge/diagrams      notation parsers, validators, generators, render
│  ├─ sessions/                # @forge/sessions      brainstorming/retro/review facilitation
│  ├─ extensions/              # @forge/extensions    layering, overlays, skills, MCP registry, presets
│  ├─ templates/               # @forge/templates     bundled templates, workflows, checklists (data)
│  ├─ tui/                     # @forge/tui           Ink application
│  ├─ telemetry/               # @forge/telemetry     event log, ledger, cost, tracing
│  ├─ installer/               # @forge/installer     init/upgrade/migrate, host project writes
│  └─ testkit/                 # @forge/testkit       fixtures, fake adapter, golden-file harness
├─ modules/                    # first-party installable modules (see 18)
│  ├─ fm-core/                 # always installed
│  ├─ fm-web/                  # web app specialisation
│  ├─ fm-service/              # backend service / API specialisation
│  ├─ fm-data/                 # data platform / pipelines specialisation
│  └─ fm-mobile/               # mobile / cross-platform specialisation
├─ fixtures/                   # sample host projects for e2e
└─ docs/
```

### Dependency rules (enforced by an eslint boundary rule + a CI script)

```
schemas  ← (no forge deps)
core     ← schemas
kb       ← core, schemas, diagrams
vcs      ← (no forge deps besides schemas)
telemetry← schemas
adapter-kit ← schemas, telemetry
adapter-*   ← adapter-kit, schemas, telemetry
methods  ← core, kb, schemas
catalog  ← schemas
diagrams ← core, schemas                     (no engine/adapter deps; generators take artifacts in)
extensions ← schemas, core, templates        (layer resolution; no engine/adapter deps)
agents   ← core, kb, schemas, adapter-kit, templates, extensions
sessions ← core, kb, agents, schemas
engine   ← core, kb, agents, adapter-kit, vcs, telemetry, schemas, methods, extensions
installer← core, schemas, templates, extensions
tui      ← engine, core, kb, telemetry, schemas        (READ-ONLY on domain state; acts via engine commands)
cli      ← everything
```

Violations (e.g. `core` importing `engine`, or `tui` writing artifacts directly) MUST fail CI.

## 2.3 Runtime architecture

```
                       ┌──────────────────────────────┐
                       │        CLI (commander)       │
                       └───────────────┬──────────────┘
                        interactive?   │
                  ┌────────────────────┴─────────────────────┐
                  ▼                                          ▼
        ┌──────────────────┐                    ┌────────────────────────┐
        │   TUI (Ink)      │ ── commands ─────▶ │    Engine (headless)   │
        │  read model ◀────┼── event stream ─── │  scheduler + runner    │
        └──────────────────┘                    └───────┬────────────────┘
                                                        │
      ┌──────────────┬──────────────┬───────────────────┼──────────────┬───────────────┐
      ▼              ▼              ▼                   ▼              ▼               ▼
 ┌─────────┐   ┌──────────┐   ┌──────────┐      ┌─────────────┐  ┌──────────┐   ┌───────────┐
 │  Spec   │   │ Knowledge│   │  Agents  │      │  Adapters   │  │   VCS    │   │ Telemetry │
 │  Graph  │   │   Body   │   │ registry │      │ CC / CM /…  │  │ worktree │   │ ledger    │
 └────┬────┘   └────┬─────┘   └────┬─────┘      └──────┬──────┘  └────┬─────┘   └─────┬─────┘
      └─────────────┴──────────────┴────────────────┬──┴──────────────┴───────────────┘
                                                    ▼
                                    <project>/  files, git, .forge/state
```

**Key architectural rules:**

1. **The engine is headless and TUI-agnostic.** It exposes a command/query API and emits a typed
   event stream. Everything the TUI can do, the non-interactive CLI can do.
2. **CQRS-ish split.** Mutations go through `EngineCommand`s; the TUI subscribes to a projected
   read model built from the event log. The TUI never mutates domain state directly.
3. **Event-sourced run state.** `.forge/state/events.ndjson` is the write-ahead log of truth for a
   run. SQLite (`state/index.db`) is a *projection* and MUST be droppable/rebuildable
   (`forge doctor --rebuild-index`).
4. **Artifacts are files.** Artifacts live in the repo as Markdown/YAML; the KB index is a
   projection of those files. If a human edits an artifact by hand, `forge sync` reconciles.
5. **Single writer per path.** The engine serialises all writes to `<project>` through the VCS lane
   manager; adapters write only inside their lane's worktree.

## 2.4 Process model

- One **supervisor process** (`forge`) owns: state, scheduler, event log, TUI.
- Each **lane** runs one adapter session as a child process (or in-process SDK stream), managed by
  a `LaneRunner`. Default concurrency = `min(4, cpus/2)`, configurable.
- Supervisor↔lane communication: adapter-normalised event stream (see `07`).
- **Crash safety:** every state transition is appended to the event log with `fsync` before the
  side-effect it authorises is attempted; side-effects are idempotent and keyed by `stepRunId`.
  On restart, in-flight steps are either resumed (adapter supports session resume) or re-run from
  their last committed checkpoint after rolling back the lane worktree to its last known-good commit.
- **Signals:** `SIGINT` = graceful pause (finish current tool call, checkpoint, exit 130).
  Second `SIGINT` within 3 s = hard abort (terminate lane process trees, checkpoint, exit 130).
  `SIGTERM` = graceful pause. Always leave state resumable.

## 2.5 Concurrency and I/O safety

- All FS writes to `<project>` go through `@forge/core/fs` which enforces: path is inside the project
  root or lane worktree; path is not in the deny list (`.git/`, `.forge/state/`, `node_modules/`);
  writes are atomic (`write temp → fsync → rename`).
- A cross-process **project lock** (`.forge/state/forge.lock`, PID + start time + hostname) prevents
  two FORGE supervisors operating on one project. Stale locks (dead PID) are reclaimed with a prompt.
- KB writes are serialised through a single `KbWriter` with an in-memory queue; a KB change no lane
  declares as its own step output is a *proposal*, applied as a patch through the writer (see `08`
  §8.6). A lane's own declared KB output is the one exception: the agent writes it as a file on the
  lane, and the output contract enforces the same guarantees directly — a registry-allocated id with no
  collision, mandatory `sources`, deprecate-not-delete — instead of the writer applying a patch.

## 2.6 Error taxonomy

All errors extend `ForgeError` with `code`, `severity`, `remedy`, and `docsUrl`.

| Code prefix | Meaning | Example |
|---|---|---|
| `CFG-` | Configuration/validation | `CFG-001 invalid config.yaml at line 12` |
| `ENV-` | Environment/tooling missing | `ENV-004 claude CLI not found on PATH` |
| `ADP-` | Adapter/platform failure | `ADP-012 session terminated by provider rate limit` |
| `VCS-` | Git failure | `VCS-007 merge conflict in lane feat/story-014` |
| `SPEC-` | Spec graph / traceability violation | `SPEC-021 STORY-014 has no parent capability` |
| `KB-` | Knowledge body violation | `KB-005 contradictory ADR: ADR-006 supersedes ADR-003 but ADR-003 is referenced by DM-002` |
| `GATE-` | Gate failure | `GATE-102 coverage 61% < threshold 80%` |
| `RUN-` | Scheduler/runtime | `RUN-033 step exceeded wall-clock budget` |
| `BUD-` | Budget/cost | `BUD-002 run exceeded $12.00 cap` |
| `USR-` | User abort / refusal | `USR-001 gate rejected by operator` |

Exit codes: `0` success · `1` generic failure · `2` usage error · `3` gate failed ·
`4` budget exceeded · `5` environment/prereq missing · `6` project lock held · `130` interrupted.

## 2.7 Build, packaging, distribution

- `forge-method` publishes a **single bundled CLI** plus data directories (`templates/`, `modules/`,
  `catalog/`) as package files. Internal `@forge/*` packages are published too (for module authors
  and for `@forge/adapter-kit` consumers) but the CLI does not resolve them at runtime from npm.
- `bin`: `{ "forge": "./dist/forge.mjs" }`. Shebang `#!/usr/bin/env node`. Node engine check with a
  friendly message before any import that requires modern syntax (use a tiny CJS preflight shim).
- `postinstall` MUST be a no-op (npx-friendly, avoids sandbox failures).
- Optional deps: `better-sqlite3` marked optional; on failure fall back to `node:sqlite` if present,
  else a JSON-file index with a warning.
- Windows: first-class. Use `path.posix` only for repo-relative artifact IDs; all disk paths via
  `node:path`. Avoid symlinks. Test on `windows-latest` in CI.
- Publish workflow: changesets → version PR → tag → `npm publish --provenance`. `@next` from `next`
  branch.

## 2.8 Configuration precedence

Highest wins:

1. CLI flags
2. `FORGE_*` environment variables
3. `<project>/.forge/config.local.yaml` (git-ignored; personal overrides)
4. `<project>/.forge/config.yaml` (committed; team truth)
5. Module defaults (from installed modules, in install order)
6. Built-in defaults

`forge config explain <key>` MUST print the resolved value **and** which layer supplied it. This is a
required debugging affordance, not a nicety.

## 2.9 Extension points (summary; details in `15` and `19`)

| Extension point | Mechanism |
|---|---|
| New agent role | `agents/*.agent.yaml` in a module, or `.forge/overrides/agents/` in a project |
| Modify an existing agent | Agent **overlay** (partial doc, merge-patch + array operators) |
| Agent procedural knowledge | **Skill** packet: `skills/<id>/SKILL.md` + references/scripts/assets |
| Agent external reach | **MCP** server registry + per-role, per-tool grants |
| New workflow / modify one | `workflows/*.workflow.yaml` or a workflow overlay (`$insertAfter`, `$replaceWhere`) |
| New decision framework | `frameworks/*.framework.yaml` + optional TS scorer; overlays tune criteria weights |
| New artifact type | `schemas/*.schema.json` + template + graph edge declarations |
| New gate check | `checks/*.check.yaml` (command + parser) or a TS check plugin |
| House style / voice | `style/*.style.yaml` |
| Whole-posture bundle | **Preset** (ejectable into visible overlays) |
| Share customization | **Overlay bundle** (`overlay.yaml`) via path, npm or git — precursor to plugins |
| New platform | implement `PlatformAdapter` **or** declare `adapter.yaml` for the generic CLI adapter |
| Technology catalog entries | `catalog/*.entry.yaml`; projects may add an approved/forbidden list |
| Facilitation technique | `techniques/*.technique.yaml` |

All of the above resolve through one layering pipeline (built-ins → modules → org → project →
local), compiled into `.forge/` as a disposable resolved set. `15` is normative for the merge
semantics, guardrails and provenance reporting; the internal package is `@forge/extensions`
(named for the plugin system it will grow into, not for overlays alone).
