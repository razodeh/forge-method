# 15 — Customization and User Freedom

## 15.0 Why this exists

FORGE is opinionated by design. Opinion is what separates it from a prompt library. But an
opinionated system that cannot be adapted gets forked, abandoned, or worked around — and a worked-
around process is worse than no process, because the gates now lie.

So FORGE draws a hard line:

> **The user owns flavour. FORGE owns rigour.**
>
> *Flavour* = who the agents are, how they speak, what they know, what tools they can reach, which
> stack conventions they follow, how much ceremony a project gets.
> *Rigour* = traceability, gate determinism, separation of duties, file-ownership safety, and the
> requirement that decisions are recorded.

Everything in the flavour column is customisable, discoverable, and survives upgrades. Everything in
the rigour column is either fixed or requires an explicit, recorded, expiring waiver. This spec
defines both lists exactly, so no implementer has to guess.

---

## 15.1 The customization surface map

| # | Surface | What the user changes | Mechanism | Blast radius | Guardrail |
|---|---|---|---|---|---|
| C1 | **Agent behaviour** | mandate wording, persona, briefs, prompts, model tier, limits | Agent overlay | Output quality | Ceilings; schema validation |
| C2 | **Agent roster** | enable/disable roles, add custom roles, alias, split, team presets | `roster` config + agent files | Process shape | Required-role check |
| C3 | **Agent knowledge** | Skills attached to roles | Skill packets | What agents *know how to do* | Skill validation, size caps |
| C4 | **Agent reach** | MCP servers granted per role | MCP registry + grants | What agents *can touch* | Allowlist, scopes, secret policy, injection posture |
| C5 | **Tool grants** | shell allowlists, network policy, git rights | Agent overlay `tools` | Safety | Module ceiling; never exceeds it |
| C6 | **Workflows** | insert/remove/replace/reorder steps, custom workflows | Workflow overlay | Process | Gate steps cannot be deleted, only re-scoped |
| C7 | **Gates & checks** | add checks, change thresholds, change autonomy per gate | Gate overlay + custom checks | Rigour | Cannot remove deterministic-check requirement; `alwaysHuman` gates locked |
| C8 | **Decision frameworks** | criteria weights, options, add/remove candidates, hard rules | Framework overlay | Recommendations | Must still emit ADR + score table |
| C9 | **Templates & artifacts** | document templates, front-matter extras, section order, house wording | Template overlay | Deliverable look | Required schema fields immutable |
| C10 | **Technology catalog** | approved/forbidden tech, add internal platforms, override entries | Project catalog | Stack selection | Constraint filter transparency preserved |
| C11 | **Standards & DoD** | coding standards, DoD/DoR profiles, checklists, commit/branch conventions | Profile files | Definition of "done" | DoD must contain ≥1 deterministic check |
| C12 | **Voice & language** | tone, verbosity, output language, terminology, doc style | Style profile | Everything written | — |
| C13 | **Presets** | whole-posture bundles (startup / enterprise / regulated / solo) | Preset | All of the above | Preset is just a bundle of the above |
| C14 | **Sessions** | facilitation techniques, session agendas | Technique files | Discussions | — |
| C15 | **Platform behaviour** | adapter selection, per-role routing, transport, bare mode | Config | Execution | Conformance suite still applies |
| C16 | **Diagrams** | notation, allowed dialects, theme and legend, complexity budgets, drift policy, required-diagram taxonomy | `diagrams:` config + overlays | Clarity of the KB | Required coverage may be tightened freely; relaxing below the module floor is reported in every gate report |

Every surface is a **file in the project**, diffable and reviewable. There is no hidden
customization state and no GUI-only setting.

---

## 15.2 The layering and override model

Five layers, resolved deepest-wins, with explicit merge semantics:

```
L0  built-in defaults            (shipped in @forge/templates)
L1  installed modules            (fm-core, fm-web, fm-service, … in install order)
L2  organisation overlay         (optional: a shared repo/package, see §15.11)
L3  project overrides            <project>/.forge/overrides/**         (committed)
L4  personal overrides           <project>/.forge/overrides.local/**   (git-ignored)
```

**Resolution rules:**

1. Resolution happens at **compile time**, not at read time. `forge compile` (implicit in `init`,
   `upgrade`, `module add`, and at the start of every run) resolves all five layers into
   `.forge/{agents,workflows,frameworks,templates,checks,skills}/` — the *resolved set*.
