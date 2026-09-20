# Getting started with FORGE

This is a real, step-by-step walkthrough. Every command below was run against the actual, current
`forge` CLI while writing this document — none of it is aspirational. Two genuine defects this guide
originally disclosed (a `workflow validate --all` finding and a `spec new` type-coverage gap) have
since been fixed; where a natural next step would still need a command that isn't wired into the CLI
yet, this guide says so explicitly rather than silently showing you a clean run that doesn't match
reality.

## 0. What you need

- **Node.js ≥ 20.19** and **pnpm** (this repository's own floor — `package.json`'s `engines` field).
- **git ≥ 2.30** (worktree support — FORGE uses git worktrees for parallel lanes).
- **A platform adapter.** Today that means the [Claude Code CLI](https://claude.com/claude-code)
  installed and on `PATH`. `forge init` runs Claude Code in **bare mode** by default (`07` §7.3),
  which intentionally ignores your personal `CLAUDE.md`/hooks/OAuth login for reproducibility —
  which means it needs `ANTHROPIC_API_KEY` (or a Bedrock/Vertex/Foundry credential) set in your
  environment, not just an interactive `claude auth login`. `forge doctor` (step 3 below) tells you
  exactly what's missing if anything is.

FORGE has not yet had its first real npm publish (the changesets release pipeline — `specs/22` M12 —
is built and ready, but running it is a real, separate action nobody has taken yet), so every
command below is run from a checkout of this repository, either via the `pnpm forge` script alias or
directly:

```bash
pnpm install
node --experimental-strip-types packages/cli/bin/forge.mjs <command>
# equivalently, from the repo root only: pnpm forge <command>
```

The rest of this guide writes just `forge <command>` — substitute whichever of the two forms you're
using.

## 1. Check your environment first

Before touching a real project, ask FORGE whether your machine is ready. Run this from _inside_ an
already-initialized project (step 2 creates one) — `forge doctor` is safe to re-run any time:

```bash
forge doctor
```

Typical output (abridged):

```
ok node-version: Node v22.14.0 satisfies the 20.10.0 floor.
ok package-manager-pnpm: pnpm 9.15.5 found on PATH.
ok git-version: git version 2.39.5 satisfies the 2.30 worktree-support floor.
ok platform-adapter: Platform adapter preflight passed (version 2.1.270).
ok config-validity: .forge/config.yaml is real and schema-valid.
...
```

If `platform-adapter` fails, the message names the exact remedy (install Claude Code, or set
`ANTHROPIC_API_KEY`). Fix that before continuing — every later step that touches a real agent
session needs it. `forge doctor` also accepts `--fix` (apply safe automatic fixes) and
`--rebuild-index` (rebuild the KB search index), and `--json` for machine-readable output.

## 2. Initialize a project

`forge init` needs `--name` and `--yes` (non-interactive; there is no interactive prompt flow wired
into this CLI yet, so `--yes` is effectively required):

```bash
mkdir my-project && cd my-project
ANTHROPIC_API_KEY=<your key> forge init --name "My Project" --level L0 --yes
```

`--level` picks how much process the project gets (`L0` patch … `L4` platform — see
[`docs/method-guide.md`](method-guide.md#scale-adaptive-levels)); omit it and FORGE proposes one
from the idea text you'd give it in guided mode. A successful run prints:

```
forge init: wrote 166 files to /path/to/my-project (level L0, platform claude-code).
```

This writes `.forge/` (resolved agents, workflows, gates, config, manifest), `docs/forge/kb/` (an
empty Knowledge Body, ready to grow), and `docs/forge/specs/` (empty until you add specs).
Re-running `forge init` on the same directory is safe — it detects the existing project and
regenerates the resolved set instead of failing.

Other useful `init` flags: `--modules web,service` (comma-separated module ids),
`--preset startup-lean`, `--platform claude-code` (explicit adapter selection instead of
auto-detected), `--git-init` (also run `git init`).

## 3. Look around

With nothing authored yet, most listings are legitimately empty — that's expected for a brand-new
project, not a bug:

```bash
forge kb list      # (empty — no KB entries yet)
forge spec list    # (empty — no specs yet)
forge gate list    # G-Deliver, G-Design, G-Foundation, G-Integration, G-Operate, G-Problem,
                    # G-Product, G-Ready, G-Stable, G-Verify — the ten gates fm-core ships
forge skill list    # the built-in skill library materialized into your project
```

Both validators come back clean on a fresh project. They do real work: FORGE checks that every
workflow step's `brief:`, every gate's `brief:` and every agent's `prompt.system`/`prompt.briefs.*`
resolves to a real, non-empty file under `.forge/briefs/` / `.forge/prompts/`, and `forge init`
materializes the shipped briefs and prompts there.

```bash
forge agent validate --all      # forge agent validate --all: no real findings.
forge workflow validate --all   # forge workflow validate --all: no real issues.
```

A missing or empty brief or prompt file shows up here as `unknown-prompt` / `unknown-brief`, so
these two commands are what to run after you edit or add an agent, workflow or gate.

## 4. Author your first spec artifact

```bash
forge spec new Vision "My Project Vision"
```

prints `forge spec new Vision: wrote docs/forge/specs/vision.md.` `spec new` recognises eight type
names (`Vision`, `Capability`, `NFR`, `Epic`, `Story`, `Task`, `InterfaceContract`, `DataModel` —
case-sensitive), and all eight now work through this CLI (`Story`/`InterfaceContract`/`DataModel`
derive their own path-template `slug`/`name` placeholder from `<title>` automatically; a fix, not a
new feature — an earlier revision of this guide disclosed those three as broken). Then:

```bash
forge spec list       # VIS-001 Vision My Project Vision
forge spec validate    # "forge spec validate: no real problems."
```

`forge spec validate` runs the full two-phase document + graph check (required edges, cycles).
There's also a narrower, gate-shelled form, `forge spec validate --rule <name>`, used internally by
the gate YAML files rather than by a human at the terminal.

## 5. See what a workflow would do, without running it

FORGE ships real workflows (`.forge/workflows/*.workflow.yaml`) that drive agent sessions through a
DAG of steps. `--dry-run` compiles the DAG and reports the plan without starting any agent session
or spending anything:

```bash
forge run discover --dry-run
# forge run discover --dry-run: compiled 5 steps.
```

Not every shipped workflow dry-runs cleanly with no other context — some (`plan-stage`, `quick-fix`)
need variables like `--stage`/`--epic`/`--story` that a real intake step would have already set.
That's expected: `discover`, `define-product`, `initialize-project`, `intake`, `shape-solution`,
`verify-stage`, `deliver-stage`, and `plan-stages` all dry-run standalone.

Dropping `--dry-run` starts a **real** run: it invokes your configured platform adapter, spawns real
agent sessions, and (with a real `ANTHROPIC_API_KEY`) spends real money. This guide stops short of
walking through a live run for that reason — once you're ready, `forge run <workflow>` is the
command, and `forge status`, `forge lanes`, `forge logs`, `forge gate`, and `forge merge` are how
you watch, inspect and progress it while it's active (see their own `--help`-free but
self-describing error messages, or `03-cli-and-installer.md` §3.2.4 for the full flag reference).
Note that `forge status` itself only succeeds once a run has actually started — on a fresh project
with no run yet, it exits non-zero with
`No FORGE run is currently active in this project. Run \`forge run <workflow>\` to start one.`,
which is the correct, by-design behaviour, not an error in this guide.

## 6. Other everyday commands

```bash
forge cost                 # per-run/per-agent/per-model spend and budget status
forge audit                # gate decisions, tool-ceiling escalations, policy violations
forge config get project.name
forge config set execution.concurrency 4
forge export markdown-bundle   # bundle the KB + specs as one Markdown document
forge export html              # ditto, as one HTML document
forge adr new "Use Postgres"   # docs/forge/kb/decisions/ADR-0001-use-postgres.md
```

## 7. What's not wired into the CLI yet

FORGE's real library code (tested independently, extensively) is ahead of what the `forge` CLI argv
dispatcher currently exposes. As of this milestone, genuinely **not** reachable from the command
line (each is a disclosed, deliberate scope boundary, not an oversight — see
`packages/cli/src/bin.ts`'s own top-of-file doc comment for the authoritative, current list):

- `module list`/`module info`, `overlay list/remove/update/explain/diff/doctor/eject` (only
  `overlay add` is wired)
- `config list`/`config explain`
- `agent`/`workflow` beyond `validate --all` (no `list`/`show`/`new`/`compile`/`graph`)
- `mcp add/test/grant/revoke/trace` (only `mcp list`/`mcp validate` — and today even `mcp list`
  reports itself as not yet supported)
- `kb diff`, `diagram legend`/`render --open`, `customize` (entirely), `preset diff`,
  `skill new/attach/detach/test/import`
- `forge help <topic>` (bare `forge help` works — it recommends your next command)
- `forge plan data`/`forge plan testing` (no such workflow exists yet)
- `forge test plan/generate/report`
- `forge logs --follow`/`--lane`, `forge cost --run`/`--since`

If a command above is what you were reaching for, it exists as tested library code but has no CLI
wiring — check `GAUNTLET-LOG.md` and `SPEC-QUESTIONS.md` for its current status rather than assuming
it's simply missing.

## Where to go next

- [`docs/method-guide.md`](method-guide.md) — the stage/gate/workflow model this walkthrough only
  touched the surface of.
- [`docs/authoring-guide.md`](authoring-guide.md) — writing your own agents, skills, workflows and
  overlays once the built-ins don't fit.
- [`docs/adapter-guide.md`](adapter-guide.md) — the Claude Code adapter you just used, the generic
  declarative adapter for driving a different coding-agent CLI, and why there's no third, named
  adapter.
