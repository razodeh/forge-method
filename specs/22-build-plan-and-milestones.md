# 22 — Build Plan and Milestones

This is the execution order for implementing FORGE. It is written to be consumed by an engineering
agent working milestone by milestone, with a hard stop and a human review at each exit gate.

## 22.0 How to use this file

- Milestones are **strictly ordered**. Do not start M(n+1) before M(n)'s exit tests pass.
- Each milestone lists: what to build, what *not* to build yet, acceptance criteria, and exit tests.
- **Exit tests are commands.** A milestone is complete when they pass, not when the code looks done.
- The guiding sequencing principle: **build the headless engine first and drive it from a
  non-interactive CLI.** The TUI comes late, because a system that can only be exercised through a
  terminal UI cannot be tested properly, and everything downstream would inherit that weakness.
- A second principle: **the fake adapter comes before any real adapter.** Otherwise every test costs
  money and depends on a model's mood.

Total: 12 milestones. M1–M7 are the walking skeleton of the product itself — at the end of M7, FORGE
can plan and build a real project headlessly. M8–M12 add the surface, the depth and the polish.

---

## M1 — Foundations: repo, schemas, core domain

**Build:** the monorepo per `02` §2.2 (pnpm + turbo + tsup + vitest + eslint flat config + changesets);
`@forge/schemas` (zod definitions for config and every artifact type in `18` §18.7, JSON Schema
emission, the migration runner); `@forge/core` (artifact model, front-matter read/write with
formatting preservation, ID allocation, the spec graph with typed edges, `ForgeError` taxonomy,
atomic FS helpers with path containment); the dependency-boundary lint.

**Do not build:** engine, adapters, TUI, KB retrieval, any agent.

**Acceptance**
- Every artifact type in the registry has a zod schema, an emitted JSON Schema, and a template stub.
- Artifact round-trip preserves formatting exactly.
- ID allocation derives from a filesystem scan, never reuses an id, and is serialised.
- Path containment rejects `..` and symlink escapes.
- The boundary lint fails on a deliberate upward import.

**Exit tests**
```
pnpm build && pnpm typecheck && pnpm lint && pnpm test
pnpm test -- packages/schemas packages/core --coverage   # ≥90% lines
node -e "require('./scripts/assert-schema-drift.mjs')"    # emitted schemas match committed
```

---

## M2 — Customization layering (`@forge/extensions`)

Deliberately early, because agents, workflows, gates and templates are all *loaded through* this
layer. Building it later means retrofitting every consumer.

**Build:** the five-layer resolver (`15` §15.2); merge semantics with all array operators; `$extends`;
compile pipeline producing the resolved set; provenance tracking per field; `forge compile` and
`forge overlay explain` as library functions; ceiling enforcement; the twelve invariant checks
(`15` §15.10) with their error codes; skill packet parsing and validation; MCP registry parsing and
grant validation; preset application and eject.

**Do not build:** overlay bundle fetching from npm/git (M11), the Customize TUI screen (M9).

**Acceptance**
- Every operator behaves per spec, including ordering and nesting; unknown operators error.
- Per-field provenance is correct across all five layers.
- Each invariant I1–I12 refuses its fixture with the documented error code.
- Skill validation catches size, dead references, injection-shaped content and secrets.
- Preset eject is byte-identical to direct application.

**Exit tests**
```
pnpm test -- packages/extensions --coverage        # ≥90%
pnpm test -- --grep "invariant I"                  # 12 tests, all asserting specific codes
pnpm forge compile --check -C fixtures/customized  # exits 0
```

---

## M3 — Knowledge Body and diagrams

**Build:** `@forge/kb` (store, `KbWriter` with serialised queue and proposal channel, SQLite index +
JSON fallback, FTS retrieval, graph expansion, context packing with budgets, the linter with every
rule from `08` §8.7, staleness and verification); `@forge/diagrams` (Mermaid parse/validate, the eight
generators, drift detection, complexity/caption lint, HTML render fallback).

