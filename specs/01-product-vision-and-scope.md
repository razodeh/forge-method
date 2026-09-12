# 01 — Product Vision, Scope and Positioning

## 1.1 Problem statement

AI coding agents are excellent at *implementation* and terrible at *engineering*. Given a prompt they
produce plausible code fast; given a product idea they produce a pile of plausible code that:

- has no coherent architecture, because nobody decided one;
- has a data model invented per-file rather than designed once;
- has tests that assert the implementation rather than the requirement;
- cannot be deployed, because deployment was never a first-class concern;
- cannot be debugged, because there is no observability and no RCA procedure;
- drifts, because there is no durable memory of why anything was decided;
- and is declared "done" while broken, because the only verifier was another LLM being agreeable.

Existing agentic method frameworks (BMAD being the most mature) solved the *planning* half well:
personas, elicitation, PRD → epics → stories, scale-adaptive depth. But they are deliberately
**generic** — they must serve game dev, creative work, and arbitrary domains — so the parts that make
software actually shippable (repo strategy, build systems, data modeling, testing strategy, CI/CD,
observability, debugging procedure) are thin or absent, and verification is largely "an agent said it
looks good."

## 1.2 Product vision

> FORGE turns a software product idea into a system that a top-tier engineering organisation would
> recognise as properly built — by running an explicit, opinionated, spec-driven software engineering
> process across a team of specialised AI agents, with a durable project knowledge body and
> machine-executable quality gates.

The bar for "done" is not "the code runs." It is:

- there is a written, versioned reason for every significant technical decision;
- the system has a designed data model, a chosen consistency posture, and a migration story;
- it builds reproducibly from a clean checkout with one command;
- it has a test pyramid the agents can execute and interpret without a human;
- it deploys to an environment via a pipeline, not via someone's laptop;
- it emits logs/metrics/traces sufficient for an agent to perform root-cause analysis;
- and every feature traces back to a capability in the PRD.

## 1.3 Target users

| Persona | Description | Primary need |
|---|---|---|
| **Solo technical founder** | Senior engineer building a product alone; wants a real system, not a prototype that must be rewritten. | Compressing an entire engineering org into a workflow they can supervise. |
| **Small product team (2–8)** | Startup team using AI agents heavily; inconsistent quality across members. | A shared, enforced process and durable decision memory. |
| **Enterprise platform team** | Adding AI-assisted delivery inside existing standards. | Customisable frameworks, gate enforcement, auditability, brownfield support. |
| **Consultancy / FDE** | Repeated greenfield delivery for clients. | Repeatable, high-quality delivery with client-visible artifacts. |

Assumed competence: comfortable in a terminal, understands git, can read a PRD and an ADR. FORGE
explains and teaches, but it does not target non-technical users.

## 1.4 What FORGE is

1. **A method** — an opinionated software engineering lifecycle expressed as machine-executable
   workflows, decision frameworks, gates and artifact schemas.
2. **A runtime** — a Node CLI + TUI that orchestrates multiple agent sessions across platforms,
   in parallel, with state, resumability, budgets and audit.
3. **A memory** — the Knowledge Body: durable, structured, queryable project truth that every agent
   reads before acting and writes back to after deciding.

## 1.5 What FORGE is not (non-goals for v1.0)

