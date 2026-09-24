# 05 — Agent System

## 5.1 What an agent is in FORGE

An agent is **a role contract**, not a chatbot personality. It is defined by:

1. **Mandate** — the decisions this role owns and is accountable for.
2. **I/O contract** — required inputs (artifacts/KB sections), produced outputs (artifact types),
   and the schema each output must satisfy.
3. **Tool grant** — the capability set the role may use (read, write, exec, network, git, deploy).
4. **KB ownership** — which KB sections it may write.
5. **Gate participation** — which gates it can produce evidence for, and which it can never approve.
6. **Persona** — voice and stance, used for facilitation quality and for productive disagreement in
   sessions. Personas are thin; mandates are thick. *(Anti-pattern: cute names carrying the design.)*

An agent is **instantiated** per step as a platform session, seeded with a compiled system prompt =
`role prompt + project context pack + step brief + output contract + constraints`.

## 5.2 Roster

Only roles that exist in a real software organisation. Marked **C**ore (always available),
**S**pecialised (installed with a module), or **O**ptional (enabled per project).

### Direction & product

| id | Role | Tier | Owns | Primary outputs |
|---|---|---|---|---|
| `orchestrator` | Delivery Orchestrator | C | Run planning, sequencing, handoffs, gate scheduling | Run plan, handoff records |
| `analyst` | Product Analyst / Discovery | C | Problem framing, users, market/competitor scan, success metrics | Product Brief, Personas, Metrics tree, Research notes |
| `pm` | Product Manager | C | Scope, capabilities, priorities, PRD, stage boundaries | PRD, Capability list, Stage plan |
| `po` | Product Owner | C | Story-level acceptance, backlog readiness, DoR | Stories, Acceptance criteria, Backlog order |
| `ux` | UX / Product Designer | C | Flows, IA, states, interaction and content design | UX Spec, Flow maps, State inventory, Copy deck |
| `em` | Engineering Manager / Delivery Lead | C | Capacity, sequencing, risk, dependency management, retros | Sequencing plan, Risk register, Retro record |

### Architecture & design

| id | Role | Tier | Owns | Primary outputs |
|---|---|---|---|---|
| `architect` | System Architect | C | System decomposition, patterns, interfaces, NFR strategy | Architecture Spec, ADRs, Component model, Interface contracts |
| `data-architect` | Data Architect | C | Domain/data model, storage choice, consistency, migrations, retention | Data Model, Storage ADRs, Migration plan, Retention policy |
| `domain-modeler` | Domain Modeler (DDD) | S(`fm-service`) | Bounded contexts, ubiquitous language, aggregates, context map | Domain Model, Context Map, Glossary entries |
| `integration-architect` | Integration Architect | S | External systems, protocols, contracts, idempotency, failure modes | Integration Spec, API contracts, Failure-mode table |
| `security` | Security Engineer (AppSec) | C | Threat model, authn/z design, secrets, supply chain, compliance mapping | Threat Model, Security requirements, Security review |

### Build

| id | Role | Tier | Owns | Primary outputs |
|---|---|---|---|---|
| `platform` | Platform / DevEx Engineer | C | Repo strategy, build system, toolchain, scaffolding, local dev env | Repo Layout Spec, Build Spec, Scaffold, Dev env |
| `backend` | Backend Engineer | C | Server-side implementation | Code, unit/integration tests |
| `frontend` | Frontend Engineer | S(`fm-web`) | Client implementation | Code, component tests |
| `mobile` | Mobile Engineer | S(`fm-mobile`) | iOS/Android/cross-platform implementation | Code, tests |
| `data-engineer` | Data Engineer | S(`fm-data`) | Pipelines, ETL/ELT, warehouse/lake modelling | Pipeline code, data tests, lineage |
| `ml-engineer` | ML Engineer | O | Model integration, evals, inference plumbing | Model service, eval harness |

### Quality & operations

