# The FORGE method

This document explains _how FORGE thinks about building software_ — the stage/gate/workflow model,
the Knowledge Body, and the traceability contract — at a conceptual level, for someone using FORGE
to build a real project. For hands-on commands, see [`getting-started.md`](getting-started.md). For
the normative, implementation-level detail this guide summarizes, see `specs/01`, `specs/09` and
`specs/10`.

## The core idea

> **FORGE turns a software product idea into a system that a top-tier engineering organisation would
> recognise as properly built** — by running an explicit, opinionated, spec-driven software
> engineering process across a team of specialised AI agents, with a durable project knowledge body
> and machine-executable quality gates.

The bar for "done" is not "the code runs." It's that there is a written, versioned reason for every
significant technical decision; the system has a designed data model and a migration story; it
builds reproducibly from a clean checkout; it has a test pyramid the agents can execute and
interpret without a human; it deploys via a pipeline, not a laptop; it emits the observability an
agent needs to debug it; and every feature traces back to a capability in the PRD. See `specs/01`
§1.2.

Three things make this real rather than aspirational:

1. **A method** — the lifecycle, gates and decision frameworks described below, expressed as
   machine-executable workflows and artifact schemas, not just prose guidance.
2. **A runtime** — the `forge` CLI: a scheduler, run state, resumability, budgets and an audit
   trail.
3. **A memory** — the Knowledge Body: durable, structured, queryable project truth every agent reads
   before acting and writes back to after deciding.

## Scale-adaptive levels

A bug fix must not require a PRD. FORGE right-sizes itself with a level, chosen at intake
(auto-proposed from your idea text, human-confirmable) and stored in the Knowledge Body — it selects
which workflows, artifacts and gates apply for the rest of the project.

| Level  | Name       | Typical                                          | Gates                                                       |
| ------ | ---------- | ------------------------------------------------ | ----------------------------------------------------------- |
| **L0** | Patch      | Bug fix, copy change, dependency bump            | `G-Verify` only                                             |
| **L1** | Feature    | 1–3 stories inside an existing system            | `G-Design`(light), `G-Verify`, `G-Deliver`                  |
| **L2** | Capability | New subsystem/service in an existing product     | `G-Product`, `G-Design`, `G-Ready`, `G-Verify`, `G-Deliver` |
| **L3** | Product    | New product, greenfield                          | All gates                                                   |
| **L4** | Platform   | Multi-service/multi-team, migrations, compliance | All gates + `G-Integration`                                 |

(`specs/01` §1.9.)

## The ten-phase lifecycle

FORGE structures work as ten phases, each with an owner, entry conditions, defined outputs and (for
most) an exit gate that must pass before the next phase's work is trusted:

| #   | Phase                    | Key outputs                                               | Exit gate      |
| --- | ------------------------ | --------------------------------------------------------- | -------------- |
| P0  | Intake                   | Idea record, level selection, constraints                 | —              |
| P1  | Discovery                | Problem, users, competitive scan, success metrics, risks  | `G-Problem`    |
| P2  | Product Definition       | Vision, PRD, capabilities, NFRs, UX spec                  | `G-Product`    |
| P3  | Solution Shaping         | Architecture spec, ADRs, domain/data model, threat model  | `G-Design`     |
| P4  | Project Initialization   | Repo strategy, build system, scaffold, CI skeleton        | `G-Foundation` |
| P5  | Planning & Decomposition | Stage plan, epics, stories, test plan, run plan           | `G-Ready`      |
| P6  | Implementation           | Contracts frozen, tests, code, reviews, merges            | — (continuous) |
| P7  | Verification             | Test execution, coverage, NFR verification, traceability  | `G-Verify`     |
| P8  | Stabilization            | RCA records, fixes, regression tests, flake control       | `G-Stable`     |
| P9  | Delivery                 | Pipeline, environments, deploy, smoke, rollback rehearsal | `G-Deliver`    |
| P10 | Operate & Learn          | Observability, SLOs, retro, KB write-back                 | `G-Operate`    |

P6→P8 loop per stage; P9→P10 per stage; the whole P2→P10 loop repeats per stage (MVP → M2 → GA). A
project's level determines which of these phases actually run: L0 runs only implementation and
verification; L1 adds a light design pass and stabilization; L2 adds product/design deltas and
delivery; L3/L4 run the full lifecycle (`specs/10` §10.2).

Each phase maps to one or more **workflows** — `.forge/workflows/*.workflow.yaml` files that
describe a DAG of steps, each step a real agent session (or a deterministic command/gate check),
wired with expressions, fanout and gate placement. `intake`, `discover`, `define-product`,
`shape-solution`, `initialize-project`, `plan-stages`, `plan-stage`, `build-stage`,
`implement-story`, `quick-fix`, `verify-stage`, `debug`, `harden`, `refactor`, `deliver-stage`,
`operate`, `adopt`, `migrate`, `retro` and `replan` are the workflows FORGE ships out of the box
(`specs/10` §10.5) — `forge run <id> --dry-run` shows you the compiled step plan for any of them
without starting a real session (the ones that declare inputs, such as `build-stage` or `quick-fix`,
take `--stage`, `--story` or `--input name=value`; see the getting-started guide, section 5).