**Do not build:** embeddings retrieval (config flag exists, implementation deferred), PlantUML/D2
support (report unavailable).

**Acceptance**
- KB round-trips, lints, and indexes; index rebuild produces identical query results.
- Contradiction detection is deterministic; LLM findings are warnings only.
- Context packing respects budgets, never evicts pinned core, and records its manifest.
- Every generator is golden-file tested; drift detection catches the `diagram-drift` fixture.
- Diagram rendering produces self-contained HTML with **zero network calls**.

**Exit tests**
```
pnpm test -- packages/kb packages/diagrams --coverage   # ≥90% kb
pnpm forge kb lint -C fixtures/greenfield-service --json
pnpm forge diagram validate -C fixtures/diagram-drift   # exits 3 with drift reported
```

---

## M4 — Adapter kit and the fake adapter

**Build:** `@forge/adapter-kit` (the `PlatformAdapter` interface, `AdapterEvent` normalisation,
`ToolGrant` mapping helpers, control-token parsing and stripping, untrusted-content wrapping, the
16-test conformance suite); `@forge/testkit` with `FakePlatformAdapter` (scripted responses,
capability degradation, failure injection, replay).

**Do not build:** the Claude Code adapter (M7).

**Acceptance**
- The fake adapter passes all 16 conformance tests.
- Control tokens inside untrusted content are stripped and logged, never executed.
- Capability degradation simulation exists for every optional capability.

**Exit tests**
```
pnpm test -- packages/adapter-kit packages/testkit
pnpm test -- --grep "conformance"     # 16 tests against the fake adapter
```

---

## M5 — Engine: workflows, scheduling, lanes, gates

The largest milestone. Split it into pieces of ≤400 lines as the build prompt requires.

**Build:** `@forge/vcs` (worktrees, lane branches, merge queue, conflict detection, claim
enforcement, shared-path strategies, dirty-tree protection); `@forge/telemetry` (event log with
fsync-before-side-effect, redaction at write time, projections, cost ledger); `@forge/engine`
(workflow parser and validator, the sandboxed expression evaluator, plan compilation with fanout and
implicit dependencies, the scheduler with concurrency/claims/backpressure/admission control, lane
runners, gate evaluation with deterministic and advisory checks, failure classification, retry and
escalation, anti-thrash, resume).

**Do not build:** real agents beyond stubs, sessions, brownfield, TUI.

**Acceptance**
- Plans compile with correct implicit dependencies; cycles rejected with a rendered graph.
- The scheduler is deterministic given a seed.
- Merge queue handles clean merges, conflicts and post-merge failures with automatic revert.
- Gates cannot be approved with a failing deterministic check; waivers require reason and expiry.
- **Resume works from any kill point** — this is the milestone's defining criterion.

**Exit tests**
```
pnpm test -- packages/engine packages/vcs packages/telemetry --coverage   # ≥90%
pnpm test -- --grep "E3 crash-resume"    # 20 randomised kill points, all resume identically
pnpm test -- --grep "scheduler determinism"
```

---

## M6 — Agents, method content and the headless CLI

**Build:** `@forge/agents` (registry, prompt compilation with all nine blocks, handoff records,
separation-of-duties enforcement, interaction modes); `@forge/methods` (framework execution engine,
rubric scoring, level selection); `@forge/catalog` (entries + selection engine); `@forge/templates`
with `fm-core` content — the full roster from `05` §5.2, the ten lifecycle workflows, all gates and
checks, the frameworks from `11`–`14`, base templates and skills; `@forge/cli` with every
non-interactive command from `03` (no TUI: `--no-tui` behaviour is the only mode).

**Do not build:** `fm-web`/`fm-service`/`fm-data`/`fm-mobile` (M10), sessions (M10), TUI (M9).

**Acceptance**
- Every shipped agent, workflow, framework, gate, check and template passes its `validate` command.
- Compiled prompts are written to step records and are auditable.
- A framework run produces an ADR containing a score table; one without is rejected.
- Every CLI command has a non-interactive path and stable `--json` output.

