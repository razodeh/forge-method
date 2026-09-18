# PLAN-M10 — Modules, sessions and brownfield

Source: `specs/22` M10. **Build:** `fm-web`/`fm-service`/`fm-data`/`fm-mobile` framework modules;
`@forge/sessions` with all ten session types (`16` §16.2), the technique library (`16` §16.4), the
five-phase anatomy `FRAME → DIVERGE → CONVERGE → DECIDE → RECORD` (`16` §16.3), anti-groupthink measures
(`16` §16.7) and mandatory write-back (`16` §16.5); `forge adopt` with all eight phases `SURVEY →
INVENTORY → CARTOGRAPHY → INFERENCE → VERIFICATION → RECONSTRUCTION → GAP ANALYSIS → BASELINE` (`17`
§17.2) including real build/test verification and the gap report. **Depends on M8** (`22` §22.2's own
sequencing diagram: `M8 ──┬── M10 ── M11 ── M12`); **does not depend on M9** — the TUI is on a parallel
branch reconverging only at M12, so nothing here assumes `@forge/tui` exists.

## Real, already-built surface this milestone reuses (confirmed by direct inspection, three parallel
research passes before this plan was drafted)

- **The full `pair`/`panel`/`debate`/`swarm-review` agent-dispatch mechanism already exists**, split
  exactly the way `Q104` (M6 A6) already resolved once for the identical layering question:
  `packages/agents/src/interaction/` has the pure `InteractionMode` type and `checkSeparationOfDuties`;
  `packages/engine/src/interaction/dispatch-agent-step.ts` (`dispatchAgentStep`, 451 lines) does the real
  work — independently-answer-then-reconcile for `panel`, proposer-vs-`critic`-then-decider for `debate`,
  de-duplicated multi-perspective `ReviewReport` for `swarm-review` — against `ctx.adapter` directly, not
  through a lane. This is the real mechanism `16` §16.3's FRAME/DIVERGE/CONVERGE phases and §16.7's
  anti-groupthink measures need; **P9/P10 below reuse it, they do not reinvent it.**
- **`kind: 'session'` is already a fully-typed workflow step**, plumbed through
  `packages/engine/src/workflow/schema.ts` (`z.literal('session')`, `sessionType`),
  `workflow/types.ts`, `plan/types.ts`, `plan/compile.ts` — compiled, validated, schedulable today.
  **The one real gap**: `packages/engine/src/dispatch/execute.ts`'s own `case 'session':` deliberately
  throws `RUN-039` ("not implemented"), grouped with `elicit`/`subworkflow`. This is M10's real
  integration point for `16` §16.6's "sessions can also be workflow steps" line — not new schema design.
- **`packages/schemas/src/artifacts/session-record.ts` already fully implements `sessionRecordSchema`**,
  covering all ten real `SESSION_TYPES` from `16` §16.2 (including `discovery-interview` and
  `story-refinement`) and `16` §16.5's own record shape verbatim (`sessionType`, `technique[]`,
  `question`, `constraints_applied[]`, `participants[]`, `started`/`ended`, `cost_usd`). No new session
  schema is built by this milestone; every piece below writes to this existing shape.
- **`packages/kb/src/write/{writer.ts,id-allocator.ts,event-log.ts}`** is a real, already-tested
  programmatic KB-writing mechanism (`KbWriter`, `KbEntryInput`, `KbProposal`) — `16` §16.5's mandatory
  write-back and `17`'s RECONSTRUCTION phase both write through this, not a new writer.
  `packages/kb/src/schema/kb-entry.ts`'s own `KB_ENTRY_CONFIDENCE = ['low','medium','high','verified']`,
  with a schema-enforced rule that `confidence: 'verified'` requires a real `## Verification` section, is
  the exact four-tier confidence model `17` §17.1/§17.2 needs — already built, already enforced.
- **`packages/diagrams/src/generate/generators.ts`'s `componentsToC4`/`schemaIntrospectToEr`/**
  **`depsToGraph`** are real, working generators (not stubs) — exactly the three `08` §8.11.6 names for
  `17` phase 6 RECONSTRUCTION's brownfield diagrams. Adoption's own job is producing their structured
  input (components, tables + foreign keys, module graph), never building new generators.
- **Module *loading* is already fully generic, not hardcoded to `fm-core`.**
  `packages/cli/src/init/manifest.ts` filters "the real, currently-existing module directories among
  `requested`" via a plain `pathExists` check; `packages/agents/src/registry/load-agent-registry.ts`
  reads `modules/<module>/agents/<id>.agent.yaml` for *any* module id. `modules/*` is a real pnpm
  workspace glob (`pnpm-workspace.yaml`). **What does not exist anywhere**: a real `module.yaml` parser,
  or any enforcement of a module's own `requires`/`conflicts`/`ceilings` (confirmed via a repo-wide grep
  for those keys — zero hits outside the spec text itself) — this is genuinely new, P1/P2 below.
- **`packages/cli/src/commands/module.ts`**: `moduleList`/`moduleInfo` are real (read the manifest);
  `moduleAdd`/`moduleRemove`/`moduleUpdate` are literal `never`-returning stubs. `packages/cli/src/
  commands/adopt.ts` and `packages/cli/src/commands/loop/session.ts` are both deliberate refusal stubs
  (`ForgeError('USR-003', ...)`), each with its own doc comment naming this milestone as where the real
  implementation belongs — not oversights, planned deferrals already in the code.
  **One real, pre-existing bug found and left for P13 to fix, not silently worked around**:
  `session.ts`'s own `SessionType` union lists only 8 of the 10 real types from
  `sessionRecordSchema`'s `SESSION_TYPES` — missing `discovery-interview` and `story-refinement`.