## Gates: how "done" is enforced, not just asserted

A **gate** is a machine-checkable go/no-go decision at a phase boundary. Every gate carries
deterministic checks (real commands with a real `failOn` expression — `forge spec validate --json`,
`forge kb lint --json`, and so on) and, optionally, advisory (LLM) checks that surface open
questions but never block on their own.

The rules that make this real rather than theatre (`specs/10` §10.3):

1. A gate with any failing deterministic check cannot be approved — only **waived**, and a waiver
   requires a reason, an owner and an expiry, and stays visible in every report until it's resolved.
2. Advisory checks never fail a gate; they create tracked open questions instead.
3. Gates are re-runnable and idempotent — `forge gate check <id>` re-evaluates without approving
   anything.
4. Every gate evaluation writes a `GateReport` artifact under `docs/forge/reports/gates/` with the
   exact check output — that report is the audit trail.
5. `G-Deliver` for a production environment is `alwaysHuman` by default; it can't be set otherwise
   without an explicit config flag and a typed acknowledgement.

The ten gates FORGE ships (`fm-core`) are `G-Problem`, `G-Product`, `G-Design`, `G-Foundation`,
`G-Ready`, `G-Verify`, `G-Stable`, `G-Integration` (L4 only), `G-Deliver`, `G-Operate` — run
`forge gate list` in any initialized project to see them, and `specs/10` §10.3's own gate catalogue
for exactly what each one fails on.

## The spec graph and traceability

Every requirement in FORGE is a typed, id'd artifact — `Vision` → `Capability` → `Epic` → `Story` →
`Task`, plus cross-cutting `NFR`, `InterfaceContract` and `DataModel` types — living under
`docs/forge/specs/`. Parent/child edges are enforced: a `Story` with no parent `Epic`, or a
`Capability` no `Story` ever implements, is an **orphan**, and `forge spec orphans` finds it.
`forge spec validate` checks both document-level schema validity and graph-level integrity (required
edges present, no cycles); `forge spec trace <id>` walks the parents and children of one artifact;
`forge spec matrix` produces the full traceability matrix.

This is what makes "every feature traces back to a capability in the PRD" a checked fact instead of
a hope (`specs/09` §9.2, §9.4).

## The Knowledge Body

The Knowledge Body (`docs/forge/kb/`) is FORGE's durable project memory — product, architecture,
data, delivery, ops and domain knowledge, decisions (ADRs), and a glossary, plus validated diagrams
generated from structured artifacts where derivable. Every agent reads the relevant slice of it
before acting and writes back to it after deciding, so the same architectural question is never
asked twice across sessions. `forge kb list`/`show`/`search`/`lint`/`sync`/`graph`/`verify` are how
you inspect and maintain it directly; `forge kb lint` catches staleness and structural problems, and
`forge kb verify` re-runs any stored verification commands a KB entry claims are still true.

## Decision frameworks and ADRs

Where BMAD-style method frameworks leave engineering depth thin, FORGE ships eight first-class
decision frameworks — init, design, data, tech, test, debug, delivery, ops — each of which produces
a real Architecture Decision Record: alternatives considered, a scoring rubric, and why the losing
options lost. `forge adr new/list/show/supersede/accept/reject` manage the ADR lifecycle directly.

## Parallelism and lanes

Within a stage, independent stories run in parallel **lanes** — isolated git worktrees with explicit
file-ownership claims, scheduled as a DAG rather than a sequential human-driven queue. `forge lanes`
shows lane status for the active run; `forge merge --lane <id>` (or `--all`) merges a lane's
completed work back once its own checks pass.

## Cost, budgets and audit

Every agent session's token usage and (adapter-reported) cost is recorded to a per-run ledger.
`forge cost` reports total spend, broken down by run, agent and model, against your configured
budget; `forge audit` reports gate decisions, tool-ceiling escalations and policy violations across
the project's whole history. Budgets can abort a run rather than silently overspend.

## Where the method stops and customization begins

FORGE draws a hard line: **the user owns flavour, FORGE owns rigour.** Flavour is who the agents
are, how they speak, what they know, what tools they can reach, which stack conventions they follow,
how much ceremony a project gets — all of that is customisable. Rigour is traceability, gate
determinism, separation of duties, file-ownership safety, and the requirement that decisions are
recorded — that's fixed, or requires an explicit, recorded, expiring waiver. See
[`authoring-guide.md`](authoring-guide.md) for how to actually change the flavour column.