**Exit tests**
```
pnpm forge agent validate --all && pnpm forge workflow validate --all && pnpm forge template validate --all
pnpm test -- --grep "E1 init"          # full artifact set, all validators clean
pnpm forge --json status -C fixtures/greenfield-service | node scripts/assert-json-contract.mjs
```

---

## M7 — Claude Code adapter and the first real run

**Build:** `@forge/adapter-claude-code` with both transports (`sdk` and `cli`), the full mapping table
from `07` §7.3, skill provisioning scoped to the lane worktree, MCP grant provisioning with
load verification, the FORGE MCP server (including `forge_skill_load`), cost/usage extraction, retry
and rate-limit event mapping, version probing with capability feature-detection.

**Acceptance**
- Passes all 16 conformance tests against real Claude Code, both transports.
- `--bare` is default; `forge doctor` explains the `ANTHROPIC_API_KEY` requirement precisely.
- A granted MCP server that fails to load fails the step rather than degrading silently.
- Skills provisioned into one lane are invisible to another lane and to global config.

**Exit tests**
```
FORGE_LIVE=1 pnpm test -- --grep "conformance"      # against real Claude Code
FORGE_LIVE=1 pnpm test -- --grep "live smoke"       # one real init + one story, artifacts validate
```

> **Checkpoint.** At the end of M7, FORGE can plan and build a real project headlessly on a real
> platform. Stop, run a genuine project through it, and let that experience inform M8+. Everything
> after this point is surface, depth and polish; if the M7 experience is bad, fix it here rather than
> building on it.

---

## M8 — Verification depth: testing, debugging, review

**Build:** the test-strategy and oracle frameworks as executable content; the normalised test-result
reporter and AC binding (`09` §9.5) for at least JS/TS and Python; coverage ratchet; oracle lint;
flake detection and quarantine; the `forge debug` RCA state machine with all ten phases, loop bounds
and anti-thrash; `swarm-review` with the eight perspectives and finding deduplication.

**Acceptance**
- AC→test binding works for both supported ecosystems; unbound ACs block `G-Verify`.
- Oracle lint catches every banned pattern in `13` F-TEST-2.
- The debug loop refuses to attempt a fix before a reproduction exists.
- Quarantine cap enforced; retries never used to turn a gate green.

**Exit tests**
```
pnpm test -- --grep "E7 debug loop"     # seeded defect → RCA with prevention action
pnpm test -- --grep "oracle lint"
pnpm test -- --grep "flake quarantine"
```

---

## M9 — TUI

**Build:** `@forge/tui` — the eight screens, the component inventory, the read-model store, modal
flows, command palette, contextual help, degradation modes (`--ascii`, `--linear`, `NO_COLOR`,
`TERM=dumb`), resize handling, interject.

**Acceptance**
- Snapshot tests at three sizes for every screen in every canonical state.
- The TUI issues only engine commands and never mutates domain state directly.
- The fuzz test survives 10 000 random events.
- Every interactive flow has a documented non-interactive equivalent.

**Exit tests**
```
pnpm test -- packages/tui
pnpm test -- --grep "tui fuzz"
pnpm test -- --grep "tui degradation"
```

---

## M10 — Modules, sessions and brownfield

**Build:** `fm-web`, `fm-service`, `fm-data`, `fm-mobile`; `@forge/sessions` with all ten session
types, the technique library, the five-phase anatomy, anti-groupthink measures and mandatory
write-back; `forge adopt` with all eight phases including build/test verification and the gap report.

**Acceptance**
- Each module validates and composes with `fm-core` without conflict.
- A session cannot complete without decisions/actions or an explicit `inconclusive` reason.
- Adoption produces no `high`-confidence claim without evidence; every seeded defect in the fixture
  appears in the gap report.

**Exit tests**
```
pnpm test -- --grep "E5 adopt"
pnpm test -- modules/          # module conformance tests
pnpm forge session brainstorm --question "…" -C fixtures/greenfield-service --yes --json
```