| id | Role | Tier | Owns | Primary outputs |
|---|---|---|---|---|
| `test-architect` | Test Architect | C | Test strategy, pyramid shape, oracle design, environments, data | Test Strategy, Test Plan, Coverage targets |
| `sdet` | SDET | C | Test implementation & harnesses (unit→e2e), fixtures, flake control | Test code, harness, flake report |
| `reviewer` | Code Reviewer | C | Change review against spec, standards, and risk | Review report, blocking findings |
| `diagnostician` | Diagnostician (RCA) | C | Reproduce, isolate, root-cause, prove the fix | RCA record, failing test, fix plan |
| `sre` | SRE / DevOps | C | Environments, CI/CD, deploy strategy, rollback, SLOs, observability | Pipeline, IaC, Runbooks, SLO/alert defs |
| `release` | Release Manager | O | Release notes, versioning, change control, rollout | Release plan, changelog |
| `techwriter` | Technical Writer | C | READMEs, ADR clarity, API docs, runbook prose, onboarding | Docs set |
| `finops` | Cost Engineer | O | Infra + token cost modelling, budget impact of designs | Cost model, budget report |
| `compliance` | Compliance Analyst | O | Regulatory mapping (GDPR/HIPAA/PCI/SOC2), evidence | Compliance matrix, control mapping |

### Facilitation

| id | Role | Tier | Owns | Primary outputs |
|---|---|---|---|---|
| `facilitator` | Session Facilitator | C | Runs brainstorms, retros, reviews, premortems; enforces technique | Session record, decisions, actions |
| `critic` | Adversarial Critic | C | Red-teams plans and designs; must produce falsifiable objections | Objection list with severity + test |

