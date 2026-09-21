# 19 — Modules, Templates, Authoring and Distribution

`15` defines *what* users can customise and the guardrails. This file defines the **mechanics**: how
modules and templates are structured, how the template engine works, how authors build and test
extensions, and how anything is packaged and distributed.

## 19.1 Modules

A module is a first-party or third-party bundle contributing agents, workflows, frameworks,
templates, checks, skills, catalog entries and techniques. Modules are the L1 layer of the
customization model (`15` §15.2).

### Shipped modules

| id | Purpose | Adds |
|---|---|---|
| `fm-core` | Always installed; the method itself | Full core roster, the ten lifecycle workflows, all gates, frameworks F-INIT/ARCH/DATA/TECH/TEST/DEBUG/DELIVER/OPS, base templates, base skills |
| `fm-web` | Web applications | `frontend` agent, UX-heavy templates, a11y checks, browser e2e strategy, frontend catalog depth, bundle-size checks |
| `fm-service` | Backend services & APIs | `domain-modeler`, `integration-architect`, contract-testing workflow, API versioning framework, OpenAPI/proto templates |
| `fm-data` | Data platforms & pipelines | `data-engineer`, F-DATA-8, lineage/quality checks, warehouse modelling templates, pipeline diagrams |
| `fm-mobile` | Mobile & cross-platform | `mobile` agent, store-release workflow, device-matrix test strategy, offline-first patterns |

Module selection is proposed at `init` from the idea text and confirmed by the user. Modules are
additive; conflicts between two modules at L1 resolve by install order and are reported at compile.

### Module layout

```
modules/fm-service/
├─ module.yaml
├─ agents/*.agent.yaml
├─ workflows/*.workflow.yaml
├─ frameworks/*.framework.yaml
├─ gates/*.gate.yaml
├─ checks/*.check.yaml
├─ skills/<id>/SKILL.md
├─ templates/**/*.hbs
├─ techniques/*.technique.yaml
├─ catalog/*.entry.yaml
├─ prompts/*.md
├─ schemas/*.schema.json          # new artifact types, if any
├─ migrations/*.ts                # if it changes artifact shapes
└─ tests/                         # module conformance tests
```

```yaml
# module.yaml
id: fm-service
name: Backend services and APIs
version: 1.3.0
forgeVersion: ">=1.0 <2"
requires: [ fm-core ]
conflicts: []
levels: [ L1, L2, L3, L4 ]
ceilings:                          # maximum tool grants any agent in this module may hold
  backend:   { write: true,  exec: [ "pnpm *", "git *", "docker *" ], network: allowlist, deploy: false }
  reviewer:  { write: false, exec: [ "git *", "rg*" ],                network: none,      deploy: false }
provides:
  agents: [ domain-modeler, integration-architect ]
  workflows: [ contract-test-cycle ]
  frameworks: [ integration-design, api-versioning ]
  checks: [ contract:verify, api:breaking-change ]
  artifactTypes: []
```

**Ceilings are declared by the module, not by the project** — this is what makes `15`'s tool-grant
guardrail enforceable: a project overlay can narrow within the ceiling or widen up to it, but
exceeding it requires a recorded, expiring escalation.

## 19.2 The template engine

Handlebars in strict mode, no `eval`, no arbitrary code, deterministic output.

### Context available to templates

```ts
interface TemplateContext {
  project: ProjectConfig;
  artifact: { id: string; type: string; created: string; author: string };
  kb: KbAccessor;          // kb.get(id), kb.section(name) — read-only, resolved at render
  spec: SpecAccessor;      // spec.get(id), spec.children(id)
  inputs: Record<string, unknown>;   // step/framework inputs
  style: StyleProfile;               // house style (15 §15.8)
  now: string;
  forge: { version: string };
}
```

### Helper set (fixed; adding helpers is a module capability, not a project one)

