# 03 — CLI, npx Experience and Installer

## 3.1 Entry-point behaviour

```
npx forge-method            # no args
```

Resolution logic, in order:

1. **Node version check.** < 20.10 → print required version and abort (exit 5).
2. **Detect context** by walking up from `cwd` for `.forge/config.yaml` (stop at filesystem root or a
   `.forge-root` marker).
3. Branch:
   - **Not a FORGE project, dir is empty or has no git repo** → launch **Init wizard** (TUI).
   - **Not a FORGE project, dir has existing code** → offer `adopt` (brownfield) or `init` (greenfield
     in a subdirectory); default highlight = `adopt`.
   - **Is a FORGE project** → launch the **TUI dashboard** at the Home screen.
4. Non-TTY stdin/stdout (piped, CI) → refuse to launch TUI; print the equivalent non-interactive
   command and exit 2. Every interactive flow MUST have a `--yes`-able non-interactive equivalent.

`npx forge-method@next` MUST work identically against prerelease dist-tag.

## 3.2 Command surface

Global flags available on every command:

| Flag | Type | Default | Meaning |
|---|---|---|---|
| `--project, -C <path>` | path | cwd | Operate on this project root |
| `--config <path>` | path | — | Explicit config file |
| `--profile <name>` | string | `default` | Named config profile (e.g. `ci`, `cheap`) |
| `--platform <id>` | string | from config | Override adapter (`claude-code`, `codemachine`, …) |
| `--model-tier <tier>` | enum | from config | `frugal` \| `balanced` \| `max` |
| `--autonomy <level>` | enum | from config | `supervised` \| `guided` \| `autonomous` (see §3.6) |
| `--concurrency <n>` | int | auto | Max parallel lanes |
| `--budget <usd>` | float | from config | Hard spend cap for this invocation |
| `--dry-run` | bool | false | Plan and print; make no writes, spawn no sessions |
| `--yes, -y` | bool | false | Accept all defaults; required for non-interactive |
| `--json` | bool | false | Machine-readable output on stdout, logs to stderr |
| `--no-tui` | bool | false | Force headless streaming output |
| `--verbose, -v` | count | 0 | `-v` info, `-vv` debug, `-vvv` trace (includes prompts) |
| `--quiet, -q` | bool | false | Errors only |
| `--no-color` | bool | auto | Respect `NO_COLOR` and `FORCE_COLOR` |
| `--seed <n>` | int | — | Deterministic tie-breaking in the scheduler (for tests) |

### 3.2.1 Lifecycle commands

| Command | Description |
|---|---|
| `forge init [dir]` | Greenfield: create a FORGE project. Wizard or `--yes` with flags. |
| `forge adopt [dir]` | Brownfield: ingest an existing codebase into a KB (see `17`). |
| `forge upgrade` | Upgrade installed FORGE assets in the project to the CLI's version; runs migrations. |
| `forge uninstall` | Remove `.forge/` and (optionally) `docs/forge/`, with confirmation and a backup tarball. |
| `forge doctor` | Diagnose environment, adapters, git, KB integrity, index health. `--fix`, `--rebuild-index`. |

### 3.2.2 Discovery & memory commands

| Command | Description |
|---|---|
| `forge discover` | Run intake: idea capture, problem framing, level selection, constraints. |
| `forge kb <sub>` | `list`, `show <id>`, `search <q>`, `lint`, `diff`, `sync`, `open <id>`, `graph` |
| `forge spec <sub>` | `list`, `show <id>`, `validate`, `trace <id>`, `matrix`, `orphans`, `new <type>` |
| `forge adr <sub>` | `new`, `list`, `show`, `supersede <id>`, `accept <id>`, `reject <id>` |
| `forge diagram <sub>` | `list`, `show <id>`, `validate`, `render [--open]`, `sync`, `generate <generator>`, `diff <id>`, `legend` |
| `forge decide <framework>` | Run a decision framework interactively (e.g. `forge decide data-store`). |

### 3.2.3 Planning commands