---

## M11 — Distribution, second adapter, security hardening

**Build:** overlay bundle fetching (path, npm, git) with integrity verification, the capability
consent screen, the static safety scan; `@forge/adapter-generic` (declarative `adapter.yaml`,
`07` §7.5) as this milestone's own second, real adapter; the full security test suite (S1–S12);
`forge audit`; `forge doctor` complete with `--fix` and `--rebuild-index`. **Do not build:**
`@forge/adapter-codemachine` — descoped (`07` §7.4); the generic declarative adapter already covers
"drive some other CLI coding tool," without a named third-party binding whose own interface was never
confirmed to exist as originally specified.

**Acceptance**
- The three distribution channels produce identical resolved output.
- Nothing installs without consent; the consent screen lists every requested capability.
- Every security invariant S1–S12 has a passing adversarial test.
- The generic adapter passes conformance against a scripted binary.

**Exit tests**
```
pnpm test -- --grep "security S"        # 12 adversarial tests
pnpm test -- --grep "E6 customization"
pnpm test -- --grep "E10 doctor"
```

---

## M12 — Release readiness

**Build:** `forge upgrade` with the full migration path and backups; `forge export` (markdown-bundle,
html); the performance benchmark suite with ratchets; Windows CI green; documentation (README,
getting-started, the method guide, the authoring guide, the adapter guide); changesets release
pipeline with provenance.

**Acceptance — the v1.0 success criteria from `01` §1.8**
- SC1–SC11 all demonstrably met, each with the command that proves it.
- CI green on the full matrix (3 OS × 3 Node).
- Cold start, first frame and compile benchmarks within budget.
- `npx forge-method@next` works from a clean machine with no global installs.

**Exit tests**
```
pnpm test                                   # everything, all suites
pnpm bench --check                          # ratchets
pnpm test -- --grep "E1|E2|E3|E4|E5|E6|E7|E8|E9|E10"
FORGE_LIVE=1 pnpm test -- --grep "live"
scripts/verify-success-criteria.mjs         # asserts SC1–SC11 with evidence
```

---

## M13 — Live-run readiness