The *Primary outputs* column names deliverables in prose. For every role that runs a shipped workflow step, an agent's machine-readable `outputs` (§5.3) lists
only artifact types registered in `18` §18.7 (or its module's own), each at its registry path, plus `Code` for
an implementation role; the engine renders a step's declared outputs at those paths into the prompt (block [5])
and its output check demands the same types and paths. A role no workflow runs may name others. A deliverable
that is a KB entry rather than a registered artifact (a UX spec, a threat model, a test strategy) is written
under the step's `produces`, and the checkable product of its step is the artifact or `HandoffRecord` the step
declares. `decisions_owned` follows the workflow step that takes the decision: `discover:define-metrics` runs as
`pm`, so `product.success_metrics` is `pm`'s.

**Roster rules (normative):**

- `reviewer`, `critic`, `diagnostician`, and `test-architect` MUST never be the same session instance
  as the author of the work under review. Enforced by the engine (`separationOfDuties`).
- `pm`/`po` cannot approve engineering gates; `architect`/`platform` cannot approve product gates.
- Any agent may *propose* a KB write; only the owning agent's writes are auto-applied at
  `autonomous`; others become proposals routed to the owner or the human.

## 5.3 Agent definition format

`# canonical` — `modules/<module>/agents/<id>.agent.yaml`

```yaml
id: architect
name: System Architect
version: 1.2.0
tier: core
extends: base-engineer            # optional inheritance from a base agent

mandate: >
  Owns the shape of the system: decomposition into components, the interaction patterns between
  them, the technology-independent design, and the non-functional strategy. Accountable for every
  architecture ADR being decided, recorded, and consistent with the Knowledge Body.

decisions_owned:                  # used for routing, gate evidence, and KB write permissions
  - architecture.decomposition
  - architecture.patterns
  - architecture.interfaces
  - architecture.nfr_strategy

persona:
  voice: precise, sceptical, allergic to unjustified complexity
  stance: >
    Prefers boring, reversible choices. Demands a stated failure mode for every component boundary.
    Will refuse to proceed on an undefined non-functional requirement rather than guess.
  disagreement_style: names the specific assumption being challenged and proposes a cheaper test

inputs:
  required:
    - artifact: PRD
    - artifact: NFR
    - kb: constraints/*
  optional:
    - artifact: DomainModel
    - kb: architecture/*

outputs:                           # registered types only; each path is the `18` §18.7 path, `*` for the id
  - type: ADR
    schema: adr.schema.json
    path: docs/forge/kb/decisions/ADR-*.md
    cardinality: many
  - type: InterfaceContract
    schema: interface-contract.schema.json
    path: docs/forge/specs/interfaces/*.yaml
    cardinality: many
  - type: Diagram
    schema: diagram.schema.json
    path: docs/forge/kb/*/views/*.mmd
    cardinality: many
  - type: DataModel
    schema: data-model.schema.json
    path: docs/forge/specs/data/DM-*.md
    cardinality: many
  - type: HandoffRecord
    schema: handoff-record.schema.json
    path: docs/forge/reports/handoffs.md

kb_write:                          # sections this agent may write without review
  - architecture/**
  - decisions/**                   # ADRs of category architecture only (enforced by schema)
kb_propose:                        # sections it may only propose changes to
  - data/**
  - constraints/**

tools:
  read: true
  write: true                      # architects don't write source code; the engine confines every step that declares outputs to them
  exec: [ "git log*", "git diff*", "ls*", "rg*", "cat*", "tree*" ]
  network: false
  git_commit: docs-only            # none | docs-only | lane | full
  deploy: false

model:
  tier: max                        # frugal | balanced | max — mapped per platform in config
  thinking: high                   # none | low | medium | high (adapter maps to its own control)

limits:
  max_turns: 40
  wall_clock_ms: 900000
  max_cost_usd: 6.00

parallel_safety:
  file_ownership: [ "docs/forge/kb/architecture/**" ]
  exclusive: true                  # only one architect lane at a time

gates:
  produces_evidence_for: [ G-Design, G-Integration ]
  may_approve: []                  # architects never self-approve their own gate

frameworks:                        # decision frameworks this agent is expected to run
  - system-design
  - pattern-selection
  - nfr-strategy

skills:                            # procedural knowledge packets (see 15 §15.4)
  - adr-authoring
  - stride-threat-modelling
  - mermaid-authoring
  - c4-diagramming
  - sequence-diagramming

mcp:                               # external reach: per-server, per-tool grants (see 15 §15.5)
  - server: acme-confluence
    tools: [ search, get_page ]

ceiling:                           # the maximum an overlay may widen `tools` to (see 15 §15.3.2)
  tools:
    write: true
    exec: [ "git *", "ls*", "rg*", "cat*", "tree*" ]
    network: none
    deploy: false

prompt:
  system: prompts/architect.system.md
  briefs:
    select-architecture-style: prompts/architect.select-architecture-style.md
    change-impact-analysis: prompts/architect.change-impact-analysis.md
```

### Prompt compilation

At runtime `@forge/agents` compiles the effective system prompt as:

```
[1] FORGE operating contract      (constant; rules of engagement — see §5.5)
[2] Role block                    (mandate, persona, decisions_owned, output contract)
[3] Project context pack          (KB slice selected for this step — see §5.4)
[4] Step brief                    (workflow-provided task + acceptance criteria + inputs)
[5] Output contract               (exact artifact schema + file paths + front-matter template)
[6] Constraints                   (tool grants, forbidden actions, budget, autonomy level)
[7] Definition of done            (the checks that will be run against this step's output)
[8] Skills                        (attached skill summaries + activated bodies — see 15 §15.4)
[9] House style + appended guidance (project style profile and any `$append_guidance` overlay)

Blocks [1] and [6] are **invariant**: no overlay, skill, MCP result, or fetched content may modify
them. Blocks [2] and [9] are the primary customization surfaces.
```

Compiled prompts are written to `.forge/state/runs/<runId>/steps/<stepId>/prompt.md` for audit and
are viewable in the TUI (`v` → Prompt). This is mandatory: an opaque prompt is an undebuggable agent.

## 5.4 Context packing

Agents must not receive the whole KB. `@forge/kb/pack` builds a **context pack** per step:

1. **Pinned core** (always): project identity, level, glossary, active constraints, ADR index
   (one-line each), current stage goal, coding standards. Budget: ≤ 15% of context.
2. **Declared inputs**: full text of artifacts the step declares as inputs.
3. **Retrieved**: KB entries selected by relevance to the step brief (see retrieval in `08`),
   capped by token budget, each with its ID so the agent can cite and request more.
4. **Expansion protocol**: the agent may request more context by emitting
   `FORGE_REQUEST_CONTEXT: <kb-id|query>`; the adapter loop resolves it and continues. This is
   preferable to over-packing.
5. **Skills**: front-matter summaries of every attached skill (cheap), plus the bodies of skills
   whose `applies_to` matches this step's file claim or language, up to `skills.packBudgetTokens`.
   Other bodies load on demand via `forge_skill_load` / `FORGE_LOAD_SKILL:`. See `15` §15.4.3.
6. **External content marking**: anything originating from an MCP server or a fetched page is wrapped
   in a labelled untrusted-content block and the step is marked `taint: external`, which strips its
   privileged actions (see `15` §15.5.4).
7. **Never included**: secrets, `.env` contents, other lanes' in-flight work, raw event logs.

Context pack composition is recorded in the step record for reproducibility.

## 5.5 The FORGE operating contract (constant prompt block)

Normative content — every agent receives this verbatim:

1. You are operating inside FORGE, an engineering process. Your output is an **artifact**, and it
   will be validated against a schema and a set of automated checks. Output that fails validation is
   rejected and you will be asked to fix it.
2. **Never invent project facts.** If a fact is not in your context, either request it
   (`FORGE_REQUEST_CONTEXT:`), ask the human (`FORGE_ASK:` with a specific question and options), or
   record an explicit assumption (`FORGE_ASSUME:` with confidence, impact and how to validate it).
   Silent assumptions are defects.
3. **Stay inside your mandate.** If the correct next action belongs to another role, hand off
   (`FORGE_HANDOFF: <role> <reason>`) rather than doing it yourself.
4. **Record decisions.** Any choice with alternatives worth naming becomes an ADR with: context,
   options, decision, consequences, reversibility class, and revisit trigger.
5. **You are not the verifier.** Do not claim work is complete. Claim it is *ready for verification*
   and state exactly which commands should prove it.
6. **Respect file ownership.** Write only to paths you own for this step. If you need a change
   elsewhere, request it (`FORGE_REQUEST_CHANGE:`).
7. **Prefer the boring option.** Novel technology requires an explicit justification recorded in an
   ADR, including the cost of being wrong.
8. **Cite the KB.** When your reasoning depends on a prior decision, cite its ID.
9. **Stop on contradiction.** If your inputs contradict each other, stop and report
   (`FORGE_CONFLICT:`) rather than picking one.
10. **No placeholders in production paths.** `TODO`, `FIXME`, stub returns, and mocked business logic
    in non-test code are gate failures. If you cannot implement it, hand off or block.

11. **Draw the structure.** When your output describes topology, sequence, state, or relationships,
    include a diagram in the project's configured notation (Mermaid by default), with a caption and an
    alt-text summary. If a generator exists for that diagram, invoke it rather than drawing by hand.
    Keep any single diagram under the project's node budget — split into layered views rather than
    producing one unreadable picture. See `08` §8.11.

Structured control tokens (`FORGE_*`) are parsed out of agent output by the adapter layer and turned
into engine events. Each has a schema; unknown tokens are logged and ignored.

## 5.6 Handoff protocol

A handoff is an artifact, not a vibe. `HandoffRecord`:

```yaml
id: HO-0042
from: architect
to: platform
step: design-system → initialize-repo
timestamp: 2026-03-04T12:41:02Z
delivered:
  - ADR-011 monorepo strategy
  - ADR-012 build system
  - docs/forge/kb/architecture/architecture-spec.md
open_questions:
  - "Do we need a separate package for the shared domain types, or is a folder enough at MVP scale?"
assumptions:
  - id: ASM-004
    text: "Single deployable at MVP; second service arrives at M2"
    confidence: high
    validate_by: "stage plan review at M2 kickoff"
constraints_for_receiver:
  - "Do not introduce a new language runtime without an ADR"
acceptance_for_receiver:
  - "pnpm install && pnpm build && pnpm test succeed from clean clone"
```

The receiving agent's context pack always includes the inbound handoff record. Handoffs are
listed in the TUI and are part of the run audit.

## 5.7 Multi-agent interaction modes

| Mode | Description | Used by |
|---|---|---|
| **Solo** | One agent, one step | Most implementation steps |
| **Pair** | Author + continuous reviewer in the same lane; reviewer sees each proposed diff before commit | High-risk stories, security-sensitive code |
| **Fan-out** | N independent agents on disjoint file sets | Story implementation |
| **Panel** | K agents answer the same question independently, then a synthesiser reconciles | Architecture options, tech selection |
| **Debate** | Proposer vs `critic`, ≤3 rounds, then a decider role rules and records an ADR | Contested decisions |
| **Relay** | Strict sequential pipeline with handoff records | Planning phases |
| **Swarm-review** | Multiple review perspectives on one diff (security, perf, testing, design) merged into one report with de-duplicated findings | Pre-merge for risky changes |

Each mode is a workflow primitive (see `10`), not ad-hoc code.

A workflow `agent` step with `mode: swarm-review` runs one read-only session per declared perspective. The
**engine**, not a reviewer, merges them: it creates the step's lane, writes the `ReviewReport` (`18` §18.7)
there with per-perspective and merged verdicts computed from the perspectives' structured findings (never
parsed from their prose), and validates it; the step's outputs (which always include the `ReviewReport`, whether
or not the step lists it) are then checked on that lane like any other agent step's. The `reviewer` role stays
`write: false`: reviewers cannot write what they review. A perspective that returns nothing readable, or
findings with malformed entries and no blocking finding of its own, fails the step instead of being recorded as
a clean review. The verdicts are data (in the report's own `verdict` front-matter key and in the run's
`ArtifactCreated` event, the latter only for a step that succeeds) and the merged verdict binds: a `blocked`
verdict fails the step instead of succeeding it, classified so it is never retried automatically; `incomplete`,
`concerns` and `clear` still succeed the step unchanged, as data only, for now.