2. The resolved set is **generated and disposable**. It carries the generated-file header, is
   git-ignored by default, and is never hand-edited. Every hand edit belongs in `overrides/`.
3. `forge config explain` has a sibling: **`forge overlay explain <id>`** prints the final resolved
   object and, per field, which layer supplied it. This is mandatory — an override system without
   provenance is unusable at layer 3.
4. Conflicts between two modules at L1 are resolved by install order, and reported at compile time
   as warnings so the user can pin intent with an L3 override.

### Merge semantics

Overlays are partial documents applied with **JSON-Merge-Patch plus explicit array operators**.
Scalars and objects merge; arrays require an operator, because silent array replacement is the
single most confusing behaviour in every config system ever built.

```yaml
# .forge/overrides/agents/backend.agent.yaml
$extends: backend              # which built-in/module agent this modifies (default: same id)
$description: "Our Java house style, tighter budget, internal tooling access"

model:
  tier: balanced               # scalar: replaced

persona:
  voice: "terse, cites the standard it is applying"   # scalar: replaced

tools:
  exec:
    $append: [ "./gradlew *", "internal-cli *" ]      # array: append
  network: allowlist
  allowlistHosts:
    $set: [ "artifactory.internal", "registry.npmjs.org" ]

skills:
  $append: [ acme-java-standards, acme-observability ]
  $remove: [ generic-node-conventions ]

mcp:
  $append:
    - server: acme-jira
      tools: [ search_issues, get_issue ]             # tool-level grant, not server-level
    - server: acme-confluence
      tools: [ search ]

limits:
  max_cost_usd: 3.00

briefs:
  implement-story: overrides/prompts/backend.implement-story.md   # replace a specific brief
  $append_guidance: overrides/prompts/backend.house-rules.md      # appended to every brief
```

Operators: `$set` (replace whole array), `$append`, `$prepend`, `$remove` (by value or `id`),
`$replaceWhere` (match on `id`, merge the matched element), `$clear`. Applied in that order.
Unknown operators are a compile error, never ignored.

`$append_guidance` deserves special mention: it is the cheapest, safest, most-used customization —
"add this paragraph to everything this role does" — and it MUST be a first-class field rather than
forcing users to fork a whole prompt.

### Upgrade safety

- Overlays are never overwritten by `forge upgrade`. Only the resolved set is regenerated.
- Each overlay declares compatibility: `$forgeVersion: ">=1.2 <2"`. On upgrade, incompatible overlays
  are reported, not silently applied.
- If an upgrade changes a base object such that an overlay's `$replaceWhere` or field path no longer
  resolves, compile emits `CFG-04x overlay target not found` with the old and new base shown as a
  diff, and the run refuses to start until resolved (or `--ignore-stale-overlays` is passed, which is
  recorded in the run).
- `forge overlay doctor` lists: stale targets, overlays that are now no-ops (base already matches),
  overlays that exceed a ceiling, and overlays that duplicate a module's behaviour.

---

## 15.3 Agent customization (C1, C2, C5)

### 15.3.1 What can be changed

| Field | Changeable | Notes |
|---|---|---|
| `persona.*` | ✅ free | voice, stance, disagreement style |
| `mandate`, `decisions_owned` | ✅ | changing `decisions_owned` re-routes work; compile warns if a decision becomes unowned or doubly-owned |
| `prompt.system`, `prompt.briefs`, `$append_guidance` | ✅ | full replacement supported |
| `model.tier`, `model.thinking` | ✅ | tier→model mapping remains config-level |
| `limits.*` | ✅ | may be raised only up to the module ceiling |
| `skills` | ✅ | see §15.4 |
| `mcp` | ✅ | see §15.5 |
| `frameworks` | ✅ | may add custom frameworks; removing a framework required by a gate fails compile |
| `inputs`, `outputs` | ⚠️ constrained | may *add* outputs; may not remove an output another step declares as an input |
| `kb_write`, `kb_propose` | ⚠️ constrained | may narrow freely; widening requires the section to be otherwise unowned or `shared: true` |
| `tools.*` | ⚠️ ceiling-bound | see below |
| `parallel_safety.file_ownership` | ⚠️ constrained | overlapping `exclusive` claims fail compile |
| `gates.may_approve` | ❌ | separation of duties is not user-editable |
| `tier`, `id` | ❌ | create a new agent instead |

### 15.3.2 Tool ceilings