Post-v1.0. Not part of the original 12-milestone build plan `specs/22` §22.2 describes — added once a
real, previously-undiscovered gap was found by direct inspection after M12: `@forge/agents`' own
prompt compiler (`05` §5.3's nine blocks), operating contract (`05` §5.5) and context-packing pipeline
(`05` §5.4, `@forge/kb/pack`) are all real and tested, but `@forge/engine`'s own dispatch never calls
any of them. A real agent step is sent `node.brief` — a raw `briefs/<name>.md` path from workflow
YAML — as its entire prompt, verbatim; no `briefs/` or `prompts/` content ships anywhere in this
codebase for any of the 62 distinct brief references or 62 distinct agent prompt references the
shipped modules make. `packages/cli/src/commands/workflow.ts`'s own validation oracle has masked this
(`briefExists: () => true`), and no test has caught it because every test runs against
`FakePlatformAdapter`, which never reads a session's own `prompt` field. No live run — `FORGE_LIVE=1`
— has ever been performed against this codebase. See `process/plans/PLAN-M13.md` for the full
investigation and piece breakdown.

**Build:** real brief and agent-prompt content for every workflow/gate/agent reference the shipped
modules make; a real per-step tool grant and model resolution (replacing one hardcoded grant and
"whichever model the adapter lists first"); wiring `compilePrompt`/`packForStep` into both real
dispatch paths (`@forge/engine/dispatch`'s `buildSessionRequest`,
`@forge/engine/interaction`'s agent-step dispatch); an output-contract check after an agent step
completes; a strict test-adapter mode that fails a session outright on an empty or bare-path-shaped
prompt, so this class of gap cannot silently recur; the `05` §5.4 point 4 context-expansion protocol,
if not already reachable.

**Do not build:** a tier→model mapping UI or a new model-selection command — `05` §5.8's own static
config table (`models.tiers.*`) is the mechanism; this milestone wires config resolution into a real
per-step call, it does not design a new one.

**Acceptance**
- Every workflow/gate `brief:` reference and every agent's `prompt.system`/`prompt.briefs.*`
  reference resolves to real, non-empty content; `forge workflow validate --all` and
  `forge agent validate --all` both fail with a named `unknown-brief`/`unknown-prompt` finding for a
  reference with no real backing file, never a silent pass.
- A dispatched agent step's real `SessionRequest` contains `05` §5.3's nine compiled blocks, the
  agent's own resolved tool grant (narrowed by ceiling, never one flat global default), and a model
  resolved from `05` §5.8's tier mapping.
- `.forge/state/runs/<runId>/steps/<stepId>/prompt.md` exists for every real agent step, matching
  what was actually sent (`05` §5.3's own "compiled prompts are always written... mandatory" line).
- A step whose declared `outputs` do not exist or do not validate against their registry schema
  fails as a real, typed step failure, not a silently-accepted success.
- A real, human-run live session (`FORGE_LIVE=1`, a real adapter credential) completes at least one
  full agent step end to end.

**Exit tests**
```
pnpm test                                   # everything, all suites, including the new prompt-assembly suite
pnpm test -- --grep "M13"
FORGE_LIVE=1 pnpm test -- --grep "live"     # requires a real adapter credential; run by the project owner
```

---

## M14 — Honest workflows: enforcement, gates, lanes and the disclosed security gaps

Post-v1.0. Not part of the original 12-milestone build plan — added once M13's two live runs
(`SPEC-QUESTIONS.md` Q231) proved one workflow (`retro`) complete end to end on real Claude and, doing
so, disclosed what a real run still lacks: an out-of-claim write is reverted but the step reports
success (25 silent losses, Q216); a `ReviewReport` verdict stops nothing; a lane with two unmerged
predecessors cannot be built; the shipped `agent` conflict policy has no resolver; `forge merge` and
the DECIDE lane land with no checks; `forge gate approve` cannot tell an agent's shell from a
person's; waivers never expire; `forge kb verify`, `forge adopt` and the RCA loop run untrusted-source
commands with the full environment; gates, `elicit` and `session` steps have never run live. M13
closed at `617e549` with 21 owner decisions open; they were delegated to the orchestrator and decided
in Q232, which is binding for this milestone. See `process/plans/PLAN-M14.md` for the pieces.

**Build:** the Q232 decisions — strict claim enforcement fails the step; declared KB outputs written
on the lane with reserved ids, mandatory `sources` and deprecate-not-delete enforced by the output
contract; `produces` prefixes following the configured docs roots; a `verdict` field on every
`ReviewReport` that the swarm-review step and the merge step obey; an engine session marker the CLI
refuses gate approval and waiver under, with the same-run separation-of-duties rule; waiver caps and
identifier owners; `GateReport` artifacts and check files attached through `appliesTo`; the DoD
`verify`/`done` split; a validated `{path}` test form for the RCA loop and `forge story verify`;
compile-time taint from an authored field, declared external inputs and KB provenance; confined stored
commands for `kb verify` and `adopt`; in-lane joins of several predecessors, the `agent` conflict
resolver, run-start fast-forward of the integration branch, checks on every landing including
`forge merge` and the DECIDE lane; `forge config set --commit`; loader-level agent output validation
and `forge upgrade` staleness; the `FORGE_REQUEST_CONTEXT` expansion loop (M13 P8); a third live run
(`plan-stage` at L1) exercising a gate and two session steps.

**Do not build:** OS-level process confinement (a sandbox, namespaces or a container — the residual
`20` §20.10 gaps stay disclosed); a deploy executor (`14` §14.3 gives FORGE none; records stay
self-attested); a retry primitive for a `blocked` review (it escalates); a UI for any of this.

**Acceptance**
- An out-of-claim write under `strict` fails the step as a typed `claim` failure after the revert
  commit and the `PolicyViolation` event; `warn` is byte-for-byte unchanged.
- A declared KB output whose id collides, lacks `sources`, or removes a base entry fails the output
  check; a KB output's id is reserved by the supervisor before prompt assembly.
- A `blocked` review fails its step without retry; an `incomplete` review refuses the merge with a
  remedy; a `concerns` review lands and is recorded in the merge commit's trailers.
- `forge gate approve|waive` under the engine's session marker is refused unless the gate names agents
  and the agent's `may_approve` lists it, and never for a gate that agent produced evidence for in the
  same run; every CLI gate evaluation writes a `GateReport` its approval digests verify against.
- A step with several unmerged predecessors sees all of them; a residual merge conflict under the
  default policy is resolved by one confined session of the lane's own agent and the merge checks then
  run; a run refuses to start when the integration branch and `main` have diverged; `forge merge` and
  the DECIDE lane never land without the configured checks.
- `forge kb verify`, `forge adopt` verification and the RCA loop refuse chained, inline-program or
  network commands and run the rest with a scrubbed environment.
- `forge run plan-stage --stage STAGE-1` at L1 completes live with G-Ready evaluated over at least one
  `ready` story and both session steps decided by an agent owner.

**Exit tests**
```
pnpm test                                   # everything, on a clean checkout of HEAD, apart from the measured load flakes
pnpm test -- --grep "M14"
FORGE_LIVE=1 pnpm test -- --grep "live"     # requires a real adapter credential; the plan-stage run is orchestrator-run
```

---

## M15 — Evidence over ceremony: gates that prove, not gates that check

Post-v1.0. FORGE was built by a stricter discipline than the one it ships. Its own construction had an
oracle — a spec written before the code by a different party than the implementer, tests derived from
that spec first, a fresh context-free critic, a bounded round loop that stopped and disclosed, and
**mutation evidence**: revert the fix, confirm the exact failure reproduces, restore, confirm green.
`GAUNTLET-LOG.md` carries hundreds of these. What a user's project gets is structural: `G-Verify` asks
whether tests ran, whether coverage cleared a threshold, whether lint is clean. Not one shipped check
can tell a suite that binds to real behaviour from one that passes whatever the implementation does. A
green gate certifies diligence and is read as correctness, which is worse than certifying nothing
because it is trusted. Shopify's Helix (`shopify.engineering/helix`) shows the alternative in
production — but its oracle is a reference implementation, which greenfield work does not have.
FORGE's own history holds the oracle that generalises and needs no reference: a test that does not
fail when you break what it claims to test is not a test. See `process/plans/PLAN-M15.md`.

**Build:** `MutationEvidence` and `EvidenceBundle` as registered artifact types; a binding engine that
reverts a story's implementation hunks in an isolated worktree, runs its named tests, and requires at
least one to fail; `forge test binding --json` as a stateless verb; `test:binding` as a deterministic
`G-Verify` check that fails the gate; exemptions that carry reason, owner and expiry and that fail the
check when stale — the discipline `brief-write-paths-in-claim.test.ts` already applies to its own
`EXEMPT` list; evidence bundles committed per story; gate approval refused when declared evidence does
not resolve; the bounded critic loop (default 3 rounds, then stop and disclose) shipped into
`implement-story`; a project disclosure ledger as the user-project analogue of `SPEC-QUESTIONS.md`;
telemetry for binding rate, critic rounds, gate-failures-before-pass, exemption churn, cost per
delivered story and KB-reads-before-decision; `forge report` with a committed baseline; a live run
proving a non-binding test is caught end to end.

**Do not build:** per-hunk or operator mutation (v1 is coarse and says so); any parity oracle needing
a reference implementation (M16); external validation (M17); new orchestration surface — every
capability is a stateless `forge <noun> <verb> --json` invoked the way gate checks already are, which
keeps the milestone neutral on the open question of whether FORGE keeps its own runtime; evidence
retention and pruning policy.

**Exit tests**
```
pnpm test
pnpm test -- --grep "M15"
forge test binding --json                   # shipped fixture project: bound, zero non-binding
FORGE_LIVE=1 pnpm test -- --grep "live"
```

---

## M16 — Parity oracles where a reference exists

Post-v1.0, after M15. M15's oracle is universal but coarse: it proves a suite binds to a change, not
that behaviour was preserved. Three shipped workflows do have a reference implementation and therefore
admit a far stronger oracle — `refactor` (where behaviour-preservation is not merely desirable but
definitional, making parity both necessary and sufficient), `migrate:expand`/`migrate:contract`, and
`adopt`. This is the transferable half of Helix's design, expressed generically: capture an observable
surface from the reference, replay it against the new implementation, and refuse the gate on
divergence. It is also where per-test mutation precision, deferred from M15 P3, is earned.

**The premise, corrected.** The paragraph above speaks of refusing "the gate" on divergence, and
presumes a gate those three workflows already reach. None did. As M15 shipped them, `refactor`,
`migrate` and `adopt` contained no `kind: gate` step, so there was no gate for a parity check to be
wired into. `refactor` was `state-invariants` → `refactor-code` → `verify-invariants` (a plain `forge
test run --json` command step) → `commit`. `migrate` ended in the same plain command (its
`verify-migration` step), and its `migrate-data` step ran `forge migrate run`, which was not wired
(`test/command-steps.test.ts` pins it as a known gap; Q213, Q202). `adopt` was an inventory command
(`forge adopt inventory --json`, also pinned there as unwired; Q213) plus two agent steps, and its one
gate, `G-Adopt`, was evaluated in-process with no gate file. M16 therefore creates the gate it was meant
to feed: the **workflow-scoped gate `G-Parity`**, with one `behavior:parity` check, reached through
explicit `kind: gate` steps (`10` §10.3 rule 8). The wiring is this: `refactor` must fail before any
agent step runs when no declaration compares at least one surface, and again at a `verify-parity` gate
between `verify-invariants` and `commit` (whether the first check is a leading `kind: gate` step or an
entry preflight is the choice of `specs/22` M16 P9); `migrate` gets the same verification gate,
unreachable until `forge migrate run` is wired; `adopt` gets no gate step, only the documented use of
`BASELINE` (`17` §17.2). See `process/plans/PLAN-M16.md`.

**Build:** a behaviour-parity harness over observable surfaces FORGE can capture without owning the
app (process stdout/exit codes, HTTP request/response pairs, library call/return, file outputs);
`forge parity capture` and `forge parity check --json`; the workflow-scoped gate `G-Parity`, whose one
`behavior:parity` deterministic check is reached through explicit `kind: gate` steps in the workflows
that have a reference; parity evidence as a registered `ParityEvidence` artifact type plus the additive
optional `EvidenceBundle.parityEvidence` id list; per-hunk mutation raising M15's binding evidence from
change-level to hunk-level attribution; an evidence retention policy, deferred from M15 P7.

**Do not build:** visual/screenshot parity — FORGE is not UI-framework-specific and a pixel oracle
needs a rendering target it does not own; a parity claim for greenfield work, which has no reference
by definition and must keep relying on M15's binding oracle.

**Exit tests**
```
node scripts/run-tests.mjs run -t "M16"
forge parity check --json                   # fixture refactor, behaviour-preserving change: exits 0
forge parity check --json                   # same fixture refactor, behaviour-changing change: exits non-zero
```

Every M16 test's `describe` name carries `(specs/22 M16 P<n>)`, which is what `-t "M16"` selects on.
That filter exits 0 when it selects nothing, so a green `-t "M16"` run is not by itself evidence that
anything ran: the exit gate also requires that every piece that adds tests has at least one test
carrying its own `(specs/22 M16 P<n>)` marker. The `forge parity check --json` exit tests run over one
fixture refactor twice, once with a behaviour-preserving change (exit 0) and once with a
behaviour-changing one (non-zero), so a check that never refuses and a check that always refuses each
fail the gate.

---

## M17 — Falsification: prove it somewhere FORGE did not build

Post-v1.0, after M15 (which emits the metrics) and preferably after M16. Every belief about FORGE's
value is currently self-reported by the system that built itself — a closed loop, and the single
largest gap against any externally-validated tool. FORGE cannot presently be wrong: there is no
measurement, no baseline, and no stated claim that could come back negative. This milestone exists to
make one claim falsifiable and then genuinely test it, accepting a negative result as the real
outcome rather than a setback to be re-run until favourable.

**Build:** a pre-registered hypothesis with a success criterion and a measurement window, committed
*before* the trial; one real external project — not this repository, not a throwaway — run through
FORGE with M15's metrics collected against a recorded baseline; the longitudinal check that tests the
Knowledge Body's central claim directly (are week-1 decisions still read and respected in week-12
work, measured by KB-reads-before-decision and by contradiction rate, not by assertion); a published
result in the `GAUNTLET-LOG.md`/`SPEC-QUESTIONS.md` tradition **whether or not it favours FORGE**; and
whatever adoption-cost reduction the trial proves necessary, which is expected to be substantial.

**Do not build:** a second trial to replace a disappointing first one; any metric chosen after seeing
the data; marketing claims not carried by the published result.

**Exit tests**
```
forge report --json --since <trial start>   # against the external project, compared to the committed baseline
```

---

## 22.1 Cross-cutting rules for the whole build

1. **No milestone is complete with a failing exit test, a skipped test, or a `TODO` in production
   code.** Skipped tests must be deleted or fixed; a skipped test is a lie about coverage.
2. **Write the spec's error codes as specified.** They are the contract for remediation messages and
   for tests.
3. **Every user-facing error carries an actionable remedy.** A `ForgeError` without a `remedy` fails
   review — this is the difference between a tool people can use and a tool people abandon.
4. **`--json` output is a stable contract** from M6 onward; changing it is a breaking change.
5. **Determinism is a feature.** Injected clock, seeded RNG, `TZ=UTC`, no filesystem-order reliance.
6. **Windows from M1**, not retrofitted at M12.
7. **Dependencies are justified in the PR.** The dependency list in `02` §2.1 is close to complete;
   additions need a reason.
8. **When the spec and your instinct disagree, implement the spec and record the disagreement** in
   `SPEC-QUESTIONS.md`. Several specs encode decisions whose rationale is deliberately non-obvious
   (fsync-per-event, lexical-first retrieval, contract-freeze before fan-out, validate-without-render
   for diagrams). Do not optimise them away without replacing the guarantee they provide.

## 22.2 Suggested sequencing if parallelising

With more than one implementer or lane, the dependency graph permits:

```
M1 ──┬── M2 ──┬── M3 ──┐
     │        │        ├── M5 ── M6 ── M7 ── M8 ──┬── M10 ── M11 ── M12 ── M13 ── M14 ── M15 ──┬── M16 ──┐
     └── M4 ──┘        ┘                          └── M9 ──────────┘                           └─────────┴── M17
```

M3 and M4 are independent of each other. M9 (TUI) can begin once M6 stabilises the engine's read
model. Everything else is serial, and M5 is the bottleneck — resist the temptation to start M6's
content authoring before the engine's resume guarantee is proven, because content written against an
unstable engine gets rewritten. M13 is drawn serial after M12 because it was discovered after M12
shipped, not because anything in M1–M12 structurally requires it first. M14 is drawn serial after M13
because every one of its pieces implements a decision that M13's live runs surfaced, not because
anything in M13 structurally requires it first.

M15 is serial after M14 because its evidence model binds to the `ReviewReport` verdicts, `GateReport`
artifacts and claim semantics M14 made real. M16 depends on M15 for the evidence artifacts a parity
result is recorded as. M17 depends on M15 for the metrics it measures with, and is drawn able to start
once M15 lands rather than waiting for M16: an external trial against M15's evidence model is worth
more early than a better-instrumented trial run late, and a negative result found sooner is cheaper.
