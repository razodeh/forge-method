# FORGE

**F**ramework for **O**rchestrated, **R**igorous, **G**overned **E**ngineering — a spec-driven
development method and CLI that runs a team of specialized AI agents through a real software
engineering process, instead of one agent improvising from a prompt.

## The problem this solves

AI coding agents are excellent at _implementation_ and terrible at _engineering_. Give one a prompt
and it produces plausible code fast. Give it a product idea and it produces a pile of plausible code
with no coherent architecture, tests that assert what the code happens to do instead of what it's
supposed to do, and no record of why anything was decided — because nothing forced it to slow down
and engineer.

FORGE is that forcing function. It runs your idea through an explicit lifecycle — discovery, design,
planning, implementation, verification, delivery — with a **team of specialized agents** (architect,
PM, engineers, SDET, reviewer, and more) instead of one generalist, **gates** that check real
conditions before letting work through instead of a prompt asking the model to "be careful," and a
**durable knowledge base** every agent reads before acting and writes to after deciding, so
decisions made in week one are still respected in week twelve.

## See it in action

```
$ ANTHROPIC_API_KEY=<your key> forge init --name "My Project" --level L0 --yes
forge init: wrote 166 files to /path/to/my-project (level L0, platform claude-code).

$ forge doctor
ok node-version: Node v22.14.0 satisfies the 20.10.0 floor.
ok package-manager-pnpm: pnpm 9.15.5 found on PATH.
ok git-version: git version 2.39.5 satisfies the 2.30 worktree-support floor.
ok platform-adapter: Platform adapter preflight passed (version 2.1.270).
ok config-validity: .forge/config.yaml is real and schema-valid.
...

$ forge spec new Vision "My Project Vision"
forge spec new Vision: wrote docs/forge/specs/vision.md.

$ forge run discover --dry-run
forge run discover --dry-run: compiled 5 steps.
```

That last command is the interesting one: dropping `--dry-run` starts a real run, where FORGE
dispatches actual agent sessions against your spec, through the gates your project's level requires,
writing back to your knowledge base as it goes. `forge status`, `forge lanes`, `forge cost`, and
`forge merge` let you watch, inspect, and steer it while it's active.

## How it fits together

- **A method** — the engineering lifecycle, gates, and decision frameworks, expressed as
  machine-executable workflows and artifact schemas, not prose guidance a model can skim past.
- **A runtime** — the `forge` CLI: a scheduler, run state, resumability, budgets, and an audit
  trail, orchestrating agent sessions against a coding-agent platform (Claude Code today; any CLI
  coding tool via a declarative adapter).
- **A memory** — the Knowledge Body (`docs/forge/kb/`): durable, structured, queryable project truth
  that outlives any one agent session.

A project doesn't get the same amount of process regardless of size. FORGE picks a **level** for
your project — from `L0` (a patch: fix it, verify it, done) up to `L4` (a platform: full discovery,
architecture, and staged delivery) — and that level decides which workflows, artifacts, and gates
actually apply. A bug fix should never require writing a PRD; a new platform should never skip
architecture review. See [the method guide](docs/method-guide.md#scale-adaptive-levels) for the full
table.

FORGE is not an LLM provider, not an IDE, and not a hosted service — it's a method and a CLI that
runs on your machine, against your repository, targeting software products specifically. See
[the product vision](specs/01-product-vision-and-scope.md) §1.5 for the full non-goals list.

## Requirements

- **Node.js ≥ 20.19** and **pnpm**.
- **git ≥ 2.30** (FORGE uses git worktrees to run agents in parallel, isolated lanes).
- **A platform adapter.** Today that means the [Claude Code CLI](https://claude.com/claude-code)
  installed and on your `PATH`, plus an `ANTHROPIC_API_KEY` (or a Bedrock/Vertex/Foundry credential)
  in your environment — `forge init` runs Claude Code in a reproducible bare mode that doesn't use
  your interactive login. `forge doctor` tells you exactly what's missing, if anything is.

## Install

FORGE is pre-release and hasn't had its first npm publish yet, so for now you run it from a source
checkout:

```bash
git clone https://github.com/razodeh/forge-method.git
cd forge-method
pnpm install
pnpm forge status
```

(`npx forge-method` will be the install path once the first release ships.)

From there, [the getting-started guide](docs/getting-started.md) walks through initializing a real
project, authoring your first spec, and dry-running a workflow — every command in it is one that was
actually run against the current CLI while writing it, not aspirational.

## Documentation

| Document                                   | Read this to...                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| [Getting started](docs/getting-started.md) | Install FORGE, initialize a project, and run your first workflow, step by step.  |
| [Method guide](docs/method-guide.md)       | Understand the stage/gate/workflow model and the Knowledge Body conceptually.    |
| [Authoring guide](docs/authoring-guide.md) | Write your own agents, skills, workflows, overlays, and modules.                 |
| [Adapter guide](docs/adapter-guide.md)     | Configure the Claude Code adapter, the generic declarative adapter, or your own. |

For the normative specification the codebase is built against, start with
[`specs/README.md`](specs/README.md) and [`specs/01`](specs/01-product-vision-and-scope.md).

## Project status

FORGE is pre-release but functional: everything shown above — init, spec authoring, dry-run
planning, and, dropping `--dry-run`, real agent runs — already works end-to-end against the real
CLI. What's not true yet: it hasn't been published to npm, and cross-platform CI
(Linux/macOS/Windows) is still being hardened. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
detailed, warts-and-all build history.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to build, test, and submit changes — including the
"gauntlet loop" every piece of this codebase is built with: implemented against a spec, attacked by
a separate, fresh-context critic, and only merged once nothing is left to fix. That build history —
every real spec-vs-implementation decision made along the way — lives in [`process/`](process/).

Please also read the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues per
[`SECURITY.md`](SECURITY.md), not as a public issue.

## License

[MIT](LICENSE) © Radwan Abu-Odeh.