Each module declares a **ceiling** per agent; an overlay can only narrow within it, or widen up to
it. Widening beyond the ceiling requires a project-level, explicitly acknowledged escalation:

```yaml
# .forge/config.yaml
security:
  toolCeilingEscalations:
    - agent: sre
      grant: { deploy: true, network: full }
      reason: "SRE role owns our internal deploy CLI which calls our private control plane"
      approvedBy: "radwan"
      approvedAt: 2026-08-19
      expires: 2026-11-19
```

Escalations appear in `forge doctor`, in every gate report, and in the TUI header while active.
Escalations that grant `write: true` to a review/critic role, or `deploy: true` to a non-ops role,
are refused outright — those are the specific combinations that break the system's guarantees.

### 15.3.3 Roster composition

```yaml
# .forge/config.yaml
roster:
  preset: startup-lean            # optional starting point (see §15.9)
  enable:  [ compliance ]         # turn on optional roles
  disable: [ ux, mobile ]         # turn off roles this project doesn't need
  alias:
    backend: "Platform Engineer"  # display name only; ids never change
  add:
    - id: sap-integrator          # custom role from .forge/overrides/agents/sap-integrator.agent.yaml
  split:
    backend:                      # one role, several specialised instances
      - id: backend-api
        skills: [ acme-rest-standards ]
        file_ownership: [ "src/api/**" ]
      - id: backend-worker
        skills: [ acme-async-standards ]
        file_ownership: [ "src/worker/**" ]
```

**Required roles** (compile error if disabled at the relevant level): `orchestrator`, `pm` (L2+),
`architect` (L2+), `test-architect` (L1+), `reviewer`, `diagnostician`. Disabling `reviewer` or
`test-architect` is the fast path to the failure modes FORGE exists to prevent, so it is refused
with a message that says exactly that and points at `autonomy` settings instead.

`split` is important for real teams: it lets one role become several bounded specialists with
disjoint file ownership, which directly increases safe parallelism.

### 15.3.4 Custom agents

`forge agent new --from backend --id sap-integrator` scaffolds a full agent file (not an overlay)
with all required fields, a starter prompt, and a validation pass. A custom agent must declare
`decisions_owned`, `outputs`, `file_ownership` and `tools` like any other; there is no
"unconstrained" agent, because an agent without a mandate is just a chat window.

---

## 15.4 Skills (C3)

### 15.4.1 Definition

A **Skill** is a named, reusable packet of *how to do a specific kind of thing well*, attached to one
or more agents and loaded progressively — metadata always, body on demand.

Skills are the answer to "our agents need to know our conventions" without stuffing everything into
system prompts. They are the highest-leverage customization surface for real teams, because most
organisational knowledge is procedural, not factual (factual belongs in the KB).

**Skill vs KB vs Framework — a boundary the implementation must keep clean:**

| | Answers | Example | Lives in |
|---|---|---|---|
| **KB entry** | *What is true about this project* | "We use Postgres; here's why" | `docs/forge/kb/` |
| **Skill** | *How to do a class of task well, anywhere* | "How we write a Flyway migration" | `skills/` |
| **Framework** | *How to make a specific decision* | "Choose a datastore" | `frameworks/` |

If a piece of content is project-specific truth, it is a KB entry. If it is a reusable procedure, it
is a Skill. Compile emits a warning when a Skill body contains project-specific identifiers that
suggest it should have been a KB entry.

### 15.4.2 Format

```
skills/acme-java-standards/
├─ SKILL.md            required: front matter + body
├─ references/         optional: deep-dive docs loaded only when the body points to them
│   ├─ error-handling.md
│   └─ logging.md
├─ examples/           optional: canonical good/bad examples
├─ scripts/            optional: executable helpers the agent may run
│   └─ check-layering.sh
└─ assets/             optional: templates, config snippets to copy
```

```markdown
---
id: acme-java-standards
name: ACME Java service standards
version: 2.1.0
description: >
  How ACME writes Spring Boot services: package layout, error model, logging fields,
  transaction boundaries, and the layering rules enforced by ArchUnit.
when_to_use: >
  Any task that creates or modifies Java source in a service module.
applies_to:
  agents: [ backend, reviewer, sdet ]        # default attachment
  languages: [ java, kotlin ]
  paths: [ "services/**/src/main/java/**" ]  # auto-activation hint
activation: auto            # auto | explicit | always
budget_tokens: 3000         # cap on the injected body
requires_tools: [ read ]
scripts:
  - id: check-layering
    run: "scripts/check-layering.sh"
    grant: exec
provides_checks:            # a Skill may contribute gate checks
  - id: acme:layering
    run: "scripts/check-layering.sh --json"
    failOn: "violations > 0"
forge_version: ">=1.0 <2"
---

## Package layout
…

## Error model
…  (see `references/error-handling.md` for the full catalogue)

## Do not
- Do not catch `Exception` at a controller boundary; use the `@ProblemDetail` mapper.
```