## 5.8 Model tier mapping

Agents declare a tier; config maps tiers to concrete platform models.

```yaml
# .forge/config.yaml
models:
  tiers:
    # A configured generic-declarative-adapter id (07 §7.5) may add its own column here too, e.g.
    # my-adapter: "<model-id>" — shown as "frugal" only, for brevity.
    frugal:   { claude-code: haiku, my-adapter: "<cheap-model>" }
    balanced: { claude-code: sonnet }
    max:      { claude-code: opus }
  overrides:
    backend: balanced
    architect: max
    diagnostician: max
```

Model identifiers MUST be resolved via the adapter's `listModels()` capability at doctor time, and
FORGE MUST NOT hard-code model version strings anywhere except a single defaults file that doctor
validates against reality. Unknown/unavailable model → doctor error with the available list.

## 5.9 Agent authoring & validation

- `forge agent new` scaffolds from a template with all required fields.
- `forge agent validate` checks: schema validity; no KB write overlap with another agent unless
  declared `shared`; `file_ownership` globs don't overlap with another agent marked `exclusive`; no
  agent's declared output lies inside another agent's `exclusive` `file_ownership`
  (`output-ownership-overlap`, an error); every declared output names a registered artifact type
  (`18` §18.7), `Code`, or a type a module registers itself, else a warning
  (`unregistered-output-type`); declared frameworks exist; prompts referenced exist; tool grants don't
  exceed the module's ceiling.
