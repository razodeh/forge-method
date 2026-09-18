# FORGE

**F**ramework for **O**rchestrated, **R**igorous, **G**overned **E**ngineering.

FORGE turns a software product idea into a system that a top-tier engineering organisation would
recognise as properly built — by running an explicit, opinionated, spec-driven software engineering
process across a team of specialised AI agents, with a durable project knowledge body and
machine-executable quality gates.

AI coding agents are excellent at _implementation_ and terrible at _engineering_. Given a prompt
they produce plausible code fast; given a product idea they produce a pile of plausible code with no
coherent architecture, tests that assert the implementation instead of the requirement, and no
durable record of why anything was decided. FORGE exists to close that gap. See
[`specs/01-product-vision-and-scope.md`](specs/01-product-vision-and-scope.md) for the full problem
statement and vision.

## What FORGE is

1. **A method** — an opinionated software engineering lifecycle expressed as machine-executable
   workflows, decision frameworks, gates and artifact schemas.
2. **A runtime** — a Node CLI (`forge`) that orchestrates agent sessions against a coding-agent
   platform (Claude Code today; any CLI coding tool via a declarative adapter), with state,
   resumability, budgets and audit.
3. **A memory** — the Knowledge Body (`docs/forge/kb/`): durable, structured, queryable project
   truth that every agent reads before acting and writes back to after deciding.

FORGE is not an LLM provider, not an IDE, not a hosted service, and not domain-generic — it targets
software products only. See `specs/01` §1.5 for the full non-goals list.

## Status

FORGE is pre-release, built milestone by milestone against the spec pack in [`specs/`](specs/). All
12 milestones are complete: the `forge` CLI is real and runs from a checkout of this repository
today, and the changesets release pipeline (`specs/22` M12) is built and ready. FORGE has not yet
had its first real `npm publish`, so `npx forge-method` is not runnable yet — that is a real,
separate action, not a missing feature. Everything documented here has been run against the actual,
current `forge` CLI — see [`docs/getting-started.md`](docs/getting-started.md) for the full
walkthrough.

## Quickstart

From a checkout of this repository:

```bash
pnpm install
pnpm forge status   # or: node --experimental-strip-types packages/cli/bin/forge.mjs status
```

Then follow [`docs/getting-started.md`](docs/getting-started.md) to initialize a project and run
your first workflow.

## Documentation

| Document                                             | What it covers                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`docs/getting-started.md`](docs/getting-started.md) | A real, step-by-step walkthrough: install, initialize a project, inspect it, run a workflow dry-run.     |
| [`docs/method-guide.md`](docs/method-guide.md)       | The FORGE methodology — stages, gates, workflows, the Knowledge Body — explained conceptually.           |
| [`docs/authoring-guide.md`](docs/authoring-guide.md) | How to write custom agents, skills, workflows, overlays and modules.                                     |
| [`docs/adapter-guide.md`](docs/adapter-guide.md)     | The two real platform adapters (Claude Code, generic declarative CLI) and how to configure a custom one. |

For the normative specification this codebase is built against, start with
[`specs/README.md`](specs/README.md) and
[`specs/01-product-vision-and-scope.md`](specs/01-product-vision-and-scope.md).

## Repository layout

```
packages/     the FORGE monorepo — cli, engine, core, adapters, kb, methods, schemas, templates, …
specs/        the normative specification pack (01–23)
modules/      shipped method modules (fm-core, fm-web, fm-service, …)
docs/         this documentation set
process/      the build history — the gauntlet loop process, milestone plans, and every real
              spec-vs-implementation decision made while building this codebase
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to build, test, and submit changes — including the
"gauntlet loop" discipline this entire codebase is built with: every piece is implemented against
the spec, attacked by a separate, fresh-context critic, and only merged once it survives review with
nothing left to fix. [`process/`](process/) is the full build history — the process itself
(`BUILD-PROMPT.md`, `QUALITY-BAR.md`), the running record of how each piece was built and every real
spec-vs-implementation decision made along the way (`GAUNTLET-LOG.md`, `SPEC-QUESTIONS.md`), and the
milestone-by-milestone cuts of work (`plans/PLAN-M1.md` through `PLAN-M12.md`).

Please also read our [Code of Conduct](CODE_OF_CONDUCT.md). Security issues should be reported per
[`SECURITY.md`](SECURITY.md), not as a public issue.

## License

[MIT](LICENSE) © Radwan Abu-Odeh.