### 15.4.3 Resolution and injection

1. **Attachment** — a skill attaches to an agent by the agent's `skills:` list, the skill's
   `applies_to.agents`, or a project rule in config. Explicit agent lists win.
2. **Activation** —
   - `always`: body injected into every step for that agent.
   - `auto` *(default)*: only the front-matter `description` + `when_to_use` are injected into the
     context pack (cheap, ~40 tokens each); the agent loads the body on demand via the
     `forge_skill_load(id)` MCP tool or the `FORGE_LOAD_SKILL:` control token. Path/language hints
     upgrade a skill to injected-body when the step's file claim matches.
   - `explicit`: only loadable when a workflow step or the user names it.
3. **Budget** — total injected skill content is capped by `skills.packBudgetTokens` (default 8000);
   over-budget skills are demoted to metadata-only and the demotion is logged, never silent.
4. **Platform mapping** — see §15.6.

### 15.4.4 Built-in skill library (shipped, all overridable)

| Group | Examples |
|---|---|
| Method skills | writing an ADR, writing testable acceptance criteria, splitting an oversized story, running an RCA, writing a runbook, expand-contract migration |
| Discipline skills | TDD loop discipline, test-oracle design, contract testing, property-based testing, performance benchmarking, threat modelling with STRIDE |
| Diagramming skills | `mermaid-authoring`, `c4-diagramming`, `sequence-diagramming` (failure paths, not just the happy path), `er-diagramming`, `state-diagramming`, `diagram-review` |
| Stack skills | per-stack conventions for the ecosystems in the catalog (Node/TS, Python, JVM, Go, Rust, .NET), each with layout, error, logging and testing conventions |
| Tooling skills | git hygiene for lanes, conventional commits, debugging with traces, reading a flamegraph, interpreting a coverage report |
| Writing skills | house documentation style, changelog writing, API reference writing |

Built-ins are deliberately thin and generic; they exist so that an organisation's overlay has an
obvious hook to replace rather than a blank page to fill.

### 15.4.5 Commands

```
forge skill list [--agent backend] [--active]
forge skill show <id>
forge skill new <id> [--from <builtin>]
forge skill validate [<id>]        # schema, size, dead references, script grants, secret scan
forge skill attach <id> --agent backend[,reviewer]
forge skill detach <id> --agent backend
forge skill test <id>              # runs provides_checks against the current repo
forge skill import <path|url|npm:pkg>
```

`forge skill validate` MUST check: front matter schema; body ≤ `budget_tokens` (warn) and ≤ hard cap
(error); every `references/` file linked from the body exists and vice-versa (dead-weight detection);
scripts are executable and declared; no secrets; no instructions that attempt to widen tool grants or
override the FORGE operating contract (see §15.10).

---

## 15.5 MCP servers (C4)

### 15.5.1 Model

MCP is how an agent reaches *outside the repo* — issue trackers, design tools, internal APIs,
databases, documentation systems. FORGE treats MCP as a **granted capability**, registered centrally
and granted per role, per tool, never ambiently available.

```yaml
# .forge/config.yaml  (or .forge/overrides/mcp/*.mcp.yaml for one-file-per-server)
mcp:
  servers:
    - id: acme-jira
      transport: stdio                  # stdio | http | sse
      command: "npx"
      args: [ "-y", "@acme/jira-mcp" ]
      env:
        JIRA_BASE_URL: "https://acme.atlassian.net"
        JIRA_TOKEN: "${secret:jira_token}"     # never a literal; see §15.5.3
      timeoutMs: 30000
      trust: internal                   # internal | vendor | community | untrusted
      readOnly: true
    - id: acme-postgres-staging
      transport: stdio
      command: "mcp-postgres"
      args: [ "--url", "${secret:staging_ro_dsn}" ]
      trust: internal
      readOnly: true
      environments: [ dev, staging ]    # never available in a production-targeted run
    - id: figma
      transport: http
      url: "https://mcp.figma.example/sse"
      trust: vendor
      readOnly: true

  grants:                               # role → server → tools
    pm:        { acme-jira: [ search_issues, get_issue, create_issue ] }
    po:        { acme-jira: [ search_issues, get_issue ] }
    ux:        { figma: [ get_file, get_comments ] }
    data-architect: { acme-postgres-staging: [ list_schemas, describe_table, explain_query ] }

  defaults:
    grantMode: explicit                 # explicit | server-wide  (explicit strongly recommended)
    injectionPosture: untrusted-content # see §15.5.4
```