- **`modules/fm-core/` currently has only `agents/*.agent.yaml` (29 files)** — no `module.yaml`,
  `workflows/`, `frameworks/`, `gates/`, `checks/`, `skills/`, `templates/`, `techniques/`, `catalog/`,
  `prompts/`, `schemas/`, `migrations/`, or `tests/` exist yet, even for the "always installed" base
  module `19` §19.1 describes as shipping "the ten lifecycle workflows, all gates, frameworks F-INIT/
  ARCH/DATA/TECH/TEST/DEBUG/DELIVER/OPS, base templates, base skills." **This predates M10 and M10's own
  Build line does not name `fm-core`** — but M10's own Acceptance criterion ("Each module validates and
  composes with `fm-core` without conflict") is untestable without `fm-core` having a real `module.yaml`
  to compose against, and P1/P2 below need *some* real module.yaml to build the parser against. Resolved
  as: **P1 completes `fm-core`'s own `module.yaml` plus wiring its already-real workflows/gates/frameworks
  (`@forge/methods`, `@forge/catalog`, already-built elsewhere in this repo) into the module manifest
  shape** — real, necessary infrastructure work this milestone's own Acceptance criterion requires, not
  scope creep, and disclosed here rather than silently absorbed.
- **`packages/catalog/src`** (`registry/{load,validate,registry}`, `select/{select,filter,coherence,
  hard-rules,criteria}`) is a real, already-built, module-agnostic catalog engine — exactly what `19`
  §19.1's `catalog/*.entry.yaml` module contribution type plugs into. No new catalog mechanism needed.
- **No target-repository git-history analysis, dependency-graph tooling, or sandboxed build/test**
  **execution exists anywhere** — confirmed real gaps for `17` phase 1 SURVEY's "Git profile" row, phase
  2 INVENTORY's module graph, and phase 5 VERIFICATION's "run it, record the result." These are the
  genuinely new pieces of `forge adopt`, not places to look for reusable code first.
- **`specs/12` §12's own F-DATA-8 is the only framework-to-module tag found in specs 11-14** — fm-web/
  fm-service/fm-mobile get no named framework IDs at all; their `19` §19.1 "Adds" column names only
  agents, checks, and templates. Confirms fm-web/service/mobile pieces below build content the spec
  itself never named a framework file for, not a missed cross-reference.

## Real Surface deviations this plan commits to before building (recorded here, not discovered mid-piece)

