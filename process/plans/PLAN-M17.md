# PLAN-M17 — Harden, then falsify: prove it somewhere FORGE did not build

**Status: DRAFT for owner review. Nothing here is built; nothing here is committed.** Post-v1.0, after
M16. Pieces take the next free `SPEC-QUESTIONS.md` number at commit time (`Q313` as this draft is
written); the log entry is `## M17 P<n>` in `process/GAUNTLET-LOG.md`. M16 pieces are cited as `M16 P<n>`.

**Line references are given where a read-only audit on 2026-10-11 (main at `d73cf5b`) confirmed them.**
Each piece's own BUILD step re-checks them; code moves.

## Why this milestone is shaped this way

`specs/22` defines M17 as falsification: one real external project, a hypothesis committed before
the trial, M15's metrics against a recorded baseline, a published result whether or not it favours
FORGE. On 2026-10-11 the owner added a precondition: **every disclosed defect is fixed before the
trial starts**, regardless of whether the trial project would hit it. That is also what measurement
integrity requires — a FORGE that changes during the measurement window confounds the very
before/after comparison the milestone exists to make. So M17 has two phases:

- **Phase A — hardening (P1–P21).** Close the whole defect register below, including the owner's
  requirement that FORGE work with *any* project's tests: known runners detected deterministically,
  anything else — an unfamiliar framework, an in-house runner, a project with no test setup at all —
  investigated by an AI agent that works out how the tests run and what their output looks like, and
  writes the parsing logic FORGE then proves before trusting it. Ends with a live run and a frozen tag
  (`m17-hardened`). No trial work starts before the tag exists.
- **Phase B — the trial (P22–P25).** Pre-register, adopt, measure, publish — `specs/22`'s original M17,
  on `~/Desktop/projects/open-interview-coder`. Outlined only; finalized after Phase A lands.

**A correction this plan opens with.** M16's own exit tests list `pnpm test` (coverage, ratchet,
boundaries). M16 was verified piece by piece with `node scripts/run-tests.mjs run` *without*
`--coverage`, and `pnpm test` has been failing: `packages/cli/src/bin.ts` reports 0% line coverage
(it runs only as a spawned subprocess, which v8 coverage cannot see) against the 85% per-file floor,
and every recent GitHub Actions run is red (e.g. run 36286349494, 2026-09-27). M16 is therefore not
complete by its own exit criteria. P2 fixes this first, and from P2 on, **every piece's verification
runs `pnpm test`, not only the scoped runner.**

## The defect register (the milestone's tracked list)

Numbers match the owner-facing list of 2026-10-11; A–F were found by the same audit. Every item is
closed by exactly one piece (or one named pair) below.