### 15.5.2 Rules

1. **No ambient MCP.** A server present in the user's platform config (e.g. a project `.mcp.json`)
   is *not* automatically available to FORGE agents. FORGE runs adapters in reproducible/bare mode
   by default precisely so that the tool surface is the one FORGE declared. `mcp.adoptHostServers:
   true` opts into inheriting them, with a loud warning and a run-level record.
2. **Tool-level grants** are the default. Server-wide grants require `grantMode: server-wide` and are
   reported per run.
3. **Write-capable servers** (`readOnly: false`) may only be granted to roles whose `tools` include
   the corresponding capability class, and never to `reviewer`, `critic`, or `diagnostician` — the
   roles whose value depends on them being observers.
4. **Environment scoping.** A server may declare `environments`; grants are dropped when a run
   targets an environment outside that list. Production-targeted runs default to *no* write-capable
   MCP servers.
5. **Availability degradation.** If an adapter reports `mcp: false`, FORGE does not silently drop the
   capability: steps whose brief depends on a granted server are refused with `ADP-02x`, or — when
   the adapter supports it — proxied through FORGE's own tool channel (§15.6).
6. Every MCP tool call is recorded in the event log with server id, tool name, argument digest
   (not raw arguments, which may contain sensitive data), duration and outcome.

### 15.5.3 Secrets

- `${secret:<name>}` is resolved from the configured secret source at session-launch time and passed
  via the child process environment only. Secrets never enter prompts, logs, event records, the KB,
  or artifacts.
- Sources: env var, OS keychain, `.forge/secrets.local.yaml` (git-ignored, 0600, warned about), or an
  external provider command (`secretCommand: "op read op://…"`).