- **`@forge/sessions`'s row in `specs/02` §2.2's dependency graph stays `['core', 'kb', 'agents',
  'schemas']` — unchanged.** The real agent-dispatch mechanism a session's DIVERGE/CONVERGE phases need
  lives in `@forge/engine/interaction`, which `sessions` has no legal edge to reach (the identical
  structural fact `Q104` already established for `@forge/agents`). Resolved the same way Q104 resolved
  it: **`@forge/sessions` holds pure facilitation logic only** (the FRAME/DIVERGE/CONVERGE/DECIDE/RECORD
  phase state machine, technique application, session-record assembly, KB write-back via the legal
  `sessions → kb` edge) **and takes agent-turn results as caller-supplied data, never calling `ctx.adapter`
  itself.** `@forge/engine` gets a new edge added to its own row (`engine: [..., 'sessions']` — the same
  direction as its existing `engine → agents` edge, not the reverse) so that `execute.ts`'s `case
  'session':` handler can drive `dispatchAgentStep` for the real agent turns and hand the phase machine
  in `@forge/sessions` the results to decide what happens next. `packages/cli`'s own `session` command
  (already depending on everything) glues the two together for the *interactive*, non-workflow case
  (`forge session brainstorm --question "…"`), calling both packages directly the same way `execute.ts`
  does inside a compiled run.
- **The technique library is genuinely new data, not a resurrected spec-only concept.** No
  `techniques/*.technique.yaml` file or technique schema exists anywhere in this repo today (confirmed:
  `modules/fm-core` has zero, `packages/schemas` has zero). P9 below builds both the schema and the 20
  real techniques `16` §16.4 tables name, as first-party content living in `modules/fm-core/techniques/`
  (matching `19` §19.1's own module layout: techniques are a module contribution type, and the technique
  library is core-method content available regardless of which `fm-*` modules are installed).

---

## P1 — `fm-core`'s own `module.yaml` and the rest of its real module layout

**Mandate:** `19` §19.1's own module layout, for the one module every project always installs, which
today has only its agent roster. Necessary infrastructure for P2's parser to validate against and for
M10's own "composes with `fm-core` without conflict" acceptance criterion to be checkable at all.

**Spec:** `19` §19.1.

**Surface:** `modules/fm-core/`
- `module.yaml`: `id: fm-core`, `requires: []`, `conflicts: []`, `levels: [L1,L2,L3,L4]`, `provides`
  naming the real 29 agents already on disk, plus real workflow/gate/framework ids already built
  elsewhere in this repo (`@forge/methods`'s own ten lifecycle workflows, `@forge/methods`'s own gates,
  the eight F-* framework families) — a manifest *pointing at* already-real content, not new content.
- `workflows/`, `gates/`, `frameworks/`: thin `*.workflow.yaml`/`*.gate.yaml`/`*.framework.yaml` files
  that are the on-disk, module-layout-conformant form of workflows/gates/frameworks this repo's own
  `@forge/methods` package already defines in code — confirmed directly against `packages/methods/src`
  before deciding whether these need to be genuinely new content or a re-expression of existing content
  in the file layout `19` §19.1 and P2's parser expect.
- `skills/`, `templates/`: base skills/templates only if a real, already-specified need exists elsewhere
  in an already-built spec section (`08`/`09`/`10`) with no current home — confirmed against those specs
  before inventing content, not assumed necessary.

**Checks:**
- `module.yaml` parses under P2's own schema once P2 exists (this piece may need to land its final form
  after confirming P2's schema shape — sequencing note, not a hard dependency reversal, since P1's own
  content is real regardless of the parser's exact schema).
- Every id `module.yaml`'s `provides` names resolves to a real file already on disk.
- `forge module info fm-core` (once P7 exists) reports the real, complete provides list.

**Depends on:** nothing new; reads already-built `@forge/methods`/`@forge/catalog` content.

---

## P2 — L1 module compilation: `module.yaml` schema, parser, `requires`/`conflicts`/`ceilings` enforcement

**Mandate:** the real, currently-nonexistent mechanism `19` §19.1 describes and every later module piece
(P3-P6) and M10's own acceptance criteria need: parsing a module's own manifest and enforcing its
declared constraints at compile time.

**Spec:** `19` §19.1.

**Surface:** `packages/extensions/src/module/` (new — `packages/extensions` already owns L2/L3 overlay
compilation per the research pass; L1 module compilation is the missing layer beneath it, in the same
package, not a new one, since `specs/02` §2.2's own `extensions` row already covers "customization
compilation" broadly)
- `moduleSchema` (zod): `id`, `name`, `version` (semver), `forgeVersion` (range), `requires: string[]`,
  `conflicts: string[]`, `levels`, `ceilings: Record<role, ToolGrant>`, `provides`.
- `parseModule(path)`, `resolveInstalledModules(manifest)`: reads every module named in the project
  manifest, checks `requires` are all present, `conflicts` are all absent, `forgeVersion` range is
  satisfied — real `VcsError`-shaped-equivalent typed errors (this package's own established error
  convention), never a silent skip.
- **Ceiling enforcement**: a project-overlay tool grant exceeding a module's own declared ceiling for
  that role is a compile error naming the offending grant and the ceiling it exceeds — `19` §19.1's own
  "exceeding it requires a recorded, expiring escalation" line is the real Surface: an escalation record
  (new, small schema) suppresses the error until its own expiry.
- **Conflict resolution by install order**: two L1 modules both `provides`-ing the same id (e.g. two
  modules both shipping an agent named `backend`) resolve by manifest install order, reported at compile
  as an informational diff line, never a silent override — `19` §19.1's own literal "conflicts... resolve
  by install order and are reported at compile."

**Checks:**
- A real fixture module requiring an absent module fails compile with a named, actionable error.
- A real fixture module conflicting with an installed one fails compile the same way.
- A tool grant exceeding a declared ceiling fails compile; an escalation record with a future expiry
  suppresses it; an expired escalation record does not.
- Two modules both providing the same agent id resolve deterministically by install order; the compile
  report names both contributors.
- `fm-core`'s own real `module.yaml` (P1) parses and resolves cleanly with zero other modules installed.

**Depends on:** P1 (a real module.yaml to test against).

---

## P3 — `fm-web` module

**Mandate:** `19` §19.1's own row: "Web applications — `frontend` agent, UX-heavy templates, a11y
checks, browser e2e strategy, frontend catalog depth, bundle-size checks."

**Spec:** `19` §19.1.

**Surface:** `modules/fm-web/`
- `module.yaml`: `requires: [fm-core]`, real `provides`.
- `agents/frontend.agent.yaml`: real persona (`decisions_owned`, `disagreement_style`, ceiling-respecting
  tool grant) per `05` §5.3's own schema — the same schema `fm-core`'s 29 agents already satisfy.
- `checks/a11y.check.yaml`, `checks/bundle-size.check.yaml`: real command + parser + `failOn` expression,
  per `19` §19.3's own check-authoring row.
- `templates/`: UX-heavy artifact templates (a component spec, a UX review record) rendering against
  `19` §19.2's real Handlebars context.
- `catalog/*.entry.yaml`: frontend-specific catalog entries plugging into `packages/catalog`'s own
  already-real registry.

**Checks:** `forge module validate fm-web` (P2's parser) passes; `a11y`/`bundle-size` checks run against
both a passing and a failing fixture (`19` §19.3's own Check-authoring row, literally); every template
renders against a fixture context and validates (`19` §19.2 rule 1).

**Depends on:** P2.

---

## P4 — `fm-service` module

**Mandate:** `19` §19.1's own row: "Backend services & APIs — `domain-modeler`, `integration-architect`,
contract-testing workflow, API versioning framework, OpenAPI/proto templates."

**Spec:** `19` §19.1.

**Surface:** `modules/fm-service/` (the exact directory `19` §19.1's own worked example already shows)
- `agents/domain-modeler.agent.yaml`, `agents/integration-architect.agent.yaml`.
- `workflows/contract-test-cycle.workflow.yaml` — a real, compilable workflow (`10`'s own DSL, already
  built) with a gate.
- `frameworks/api-versioning.framework.yaml` — a real rubric-shaped framework (`11` §11.0's own
  weighted-rubric model, criteria weights summing to 1.0).
- `templates/`: OpenAPI/proto contract templates.
- `checks/contract-verify.check.yaml`, `checks/api-breaking-change.check.yaml` — `module.yaml`'s own
  worked example in `19` §19.1 already names these two exact check ids; built to match.

**Checks:** identical shape to P3's — module validates, workflow compiles and dry-runs against the fake
adapter (`19` §19.3's own Workflow-authoring row), framework runs against a fixture KB and produces a
scored ADR (`19` §19.3's own Framework-authoring row), both checks run against pass/fail fixtures.

**Depends on:** P2.

---

## P5 — `fm-data` module

**Mandate:** `19` §19.1's own row: "Data platforms & pipelines — `data-engineer`, F-DATA-8, lineage/
quality checks, warehouse modelling templates, pipeline diagrams." The one module with an explicit
framework-spec cross-reference (`12` §12, F-DATA-8) to build against directly.

**Spec:** `19` §19.1, `12` §12 (F-DATA-8's own real text).

**Surface:** `modules/fm-data/`
- `agents/data-engineer.agent.yaml`.
- `frameworks/analytical-pipeline-design.framework.yaml` — F-DATA-8 made real, matching `12` §12's own
  already-written criteria/rubric text exactly rather than re-deriving one.
- `checks/lineage.check.yaml`, `checks/data-quality.check.yaml`.
- `templates/`: warehouse-modelling templates.
- Pipeline diagram generation reuses `packages/diagrams`'s own already-real generators where the shape
  matches (confirmed against `generators.ts` before assuming a new generator is needed).

**Checks:** identical shape to P3/P4's; F-DATA-8's own framework check specifically asserts its rubric
weights sum to 1.0 and its output template produces a scored ADR, matching `12` §12's own real text.

**Depends on:** P2.

---

## P6 — `fm-mobile` module

**Mandate:** `19` §19.1's own row: "Mobile & cross-platform — `mobile` agent, store-release workflow,
device-matrix test strategy, offline-first patterns."

**Spec:** `19` §19.1.

**Surface:** `modules/fm-mobile/`
- `agents/mobile.agent.yaml`.
- `workflows/store-release.workflow.yaml` — a real, compilable workflow with a gate (app-store review
  readiness).
- `checks/device-matrix.check.yaml`.
- `templates/`: offline-first pattern templates.

**Checks:** identical shape to P3/P4/P5's.

**Depends on:** P2.

---

## P7 — Module lifecycle CLI: `moduleAdd`/`moduleRemove`/`moduleUpdate`

**Mandate:** the three real `never`-returning stubs in `packages/cli/src/commands/module.ts`, and `19`
§19.5's own installation flow (fetch/verify, parse manifest, **capability consent screen**, static
safety scan, install into `.forge/` layers, `manifest.yaml` record, `forge compile` diff report) for the
one channel this milestone actually needs: **local path only** (`forge module add ./modules/fm-web`-
shaped, or a first-party module already vendored in this monorepo's own `modules/`) — npm/git channels
are `19` §19.5's own distribution-channel table, M11's own named scope (overlay bundle fetching), not
this milestone's; disclosed here as an explicit non-goal, not silently absorbed.

**Spec:** `19` §19.5 (local-path channel only), `15` (capability consent screen — already specified,
first real implementation).

**Surface:** `packages/cli/src/commands/module.ts`
- `moduleAdd(id, path)`: P2's parser validates the module, the consent screen lists every requested tool
  grant/ceiling before anything writes to disk, refusal aborts cleanly with nothing installed.
- `moduleRemove(id)`: refuses if another installed module's own `requires` names it (a real, checked
  dependent-module guard, not merely "removes the row").
- `moduleUpdate(id, path)`: re-validates and re-runs the consent screen only for *newly*-requested
  grants versus the currently-installed version — `19` §19.5's own "report what changed... as a diff."

**Checks:** add/remove/update each round-trip against a real fixture module; refusal on the consent
screen leaves the manifest untouched; removing a required-by-another-module module fails with a named
error; updating a module that widens a ceiling shows exactly the new grants in the diff, not the whole
resolved set.

**Depends on:** P2 (parser), one of P3-P6 (a real non-`fm-core` module to add/remove/update against).

---

## P8 — Module conformance test runner

**Mandate:** `19` §19.1's own module layout names a `tests/` directory per module ("module conformance
tests") with no existing runner pattern anywhere in this repo (confirmed: `@forge/testkit` has none).

**Spec:** `19` §19.1.

**Surface:** `packages/extensions/src/module/conformance.ts` (or `packages/testkit`, decided once P2's
own package placement is final — both are legal per the dependency graph; placed wherever P2's own real
code ends up, so a module's conformance suite can import the same parser/resolver it is testing against)
- `runModuleConformance(modulePath)`: discovers `tests/*.test.ts` under a module directory, runs them
  against `@forge/testkit`'s `FakePlatformAdapter` (`19` §19.4's own real, already-built dependency), and
  additionally re-validates every agent/workflow/framework/check the module declares via `provides`
  against P2's own schema — a conformance suite is "does this module's own content still satisfy the
  contracts it claims to," not merely "do its hand-written tests pass."

**Checks:** run against P3-P6's own four real modules; a deliberately-broken fixture module (a `provides`
entry naming a file that does not exist) fails conformance with a named, actionable error.

**Depends on:** P2, at least one of P3-P6.

---

## P9 — `@forge/sessions`: package scaffold, technique library, the five-phase state machine

**Mandate:** `16` §16.3's own FRAME→DIVERGE→CONVERGE→DECIDE→RECORD anatomy and §16.4's own technique
library, as **pure logic** — no agent dispatch, no adapter calls, per this plan's own recorded Surface
deviation above. The foundational piece every later session piece builds on.

**Spec:** `16` §16.2, §16.3, §16.4, §16.5.

**Surface:** new package `packages/sessions` (`sessions: ['core','kb','agents','schemas']`, the existing,
unmodified dependency-graph row)
- `modules/fm-core/techniques/*.technique.yaml` (new content — confirmed nothing like this exists
  anywhere yet): all 20 real techniques `16` §16.4 names across its three tables (12 divergent, 8
  convergent) plus the 6 retro techniques from `16` §16.4's own prose row — each a real, small yaml
  document (`id`, `name`, `bestFor`, `phase: diverge|converge|retro`, a facilitator prompt template).
- `techniqueSchema` (zod), `loadTechnique(id)`, `listTechniques(phase?)`.
- `SessionPhaseMachine`: a pure state machine over `{ phase, framing, ideas, clusters, decisions,
  nonDecisions, actions }`, taking phase-appropriate inputs (a framed question; a batch of ideas from
  DIVERGE; a clustering/scoring from CONVERGE; a ruling from DECIDE) and returning the next state plus
  what the *caller* (P10) needs to do next (e.g. "dispatch these N participants in `panel` mode," "this
  session is refused: the question is not statable in one sentence" per `16` §16.3 FRAME's own literal
  refusal rule).
- `assembleSessionRecord(state)`: produces a value satisfying the already-real `sessionRecordSchema`
  (`packages/schemas`) — this piece writes to that existing shape, does not extend it.
- **Mandatory write-back gate**: `canComplete(state)` is `false` unless every decision has an artifact
  reference and every action has an owner (`16` §16.5's own literal rule); a session with zero decisions
  and zero actions is valid only as `status: 'inconclusive'` with a stated reason, never silently
  completed.

**Checks:**
- Every one of the 20 techniques loads and validates against its own schema.
- FRAME refuses a multi-sentence or unanswerable question with a named error, per `16` §16.3 step 1.
- DIVERGE enforces the idea cap (30, `16` §16.8) by forcing clustering, not by silently dropping ideas.
- CONVERGE requires at least one `critic`-sourced objection be present before allowing DECIDE, when a
  `critic` participant is present — a structural check, not a content-quality judgement this piece cannot
  make (`16` §16.7 point 2's own "not acceptable" language governs a later piece's own facilitator logic,
  not this piece's pure state machine).
- `canComplete` is `false` for zero decisions/zero actions unless `status` is explicitly `inconclusive`
  with a non-empty reason; `true` once every decision/action has its reference/owner.
- `assembleSessionRecord`'s output validates against the real, existing `sessionRecordSchema` byte-for-
  byte on every required field.

**Depends on:** nothing new outside already-real `@forge/schemas`/`@forge/kb`.

---

## P10 — `@forge/engine/session`: filling the real `RUN-039` stub, driving real agent turns

**Mandate:** the one concrete, marked integration point the research pass found: `execute.ts`'s own
`case 'session':` throws `RUN-039`. This piece makes a `kind: 'session'` workflow step actually run,
bridging P9's pure phase machine to the already-real `dispatchAgentStep` mechanism.

**Spec:** `16` §16.6 ("sessions can also be workflow steps"), `06` (dispatch conventions).

**Surface:** `packages/engine/src/interaction/session.ts` (new module, alongside the existing
`dispatch-agent-step.ts` it calls into) plus the removed `RUN-039` throw in `execute.ts`
- `runSessionStep(node, ctx)`: reads the step's own `sessionType`/participants/technique, drives P9's
  `SessionPhaseMachine` phase by phase — FRAME (no dispatch), DIVERGE (a `panel`-mode `dispatchAgentStep`
  call per `16` §16.3 step 2's own "criticism suspended, `critic` muted" rule — the `critic` participant
  is simply omitted from this phase's own dispatch, not dispatched-then-ignored), CONVERGE (`panel` or
  `swarm-review` including `critic` this time), DECIDE (a single `solo`-mode dispatch to the decision
  owner, resolved from `decisions_owned` per `05` §5.3, or the human via the existing human-input
  mechanism if no agent owns it) — feeding each phase's real dispatch output back into the phase machine
  as its next input, then RECORD (P9's `assembleSessionRecord` plus `@forge/kb`'s writer for write-back).
- Adds the new, deliberate `engine → sessions` graph edge (this plan's own recorded Surface deviation).

**Checks:**
- A real `kind: 'session', sessionType: 'brainstorm'` step run against `FakePlatformAdapter` produces a
  real, valid `SessionRecord` with real decisions/actions, end to end.
- `critic` is confirmed genuinely absent from DIVERGE's own dispatch call (not merely instructed to stay
  quiet) and genuinely present in CONVERGE's.
- A session whose DECIDE-phase owner resolves to no real agent falls back to a human-input request, not
  a silent skip or a thrown error.
- `RUN-039` is no longer reachable for `kind: 'session'`; still reachable, unchanged, for `elicit`/
  `subworkflow` (this piece's own scope is exactly `session`, disclosed rather than silently widened).

**Depends on:** P9.

---

## P11 — Anti-groupthink measures (`16` §16.7)

**Mandate:** the five measures `16` §16.7 names, layered onto P10's dispatch rather than assumed free
from reusing `dispatchAgentStep` as-is (panel mode's own "independently before seeing each other" is
already `dispatchAgentStep`'s own real behaviour per Q104 — confirmed, not re-verified from scratch here
— but measures 2-5 are session-specific and genuinely new).

**Spec:** `16` §16.7.

**Surface:** `packages/sessions` (facilitator-logic additions) + `packages/engine/src/interaction/
session.ts`
1. Panel independence: confirmed already real via `dispatchAgentStep` (Q104) — a test proving it here,
   not new code.
2. `critic`'s CONVERGE mandate: P9's own CONVERGE gate (built in P9) enforces a real, non-generic
   objection is present — extended here with a classifier for the specific "this seems fine"-shaped
   non-objection `16` §16.7 point 2 names as unacceptable, rejecting and re-prompting once before
   accepting a session where `critic` genuinely has nothing more specific to add.
3. `steel-man-debate` requiring each side state the opposing case first: a real technique-driven
   sequencing in P10's `debate`-mode dispatch (reusing `dispatchAgentStep`'s own `debate` support,
   sequencing its own rounds so the steel-man statement is round 1's own required content).
4. The record flags a session where no participant disagreed with anyone — computed from `disagreement_
   style` invocations actually observed during dispatch (a real, counted signal, not a heuristic guess),
   written into `SessionRecord` as a new, small boolean/note field this piece adds (confirmed the
   existing schema has room for an additive field without breaking `19` §19.5's own stability-tier rule
   for the `evolving`-tier schemas it governs — session-record's own tier confirmed against `19` §19.5's
   table before adding a field).
5. The human's position hidden during DIVERGE, entering only at CONVERGE where it outranks: P10's own
   DIVERGE dispatch never includes human input as a dispatched "participant" at all; CONVERGE explicitly
   reads it and gives it override weight over agent scoring — a real precedence rule in P9's DECIDE-input
   handling, not merely a documented intention.

**Checks:** each of the 5 measures gets a direct test against a constructed scenario proving the specific
failure mode it prevents would otherwise occur (e.g. measure 4: a scripted all-agreement panel correctly
flags itself; a scripted panel with one real disagreement does not).

**Depends on:** P9, P10.

---

## P12 — Session record write-back and cost/time bounds enforcement

**Mandate:** `16` §16.5's own "write-back is mandatory and is a distinct step" plus `16` §16.8's own cost/
time/round bounds table, both currently unenforced anywhere (P9 built the pure `canComplete` gate; this
piece wires the *enforcement* during a live run, and the real KB write-back).

**Spec:** `16` §16.5, `16` §16.8.

**Surface:** `packages/engine/src/interaction/session.ts` (bounds enforcement, since it owns the live
dispatch loop) + `packages/sessions` (write-back assembly, already scaffolded by P9)
- Per-phase round caps (DIVERGE 3, CONVERGE 2, DECIDE 1), max 5 agents + human, 20 min wall clock, $3
  cost, all read from config (not hardcoded — `16` §16.8's own "all configurable" line) with the stated
  defaults.
- On breach: the facilitator forces convergence with current state and the record is marked `truncated:
  true` with the specific bound that triggered it — `16` §16.8's own literal "better a bounded, honest
  partial result... records that the session was truncated."
- Real write-back: every `Decision`/`Action`/`NonDecision` with an artifact reference becomes a real
  `@forge/kb` write (via the already-real `KbWriter`) or a real ADR/risk/story creation where the
  decision's own artifact type calls for one — reusing existing artifact-creation mechanisms per type,
  not a new one invented here.

**Checks:** a DIVERGE phase forced past 3 rounds by a scripted non-converging fake-adapter script is cut
off and marked truncated with `bound: 'diverge-rounds'`; a session exceeding $3 cost mid-CONVERGE is cut
off and marked truncated with `bound: 'cost'`; a completed session's every decision/action produces a
real, verifiable KB/ADR/risk/story write, checked by re-reading it back from disk.

**Depends on:** P9, P10, P11.

---

## P13 — `forge session` CLI

**Mandate:** replace `packages/cli/src/commands/loop/session.ts`'s own refusal stub with the real thing,
fixing its own pre-existing `SessionType` union bug (missing `discovery-interview`/`story-refinement`)
along the way rather than papering over it.

**Spec:** `16` §16.6.

**Surface:** `packages/cli/src/commands/loop/session.ts`
- `forge session <type> --question "…" [--technique …] [--roles …]` for all ten real types.
- `forge session design-review --target <id>`, `--premortem --scope <id>`, `--retro --stage <id>`,
  `--war-room --defect <id>`, `--tradeoff --question "…" --options a,b,c` — the type-specific flag shapes
  `16` §16.6's own worked commands show.
- `forge session list | show <id> | resume <id> | export <id>` against real, persisted session records.
- `SessionType` union corrected to the real 10-member `SESSION_TYPES` from `sessionRecordSchema` —
  `discovery-interview`/`story-refinement` are real, dispatchable session types after this piece, not
  merely schema-valid-but-unreachable ones.

**Checks:** each of the 10 session types is invocable and produces a real record; `resume` against a
`truncated` session record picks up from its own last recorded phase, not from FRAME again; `export`
produces the real `docs/forge/sessions/SESSION-{id}-{slug}.md` file per `16` §16.5's own canonical path.

**Depends on:** P10, P12.

---

## P14 — Workflow-step session placements (`16` §16.6's own built-in placement table)

**Mandate:** the 7 built-in placements `16` §16.6 names (Discovery, Product Definition, Solution Shaping,
Planning, Implementation, Stabilization, Operate & Learn) wired into `@forge/methods`'s own already-real
ten lifecycle workflows, plus the mandatory-retro rule.

**Spec:** `16` §16.6.

**Surface:** `packages/methods/src` (the already-real lifecycle workflow definitions — this piece edits
existing workflow content, it does not build a new mechanism)
- Each named placement becomes a real `kind: 'session', sessionType: ...` step at the correct point in
  the correct lifecycle stage's own workflow.
- The P10 (Operate & Learn) stage retro is **not conditionally included** — `16` §16.6's own "not
  optional" line is enforced as a compile-time-present step, never a configuration toggle that could
  omit it.
- `standup`'s own trigger condition (elapsed time or blocked-lane count) is a real, evaluable expression
  against `RunReadModel`-shaped data the scheduler already tracks, not a placeholder.

**Checks:** each of the 7 stages' own compiled workflow contains the correct session step(s) at the
correct dependency position; attempting to author a project overlay that removes the mandatory retro
step fails compile with a named error (`19` §19.3's own override rules: "may not remove a required...
field," extended here to a required step by the same principle, recorded as an explicit extension of
that rule if the literal spec text does not already cover steps, not just schema fields).

**Depends on:** P10, P13.

---

## P15 — `forge adopt` phases 1-2: SURVEY and INVENTORY (deterministic, no LLM)

**Mandate:** `17` §17.2 phases 1-2, entirely deterministic tooling — the real, currently-nonexistent
git-history and target-repo dependency-graph analysis the research pass confirmed as genuine gaps.

**Spec:** `17` §17.2 phases 1 (SURVEY) and 2 (INVENTORY).

**Surface:** new `packages/kb/src/adopt/survey.ts`, `packages/kb/src/adopt/inventory.ts` (placed in
`@forge/kb` since adoption's whole job is producing KB content, and `kb`'s own dependency row already
permits everything these two phases need — confirmed against the graph before choosing package
placement)
- SURVEY: size/language/file-count walker; manifest-file detection for the 5 real toolchains `17` §17.2
  names (`package.json`/`pom.xml`/`pyproject.toml`/`go.mod`/`Cargo.toml`); entry-point/deployable-unit/
  datastore/test-setup/CI signal extraction, each from the real file-shape `17` §17.2's own table names;
  **new** git-profile analysis (age, commit count, contributor count, churn hotspots, files-changed-
  together) via `@forge/vcs`-mediated `git log`/`git shortlog` calls (a new `@forge/vcs` export, since
  `vcs` already owns every other real git subprocess call in this repo and `kb → vcs` is not a real graph
  edge — confirmed, and not one this piece adds either: the git-profile primitive lives in `@forge/vcs`
  itself, `@forge/kb`'s own SURVEY code calls it through whatever legal path the graph permits, resolved
  concretely once this piece's own implementation starts, recorded here as a known open sequencing
  question rather than guessed at in this plan). Output: `reports/adoption/survey.json`, facts only.
- INVENTORY: **new** target-repository dependency-graph extraction (language-appropriate — confirmed no
  existing tooling anywhere in this repo, genuinely new), public-API-surface extraction (routes/schema/
  CLI commands/exported symbols/queue consumers/scheduled jobs/webhooks — static analysis per language),
  data-surface extraction (migrations, ORM entities, index inventory), config-surface extraction (env
  vars, config keys, secret references), external-dependency extraction.
- **Size-threshold gate**: `17` §17.2 phase 1's own literal "if the repo exceeds size thresholds, `adopt`
  proposes a scoped adoption... rather than attempting the whole thing" — a real, enforced check here,
  not deferred to a later phase.

**Checks:** run against `@forge/testkit`-style fixture repositories in each of the 5 named languages/
toolchains (at minimum: a Node/`package.json` fixture, one other) — SURVEY's own output matches the
fixture's real, known facts exactly; the size-threshold gate fires against a synthetically oversized
fixture and proposes a scoped adoption rather than proceeding; INVENTORY's own dependency graph matches
the fixture's real, hand-verified import structure.

**Depends on:** nothing new outside `@forge/vcs`/`@forge/kb` (whose own final call-path this piece
resolves concretely, per the open sequencing note above).

---

## P16 — `forge adopt` phases 3-4: CARTOGRAPHY and INFERENCE (LLM, evidence-bound)

**Mandate:** `17` §17.2 phases 3-4 — the first LLM-driven phases, under a strict evidence rule, reusing
the already-real agent-dispatch mechanism (`architect`/`data-architect` roles, read-only, tainted per
`20` §20.5) rather than inventing a new one.

**Spec:** `17` §17.2 phases 3 (CARTOGRAPHY) and 4 (INFERENCE), `20` §20.5 (taint).

**Surface:** `packages/kb/src/adopt/cartography.ts`, `packages/kb/src/adopt/inference.ts`
- CARTOGRAPHY: component identification, layering/boundaries, runtime topology, data ownership (shared-
  write tables flagged immediately, per `17` §17.2's own "highest-value finding" framing), critical
  paths — each a real `dispatchAgentStep`-mediated (`solo` or `panel`) call against P15's own real
  survey/inventory data as the evidence base, every claim required to cite a specific evidence item
  (path, line range, or a P15-produced fact) before being accepted; a claim with no citable evidence is
  rejected at assembly time, not merely discouraged by prompt wording.
- INFERENCE: implicit conventions (with real adherence ratios, "17 of 21," not vague language), apparent
  intent, probable NFRs, domain-vocabulary → glossary candidates — every output starts at `confidence:
  low|medium` and `status: draft`, enforced structurally (the KB writer refuses a higher confidence value
  from this phase's own call path).

**Checks:** a fixture repo with a known, seeded shared-write-table produces a CARTOGRAPHY finding
flagging it; a claim manufactured without real evidence (a scripted fake-adapter response inventing a
component that does not exist in P15's own inventory) is rejected, not silently accepted — this is the
piece's own central anti-fabrication check, matching `17` §17.1's own "core risk is confident
fabrication" framing directly; every INFERENCE output is confirmed `confidence: low|medium`/`status:
draft` with no path to a higher value from this phase alone.

**Depends on:** P15.

---

## P17 — `forge adopt` phase 5: VERIFICATION (the phase that earns trust)

**Mandate:** `17` §17.2 phase 5 — testing every prior claim against reality wherever a test is possible,
including the mandatory real build/test execution the research pass confirmed has no existing sandboxed-
execution primitive to reuse (`kind: 'command'`'s own `runCommandStep` is the closest real pattern,
confirmed, but built for a compiled workflow's own lane context, not a bare target-repo clone).

**Spec:** `17` §17.2 phase 5.

**Surface:** `packages/kb/src/adopt/verification.ts`
- Per-claim-type verification per `17` §17.2's own table: static evidence re-check, schema introspection,
  **running the build** (clean clone → build → record pass/fail, not merely re-reading a README's own
  claimed command), **running the test suite** (record pass/fail/coverage as measured), pipeline-file
  reading with last-successful-run lookup, route-table cross-check, lint-rule/grep-ratio convention
  checks.
- **New, real sandboxed execution**: a clean, isolated checkout (a real temp clone, matching `@forge/vcs`'s
  own already-established `mkdtemp` + real git patterns from M5's own crash-resume test infrastructure —
  confirmed as the right precedent to follow, not inventing a new sandboxing approach) running the
  detected build/test commands with a real timeout and captured output.
- Verified claims promoted to `confidence: verified` with the real verification command stored on the
  entry (`08` §8.3's own already-real field), enabling `forge kb verify`'s own later drift detection —
  confirmed `forge kb verify` already exists or is this milestone's own piece to build; resolved
  concretely once this piece starts (open item, not guessed here).
- **Failures are findings, not blockers**: `17` §17.2's own literal "a repository whose README build
  command does not work is a fact worth knowing" — a failed build/test run does not abort adoption, it
  produces a `GAP` entry for phase 7 to consume.

**Checks:** a fixture repo with a genuinely broken build command produces a real, measured failure
recorded as a finding, and adoption continues past it; a fixture repo with a genuinely passing build/test
suite is promoted to `confidence: verified` with the real command stored; a claim CARTOGRAPHY/INFERENCE
made that VERIFICATION can structurally test and disproves is downgraded, never left at its prior
confidence.

**Depends on:** P16.

---

## P18 — `forge adopt` phase 6: RECONSTRUCTION (writing the KB)

**Mandate:** `17` §17.2 phase 6 — writing the actual KB, in the same layout as a greenfield project (`08`
§8.2), reusing the already-real diagram generators and KB writer rather than building new ones.

**Spec:** `17` §17.2 phase 6, `08` §8.2, `08` §8.11.6.

**Surface:** `packages/kb/src/adopt/reconstruction.ts`
- Writes `architecture/`, `data/`, `delivery/`, `engineering/standards.md`, `product/`, `decisions/`
  entries via the already-real `KbWriter`, carrying forward every confidence/evidence value P15-P17
  produced — this piece assembles and writes, it does not re-derive facts.
- Diagrams generated via `packages/diagrams`'s own real `componentsToC4`/`depsToGraph`/
  `schemaIntrospectToEr`, fed P15/P16's own structured component/module/schema data — confirmed these
  three generators' own real input shapes match what P15/P16 produce before this piece assumes so.
- **Retroactive ADRs**: `status: accepted`, `date: unknown`, `framework: reconstructed`, context inferred
  — a real, distinct ADR-creation path from the normal one, labelled so nobody mistakes a reconstruction
  for original reasoning, per `17` §17.2 phase 6's own literal warning.
- `product/` entries marked `confidence: low` pending human confirmation, per phase 6's own "usually
  sparse... reverse-engineered" text.

**Checks:** a full fixture-repo run through P15-P18 produces a KB indistinguishable in layout from a
greenfield KB fixture (same section structure, same entry schema); every generated diagram's own source
data traces back to a real P15/P16 fact, never fabricated; every retroactive ADR carries all three of
`date: unknown`/`framework: reconstructed`/inferred context, never silently presented as an original ADR.

**Depends on:** P15, P16, P17.

---

## P19 — `forge adopt` phases 7-8: GAP ANALYSIS, BASELINE, and human confirmation

**Mandate:** `17` §17.2 phases 7-8, plus `17` §17.3's own human-confirmation flow (impact×uncertainty
ranking, 20-question cap, "I don't know" always available) — the phase that makes adoption immediately
useful and the one that closes the loop with the human.

**Spec:** `17` §17.2 phases 7 (GAP ANALYSIS) and 8 (BASELINE), `17` §17.3.

**Surface:** `packages/kb/src/adopt/{gap-analysis,baseline,confirmation}.ts`
- GAP ANALYSIS: the 6 gap classes `17` §17.2 phase 7 names (knowledge/verification/delivery/operability/
  safety/consistency), each severity-rated, actionable ones converted to real stories — `reports/
  adoption/gaps.md` plus real `RISK-###`/`OQ-###` artifacts via already-real artifact-creation paths.
- BASELINE: a real `BASELINE` git tag/commit (`@forge/vcs`-mediated), the measured-facts snapshot (build
  time, test count/pass rate, coverage, dependency count, LOC, cycles, gap counts) stored as the ratchet
  reference; `G-Adopt` gate wired into `@forge/methods`'s own gate mechanism, checking exactly the four
  conditions `17` §17.2 phase 8 names.
- Human confirmation: claims batched by section, ranked by impact × uncertainty, capped at 20 questions
  (the rest become real `OQ-###` artifacts, not silently dropped); each question shows claim + evidence +
  consequence-if-wrong; "I don't know" converts the claim to `confidence: low` plus a new `OQ-###`, never
  forces a guess.

**Surface (CLI):** `packages/cli/src/commands/adopt.ts` — replacing the refusal stub
- `forge adopt [dir] [--scope <path|module>] [--depth quick|standard|deep] [--no-verify]`: `quick` runs
  phases 1-2 plus minimal cartography; `standard` (default) runs all 8; `deep` adds git-history inference
  and per-component characterisation-test generation (`17` §17.2's own `--depth` semantics exactly).
- `forge adopt --incremental` (`17` §17.5): re-runs SURVEY-VERIFICATION on demand, reporting new
  components/routes/tables, verification-command drift, adherence-ratio movement, and gap deltas against
  the stored baseline.
- `forge adopt --report`, `forge baseline show | diff`.

**Checks:** GAP ANALYSIS against a fixture repo with seeded defects in every one of the 6 gap classes
finds every seeded defect, per M10's own Acceptance criterion ("every seeded defect in the fixture
appears in the gap report") — this is the literal exit test named in `specs/22`'s own M10 Build section,
built and run here, not merely implied; the human-confirmation flow caps at exactly 20 questions against
a fixture with more than 20 high-impact claims, the remainder become real `OQ-###` entries; `--incremental`
against a fixture repo with one new, undocumented route since the baseline reports exactly that route as
new, nothing else; `G-Adopt` refuses to pass with an unconfirmed `high`-impact claim present.

**Depends on:** P15, P16, P17, P18.

---

## P20 — Working-in-an-adopted-codebase adjustments (`17` §17.4)

**Mandate:** `17` §17.4's own six adjustments FORGE makes once a codebase is adopted — the piece that
makes adoption's own output actually change how later work in that project behaves, not merely a report
that gets filed away.

**Spec:** `17` §17.4.

**Surface:** touches `@forge/methods` (convention-observance in generated code), `@forge/vcs`/`@forge/kb`
(blast-radius analysis from the P16 module graph), `@forge/methods` (characterisation-test-before-
refactor rule, strangler-fig default as a recorded ADR pattern), `@forge/kb`/`packages/cli` (narrower
file-claim defaults — `strict` even at `guided` autonomy for an adopted project, a real, checked
autonomy-level override keyed off a project's own `adopted: true` marker P18 sets).
- Blast-radius analysis: any story touching a component computes real dependents from P16's own stored
  module graph and includes them in test scope — a real, automatic scope expansion, not a manual step.
- Drift detection "from day one": `forge kb verify` (P17's own verification-command mechanism) and
  `diagram:drift` (confirmed against `packages/diagrams`'s own existing drift-check capability before
  assuming new code is needed) both already work the moment P17/P18 land; this piece's own job is
  confirming they fire correctly against a real adopted-project fixture, not building new drift logic.

**Checks:** a story touching a component with 3 real dependents (per a fixture module graph) gets exactly
those 3 added to its test scope automatically; an adopted-project fixture at `guided` autonomy still
enforces `strict` out-of-claim handling, confirmed against `@forge/vcs`'s own already-real claim-
enforcement mechanism (M5) with the adopted-project override applied; `forge kb verify` against a fixture
whose verified build command now fails reports real drift.

**Depends on:** P16, P17, P18, P19.

---

## Notes on sequencing and scope

- **Modules (P1-P8) and sessions (P9-P14) have no dependency on each other** and can build in either
  order or interleaved; **adopt (P15-P20) has no dependency on modules or sessions at all** — the three
  subsystems named in M10's own Build line are genuinely independent, matching the spec's own single,
  flat Build line naming all three without an internal ordering.
- **Total: 20 pieces** — larger than M9's 16, proportionate to M10's own three-subsystem scope (framework
  modules, a new facilitation package, and a full eight-phase brownfield pipeline) rather than an
  arbitrary target.
- Every piece follows the identical `BUILD-PROMPT.md` gauntlet-loop discipline already established across
  M1-M9: tests-first, a fresh context-free critic per round, judge-and-loop on real findings, two-commit
  pattern (`feat(...)` then `docs: record M10 P<n> in the gauntlet log`), `SPEC-QUESTIONS.md` entries for
  every real design decision.