- **Not an LLM provider or agent harness.** It drives Claude Code (and, via the generic declarative
  adapter, `07` §7.5, whatever other coding-agent CLI a user configures); it does not implement a tool
  loop, a context manager, or its own model calls for coding work.
  *(Exception: small structured "utility completions" — classification, extraction, summarisation —
  MAY be run through an adapter's one-shot mode. FORGE never implements its own agent loop.)*
- **Not an IDE, editor, or GUI.** Terminal only in v1.
- **Not a hosted service.** No accounts, no server, no telemetry-by-default. Local-first.
- **Not domain-generic.** No game dev module, no creative writing module, no marketing module.
  Software products only. Domain extensions are possible via modules but are not shipped or blessed.
- **Not a project management tool.** It models work to drive agents, not to replace Jira. Integrations
  are export-only in v1.
- **Not a code generator you fire and forget.** Autonomy is configurable and bounded by gates.

## 1.6 Explicit differentiators vs BMAD

This section is normative: each row is a capability the implementation MUST deliver.

| # | Dimension | BMAD (as of v6.x) | FORGE requirement |
|---|---|---|---|
| D1 | Scope | Domain-generic modules (software, game, creative) | Software products only; depth over breadth |
| D2 | Runtime | Files + prompts installed into an IDE; the IDE drives | A real orchestration runtime with a scheduler, run state, and a TUI; the IDE/agent-CLI is a *backend* |
| D3 | Parallelism | Mostly sequential agent turns driven by the human | First-class DAG scheduler, git-worktree lanes, file-ownership contracts, merge queue |
| D4 | Project memory | Documents + a context/spine file | A schema'd, indexed, validated Knowledge Body with contradiction and staleness detection |
| D5 | Engineering depth | Product/architecture planning strong; init, data, test, debug, deploy thin | Eight first-class decision frameworks (init, design, data, tech, test, debug, delivery, ops) each producing ADRs |
| D6 | Verification | LLM review + checklists | Deterministic gates: build/test/lint/typecheck/coverage/contract/smoke, exit-code driven, LLM as advisory only |
| D7 | Traceability | Story files reference epics | Typed spec graph with enforced edges and a machine-checked traceability matrix; orphan detection |
| D8 | Testing | QA/TEA module, human-oriented | Test strategy designed so agents can author, run, and interpret tests autonomously; test-oracle discipline |
| D9 | Debugging | Ad hoc | Formal RCA loop: reproduce → isolate → hypothesise → falsify → fix → regression-test → KB write-back |
| D10 | Delivery | Out of scope | Build system, environments, CI/CD pipeline, deployment strategy and rollback are designed artifacts |
| D11 | Interface | CLI installer + IDE chat | Installer + **TUI** as the primary control surface: run board, lane inspector, gate approvals, KB browser |
| D12 | Cost/observability | Not modelled | Per-run/per-agent token & cost ledger, budgets, caps, and full event log |
| D13 | Customization | Fork/edit the installed files; edits collide with upgrades | Layered overlay model: agents, skills, MCP grants, workflows, gates, frameworks, templates and voice are customised in visible, diffable files that survive upgrades — with a compile-time guardrail set that prevents customization from disabling rigour (see `15`) |

**Anti-goal:** FORGE must not become a BMAD clone with extra files. If a feature can be expressed as
"a better prompt," it belongs in a template; if it requires state, scheduling, verification or
memory, it belongs in the runtime. The runtime is the differentiator.

## 1.7 Product principles (user-facing)

1. **Ask once, remember forever.** The user should never be asked the same architectural question
   twice, in any session, by any agent.
2. **Show the reasoning, store the reasoning.** Every recommendation comes with alternatives
   considered and why they lost.
3. **Never silently assume.** Missing decision → elicit, derive, or block. Assumptions that *are*
   made are recorded as `ASM-###` artifacts with an owner and a validation trigger.
4. **The user can always see what's happening.** No opaque multi-minute silences: the TUI streams
   lane activity, current step, spend, and next gate.
5. **Stop the line.** Any gate failure halts dependent work rather than cascading broken assumptions.
6. **Right-sized process.** A bug fix must not require a PRD. Scale-adaptive levels (see §10.4)
   choose which phases and artifacts apply.
7. **Adapt it to us, not us to it.** Teams have house styles, mandated stacks, internal tooling and
   their own idea of what a PRD looks like. Every one of those is a supported customization, not a
   fork. But customization changes *how* the work is done, never *whether* it is verified.

## 1.8 Success criteria for v1.0

FORGE v1.0 is done when all of the following hold:

- **SC1** `npx forge-method init` on an empty directory, given a one-paragraph product idea, produces
  a complete Stage-1 (MVP) plan: Vision, PRD, NFRs, architecture ADR set, data model, repo/build
  strategy, test strategy, delivery plan, epics and stories — with a valid traceability matrix.
- **SC2** `forge run build --stage mvp` executes that plan across ≥3 parallel lanes and produces a
  repository that builds, passes its own generated test suite, and starts, from a clean clone, on a
  machine that never ran FORGE.
- **SC3** The same project resumed after `kill -9` mid-run continues without losing or duplicating
  work, verified by an automated crash-resume test.
- **SC4** `forge adopt` on a real existing repo (≥50k LOC) produces a KB whose architecture and data
  model sections are judged accurate by the repo's maintainer, and a drift report.
- **SC5** Both the Claude Code adapter and the generic declarative CLI adapter (`07` §7.5, run against
  a real scripted binary) pass the adapter conformance suite; swapping platforms via config changes
  no workflow, agent, or artifact.
- **SC6** A deliberately introduced bug in the generated system is found and fixed by
  `forge debug <symptom>` with an RCA record and a regression test, with no human diagnosis.
- **SC7** All gates are enforceable: an attempt to advance a stage with a failing gate is refused,
  and the refusal is visible in the TUI with the failing check's output.
- **SC8** Cost ledger accuracy: reported spend per run is within 5% of the sum of adapter-reported
  costs, and budget caps abort runs.
- **SC9** An organisation can express its house standards — a rewritten agent persona and prompt, two
  custom skills, an internal MCP server granted to two roles, a replaced PRD template, a custom gate
  check and a forbidden-technology list — entirely in `.forge/overrides/`, share it as one overlay
  bundle, and apply it to a second project in one command. A minor-version upgrade preserves all of
  it and reports anything that no longer applies.
- **SC10** Every diagram required by the taxonomy (`08` §8.11.3) exists, parses, and — for generated
  diagrams — matches regeneration, so an architecture change that skips the diagram fails the gate.
- **SC11** Every guardrail invariant (`15` §15.10, I1–I12) is enforced at compile time with a test
  proving a malicious or careless overlay is refused with the specific error code.

## 1.9 Scale-adaptive levels

FORGE right-sizes itself. Level is chosen at intake (auto-proposed, human-confirmable) and stored in
the KB; it selects which workflows, artifacts and gates apply.

| Level | Name | Typical | Artifacts required | Gates |
|---|---|---|---|---|
| **L0** | Patch | Bug fix, copy change, dependency bump | Task + test | G-Verify only |
| **L1** | Feature | 1–3 stories inside an existing system | Tech Spec, Stories, Test Plan delta | G-Design(light), G-Verify, G-Deliver |
| **L2** | Capability | New subsystem/service in an existing product | PRD delta, ADRs, Data delta, Epics/Stories, Test Plan | G-Product, G-Design, G-Ready, G-Verify, G-Deliver |
| **L3** | Product | New product, greenfield | Full set (Vision → Ops) | All gates |
| **L4** | Platform | Multi-service/multi-team system, migrations, compliance | Full set + Domain Decomposition, Integration Contracts, Migration Plan, Compliance record | All gates + G-Integration |

Level selection heuristic (implemented in `@forge/methods/level.ts`) considers: greenfield vs
brownfield, number of user-facing capabilities, number of deployable units, presence of persistent
state, presence of external integrations, regulatory flags, and whether more than one runtime/
language is involved. The heuristic MUST show its reasoning and MUST be overridable.

## 1.10 The FORGE promise, expressed as artifacts

At the end of an L3 run the host project contains, at minimum:

```
docs/forge/kb/          product, architecture, data, delivery, ops, domain, decisions (ADRs), glossary
docs/forge/kb/**/views/ validated Mermaid diagrams: C4 context/container/component, ER, sequence,
                        state, deployment, pipeline — generated from structured artifacts where derivable
docs/forge/specs/       vision, prd, nfrs, capabilities, epics, stories, tasks, test-plan, traceability
docs/forge/plans/       stage plans, milestone plans, run plans
docs/forge/sessions/    brainstorms, design reviews, retros, RCA records
docs/forge/reports/     gate reports, coverage, drift, cost
<repo>                  a building, tested, deployable system matching the above
```