- `forge doctor` verifies every referenced secret resolves *without printing it*, and `forge mcp test
  <id>` performs a live handshake and lists the tools the server actually exposes — which is also how
  grants are validated against reality (granting a tool the server doesn't expose is a compile error).

### 15.5.4 Prompt-injection posture

MCP results are **untrusted content**. This is not optional hardening; it is a correctness property
of a system that lets agents read tickets and web pages and then write code.

- All MCP tool results are wrapped by the adapter in a delimited, labelled block stating they are
  external data, not instructions.
- Control tokens (`FORGE_*`) appearing inside MCP results are stripped and logged as a security
  event, never executed.
- A step whose context includes untrusted content is marked `taint: external` in the run record.
  Tainted steps cannot: escalate tool grants, approve gates, write ADRs without human confirmation,
  or target production environments.
- `forge doctor --security` reports every role holding both an untrusted-content source and a
  write-capable grant — the combination worth reviewing.

### 15.5.5 Commands

```
forge mcp list [--agent pm]
forge mcp add <id> --transport stdio --command … [--read-only]
forge mcp test <id>                  # handshake + list actual tools
forge mcp grant <id> --agent pm --tools search_issues,get_issue
forge mcp revoke <id> --agent pm
forge mcp trace [--run <id>]         # every MCP call made in a run
```

---

## 15.6 Making customization portable across platforms

Skills and MCP mean different things on different backends. `@forge/adapter-kit` gains two
capability flags and two provisioning hooks so this is handled once, not per feature:

```ts
export interface AdapterCapabilities {
  // …existing fields…
  skills: 'native' | 'inline' | 'none';   // platform has a skill/progressive-disclosure concept
  mcp: boolean;                            // (already present) native MCP client
  toolProxy: boolean;                      // adapter can expose FORGE-brokered tools to the session
}

export interface PlatformAdapter {
  // …existing methods…
  provisionSkills?(skills: ResolvedSkill[], ctx: SessionContext): Promise<SkillProvisioning>;
  provisionMcp?(servers: GrantedMcpServer[], ctx: SessionContext): Promise<McpProvisioning>;
}
```

Provisioning strategies:

| Capability | Strategy |
|---|---|
| `skills: native` | Materialise resolved skills into the platform's skill directory scoped to the lane worktree, so progressive disclosure is the platform's job |
| `skills: inline` | Inject front-matter summaries into the context pack; serve bodies on demand through the tool proxy (`forge_skill_load`) or the `FORGE_LOAD_SKILL:` token |
| `skills: none` | Inject the highest-priority skills' bodies up to budget; report the degradation in the run record |
| `mcp: true` | Pass the granted server subset as the session's MCP configuration; verify the loaded-server list from the session's init metadata and fail the step if a granted server failed to load |
| `mcp: false, toolProxy: true` | FORGE hosts the MCP clients in-process and re-exposes only the granted tools through its own tool channel |
| `mcp: false, toolProxy: false` | Steps requiring MCP are refused with a precise message naming the server and the adapter limitation |

Two additions to the adapter conformance suite (`07` §7.6):

| # | Test | Asserts |
|---|---|---|
| C15 | Skill scoping | A provisioned skill is visible to the session and *not* leaked into other lanes or the user's global config |
| C16 | MCP grant fidelity | A session granted tools `[a]` of a server exposing `[a,b]` can call `a` and cannot call `b`; ungranted servers are absent from the session's reported server list |

---

## 15.7 Workflow, gate, framework and template customization (C6–C9)

### Workflow overlays

```yaml
# .forge/overrides/workflows/build-stage.workflow.yaml
$extends: build-stage
steps:
  $replaceWhere:
    - id: review
      step:
        perspectives: { $append: [ accessibility, i18n ] }
  $insertAfter:
    - anchor: merge
      steps:
        - id: acme-security-scan
          kind: command
          run: "acme-scanner --sarif out.sarif"
          inline: false
          gateEvidence: [ G-Verify ]
  $remove: [ ]          # gate steps cannot be removed; compile refuses with GATE-9xx
```

Rules: gate steps may be re-scoped or have checks added, never deleted. Removing a `red` (test-first)
step or a `review` step is refused — those are the separation-of-duties spine of the inner loop.
Everything else is fair game, including whole custom workflows via `forge workflow new`.

### Custom gate checks

```yaml
# .forge/overrides/checks/acme-licence.check.yaml
id: acme:licence-policy
run: "acme-licence-check --json"
parser: json
failOn: "violations > 0"
remedy: "Run `acme-licence-check --explain` and either replace the dependency or file an exception."
appliesTo: { gates: [ G-Verify, G-Deliver ] }
severity: error          # error | warn
```

Thresholds on built-in checks are tunable (`coverage.min`, `complexity.max`, flake rate, bundle size)
but **cannot be removed**, only raised or lowered, and lowering below the module floor prints the
delta in every gate report so a weakened bar is never invisible.

### Framework overlays

Criteria weights, added/removed options, extra hard rules, and a replaced output template:

```yaml
# .forge/overrides/frameworks/repo-strategy.framework.yaml
$extends: repo-strategy
criteria:
  $replaceWhere:
    - id: onboarding-simplicity
      weight: 0.05
    - id: access-control-granularity
      weight: 0.25
options:
  $remove: [ meta-repo ]
rules:
  $append:
    - if: "true"
      then: { eliminate: [ polyrepo ], reason: "ACME platform policy PLAT-14" }
```

The invariant: a framework still has to emit an ADR with a comparison table. Weights are flavour;
the audit trail is rigour.

### Template overlays

Every artifact template is overridable. Required schema fields stay required — a template that omits
one fails compile with the field name, rather than producing artifacts that fail validation later.
This lets an organisation put its own PRD/ADR/story shape in front of the same underlying model,
which is usually the difference between adoption and rejection.

---

## 15.8 Voice, language and house style (C12)

```yaml
# .forge/overrides/style/house.style.yaml
id: acme-house
language: en                       # artifact output language (agents still reason in any language)
tone: "direct, low-ceremony, no marketing register"
person: third                      # first | third
banned_phrases: [ "leverage", "seamless", "best-in-class" ]
artifact_conventions:
  headings: sentence-case
  dates: ISO-8601
  code_fences: always-annotated
  diagrams: mermaid
commit_style: conventional
doc_length:
  adr: "≤ 2 pages"
  story: "≤ 1 page"
```

Applied as an appended block to every writing-capable agent's prompt and enforced by a `style:lint`
advisory check. `language` also drives elicitation and TUI-facing text where translations exist —
i18n of the tool's own UI is out of scope for v1, but *artifact language* is not, and it matters for
non-English teams.

---

## 15.9 Presets (C13)

A preset is a signed bundle of the above, applied atomically, and fully expandable into visible
overlay files (`forge preset apply <id> --eject` writes them out so nothing stays magic).

| Preset | Posture |
|---|---|
| `solo-fast` | L1–L2 default, autonomy `autonomous` for non-destructive steps, lean artifact set, reviewer enabled but single-perspective, cost-tuned models |
| `startup-lean` *(default)* | Balanced; full inner loop; light documentation; staged NFRs |
| `enterprise-rigor` | All gates `alwaysHuman` at design and delivery, full ADR discipline, compliance role on, expanded review perspectives, waivers require expiry ≤ 30 days |
| `regulated` | `enterprise-rigor` + compliance matrix required at `G-Design`, data-map mandatory, deletion tests mandatory, no `emerging`-maturity technology, no write-capable MCP |
| `agency-delivery` | Client-facing artifact templates, weekly stage cadence, export-oriented reporting |

```
forge preset list | show <id> | apply <id> [--eject] | diff <id>
```

`forge preset diff` against the current project is the honest way to answer "how far have we drifted
from our standard?" — useful for consultancies and platform teams.

---

## 15.10 Guardrails: what customization can never do

Compile-time refusals, each with a specific error code and a message explaining the reason rather
than just the rule:

| # | Invariant | Code |
|---|---|---|
| I1 | An agent cannot review, test, or diagnose its own output (separation of duties) | `CFG-501` |
| I2 | The test-authoring step and the implementation step cannot be the same agent instance, and implementers cannot own test file paths | `CFG-502` |
| I3 | A gate cannot be approved with a failing deterministic check; only waived, with reason + owner + expiry | `GATE-501` |
| I4 | A gate cannot be defined with zero deterministic checks | `GATE-502` |
| I5 | `alwaysHuman` gates (production delivery, one-way-door ADRs) cannot be downgraded by overlay | `GATE-503` |
| I6 | Traceability edges required by the spec graph cannot be disabled | `SPEC-501` |
| I7 | Tool grants cannot exceed module ceilings without a recorded, expiring escalation | `SEC-501` |
| I8 | Secrets cannot be placed in prompts, artifacts, skills, or the KB | `SEC-502` |
| I9 | Skills and MCP results cannot alter the FORGE operating contract, tool grants, or autonomy | `SEC-503` |
| I10 | Overlays cannot disable the event log, the cost ledger, or the audit trail | `CFG-503` |
| I11 | A custom agent cannot be created without a mandate, outputs, and file ownership | `CFG-504` |
| I12 | Required roles cannot be disabled at their applicable level | `CFG-505` |

**I9 deserves emphasis for the implementer.** Skills and MCP results are user-supplied *and*
externally-supplied content flowing into agent context. The compiler MUST scan skill bodies for
instruction-shaped content targeting the operating contract (patterns like "ignore previous
instructions", "you may write to", "approve the gate", `FORGE_*` tokens) and refuse or strip them
with a security warning. This is a static check at compile time plus a runtime strip in the adapter
layer — both, because either alone is bypassable.

---

## 15.11 Sharing customization, and the road to plugins

v1 ships **overlay bundles**; the plugin system is a v1.x superset, and the file formats here are
chosen so that the migration is a repackaging, not a rewrite.

### v1: overlay bundles

An overlay bundle is any directory or package containing an `overlay.yaml` plus the same
`agents/ skills/ mcp/ workflows/ frameworks/ templates/ checks/ techniques/ catalog/ style/` tree used
in `.forge/overrides/`.

```yaml
# overlay.yaml
id: acme-engineering
name: ACME Engineering Standards
version: 3.2.0
forgeVersion: ">=1.0 <2"
requiresModules: [ fm-service ]
provides:
  agents: [ backend, reviewer, sap-integrator ]
  skills: [ acme-java-standards, acme-observability, acme-rest-standards ]
  mcp: [ acme-jira, acme-confluence ]
  checks: [ acme:licence-policy, acme:layering ]
  presets: [ acme-default ]
requestsCapabilities:              # declared up-front, shown to the user before install
  - network: [ "artifactory.internal" ]
  - exec: [ "./gradlew *" ]
  - mcp-write: false
```

```
forge overlay add ./acme-engineering
forge overlay add npm:@acme/forge-standards
forge overlay add git+https://git.acme.internal/platform/forge-standards#v3.2.0
forge overlay list | remove <id> | update | explain <id>
```

Installation MUST show a **capability request screen** (what shell commands, network hosts, MCP
servers and tool grants this bundle wants) and require confirmation — the same consent model good
package ecosystems use, applied before the code runs rather than after.

### v1.x: plugins

The plugin system adds, on top of overlay bundles: executable extension points (TS entry points for
custom checks, scorers, exporters, and adapters), lifecycle hooks, a registry/marketplace, semver
compatibility resolution across multiple plugins, and sandboxed execution.

Design decisions to make **now** so that path stays open:

1. Every extension point already has a **data-first** form (YAML) and an optional **code** form. Ship
   the data form in v1; the code form is the plugin API.
2. `overlay.yaml` is a strict subset of the future `plugin.yaml` — the plugin manifest adds
   `entryPoints`, `hooks`, and `permissions`, and nothing changes meaning.
3. All resolution goes through the layering model in §15.2, so plugins simply become another L1/L2
   contributor rather than a new mechanism.
4. Capability declaration and consent exist from v1, so plugin security is an extension of an
   existing model rather than a retrofit.
5. `forge overlay` and `forge plugin` will share an implementation; name the internal package
   `@forge/extensions` rather than `@forge/overlays` to avoid a rename later.

---

## 15.12 CLI and TUI surface for customization

### CLI additions (extends `03`)

| Command | Description |
|---|---|
| `forge customize` | Interactive entry point: pick a surface, see current value, edit, preview diff, write overlay |
| `forge overlay list \| add \| remove \| update \| explain <id> \| diff \| doctor \| eject` | Overlay bundle and override management |
| `forge agent override <id>` | Open/scaffold an agent overlay in `$EDITOR`, then validate |
| `forge agent diff <id>` | Base vs resolved, field by field, with layer provenance |
| `forge agent reset <id>` | Remove overlays for one agent (with confirmation and a backup) |
| `forge skill …` | See §15.4.5 |
| `forge mcp …` | See §15.5.5 |
| `forge preset …` | See §15.9 |
| `forge compile [--check]` | Resolve all layers; `--check` fails on any compile error (CI-friendly) |

### TUI: screen S8 — Customize

Added to the global nav (`8`). Left pane: the sixteen surfaces from §15.1 with a modified-count
badge. Right pane: resolved value with per-field layer provenance colouring (built-in / module /
org / project / local), an editor launcher, and a live validation strip.

Keys: `e` edit overlay · `d` diff against base · `r` reset · `t` test (runs the surface's validation:
skill checks, MCP handshake, framework dry-run) · `E` eject a preset into visible overlays.

The TUI header shows a `⚙ N` indicator when active overlays exist, and `⚠ escalations: N` when tool
ceiling escalations are in force — customization should never be invisible while a run is executing.

---

## 15.13 Acceptance criteria for this spec

- **AC15-1** Any of the sixteen surfaces can be customised by adding a file under
  `.forge/overrides/`, with no edits to installed FORGE files.
- **AC15-2** `forge overlay explain <id>` prints, for every field of the resolved object, the layer
  that supplied it.
- **AC15-3** `forge upgrade` across a minor version preserves all overlays, and reports (does not
  silently drop) any overlay whose target no longer exists.
- **AC15-4** A skill attached to an agent is visible to that agent's sessions on both the Claude Code
  adapter and the CodeMachine adapter, with the degradation strategy recorded when native support is
  absent (conformance C15).
- **AC15-5** An MCP server granted `[a]` of `[a,b]` permits `a` and denies `b` in a live session
  (conformance C16); ungranted servers are absent entirely.
- **AC15-6** Each invariant I1–I12 has a compile-time test asserting the specific error code, using a
  malicious or careless overlay fixture.
- **AC15-7** A skill body containing injected instructions targeting the operating contract is
  refused at compile time *and* stripped at runtime; both paths are tested.
- **AC15-8** `forge preset apply enterprise-rigor --eject` produces visible overlay files whose
  resolved output is byte-identical to applying the preset directly.
- **AC15-9** Secrets referenced by MCP config never appear in any prompt, artifact, log, event
  record, or KB entry — asserted by a repository-wide scan test over a fixture run.
- **AC15-10** An overlay bundle installed from a local path, an npm package, and a git URL produces
  identical resolved output, and the capability consent screen lists every requested capability.