| Command | Description |
|---|---|
| `forge plan product` | Vision → PRD → capabilities → NFRs. |
| `forge plan architecture` | System design frameworks → ADRs → component model → interfaces. |
| `forge plan data` | Data modeling framework → entities, stores, consistency, migrations. |
| `forge plan init` | Project initialization framework → repo strategy, build system, VCS conventions. |
| `forge plan testing` | Test strategy + agent-executability design. |
| `forge plan delivery` | Environments, CI/CD, deploy strategy, rollback, observability. |
| `forge plan stages` | Decompose into stages (MVP/milestones) with scope, exit criteria, sequencing. |
| `forge plan stage <id>` | Epics + stories + tasks for one stage; produce the run plan DAG. |
| `forge plan replan --from <event>` | Re-plan after a scope change, gate failure, or new constraint. |

### 3.2.4 Execution commands

| Command | Description |
|---|---|
| `forge run <workflow> [--stage <id>] [--epic <id>] [--story <id>]` | Execute a workflow. |
| `forge run build --stage mvp` | The main implementation loop. |
| `forge resume [runId]` | Resume the last (or given) run. |
| `forge pause` / `forge abort [runId]` | Control a running supervisor via the lock socket. |
| `forge status` | Current state: stage, gates, lanes, spend, blockers. `--watch`. |
| `forge lanes` | List lanes with branch, worktree, agent, step, status. |
| `forge logs [--lane <id>] [--follow] [--step <id>]` | Tail normalised event/transcript logs. |
| `forge gate <sub>` | `list`, `check <gate>`, `approve <gate>`, `reject <gate> --reason`, `waive <gate> --reason --expires` |
| `forge merge` | Drive the merge queue manually; `--lane`, `--all`, `--abort`. |

### 3.2.5 Engineering-loop commands

| Command | Description |
|---|---|
| `forge implement <storyId>` | Single-story loop (spec → tests → code → verify → review). |
| `forge test <sub>` | `plan`, `generate`, `run`, `report`, `flaky`, `coverage` |
| `forge debug <symptom\|--from-failure <runId>>` | Autonomous RCA loop (see `13`). |
| `forge review [--diff <range>]` | Multi-perspective review (design/security/perf/testing). |
| `forge refactor <target> --goal <text>` | Bounded, test-guarded refactor. |
| `forge deploy <env>` | Execute the delivery workflow for an environment. |

### 3.2.6 Collaboration commands

| Command | Description |
|---|---|
| `forge session <type>` | `brainstorm`, `design-review`, `retro`, `premortem`, `war-room`, `estimation`, `tradeoff`, `standup` |
| `forge session list \| show <id> \| resume <id>` | Session records. |
| `forge ask <question>` | One-shot question answered strictly from the KB, with citations. |
| `forge panel <question> --roles architect,security,sre` | Multi-agent structured debate. |

### 3.2.7 Meta commands

| Command | Description |
|---|---|
| `forge module <sub>` | `list`, `add <name\|path\|url>`, `remove`, `update`, `info` |
| `forge agent <sub>` | `list`, `show <id>`, `new`, `validate`, `compile` (emit platform-native assets) |
| `forge workflow <sub>` | `list`, `show`, `validate`, `graph <id>` (Mermaid), `new` |
| `forge config <sub>` | `get`, `set`, `list`, `explain <key>`, `edit` |
| `forge cost [--run <id>] [--since <date>]` | Cost/token ledger reports. |
| `forge export <target>` | `markdown-bundle`, `html`, `jira`, `linear`, `github-issues` (v1: first two + dry-run for the rest) |
| `forge help [topic]` | Contextual, state-aware help: "you are here, these are your next moves." |

### 3.2.8 Customization commands

Full semantics in `15`. Summary of the surface:

| Command | Description |
|---|---|
| `forge customize` | Interactive entry point: pick a surface, view resolved value, edit, preview diff, write the overlay |
| `forge compile [--check]` | Resolve all customization layers into `.forge/`; `--check` fails on any compile error (CI) |
| `forge overlay <sub>` | `list`, `add <path\|npm:\|git+…>`, `remove`, `update`, `explain <id>`, `diff`, `doctor`, `eject` |
| `forge agent override <id>` | Scaffold/open an agent overlay in `$EDITOR`, then validate |
| `forge agent diff <id>` | Base vs resolved, field by field, with layer provenance |
| `forge agent reset <id>` | Drop overlays for one agent (confirmation + backup) |
| `forge skill <sub>` | `list`, `show`, `new`, `validate`, `attach`, `detach`, `test`, `import` |
| `forge mcp <sub>` | `list`, `add`, `test`, `grant`, `revoke`, `trace` |
| `forge preset <sub>` | `list`, `show`, `apply [--eject]`, `diff` |

`forge help` with no args, inside a project, MUST inspect state and recommend the next command —
this is the single most important discoverability affordance (BMAD's `/bmad-help` equivalent).

## 3.3 `forge init` — the greenfield wizard

Steps (each is skippable via flags for `--yes`):

1. **Project identity** — name, slug, one-line description, repo URL (optional).
2. **Idea capture** — free-text product idea; optional file/URL attachments (`--idea-file`).
3. **Mode** — `guided` (full discovery) vs `express` (agents propose everything, human approves at
   gates).
4. **Level** — auto-proposed L0–L4 with reasoning shown; confirm or override.
5. **Platform** — detect installed platforms (probe `claude` on PATH, CodeMachine binary/config,
   `ANTHROPIC_API_KEY`); pick primary + optional fallback; run a **connectivity smoke test** and show
   the result before continuing.
6. **Autonomy & budget** — autonomy level, per-run budget, per-stage budget, daily cap.
7. **Paths** — KB root (default `docs/forge`), runtime dir (`.forge`), code root (default repo root).
8. **Modules** — choose specialisation modules (`fm-web`, `fm-service`, `fm-data`, `fm-mobile`);
   auto-suggested from the idea text.
9. **VCS** — init git if absent; branch naming; commit conventions; whether FORGE may commit.
10. **Posture** — choose a preset (`solo-fast`, `startup-lean` (default), `enterprise-rigor`,
    `regulated`, `agency-delivery`) and optionally add an organisation overlay bundle by path, npm
    package or git URL. Bundles show their **capability request screen** (shell commands, network
    hosts, MCP servers, tool grants) and require confirmation before installation.
11. **Write** — show a file-by-file plan, then write; print next command.

Flags for non-interactive parity:

```
forge init . --yes \
  --name "Acme Billing" \
  --idea-file ./idea.md \
  --level L3 --mode guided \
  --platform claude-code --fallback-platform codemachine \
  --autonomy guided --budget 25 \
  --modules fm-service,fm-web \
  --preset startup-lean --overlay npm:@acme/forge-standards \
  --kb-root docs/forge --git-init --allow-commits
```

### Files written by `init`

```
<project>/
├─ .forge/
│  ├─ config.yaml
│  ├─ config.local.yaml         (gitignored, created empty)
│  ├─ manifest.yaml             installed modules + versions + checksums
│  ├─ agents/                   compiled platform-native agent assets (regenerable)
│  ├─ workflows/                resolved workflow definitions (regenerable)
│  ├─ frameworks/               resolved frameworks (regenerable)
│  ├─ templates/                resolved templates (regenerable)
│  ├─ checks/                   gate check definitions (regenerable)
│  ├─ skills/                   resolved skill packets (regenerable)
│  ├─ overrides/                YOUR customization — hand-authored, committed, never regenerated
│  │   ├─ agents/ skills/ mcp/ workflows/ frameworks/ templates/ checks/ style/ catalog/
│  ├─ overrides.local/          personal customization (gitignored)
│  ├─ secrets.local.yaml        gitignored, 0600, optional — MCP/tool secrets
│  └─ state/                    gitignored: events.ndjson, index.db, locks, worktrees/, cache/
├─ docs/forge/                  KB + specs + plans + sessions + reports (see 08, 09)
├─ .gitignore                   appended with FORGE entries
└─ FORGE.md                     short project-level "how this project is run" doc for humans & agents
```

Plus platform-native integration assets, written **only** into their canonical locations:

- Claude Code: `.claude/agents/forge-*.md`, `.claude/commands/forge-*.md`,
  `.claude/settings.json` merge (never overwrite: deep-merge with a `forge` marker block),
  optional `.mcp.json` entry for the FORGE MCP server.
- CodeMachine: per adapter's declared asset layout (see `07`).

**Idempotency:** re-running `init` on an existing project MUST detect it and switch to `upgrade`
semantics. All generated (regenerable) files carry a header
`<!-- forge:generated v=<ver> hash=<sha> — edits will be overwritten; use overrides/ -->`.
Files with a modified hash are never silently overwritten: FORGE reports them and offers
`keep-mine` / `take-theirs` / `merge` / `show-diff`.

## 3.4 `forge upgrade`

1. Read `.forge/manifest.yaml` (`forgeVersion`, module versions, file checksums).
2. Compute a migration path from installed version → CLI version using ordered migrations in
   `@forge/schemas/migrations/`.
3. **Back up** `docs/forge/` + `.forge/` to `.forge/backups/<timestamp>.tar.gz` (retain last 5).
4. Apply schema migrations to artifacts (front-matter versions bump; content transformed).
5. Regenerate `.forge/{agents,workflows,frameworks,templates,checks}` and platform assets.
6. Re-run `forge doctor` and print a summary + a diff stat.
7. `--dry-run` prints the plan without writing. `--to <version>` pins. Downgrades are refused.

Every migration MUST be: pure (artifact-in/artifact-out), reversible or explicitly flagged
irreversible, and covered by a golden-file test with a real "before" fixture.

## 3.5 Output modes

| Mode | Trigger | Behaviour |
|---|---|---|
| TUI | TTY + interactive command | Full Ink app |
| Stream | `--no-tui` or non-TTY | Line-oriented, prefixed `[lane][agent][step]`, ANSI only if colour allowed |
| JSON | `--json` | NDJSON events on stdout (schema = the engine event stream), human logs to stderr |
| Quiet | `--quiet` | Errors + final summary only |

`--json` output MUST be stable and versioned (`{"v":1,...}`) — it is the integration contract for CI.

## 3.6 Autonomy levels

| Level | Human approval required for | Agent may |
|---|---|---|
| `supervised` | every gate, every ADR, every file-creating step outside a lane, every command not on the allowlist | propose, draft, run read-only analysis |
| `guided` *(default)* | every gate; ADRs of reversibility class `hard`; destructive ops; budget overrun | write code in lanes, run tests, commit to lane branches, open merge requests |
| `autonomous` | destructive ops; budget overrun; gates marked `alwaysHuman`; production deploys | everything else, including merging to the integration branch when gates pass |

Autonomy is set globally and overridable **per gate** and **per workflow step**. `forge run` prints
the effective autonomy matrix before starting when it differs from config.

## 3.7 Prerequisite detection and remediation

`forge doctor` checks and reports, each with a copy-pasteable fix:

- Node version; pnpm/npm presence (informational)
- `git` ≥ 2.30 (worktree support), user.name/user.email configured
- Platform adapters: binary present, version, auth working, model access
  (Claude Code: `claude --version`, then a 1-token smoke query; note `--bare` does not read OAuth
  credentials so `ANTHROPIC_API_KEY` must be set for bare runs)
- Disk space for worktrees; inode/path-length constraints on Windows
- Project: config validity, manifest checksum drift, KB lint, spec graph validity, index freshness
- Locks: stale supervisor lock, orphaned worktrees, dangling lane branches
- Diagrams: notation parsers available, optional renderer presence, generated-diagram drift, and any
  diagram exceeding the complexity budget
- Customization: overlay compile errors, stale overlay targets, no-op overlays, active tool-ceiling
  escalations (with expiry), skill validation, MCP server handshakes and grant fidelity, unresolved
  `${secret:…}` references (existence verified without printing values)

Exit code 5 if any hard prerequisite fails; 0 with warnings otherwise. `--json` for CI.

## 3.8 Telemetry policy

**No network telemetry in v1.** No analytics, no phone-home, no version-check ping unless the user
runs `forge upgrade --check`. This MUST be stated in `forge --help` footer and README. All telemetry
described elsewhere in this pack is *local* (event log, ledger).
