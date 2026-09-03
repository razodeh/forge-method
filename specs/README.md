# FORGE — Specification Pack

**FORGE** is an AI software-product development method and runtime: an `npx`-installable, TUI-driven
orchestration layer that turns a software product idea into a *shipped, engineered system* using a
fleet of role-specialised AI agents running on top of coding-agent platforms (Claude Code,
CodeMachine, and others later).

This directory is the **complete build specification**. It is written to be handed to Claude Code (or
any competent engineering agent/team) and executed from empty repo to v1.0 without further design
input.

---

## 0. How to consume this pack

**Reading order for the implementer:**

| # | File | What it fixes |
|---|---|---|
| 01 | `01-product-vision-and-scope.md` | What FORGE is, who it's for, what it is *not*, differentiators vs BMAD, success criteria |
| 02 | `02-architecture-and-tech-stack.md` | Monorepo layout, packages, module boundaries, runtime tech choices, build/release |
| 03 | `03-cli-and-installer.md` | `npx forge-method` UX, every command + flag, install/upgrade/migrate, non-TTY mode |
| 04 | `04-tui-specification.md` | Every screen, component, keybinding, state machine, rendering rules |
| 05 | `05-agent-system.md` | Agent roster, agent definition format, personas, tool grants, handoff protocol |
| 06 | `06-orchestration-and-parallelism.md` | Run graph, scheduler, worktrees, file ownership, merge queue, retries, budgets |
| 07 | `07-platform-adapters.md` | Adapter interface, Claude Code adapter, CodeMachine adapter, conformance suite |
| 08 | `08-knowledge-body.md` | Project memory: layout, schemas, ADRs, indexing, retrieval, staleness, contradiction detection |
| 09 | `09-spec-driven-development.md` | Artifact hierarchy, IDs, traceability, machine-readable ACs, spec→test→code binding |
| 10 | `10-workflow-engine-and-lifecycle.md` | Workflow DSL, the FORGE lifecycle, phases/gates, milestone planning, built-in workflows |
| 11 | `11-frameworks-initialization-and-architecture.md` | Project initialization + system design decision frameworks |
| 12 | `12-frameworks-data-and-technology.md` | Data modeling, CAP/consistency, DBMS selection, technology catalog + selection engine |
| 13 | `13-frameworks-testing-and-debugging.md` | Agent-executable test strategy, quality gates, autonomous debug/RCA loop |
| 14 | `14-frameworks-delivery-and-operations.md` | Build system, environments, CI/CD, deployment, observability, release |
| 15 | `15-customization-and-user-freedom.md` | **The customization surface**: agent overlays, skills, MCP grants, presets, guardrails, plugin road-map |
| 16 | `16-collaboration-sessions.md` | Brainstorming, retro, design review, war room, estimation; facilitation technique library |
| 17 | `17-brownfield-ingestion.md` | Existing-codebase onboarding, cartography, KB reconstruction, drift detection |
| 18 | `18-persistence-config-and-schemas.md` | On-disk layout, config resolution, state store, event log, all canonical schemas |
| 19 | `19-authoring-modules-and-distribution.md` | Module system, template engine, authoring workflow, packaging and distribution of overlay bundles |
| 20 | `20-security-safety-and-cost.md` | Permission model, secrets, destructive-op guardrails, token/cost governance |
| 21 | `21-testing-forge-itself.md` | Test plan for FORGE the product: unit, integration, e2e, golden files, agent-sim harness |
| 22 | `22-build-plan-and-milestones.md` | Ordered implementation milestones with acceptance criteria and exit tests |
| 23 | `23-open-decisions.md` | The small set of decisions deliberately left to the implementer/owner, with recommendations |

**Build order:** follow `22-build-plan-and-milestones.md`. Do not build the TUI first; build
`@forge/core` + `@forge/schemas` + the workflow engine headlessly and drive it from a non-interactive
CLI, then layer the TUI on top. This keeps the whole system testable without a terminal.

---

## 1. Naming and identifiers

| Thing | Value |
|---|---|
| Product name | FORGE |
| Expansion | *Framework for Orchestrated, Rigorous, Governed Engineering* |
| npm package (installer/CLI) | `forge-method` |
| Invocation | `npx forge-method` / `npx forge-method@next` |
| Installed binary | `forge` |
| Scope for internal packages | `@forge/*` |
| Project install dir | `.forge/` (runtime) + `docs/forge/` (human-readable artifacts) |
| Config file | `.forge/config.yaml` |
| Env prefix | `FORGE_` |

> **Implementer action:** verify `forge-method` and the `@forge` npm scope are available before
> publishing. If not, fall back to `forgekit-method` / `@forgekit/*`. Names appear only in
> `packages/*/package.json`, the `bin` map, and `constants.ts` — keep them centralised so a rename is
> a one-file change. See `23-open-decisions.md` §1.

---

## 2. Non-negotiable design principles

These are the invariants. Every design decision downstream must be checkable against them.

1. **Engineering, not vibe coding.** Every line of production code must be traceable to a spec
   artifact, and every spec artifact must be traceable to a product capability. Untraceable code is
   a gate failure, not a style preference.
2. **The Knowledge Body is the single source of truth.** Agents never invent context. If a decision
   isn't in the KB, the workflow must either *elicit* it, *derive* it via a decision framework, or
   *stop*. Silent assumptions are the primary failure mode of AI dev tooling and FORGE treats them
   as defects.