- `forge agent compile` emits platform-native assets (e.g. Claude Code subagent files) so the roles
  are also usable directly inside the host platform's own UI — a deliberate escape hatch for humans
  who want to talk to a single role without a run.

## 5.10 Customization of agents

Agents are the surface users most want to change, so the mechanism is first-class rather than
"edit the installed file". Full semantics in `15`; the contract from this spec's side:

- **Nothing in `modules/*/agents/` is ever hand-edited.** Changes live in
  `.forge/overrides/agents/<id>.agent.yaml` as a partial document with `$extends`, and are merged at
  compile time. `forge agent diff <id>` shows base vs resolved with per-field layer provenance.
- **Freely customisable:** persona, mandate wording, prompts and briefs, `$append_guidance`, model
  tier and thinking level, limits, `skills`, `mcp`, `frameworks`, display name.
- **Constrained:** `tools` (only within `ceiling`, unless a recorded expiring escalation exists),
  `kb_write` (narrowing is free, widening needs the section to be unowned or `shared`), `outputs`
  (additive only), `file_ownership` (no overlap with another `exclusive` claim), `decisions_owned`
  (compile warns on unowned or doubly-owned decisions).
- **Immutable:** `gates.may_approve` and the separation-of-duties rules in §5.2. An overlay that
  would let an agent review, test or diagnose its own output fails compile with `CFG-501`.
- **Roster shaping:** roles can be enabled, disabled, aliased, added, or `split` into several bounded
  specialists with disjoint file ownership — the last of which is the cleanest way to increase safe
  parallelism on a large codebase. Required roles (`orchestrator`, `pm`, `architect`,
  `test-architect`, `reviewer`, `diagnostician`) cannot be disabled at their applicable level.

`forge agent validate` runs all of the above checks, and additionally verifies that every skill and
MCP server an agent references actually exists and exposes the granted tools.