| # | Defect | Piece |
|---|---|---|
| 1 | Trunk hardcoded `main` (`cli/src/commands/run/context.ts:84`; `G-Parity.gate.yaml:7`) | P9 |
| 2 | Only Vitest/pytest output understood (`loop/test/reporter.ts:288`, `:314`) | P3–P7 |
| 3 | Workflow `retry:` is never acted on (`engine/src/run/run-engine.ts:188-197`; `decideRetry` has no caller) | P10 |
| 4 | Structured-output mode discards the answer — reachable via `adopt` inference/cartography (`adapter-claude-code/src/cli/build-args.ts:45-59`, Q116) | P11 |
| 5 | Root-path token rewrite + length-anchored `replace` can mask a regression (M16 P4, Q298) | P14 |
| 6 | Test-time ecosystem sniff requires `package.json`/Python marker (`loop/test/ecosystem.ts:26-32`) | P3, P6, P7 |
| 7 | Failed command step reports stderr noise, hides the real `--json` error (`engine/src/dispatch/steps.ts:1141`, `:1178`) | P12 |
| 8 | `refactor-code` inherits the 20-turn default (`engine/src/plan/compile.ts:112`) | P10 |
| 9 | Lane/integration worktrees live inside the project tree, so any globbing runner discovers them (`vcs/src/lanes.ts:49`) | P8 |
| 10 | `test binding` output misleading for behaviour-preserving stories (`cli/src/bin.ts:2050-2080`) | P13 |
| 11 | Cache tokens never reach the ledger; recorded token counts are main-loop-only (`dispatch/steps.ts:894`, `adapter-kit/src/types/session.ts:56-61`) | P11 |
| 12 | Self-reverting tamper of `.forge/parity/` inside a case run (M16 P7, Q294 D7) | P14 |
| 13 | `parity capture` observes surfaces declared unobservable (`parity/capture-command.ts:434`) | P14 |
| 14 | `migrate` parity unreachable — `forge migrate run` not wired (Q202, Q213) | P18 |
| 15 | Lane commit subject = first 72 chars of agent narration (`dispatch/steps.ts:908`, `:916`) | P12 |
| 16 | `RUN-110` drops the schema issues (`cli/src/bin.ts:1912-1914`) | P13 |
| 17 | No runtime backstop for catastrophic normalize regexes (`parity/replace-lint.ts:18-39`) | P14 |
| 18 | Windows: parity observation refused (`parity/observe.ts:519`), no descendant kill on win32, Windows CI legs cancelled | P16 |
| 19 | Normalize over-restriction (`sort-lines`+`trim-trailing-whitespace`) and `strip-ansi` residual (M16 P4) | P14 |
| 20 | `pnpm test` red: `bin.ts` 0% coverage; CI failing on every leg | P2 |
| 21a | `forge upgrade` never retrofits `.gitignore` | P13 |
| 21b | Lanes skipped by `skipChecks` leave no telemetry marker (`dispatch/steps.ts:1594-1596`) | P12 |
| A | `forge adopt` and `forge spec re-derive` not wired in `bin.ts` (Q213) | P17 |
| B | In-run gate telemetry lands in the integration worktree's event log, which `forge report` never reads (M16 P15) | P12 |
| C | A session that commits inside its own lane bypasses the write claim (Q294 D2, Q209/Q212) | P15 |
| D | A fresh run after partial integration collides with the output contract (`RUN-083`, M16 P9 log) | P10 |
| E | P1 pin-test gaps: sentence-only granularity for 78/287 pins; `scanLines` misses tilde/indented fences, hidden `<div>`s | P19 |
| F | A completed run leaves trunk untouched; no command or doc says how to land it; a manual trunk commit then blocks the next run | P9 |

## Decisions this plan commits to

1. **Runner-agnostic testing is a contract, not a list of supported runners.** FORGE defines a
   canonical, versioned test report (`forge-test-report`, JSON). A project tells FORGE, per test
   layer, the command, where its output lands (stdout or a FORGE-allocated `{output}` path), and its
   format — one of a small set of built-in parsers (`junit-xml`, `tap`, `forge-json`, plus
   `vitest-json`, `jest-json`, `go-test-json` where a runner's native JSON carries more than its JUnit
   does) or a **translator** that prints `forge-json`. Optional `scope` (`{files}`) and `filter`
   (`{name}`, `{name:regex}`) templates unlock file-scoped and single-test runs.
