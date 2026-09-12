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
     │        │        ├── M5 ── M6 ── M7 ── M8 ──┬── M10 ── M11 ── M12
     └── M4 ──┘        ┘                          └── M9 ──────────┘
```

M3 and M4 are independent of each other. M9 (TUI) can begin once M6 stabilises the engine's read
model. Everything else is serial, and M5 is the bottleneck — resist the temptation to start M6's
content authoring before the engine's resume guarantee is proven, because content written against an
unstable engine gets rewritten.