3. **Decisions are explicit, recorded, and revisable.** Architecture, stack, data model, and process
   choices are captured as ADRs with alternatives, trade-offs, and reversibility class.
4. **Verification is machine-executable.** A quality gate that requires a human to eyeball something
   is a last resort. Gates run commands and read exit codes and structured reports.
5. **Agents review agents is not verification.** LLM review is a *signal*, never a gate pass on its
   own. Every gate requires at least one deterministic, non-LLM check (build, test, lint, typecheck,
   schema validation, coverage, contract test, smoke test against a running system).
6. **Human-in-the-loop is a first-class control, not an afterthought.** Every gate has an autonomy
   level. The user chooses per-gate how much rope the agents get.
7. **Everything durable is plain text in the repo.** Markdown + YAML front matter + JSON. Diffable,
   reviewable, git-native. Binary/SQLite state is always *derived and rebuildable*.
8. **Platform-agnostic core.** No Claude-Code-specific concept leaks past `@forge/adapter-kit`.
9. **Resumable by construction.** Any run can be killed at any moment and resumed from the last
   committed step. Crash-safety is tested, not assumed.
10. **Parallel by default, safe by contract.** Agents fan out only after the interfaces they share
    are frozen. Concurrency is bounded by declared file ownership, not by hope.
11. **If it has structure, it gets drawn.** Topology, sequence, state and relationships are recorded
    as validated, text-based diagrams (Mermaid by default) that live in the repo, are generated from
    structured artifacts where derivable, and are checked for drift. Binary images and SaaS boards
    are never sources of truth, because an agent cannot read or update them. See `08` §8.11.
12. **The user owns flavour; FORGE owns rigour.** Personas, skills, tool reach, stack conventions,
    templates, ceremony level and voice are all customisable through visible, diffable, upgrade-safe
    overlay files. Traceability, gate determinism, separation of duties and audit are not — they can
    only be waived explicitly, with an owner and an expiry. A process that can be quietly bent is a
    process that lies. See `15`.

---

## 3. Conventions used in this pack

- **MUST / SHOULD / MAY** carry RFC 2119 meaning. `MUST` items are acceptance criteria.
- Code fences containing TypeScript are **normative interface definitions** — implement them as
  written (names, shapes) unless a later file supersedes them.
- YAML blocks labelled `# canonical` are the authoritative file formats.
- `TODO(impl)` marks a deliberate degree of freedom; `23-open-decisions.md` lists them all.
- Paths are relative to the FORGE repo root unless prefixed with `<project>/`, which means the user's
  project that FORGE is installed into.

---

## 4. Glossary

| Term | Meaning |
|---|---|
| **Host project** | The user's software project FORGE is installed into. |
| **Knowledge Body (KB)** | The durable, structured project memory under `<project>/docs/forge/kb/`. |
| **Artifact** | Any FORGE-produced document with an ID, front matter, and a schema (Vision, PRD, ADR, Epic, Story, Task, Test Plan, Session Record, …). |
| **Spec graph** | The typed DAG linking artifacts by traceability edges. |
| **Agent** | A role definition (persona + mandate + tool grants + I/O contract), instantiated as a platform session. |
| **Adapter** | Implementation of the platform interface for a coding-agent runtime (Claude Code, CodeMachine, …). |
| **Lane** | An isolated execution context (git worktree + branch + session) in which one agent works. |
| **Run** | One execution of a workflow, with an event log, ledger, and resumable state. |
| **Step** | One node in a workflow: an agent invocation, a command, a gate, an elicitation, or a sub-workflow. |
| **Gate** | A named checkpoint with deterministic checks and an autonomy level. |
| **Framework** | A structured decision procedure (inputs → questions → rubric → recommendation → ADR). |
| **Module** | An installable bundle of agents, workflows, frameworks, templates and catalogs. |
| **Elicitation** | Structured questioning of the human to fill a KB gap. |
| **Stage** | A delivery slice of the product (MVP, Milestone 2, GA, …). |
| **Overlay** | A partial document under `.forge/overrides/` that modifies a built-in or module-supplied object (agent, workflow, gate, framework, template, check) without editing it. |
| **Resolved set** | The compiled output of all customization layers, regenerated on demand and never hand-edited. |
| **Skill** | A reusable, progressively-disclosed packet describing *how to do a class of task well*, attached to agents. Distinct from KB (project truth) and Framework (a decision procedure). |
| **MCP grant** | A per-role, per-tool authorisation to use a registered MCP server. Never ambient. |
| **Ceiling** | The maximum tool grant a module permits for an agent; overlays may narrow within it, and exceed it only via a recorded, expiring escalation. |
| **Preset** | A named bundle of customization choices (`startup-lean`, `enterprise-rigor`, …) that can be ejected into visible overlay files. |
| **Overlay bundle** | A shareable, versioned package of overlays — the v1 precursor to plugins. |
| **Diagram (`DIAG-###`)** | A validated, text-based diagram artifact (Mermaid by default) that clarifies a decision, structure, sequence or state. Generated from structured artifacts wherever derivable. |
| **Taint** | A marker on a step whose context includes untrusted external content (MCP results, fetched pages); tainted steps lose privileged actions. |