2. **The AI figures out what FORGE cannot recognise — and FORGE proves the result before trusting it.**
   Known runners are detected deterministically (free, instant, reproducible). Everything else goes to
   an agent: an unrecognised framework, an in-house runner with its own output format, a polyglot repo,
   or a project with no test setup at all. The agent investigates how the project's tests actually run
   (manifests, CI files, Makefiles, scripts, docs, and the in-house runner's own source), runs them,
   studies the real output, and either maps it to a built-in format or **writes the parsing logic** — a
   translator script committed to the project. An agent-written translator is never trusted on the
   agent's word: it must pass FORGE's deterministic **translator proof** (P6) — schema-valid output,
   counts that reconcile with the runner's own exit code and summary, an injected-failure probe the
   translator must report by exact name, and identical results across two runs. A project with no test
   setup gets a *proposal* (a conventional runner for its stack, as a reviewable change), never a
   silently added dependency. Human approval (`G-TestAdopt`) is required before an agent-produced
   configuration is used by any gate.
3. **No capability is ever faked.** A consumer that needs a capability the project did not declare
   degrades to a stated, typed, visible outcome — never a silent pass: no `filter` → flaky retry is
   skipped and recorded "unclassified"; no `scope` → binding and hunk mutation run the whole suite
   each time, bounded by a budget with a typed refusal; no `file` attribution → binding attributes by
   name and says so; no failure-kind signal (e.g. TAP) → every failure is `assertion`, the
   conservative choice for hunk credit, and stated.
4. **Explicit config always wins; detection and the agent only propose.** `detectEcosystem` leaves the
   test-time path entirely.
5. **Zero-change migration for existing projects.** A plain-string `testCommands.unit` keeps today's
   exact behaviour; `forge doctor` suggests the structured form. Every M15/M16 golden stays
   byte-identical in legacy mode.
6. **Worktrees move out of the project tree** (#9; owner delegated, 2026-10-11) — a per-project
   directory under the user cache (`$XDG_CACHE_HOME/forge/<project-hash>/worktrees`, platform
   equivalents). Chosen over an exclusion list because an exclusion has to be taught to every runner,
   which contradicts Decision 1; it also shortens Windows paths (#18).
7. **Trunk is configuration** (`vcs.trunk`, proposed at `forge init` from `origin/HEAD` or
   `init.defaultBranch`, default `main`). `--trusted` accepts the symbolic `@trunk`, resolved by
   `forge parity check` itself, so gate YAML needs no templating.
8. **CI runs from a `next` branch only** (owner delegated, 2026-10-11). The repository is public, and
   a push to `main` triggers `release.yml` (changesets and `npm publish --provenance`), so `main` is
   never pushed by this milestone; `next` triggers `ci.yml` alone. Every push is preceded by a secret
   scan of the outgoing range (the gitignored `.env`'s key tail, plus token-shaped strings). The first
   push happens in P2. From P2 on, a piece is not done while CI is red for a reason it touches.
9. **`forge migrate run` is built** (#14; owner delegated, 2026-10-11), with P1 writing the spec `03`
   lacks — the owner's instruction is "every defect fixed", and descoping would leave one standing.
10. **Phase A ends frozen.** P21's live run happens on the tagged commit; Phase B measures that tag and
    nothing newer. A defect found during the trial is recorded and fixed *after* the window closes.
11. **Concealment is out of scope** (owner, 2026-10-11). In the trial project, no work is done on
    hiding the app from screen sharing, recording or proctoring, or on evading detection. Everything
    else — transcription, AI suggestions, the build, the backlog, tests — is in scope.

## Parallel chains

```
P1 (spec) ─┬─ P2 (CI green, first push to `next`) ─────────────────────────┐
           ├─ Chain R (runners):  P3 ─ P4 ─ P5 ─ P6 ─ P7 ────────────────────┤
           ├─ Chain V (vcs):      P8 ─ P15 ─ P16                             │
           ├─ Chain E (engine):   P10 ─ P12  (both edit dispatch/steps.ts)   │
           ├─ Chain D (adapter):  P11 ─ P17 (also needs P7)                  ├─ P20 (docs) ─ P21 (live, owner-authorized) ─ tag m17-hardened
           ├─ Chain P (parity):   P14                                        │
           └─ Singles:            P9, P13, P18, P19                          ┘
Phase B: P22 ─ P23 ─ P24 ─ P25  (after the tag; outline only)
```

P2 lands before anything else is *verified*, but pieces may be *built* in parallel with it.

---

## Phase A — hardening

## P1 — Spec first: M17's two phases, the test-report contract, and every normative change

**Mandate.** Amend `specs/22` M17 (two phases; the hardening precondition; the frozen tag; Phase A's
build/do-not-build lists). Write the normative text every later piece builds against: `09` §9.5 (the
canonical `forge-test-report`, replacing "vitest JSON or pytest XML" as the normalized source), `13`
F-TEST-1/6/7/10 (what each consumer does per declared capability) and a new F-TEST entry for test
adoption and the translator proof, `18` (structured `execution.testCommands`, translators,
`quality.coverage.source/format`, `vcs.trunk`, worktree location), `03` (`forge test adopt`,
`forge adopt`, `forge spec re-derive`, `forge migrate run`), `06` §6.4/§6.5/§6.8 (worktree location,
landing a run on trunk, real retries), `07` §7.2/§7.3 (multi-event result mapping,
`structured_output`, per-model usage), `10` (the `G-TestAdopt` gate), `13` F-TEST-9 (root token,
tamper isolation, normalize budget). Record the defect register and the correction about M16's exit
tests.

**Surface.** `specs/{03,06,07,09,10,13,18,22}.md`, `test/spec-cli-examples.test.ts`,
`test/output-contract-known-gaps.test.ts`, `process/SPEC-QUESTIONS.md`.

**Tests first.** Pin the new normative sentences; the known-gaps test lists every surface still
unbuilt and shrinks as pieces land.

---

## P2 — CI green: `bin.ts` coverage, and the whole suite as the bar [#20]

**Mandate.** Make `pnpm test` (coverage, ratchet, boundaries) pass locally, and find every cause of
the red CI runs, not only `bin.ts`. Preferred fix: move `bin.ts`'s dispatch logic into importable
modules so `bin.ts` is a thin entry shell (excluded like `scripts/check-*.mjs`, with the documented
reason), raising real coverage; fallback: `NODE_V8_COVERAGE` collection from spawned subprocesses
plus a merge step. Push to `next` (Decision 8) and drive every CI leg green. Correct M16's own log
entry: its exit tests were not all green.

**Surface.** `packages/cli/src/bin.ts` and new `packages/cli/src/commands/dispatch/*`,
`vitest.config.ts`, `scripts/run-tests.mjs`, `scripts/check-coverage-ratchet.mjs`,
`.github/workflows/*` (read; edited only if a cause lives there), `process/GAUNTLET-LOG.md`.

**Tests first.** `pnpm test` fails at the start of the piece and passes at the end; the coverage
report for the new dispatch modules meets the floor; every existing CLI subprocess test passes
unchanged.

**Mutation evidence.** Re-inline one dispatch module into `bin.ts`: its coverage disappears and the
floor fails.

---

## P3 — The canonical test report, structured `testCommands`, parsers and translators [#2, #6]

**Mandate.** Introduce `forge-test-report` v1 (`{name, file?, status, kind?, durationMs?, acId?}`,
only `name` and `status` required) as a registered JSON schema. Extend `execution.testCommands.<layer>`
to accept `{run, output: {source: stdout|file, path?}, format, translate?, scope?, filter?,
timeoutMs?}` alongside the legacy string. Ship parsers for `junit-xml`, `tap`, `forge-json`,
`vitest-json`, `jest-json`, `go-test-json`. A translator runs under the same confined runner and
timeout; non-zero exit or invalid `forge-json` is `tool-error`. FORGE owns and deletes `{output}`
before every run (a stale report is never read). The process tree is killed before a translator ever
sees partial output. Remove the test-time `detectEcosystem` gate; legacy strings keep current behaviour.

**Surface.** `packages/schemas/src/config/{schema,defaults,docs}.ts`, a new
`packages/schemas/src/test-report.ts`, `packages/cli/src/commands/loop/test/{reporter,ecosystem}.ts`
and new `loop/test/parsers/*`, `packages/core/src/errors/codes.ts`, `packages/core/test/errors.test.ts`.

**Tests first.** Golden fixtures per parser from real runners (Vitest, Jest+jest-junit, Mocha,
`node --test` TAP and JUnit, pytest, `go test -json`); a custom-runner fixture with a translator; a
translator that exits non-zero, prints garbage, or prints a valid-but-empty report — each a typed
outcome; a stale `{output}` file is never read; legacy-string goldens byte-identical.

**Mutation evidence.** Skip the `{output}` pre-delete: the stale-report test fails. Accept an empty
translator report as a pass: the zero-tests guard test fails.

---

## P4 — Every consumer on the adapter, with honest degradation [#2]

**Mandate.** Route `forge test run` (incl. the zero-tests guard and flaky retry-in-isolation),
`flaky.json`, `forge test binding` (baseline/mutated/restore), hunk mutation, `forge story verify`,
and `bin.ts`'s binding/exempt paths through P3, applying Decision 3's degradation table. AC-id
extraction searches the whole reported name and honours a `forge-json` `acId`. A whole-suite fallback
is bounded by a declared budget with a typed refusal, never a silent partial pass.

**Surface.** `loop/test/{run,flaky,binding,hunk-mutation,ac-binding}.ts`, `commands/story.ts`,
`bin.ts` (or P2's dispatch modules).

**Tests first.** The full M15/M16 binding and hunk suites run green under three runner configs
(Vitest legacy, `node --test` via JUnit, a custom runner via translator); each missing capability
yields its stated outcome; `G-Verify` cannot pass on a degraded-to-unverified result.

**Mutation evidence.** Treat "no `filter` declared" as "not flaky": the unclassified test fails.

---

## P5 — Coverage and oracle-lint stop assuming a runner

**Mandate.** `quality.coverage.source`/`format` (`istanbul-json`, `lcov`, `cobertura`, `jacoco`)
replace the hard-coded `coverage/coverage-summary.json`; oracle-lint's test-file globs come from
config (defaults unchanged).

**Surface.** `loop/test/coverage.ts`, `loop/test/oracle-lint.ts`, config schema.

**Tests first.** A golden per coverage format; oracle-lint over a project whose tests are `*_test.go`.

---

## P6 — Deterministic runner detection, and the translator proof [#2, #6]

**Mandate.** Two things every later adoption path rests on.

*Detection.* `forge test adopt` inspects `package.json` (scripts, devDependencies), `pyproject.toml`
/`setup.cfg`/`tox.ini`/`requirements*.txt`, `go.mod`, `Cargo.toml`, `pom.xml`/`build.gradle`,
`*.csproj`, `Gemfile`, `composer.json`, `Makefile`, and CI files, across languages and in monorepos
(one entry per package/layer). When it recognises a runner with confidence, it proposes a structured
entry preferring the runner's richest machine-readable output (`--write` applies it). When it does
not — or recognises only partly — it hands off to P7 instead of guessing.

*The translator proof* — a deterministic harness, the only path by which any non-built-in format
(agent-written or hand-written) becomes trusted: (1) the translator's output validates against
`forge-test-report`; (2) the counts reconcile with the runner itself — a non-zero runner exit implies
at least one `fail` or a `crash`/`timeout` outcome, a zero exit implies none, and where the runner
prints a summary line the totals match it; (3) an **injected-failure probe** — a deliberately failing
test written in the runner's own idiom (supplied by whoever proposed the configuration) is added in a
scratch lane, and the translator must report exactly that test as `fail`, by its exact name (and file,
if the format claims file attribution), then the probe is removed; (4) two consecutive runs yield the
same canonical report, ignoring durations; (5) the zero-tests guard holds. A failing proof is a typed
refusal naming the failing check. The proof result is recorded as evidence and pinned to the
translator's content hash and the runner's version; `forge doctor` re-runs it when either changes.

**Surface.** New `commands/loop/test/{adopt,detect,proof}.ts`, CLI wiring, `03` row,
`packages/core/src/errors/codes.ts`.

**Tests first.** One fixture project per recognised runner and language proposes the expected config;
an unrecognised runner hands off rather than guesses; a translator that drops failures, mislabels
names, is nondeterministic, or reports zero tests each fails the proof on the right check.

**Mutation evidence.** Skip the injected-failure probe: a translator that reports every test as
`pass` is accepted — the dedicated test fails.

---

## P7 — AI-driven test adoption: the agent works out the runner and writes the parser [#2, #6]

**Mandate.** A new workflow, `adopt-tests` (agent role: `test-architect`, brief
`briefs/adopt-tests.md`), run by `forge test adopt` whenever P6's detection cannot settle the
configuration, or on `--agent`. The agent:

1. **Identifies how the project's tests run** — which framework or in-house tool, which command,
   which layers — from manifests, CI configuration, Makefiles, scripts, documentation, and, for an
   in-house runner, the runner's own source code.
2. **Runs the tests** in its lane (exec grant limited to the commands it proposes) and **studies the
   real output** — stdout, any report files, exit codes — including a run with a failing probe test,
   so it sees what failure looks like, not only success.
3. **Produces the configuration:** maps to a built-in format where one fits, or **writes the parsing
   logic** — a translator committed to the project at `.forge/test-translators/<layer>.<ext>`, in Node
   by default or the project's own language when that is more natural for its output — plus the
   injected-failure probe P6's proof needs, and `scope`/`filter` templates where the runner supports
   them (stating which it does not).
4. **When there is no test setup at all**, determines the stack and proposes a conventional runner for
   it as a reviewable change (an ADR plus the minimal configuration), applied only after approval —
   never a silently added dependency.

The workflow then runs P6's translator proof; a failing proof loops back to the agent with the
failing check (bounded, default 3 rounds, then stop and disclose); a passing proof goes to the
`G-TestAdopt` human gate with the proof as evidence. Only an approved configuration is written to
`.forge/config.yaml`.

**Surface.** `templates/workflows/adopt-tests.workflow.yaml`, `templates/briefs/adopt-tests.md`,
`templates/checks/G-TestAdopt.gate.yaml`, `commands/loop/test/adopt.ts`, agent grants.

**Tests first.** Against a fake platform adapter scripting an agent session: a translator that passes
the proof reaches the gate; one that fails loops back with the named check and stops after the bound;
nothing reaches `.forge/config.yaml` without approval; a no-tests project yields a proposal, not a
dependency change. Real-agent behaviour is proven in P21, not mocked here.

---

## P8 — Worktrees outside the project tree [#9]

**Mandate.** Lane and integration worktrees move to a per-project directory under the user cache
(Decision 6), keyed by a stable project hash; resume finds them; `forge doctor` reports and offers to
remove old in-tree worktrees. Parity's in-tree special case (`parity/observe.ts:458`) is removed.

**Surface.** `packages/vcs/src/lanes.ts`, `packages/engine/src/resume/orchestrate.ts`,
`parity/observe.ts`, `forge doctor`, `06` §6.4.

**Tests first.** A globbing test runner in the project root finds no lane copies; crash-resume
goldens unchanged; a project moved on disk still resumes (or refuses typed).

---

## P9 — Trunk as configuration, and landing a finished run [#1, F]

**Mandate.** `vcs.trunk` (Decision 7); every `TRUNK` use reads it; `--trusted @trunk`. A completed
run's integration branch can be landed on trunk by an explicit command (or per `06` §6.5's "merge
directly to trunk" config), documented; the diverged-branch refusal names the command that resolves it.

**Surface.** `cli/src/commands/run/{context,run}.ts`, `templates/checks/G-Parity.gate.yaml`,
`parity/check-command.ts`, config schema, `docs/getting-started.md`.

**Tests first.** A `master`-trunk fixture passes `refactor`'s `G-Parity`; a completed run lands on
trunk; a manual trunk commit followed by a run gets an actionable refusal.

---

## P10 — Retries for real, agent-step limits, and re-running after partial integration [#3, #8, D]

**Mandate.** `driveToCompletion` consults `decideRetry`/`computeBackoff` on failure, recreates the
lane, re-executes, emits a retry event, respects budget admission and resume. `refactor-code` (and
every characterise-then-change agent step, audited) declares realistic `limits`. A fresh run whose
predecessor already integrated some steps either reuses or cleanly supersedes their outputs instead
of colliding with `RUN-083`.

**Surface.** `engine/src/run/run-engine.ts`, `engine/src/failures/*`, `engine/src/resume/*`,
`templates/workflows/*.workflow.yaml`, `test/workflows.test.ts`.

**Tests first.** A transient failure is retried and succeeds; a repeated identical signature
escalates after two; retry spend is attributed per step; resume mid-retry is deterministic.

---

## P11 — Adapter: multi-event results, structured output, honest token accounting [#4, #11]

**Mandate.** One raw `result` message may yield several `AdapterEvent`s (CLI `parseCliEventLine`
returns an array; SDK already does). Read `structured_output` into `SessionResult.structured`; flip
`structuredOutput` to true once conformance passes. `SessionUsage` gains `cacheReadTokens` and
`cacheCreationTokens`; per-model `modelUsage` is summed so recorded tokens match recorded cost.

**Surface.** `adapter-claude-code/src/{cli/parse-event,sdk/map-message,session-result,capabilities,cli/build-args}.ts`,
`adapter-kit/src/types/{events,session}.ts`, `engine/src/dispatch/steps.ts` (ledger fields),
`07` §7.2/§7.3.

**Tests first.** A structured-output session returns its object; `adopt` inference yields claims
through the Claude Code adapter; ledger tokens for a real captured result equal `modelUsage` sums.

---

## P12 — Engine messages and telemetry that reach the right place [#7, #15, #21b, B]

**Mandate.** A failed command step's message combines bounded stderr and stdout tails and surfaces a
`--json` envelope's `problems`/`error.message`, dropping known runtime warning lines. Lane commit
subjects use step id + brief title (or a `FORGE_COMMIT_SUBJECT:` control token), never truncated
narration. `skipChecks` lanes carry a reason in the merge event. In-run gate telemetry is written to
the project's own event log (`FORGE_PROJECT_ROOT`), not the integration worktree's.

**Surface.** `engine/src/dispatch/steps.ts`, `dispatch/merge-checks.ts`, gate evaluation and the
launcher shim, `forge report`.

**Tests first.** A command step whose stderr is only a runtime warning reports the stdout envelope's
real problem; an in-run `G-Parity` evaluation appears in `forge report`.

---

## P13 — CLI clarity [#10, #16, #21a]

**Mandate.** `RUN-110` carries the schema issues. `forge test binding --json` gains additive notes
when the story is behaviour-preserving (all-nonBinding is expected) and a hunk reason for a
behaviourally silent revert (`--json` stays backward-compatible, 22.1 rule 4). `forge upgrade` merges
missing managed `.gitignore` entries.

**Surface.** `bin.ts`/dispatch modules, `core/src/errors/codes.ts`, `commands/upgrade/*`.

---

## P14 — Parity oracle hardening [#5, #12, #13, #17, #19]

**Mandate.** Close the root-token masking (the build chooses among a length-preserving token, a
post-rule rewrite, or provenance, and proves the choice with M16 P4's own repro set plus a new
adversarial round). Observe the candidate with `.forge/parity/` absent or read-only so a case cannot
tamper and restore. `capture` skips unobservable surfaces, mirroring `check`. Normalize runs under a
wall-clock budget (worker thread) with a typed refusal. Replace the two accepted over-restrictions
with proven-safe rules (a proof in the log, not a carve-out by intuition).

**Surface.** `cli/src/commands/parity/*`, `13` F-TEST-9.

**Tests first.** Every M16 P4 attack repro still refused or neutralised; the root-token repro now
fails as it should; a self-reverting tamper is detected; a catastrophic pattern is refused by time,
not hung.

---

## P15 — In-lane commits honour the write claim [C]

**Mandate.** Commits a session makes inside its own lane are checked against the declared write claim
at landing, exactly as uncommitted writes are; an out-of-claim path is reverted or the step fails
(per the existing policy), never landed silently.

**Surface.** `engine/src/dispatch/*` (claim check), `vcs/src/*`, Q294 D2.

---

## P16 — Windows, and the real CI infrastructure that blocks seeing it [#18]

**Mandate.** The first real push of this plan's own work (`next`, 2026-10-20/21, run `39503607194`)
surfaced real defects beyond what #18 anticipated — all 11 matrix legs failed, and none of the 3
Windows legs completed within the 45-minute job ceiling, so this piece now also closes what blocks
seeing a real signal at all, before closing #18 itself:

1. **A Node 20 incompatibility, not Windows-specific** (new, undisclosed defect, `Q340`):
   `--experimental-strip-types` does not exist on Node 20.x (confirmed live: Node 20.20.2 rejects it
   as "bad option"); every script that spawns a child process with it — `scripts/lib/schema-
   drift.mjs`, `scripts/verify-success-criteria.mjs`, `scripts/bench.test.ts`, and any sibling using
   the same pattern — fails outright on the real `node 20` leg. `specs/02` §2.1 pins Node >=20.10 as
   a tested, supported version; this is a real violation of that pin, confirmed on `ubuntu-latest`/
   `node 20`.
2. **A real bug in `scripts/verify-success-criteria.mjs`'s own pass-detection, not Windows-specific**
   (new, undisclosed defect, `Q341`): on the one leg that got furthest (`node 22, ubuntu-latest,
   TZ=Asia/Kathmandu`), the real SIGKILL-resume success-criterion test (`crash-resume.test.ts`, E3)
   genuinely passed (`1 passed (1)`, confirmed in the captured log) but the wrapper script reported
   `REFUSED: exit 0 but no test actually passed — the -t pattern (or file target) matched zero real
   tests` and failed SC3 anyway — a real, environment-specific parsing bug (likely a TTY/color-code
   assumption that only holds locally), not a real test failure.
3. **The 45-minute job ceiling is still insufficient**, confirmed live: 9 of 11 real matrix legs in
   this first real run hit it, including all 3 Windows legs and legs on every other OS too — worse
   than the single-leg-class #18 originally named. Diagnose before just raising the number again:
   `floor (node 24/22, macos-latest)` carried a real "capacity constraints … longer queue times"
   annotation, so some of this may be queue time eating the job clock rather than `pnpm test` itself
   growing slower — distinguish the two before choosing a fix (a higher ceiling, sharding `pnpm
   test` across more jobs, or both).
4. **Once 1–3 are fixed and a real matrix can complete**, close #18 itself for real: argv-array
   command spawning (no shell, so no quoting), `taskkill /T /F` process-tree kill, lifting `ENV-007`
   for the process surface, and the parity/binding/lane/test-adoption suites passing on a real
   Windows runner — fixing whatever real Windows-specific defects a COMPLETED run then surfaces (none
   have been seen cleanly yet: every Windows leg in the first real run died by timeout before
   finishing, not by a real test failure).

**Exit condition, concrete and real (narrower than the original piece's own looser framing)**:
re-push to `next`, and the full real matrix `ci.yml` currently defines (11 jobs across its OS/Node/TZ
combinations) is green, not merely "configured."

---

## P17 — `forge adopt` and `forge spec re-derive`, wired [A]

**Mandate.** Wire both verbs `03`/`17` define, on top of P11's structured output and P7's test
adoption, so an existing project can be adopted end to end — the path Phase B's trial takes.

---

## P18 — `forge migrate run`, and migrate parity made reachable [#14]

**Mandate.** Build `forge migrate run` per P1's spec (Decision 9). The `migrate` workflow's
`verify-parity` gate becomes reachable and is proven by a fixture migration.

---

## P19 — Pin-test gaps [E]

**Mandate.** Pin the 78 sentence-granularity pins to their blocks; `scanLines` handles tilde fences,
indented code and hidden `<div>`s.

---

## P20 — Docs

**Mandate.** Bringing any project's tests into FORGE (`forge test adopt`, what the agent does, the
translator proof, writing a translator by hand), trunk configuration, landing a run, retries,
worktree location, Windows support, the corrected M16 status.

---

## P21 — Live run, then freeze (owner-authorized only)

**Mandate.** Real agents, real spend, three fresh fixture projects: (1) Node with `node --test`;
(2) an in-house runner with a bespoke output format FORGE has never seen; (3) a Python project with
no test configuration at all. On each: `forge test adopt` (the agent identifies the runner, writes and
proves the translator, or proposes a runner) → `G-TestAdopt` → `forge refactor` reaching `commit` →
land on trunk. Plus a forced transient failure retried live, and ledger tokens/cost cross-checked.
Every real defect found is fixed under the gauntlet. Then tag `m17-hardened`. Does not start without
the owner's explicit authorization in the conversation.

**Closing gate, combined with P16 (owner instruction, 2026-10-21): Phase A's own `m17-hardened` tag
is one combined gate, not two independently-closeable ones.** It is not cut until BOTH P16's real
`next` CI matrix is fully green AND every real defect this piece's own live run finds is fixed under
the identical gauntlet discipline as every other M17 piece — whichever of the two finishes its own
fixes last is what actually unblocks the tag.

**`Q347` added to this same gate.** The live run itself surfaced a severe, disclosed-not-fixed
defect (`SPEC-QUESTIONS.md` `Q347`): under real `--agent` sessions' `dontAsk` permission mode,
FORGE's own `canUseTool`/`vetProposedCommand` is not reliably the enforcement point for live Bash
calls once shell operators are involved — the Claude Code CLI's own internal allow/deny resolution
can both wrongly allow a shell-chained command whose base verb merely looks granted and wrongly deny
one that should pass, in neither case ever reaching FORGE's own callback. This is not `adopt-tests`-
specific; it is the channel every `kind: agent` step's live Bash calls run through. Deliberately not
fixed under the live-run's own chain (the lesson, named twice already this milestone at `Q345`/`Q346`,
is that a fix to exactly this class of thing that looks right on paper can still be wrong until a
real, live round-trip proves otherwise) — needs its own dedicated piece with the same rigor as the
original P7 gauntlet, and `m17-hardened` does not cut until it closes.

---

## Phase B — the trial (outline; finalized after the tag)

Trial project: `~/Desktop/projects/open-interview-coder` (Electron + Vite + Vue 3, Vitest, 768/768
tests green; `npm run build` failing on one `tsc` error; core transcription loop broken). Decision 11
applies: no work on concealment.

- **P22 — Pre-registration.** The owner-authored hypothesis, success criterion and measurement window,
  committed before any trial work. The metrics are M15's; none chosen after seeing data.
- **P23 — Adopt the trial project.** `forge init`/`forge adopt` on the owner's real repository
  (confirmed before touching it; its work-in-progress branch reconciled with `main` first), baseline
  recorded.
- **P24 — The trial window.** Real work through FORGE; KB-reads-before-decision and contradiction rate
  measured week 1 → end.
- **P25 — Publish.** The result in `GAUNTLET-LOG.md`/`SPEC-QUESTIONS.md`, favourable or not, plus
  whatever adoption-cost reduction it proves necessary (fixed after the window closes).

## Exit tests (Phase A)

```
pnpm test                                        # coverage, ratchet, boundaries — must be green
node scripts/run-tests.mjs run -t "M17"
pnpm typecheck && pnpm lint && pnpm emit-schemas && pnpm schema-drift
forge test adopt --json                          # each recognised-runner fixture: proposes the expected config
forge test run --json                            # node --test, custom-runner and no-config fixtures: real outcomes
forge test binding --story <id> --json           # same, under a non-Vitest runner
forge refactor <target> --goal <text>            # master-trunk fixture: reaches commit, lands on trunk
CI on `next`: every leg green (Linux, macOS, Windows)
```

## What this milestone deliberately does not do

- Change FORGE during the trial window (Decision 10).
- A second trial to replace a disappointing first one; metrics chosen after seeing the data; claims
  the published result does not carry (`specs/22`).
- Trust any agent-written parser without the translator proof, or apply an agent-proposed test setup
  without human approval.
- Push to `main` (Decision 8).
- Build or repair concealment features — hiding an app from screen sharing, recording or proctoring
  (Decision 11).
