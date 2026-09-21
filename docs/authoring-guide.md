# Authoring guide: agents, skills, workflows, overlays, modules

FORGE draws a hard line: **the user owns flavour, FORGE owns rigour.** Flavour — who the agents are,
how they speak, what they know, what tools they can reach, which stack conventions they follow, how
much ceremony a project gets — is customisable, discoverable, and survives upgrades. Rigour —
traceability, gate determinism, separation of duties, file-ownership safety, the requirement that
decisions are recorded — is fixed, or requires an explicit, recorded, expiring waiver. This guide is
about the flavour column. For the full, normative definition of both columns, see
`specs/15-customization-and-user-freedom.md`; for packaging/distribution mechanics, see
`specs/19-authoring-modules-and-distribution.md`.

Every customization surface below is a **file in the project**, diffable and reviewable — there is
no hidden customization state.

## The layering model

Five layers, resolved deepest-wins, at **compile time** (not read time):

```
L0  built-in defaults            (shipped in @forge/templates)
L1  installed modules            (fm-core, fm-web, fm-service, … in install order)
L2  organisation overlay         (optional: a shared repo/package)
L3  project overrides            <project>/.forge/overrides/**         (committed)
L4  personal overrides           <project>/.forge/overrides.local/**   (git-ignored)
```

`forge compile` (implicit in `init`, `upgrade`, `module add`, and the start of every run) resolves
all five layers into `.forge/{agents,workflows,frameworks,templates,checks,skills}/` — the _resolved
set_. That resolved set is generated and disposable; every hand edit belongs in `overrides/`, never
in the resolved directories directly. `forge overlay explain <id>` is the intended way to see, per
field, which layer supplied the final value — **this is one of the still-unwired commands** (see the
CLI status note below); today the equivalent visibility is: read the resolved file under `.forge/`
and the override file under `.forge/overrides/` side by side.

Overlays are applied as JSON-Merge-Patch plus explicit array operators — scalars and objects merge;
arrays require an operator (`$set`, `$append`, `$prepend`, `$remove`, `$replaceWhere`, `$clear`)
because silent array replacement is a common source of config confusion. An unknown operator is a
compile error, never silently ignored (`specs/15` §15.2).

## Agents

An agent overlay modifies persona, mandate wording, briefs, prompts, model tier, limits, skills, MCP
grants, and tool grants _within the module's declared ceiling_:

```yaml
# .forge/overrides/agents/backend.agent.yaml
$extends: backend
$description: 'Our Java house style, tighter budget, internal tooling access'

model:
  tier: balanced

persona:
  voice: 'terse, cites the standard it is applying'

tools:
  exec:
    $append: ['./gradlew *', 'internal-cli *']
  allowlistHosts:
    $set: ['artifactory.internal', 'registry.npmjs.org']

skills:
  $append: [acme-java-standards, acme-observability]
  $remove: [generic-node-conventions]

briefs:
  implement-story: overrides/prompts/backend.implement-story.md
  $append_guidance: overrides/prompts/backend.house-rules.md
```

Apart from `$append_guidance`, a `briefs.<key>` entry attaches to a step only when `<key>` is the
basename, without `.md`, of that step's own `brief:` (`implement-story` for
`brief: briefs/implement-story.md`), and only for the agent that step runs; an interaction-mode
participant session (`swarm-review`, `panel`, `debate`, `pair`) attaches the entry named after its
mode. A key that matches neither is never read, so name it after a brief the agent's steps actually
use.