| Helper | Purpose |
|---|---|
| `{{id "STORY"}}` | Allocate the next id of a type |
| `{{slug text}}` | URL/file-safe slug |
| `{{date fmt}}` | ISO or formatted date |
| `{{link id}}` | Render a cross-reference in the project's link style |
| `{{table rows cols}}` | Markdown table from data |
| `{{mermaid kind data}}` | Render a diagram from structured data via a generator |
| `{{#each}} {{#if}} {{#unless}} {{#with}}` | Standard block helpers |
| `{{indent n text}}`, `{{wrap n text}}` | Layout control for nested content |
| `{{required value "message"}}` | Fail the render if a required value is missing |
| `{{cite id}}` | Emit a KB citation with the id |

`{{required}}` matters: a template that silently renders an empty required section produces an
artifact that fails validation later with a confusing error. Failing at render time, naming the
missing input, is far better.

### Template rules

1. Templates produce **valid artifacts**: front matter matching the type's schema and every
   `requiredSections` present. `forge template validate` renders each template against a fixture
   context and validates the output — a template that cannot produce a valid artifact is broken at
   authoring time, not at run time.
2. Templates are **layout and prompting**, never logic. Conditional inclusion is fine; computation
   belongs in a framework or a TS helper.
3. Overrides may reorder, rename and re-word sections and add fields, but may not remove a required
   schema field (`15` §15.7).
4. Output is deterministic given the same context — no randomness, no timestamps other than `now`
   supplied by the caller (so golden-file tests work).

### Prompt templates

The same engine renders agent briefs and system prompts. Prompt templates additionally have access to
the resolved context pack manifest so a brief can reference specific ids. Compiled prompts are always
written to the step record for audit (`05` §5.3).

## 19.3 Authoring workflow

The path from "we do X differently" to a tested, shareable extension:

```
forge <thing> new  →  edit  →  forge <thing> validate  →  forge <thing> test  →  forge compile --check
                                                                                        │
                                                              forge overlay eject / package
```

| Artifact | `new` | `validate` | `test` |
|---|---|---|---|
| Agent | scaffolds from a base or an existing agent | schema, ownership overlaps, ceiling compliance, referenced skills/MCP/frameworks exist, separation-of-duties invariants | dry-run a step against a fixture project with the fake adapter |
| Skill | scaffolds `SKILL.md` + dirs | schema, size caps, dead references, script grants, secret scan, injection scan | runs `provides_checks` against the current repo |
| Workflow | scaffolds with a gate | ids unique, no cycles, references resolve, fanout resolves, gate steps present | compile the DAG and dry-run with the fake adapter |
| Framework | scaffolds rubric | criteria weights sum to 1.0, options non-empty, rules parse, output template renders | run against a fixture KB, assert an ADR with a score table is produced |
| Check | scaffolds command+parser | command exists, parser handles sample output, `failOn` expression parses | run against pass and fail fixtures |
| Template | copies the base | renders against a fixture context; output validates | golden-file comparison |
| Gate | scaffolds | ≥1 deterministic check; `alwaysHuman` flags respected | evaluate against pass/fail fixtures |

**`forge compile --check` is the CI command** for anyone maintaining customization: it resolves every
layer and fails on any compile error, stale overlay target, ceiling violation or invariant breach.
An organisation's standards repo should run this against a fixture project on every PR.

## 19.4 The fake adapter (authoring and testing dependency)

`@forge/testkit` ships a `FakePlatformAdapter` implementing the full `PlatformAdapter` interface with
scripted responses. It is what makes authoring and testing possible without spending money or
depending on a model's mood:

```ts
const adapter = new FakePlatformAdapter({
  capabilities: { streaming: true, sessionResume: true, mcp: true, skills: 'native', /* … */ },
  script: [
    { match: { agent: 'architect', step: 'freeze-contracts' },
      emit: [ { type: 'text', text: '…' },
              { type: 'file.changed', path: 'docs/forge/specs/interfaces/invoice.yaml', change: 'created' } ],
      writeFiles: { 'docs/forge/specs/interfaces/invoice.yaml': fixtures.invoiceContract },
      usage: { inputTokens: 1200, outputTokens: 400, costUsd: 0.02 } },
    { match: { agent: 'backend' }, behaviour: 'fail-then-succeed', failures: 1 },
  ],
});
```

It supports capability degradation simulation (turn off `mcp`, `skills`, `sessionResume` and assert
the documented fallbacks), failure injection (rate limits, timeouts, malformed output, out-of-claim
writes, injection attempts), and deterministic replay from recorded real runs.

The fake adapter is strict by default: a session whose prompt is empty, a bare path, or lacks the nine
blocks of `05` §5.3 (with the verbatim operating contract in block [1]) is refused
(`STRICT_PROMPT_VIOLATION`), so a test cannot pass on a prompt no real agent could follow. Tests that
hand-build requests pass `{ strict: false }`.

## 19.5 Packaging and distribution

### Overlay bundles

Format defined in `15` §15.11. Distribution channels, all producing identical resolved output
(`15` AC15-10):

| Channel | Command | Notes |
|---|---|---|
| Local path | `forge overlay add ./acme-standards` | Development and monorepo-internal sharing |
| npm | `forge overlay add npm:@acme/forge-standards` | Versioned, private registries supported |
| git | `forge overlay add git+https://…#v3.2.0` | Pinned to a tag or SHA; floating refs warned about |

### Installation flow

1. Fetch and verify integrity (checksum; signature where the channel supports it).
2. Parse `overlay.yaml` / `module.yaml`; check `forgeVersion` and `requires`.
3. **Capability consent screen** — every requested shell pattern, network host, MCP server and tool
   grant, shown before anything is installed. Nothing is installed on refusal.
4. Static safety scan: skill and template bodies scanned for injection-shaped content and
   grant-widening attempts (`15` §15.10 I9, `20` §20.6).
5. Install into `.forge/` layers, record in `manifest.yaml` with version and checksums.
6. `forge compile` and report what changed in the resolved set, as a diff.

### Versioning and compatibility

- Modules and bundles follow semver against the **contract they consume** (agent schema, workflow
  DSL, check format, adapter interface).
- `forgeVersion` ranges are enforced; incompatible extensions are reported, never silently loaded.
- FORGE declares a **stability tier** per extension contract so authors know what can break:

| Contract | Tier | Breaking-change policy |
|---|---|---|
| Agent definition schema | stable | Major only, with a migration |
| Workflow DSL | stable | Major only, with a migration |
| Skill format | stable | Major only |
| Check format | stable | Major only |
| Framework schema | evolving | Minor may add; removals major |
| `PlatformAdapter` | evolving | Minor may add optional methods; conformance suite is the contract |
| Internal `@forge/*` APIs | unstable | Any release; not for external consumption |

- Deprecations warn for one minor version before removal, naming the replacement.

### Registry (post-v1)

Not shipped in v1. The design constraint carried forward: a registry adds *discovery*, not new
capability. Installation, consent, compile and guardrails already work for any channel, so the
registry is a resolver in front of the existing flow, not a new mechanism. Reviewing published
bundles for capability requests before listing is the security model, since installation itself
already requires consent.

## 19.6 Documentation obligations for extensions

An extension is only useful if the next person understands it. `forge overlay validate` requires:

- `overlay.yaml`/`module.yaml` with a description per provided item.
- A `README.md` stating what it changes, why, and what it assumes about the project.
- For each custom agent: what decisions it owns and how it differs from the base.
- For each skill: `when_to_use` that is specific enough to trigger correctly (`15` §15.4.3) — a vague
  `when_to_use` produces a skill that either never loads or always loads.
- For each check: a `remedy` string. A failing check without a remedy is a dead end for the agent that
  hits it, and dead ends are where autonomous loops stall.