What can never change: `gates.may_approve` (separation of duties isn't user-editable), and
`tier`/`id` (create a new agent instead of mutating an identity). Tool grants are ceiling-bound — a
module declares a ceiling per agent (`module.yaml`'s `ceilings:` block); an overlay can narrow
within it or widen up to it, but exceeding it needs a project-level, explicitly acknowledged
escalation recorded in `.forge/config.yaml`'s `security.toolCeilingEscalations`, which then shows up
in `forge doctor`, every gate report, and the TUI header while active (`specs/15` §15.3.1–15.3.2).

**Roster composition** — enabling/disabling roles, aliasing, splitting one role into several
file-ownership-scoped specialists — is a `.forge/config.yaml` `roster:` block, not an agent overlay.
`orchestrator`, `pm` (L2+), `architect` (L2+), `test-architect` (L1+), `reviewer` and
`diagnostician` are required roles; disabling `reviewer` or `test-architect` is refused outright
(`specs/15` §15.3.3).

## Skills

A **skill** is a named, reusable packet of _how to do a specific kind of thing well_, attached to
one or more agents and loaded progressively (metadata always, body on demand). It answers "how do we
do X, anywhere" — project-specific _truth_ belongs in the Knowledge Body instead, and a specific
_decision_ belongs in a framework, not a skill (`specs/15` §15.4.1).

```
skills/acme-java-standards/
├─ SKILL.md            required: front matter + body
├─ references/         optional: deep-dive docs loaded only when the body points to them
├─ examples/            optional: canonical good/bad examples
├─ scripts/             optional: executable helpers the agent may run
└─ assets/              optional: templates, config snippets to copy
```

```markdown
---
id: acme-java-standards
name: ACME Java service standards
version: 2.1.0
description: >
  How ACME writes Spring Boot services: package layout, error model, logging fields, transaction
  boundaries, and the layering rules enforced by ArchUnit.
when_to_use: >
  Any task that creates or modifies Java source in a service module.
applies_to:
  agents: [backend, reviewer, sdet]
  languages: [java, kotlin]
  paths: ['services/**/src/main/java/**']
activation: auto # auto | explicit | always
budget_tokens: 3000
requires_tools: [read]
forge_version: '>=1.0 <2'
---

## Package layout

…

## Do not

- Do not catch `Exception` at a controller boundary; use the `@ProblemDetail` mapper.
```

`when_to_use` matters more than it looks: it's what decides whether the skill triggers correctly. A
vague one produces a skill that either never loads or always loads.

**Working with skills in this CLI today:**

```bash
forge skill list                 # every skill in the resolved set
forge skill validate <id>        # schema, size caps, dead references, script grants, secret scan
```

`skill new`, `skill attach`/`detach`, `skill test` and `skill import` are named in `specs/03` §3.2.8
and have no CLI wiring yet (`packages/cli/src/bin.ts`'s own doc comment discloses this) — write and
edit `SKILL.md` files by hand under `skills/` or `.forge/overrides/skills/` and validate with
`forge skill validate <id>` in the meantime.

## Workflows, gates and frameworks

Workflow overlays insert/replace/reorder steps or add whole custom workflows:

```yaml
# .forge/overrides/workflows/build-stage.workflow.yaml
$extends: build-stage
steps:
  $replaceWhere:
    - id: review
      step:
        perspectives: { $append: [accessibility, i18n] }
  $insertAfter:
    - anchor: merge
      steps:
        - id: acme-security-scan
          kind: command
          run: 'acme-scanner --sarif out.sarif'
          gateEvidence: [G-Verify]
```

Gate steps can be re-scoped or have checks added, but never deleted — removing a test-first (`red`)
step or a `review` step is refused, since those are the separation-of-duties spine of the inner
loop.

Custom gate checks are their own files:

```yaml
# .forge/overrides/checks/acme-licence.check.yaml
id: acme:licence-policy
run: 'acme-licence-check --json'
parser: json
failOn: 'violations > 0'
remedy: 'Run `acme-licence-check --explain` and either replace the dependency or file an exception.'
appliesTo: { gates: [G-Verify, G-Deliver] }
severity: error
```

A check must positively show success (`specs/10` §10.3, "Check contract"). It exits `0` or `1` and
prints one JSON object; that object must not say it failed (`ok` other than `true`,
`success: false`, a top-level `error`), and every field `failOn` reads must be present with the
right type (a number, or a string, for `>`). If the command cannot do its job (a missing directory,
a failing `git diff`), have it print a failing count and a `reason` — for example
`{"violations":0,"errors":1,"reason":"no dist/ directory found"}` with
`failOn: 'violations > 0 || errors > 0'` — rather than printing `0` for nothing scanned: a check
that finds nothing to check has not passed. An exit code of `1` beside a clean body only counts when
the body is a `forge` envelope (`{"v":1,...}`). The gate report records each check's stdout, exit
code and stderr (sanitised and capped), and `forge gate check <id>` prints the `reason` of every
failing check. A gate file with an unknown key (a misspelled `checks:`) or no deterministic check is
refused when it is loaded, and `forge workflow validate --all` lists the problem.

A failing check without a `remedy` is a dead end for whichever agent hits it — always write one
(`specs/19` §19.6). Built-in check thresholds (coverage minimum, complexity maximum, flake rate,
bundle size) are tunable but never removable; lowering one below the module's floor prints the delta
in every gate report so a weakened bar is never invisible.

Framework overlays (criteria weights, added/removed options, extra hard rules, a replaced output
template) still have to emit an ADR with a comparison table — weights are flavour, the audit trail
is rigour (`specs/15` §15.7).

`forge workflow validate --all` and `forge agent validate --all` are real and wired — run them after
any overlay edit:

```bash
forge agent validate --all
forge workflow validate --all
```

Both are clean on a fresh project, so any finding after your edit is yours. When you hand-author an
agent or workflow, create the files it names: a `prompt.system: prompts/<id>.system.md` needs
`.forge/prompts/<id>.system.md`, and a step's `brief: briefs/<name>.md` needs
`.forge/briefs/<name>.md`, each with real (non-empty) text.

`forge workflow new`, `forge workflow list/show/compile/graph`, and the rest of `forge agent` beyond
`validate --all` are named in `specs/03` §3.2.7/§3.2.8 and have no CLI wiring yet — author these
files by hand under `.forge/overrides/` and validate with the `--all` commands above.

## Templates and house style

Every artifact template is overridable via `.forge/overrides/templates/`; required schema fields
stay required — an overlay that omits one fails compile with the field name, rather than producing
an artifact that fails validation later. Voice and language (tone, banned phrases, heading/date
conventions, doc-length targets) live in `.forge/overrides/style/*.style.yaml` and apply as an
appended block to every writing-capable agent's prompt (`specs/15` §15.7–§15.8).

## Presets

A preset is a signed bundle of the above, applied atomically:

```bash
forge preset list                    # solo-fast, startup-lean (default), enterprise-rigor, regulated, agency-delivery
forge preset show <id>               # the resolved bundle contents as JSON
forge preset apply <id>              # apply it to the current project
forge preset apply <id> --eject      # write it out as visible overlay files instead of applying magically
```

`forge preset diff` (compare the current project against a preset) is named in `specs/03` §3.2.8 but
has no real mechanism anywhere in this codebase yet — a genuinely disclosed gap, not an oversight.

## The authoring workflow, and its real CLI status today

The intended path, per `specs/19` §19.3:

```
forge <thing> new  →  edit  →  forge <thing> validate  →  forge <thing> test  →  forge compile --check
```

As currently wired, only parts of this loop are reachable from the CLI:

- **Agents/workflows/templates**: no `new` scaffolding command yet. Copy an existing built-in file
  under `.forge/overrides/` and edit it by hand, then validate with `forge agent validate --all` /
  `forge workflow validate --all`. `forge template validate --all` validates every shipped template.
- **Skills**: `forge skill validate <id>` is real and wired (see above); `new`/`test` are not.
- **`forge compile`**: the function is real and tested, but it takes `--sources <path>` pointing at
  a JSON file holding this project's own `CompileSources` — there is no automatic "gather my
  project's own content" resolver yet, so `forge compile --check` as a zero-argument CI command (as
  `specs/19` §19.3 describes it) does not work as-is. Treat `forge agent validate --all` +
  `forge workflow validate --all` + `forge template validate --all` as the practical CI gate for
  customization changes today — but the first two currently exit 1 on a fresh project until the
  brief/prompt content lands (`SPEC-QUESTIONS.md` Q197), so gate on "no _new_ findings" for now.

## Modules

A module is a first-party or third-party bundle contributing agents, workflows, frameworks,
templates, checks, skills and catalog entries — the L1 layer of the customization model. `fm-core`
(always installed — the method itself), `fm-web`, `fm-service`, `fm-data` and `fm-mobile` are the
shipped modules (`specs/19` §19.1). Layout:

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
└─ tests/                  # module conformance tests
```

`module.yaml` declares `id`, `version`, `forgeVersion` compatibility range, `requires`, `conflicts`,
supported `levels`, and per-agent tool `ceilings` (ceilings are declared by the module, never by the
project — that's what makes the tool-grant guardrail enforceable).

## Sharing customization: overlay and module distribution

```bash
forge overlay add ./acme-standards            # local path — development / monorepo-internal sharing
forge overlay add npm:@acme/forge-standards   # versioned, private registries supported
forge overlay add git+https://…#v3.2.0        # pinned to a tag or SHA
forge module add <id> ./local-module-dir      # same three source forms
forge module remove <id>
forge module update <id> <source>
```

All three source forms are real and wired today.
`forge overlay list/remove/update/explain/diff/ doctor/eject` are named in `specs/03` §3.2.8 but
have no CLI wiring beyond `add` yet — an installed overlay's manifest entry (`.forge/manifest.yaml`)
is the way to confirm what's installed in the meantime.

Installation runs a **capability consent screen** — every requested shell pattern, network host, MCP
server and tool grant is shown before anything installs, and nothing installs on refusal — plus a
static safety scan of skill/template bodies for injection-shaped content or grant-widening attempts
(`specs/19` §19.5). Distribution channels all produce identical resolved output regardless of
channel.

## Documentation obligations, if you're sharing an extension

An extension is only useful if the next person understands it (`specs/19` §19.6):

- `overlay.yaml`/`module.yaml` needs a description per provided item.
- A `README.md` stating what it changes, why, and what it assumes about the project.
- For each custom agent: what decisions it owns and how it differs from the base.
- For each skill: a `when_to_use` specific enough to trigger correctly.
- For each check: a `remedy` string.

## What's authoring-relevant but genuinely not wired into the CLI yet

For completeness, gathered in one place (each is a real, disclosed gap — `packages/cli/src/bin.ts`'s
own top-of-file doc comment is the authoritative, current source of truth):

- `forge agent new`, `forge agent list/show/compile/graph`
- `forge workflow new`, `forge workflow list/show/compile/graph`
- `forge skill new/attach/detach/test/import`
- `forge overlay list/remove/update/explain/diff/doctor/eject`
- `forge module list/info`
- `forge preset diff`
- `forge config list/explain`
- `forge customize` (the whole command)

None of these are "coming eventually and unspecified" — each has a fully normative spec in
`specs/15`/ `specs/19` and real, tested library code behind at least some of them; what's missing is
CLI argv wiring, tracked milestone by milestone in `GAUNTLET-LOG.md`/`SPEC-QUESTIONS.md`.
