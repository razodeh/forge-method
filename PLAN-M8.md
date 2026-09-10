# PLAN-M8 — Verification depth: testing, debugging, review

Source: `specs/22` M8. **Build:** the test-strategy and oracle frameworks as executable content; the
normalised test-result reporter and AC binding (`09` §9.5) for at least JS/TS and Python; coverage
ratchet; oracle lint; flake detection and quarantine; the `forge debug` RCA state machine with all ten
phases, loop bounds and anti-thrash; `swarm-review` with the eight perspectives and finding
deduplication. **Do not build:** anything under `13.2`'s F-DEBUG-3 observability *preconditions*
themselves (structured logging, trace propagation — that is `14`'s delivery-framework territory, gated
at `G-Operate`, not `G-Verify`/`G-Stable`); TUI (M9); modules/sessions/adopt (M10).

**Real, already-built surface this milestone reuses rather than re-invents** (confirmed by direct
inspection, not assumed from spec prose):

- **The generic gate-evaluation mechanism** (`@forge/engine/gates`, M5 P14) — `evaluateGate` runs every
  `DeterministicCheck` as a real subprocess (`runShellCommand`, `execa`, `shell: true`, `reject: false`),
  parses its stdout as JSON, evaluates `check.failOn` via `@forge/engine/expr`. This milestone supplies
  check *content* (real CLI subcommands + `failOn` expressions), never a new evaluation mechanism.
- **`G-Ready.gate.yaml`/`G-Verify.gate.yaml`/`G-Stable.gate.yaml`** (already committed under
  `packages/templates/templates/checks/`) already name the exact CLI contract this milestone must
  satisfy, verbatim:
  - G-Ready: `story:dor` → `forge spec validate --rule definition-of-ready --json`, plus
    `story:file-claim-overlap`, `story:unbound-acceptance-criteria`, `story:oversized`, all
    `forge spec validate --rule <name> --json`, all `failOn: 'errors > 0'`.
  - G-Verify: `test:run` → `forge test run --json` (`failOn: 'failed > 0'`); `story:ac-coverage` →
    `forge test coverage --rule acceptance-criteria --json` (`failOn: 'coverage < 100'`); `test:coverage`
    → `forge test coverage --json` (`failOn: 'coverage < 80'`); `test:lint` →
    `forge test run --rule lint --json`; `test:typecheck` → `forge test run --rule typecheck --json`
    (both `failOn: 'errors > 0'`).
  - G-Stable: `defect:open-severe` → `forge spec validate --rule open-sev1-sev2-defects --json`;
    `test:flaky` → `forge test flaky --json` (`failOn: 'flaky > 0'`); `rca:unresolved` →
    `forge spec validate --rule unresolved-rca --json`.
  This is the authoritative JSON contract (field names, check ids) — where spec prose uses a different
  check-id spelling (e.g. `spec:ac-coverage` vs. the shipped `story:ac-coverage`), the already-committed
  YAML wins; the divergence is recorded in `SPEC-QUESTIONS.md`, not silently "fixed" by renaming shipped
  YAML. `13` §13.4's own gate-integration table additionally requires, for `G-Verify`, "coverage ratchet
  not violated," "oracle lint clean," and "quarantine count under cap" — **none of which appear in the
  shipped `G-Verify.gate.yaml` deterministic-check list yet.** This is a real gap the table itself
  demands closing; the pieces below add `coverage:ratchet`, `test:oracle-lint`, and
  `test:quarantine-cap` as new deterministic checks on `G-Verify`, and (per F-TEST-1 rule 5 — pyramid
  budget is a *warning*, never a hard floor) an `test:pyramid-budget` **advisory** check, not
  deterministic.
- **Every "framework as executable content" M8's Build line calls for already exists** as real,
  committed YAML under `packages/templates/templates/frameworks/`: `test-pyramid-shape`,
  `test-oracle-design`, `test-data-strategy`, `test-environment-dependency-strategy`,
  `coverage-adequacy`, `flake-control`, `agent-executable-tests`, `rca-loop`,
  `rca-loop-bounds-escalation`, `debugging-observability-precondition`, `review-perspectives`,
  `review-boundaries` — all loadable/scoreable via `@forge/methods`' already-built generic
  schema/score/level engine (M6). Every one of these files is a deliberate **one-option "execution
  step, not a decision" stub** (confirmed by reading `rca-loop.framework.yaml`,
  `review-perspectives.framework.yaml`, `review-boundaries.framework.yaml`,
  `coverage-adequacy.framework.yaml`, `flake-control.framework.yaml` directly) whose own comments punt
  the *real mechanism* to real code that does not exist yet. **This milestone's job is that real code,
  not the framework layer** — `@forge/methods`' engine itself needs zero changes.
- **`@forge/engine/interaction`'s `dispatchAgentStep`** (M6 A6) already implements all seven `05` §5.7
  interaction modes, including a real, working `swarm-review` (multi-session dispatch, exact-string
  finding dedup via `mergeReviewReport`). Gaps confirmed directly: `ReviewFinding` carries no severity
  field at all; `forge review` hardcodes 4 of F-REVIEW-1's 8 perspectives; no CFG-501
  (self-authorship) runtime check exists on this path (CFG-501 today is a *compile-time* overlay
  invariant, unrelated to a live `forge review` invocation); no "empty review is itself a finding"
  check exists.
- **`Defect`/`RCA` artifact schemas** (`packages/schemas/src/artifacts/{defect,rca}.ts`) already exist,
  complete, matching `13` §13.2's worked `RCA-007` example field-for-field. No `TEST` artifact type
  exists in the registry (by design — `09` §9.3's own "essentials" list excludes it; `TEST` is a
  synthetic graph node in `@forge/core/graph`, derived by regexing a leading `AC-\d{3,4}-\d+` id off
  each `Story.tests` string — confirmed in `packages/core/src/graph/build.ts`).
- **`forge spec matrix/trace/orphans/validate` already exist** (`packages/cli/src/commands/spec.ts`)
  but operate purely on `SpecGraph` structure — **zero connection to real test pass/fail data today**,
  and `specValidate` currently takes no `--rule` parameter at all. This milestone extends it; it does
  not replace it.
- **`forge test <plan|generate|run|report|flaky|coverage>`** (`packages/cli/src/commands/loop/test.ts`)
  is a complete stub — every subcommand throws `USR-003` unconditionally. This milestone builds `run`,
  `coverage`, and `flaky` for real (the three the shipped gates actually invoke); `plan`/`generate`/
  `report` are **out of scope** — no shipped gate check needs them, and `13`'s own Build line does not
  name test-strategy *generation* as this milestone's job (the frameworks already do that, per above).
- **`packages/cli/src/bin.ts` is a deliberately minimal argv dispatcher** (M6 C9) wiring only
  `agent validate --all`, `workflow validate --all`, `template validate --all`, `status`. Every other
  command — including everything `spec.ts`/the new `test`/`debug`/`review` work builds — exists only as
  a real, tested function taking a hand-built `*CommandContext`, with **no CLI wiring at all**. Since
  `evaluateGate`'s `CheckRunner` shells out via real `execa`, the gate contract above is unreachable
  until `forge spec validate --rule`, `forge test run/coverage/flaky` are real, invocable subcommands.
  Each piece below that a gate check depends on wires its own narrow slice into `bin.ts`, matching C9's
  own "wire exactly what's needed" discipline — this milestone does not attempt a general CLI dispatcher.
- **`scripts/lib/coverage-ratchet.mjs`** (FORGE's own repo tooling, `scripts/`, not `packages/`) is a
  real, already-tested pure-function ratchet: groups istanbul `coverage-summary.json`-shaped per-file
  data into per-package totals, compares against a baseline JSON with a 0.5pp tolerance, ratchets up
  only. Directly reusable as a **design pattern** for `coverage:ratchet`'s product-facing
  implementation — not reusable as code (it protects FORGE's own coverage, lives outside `packages/`,
  and a target project's coverage-ratchet baseline is that project's own data, not FORGE's).
- **`09` §9.8's Definition of Ready/Done** is itself a small, profile-based, machine-checked expression
  system (`dod-profiles.yaml`, worked example: `story.acceptance.length > 0`,
  `check: spec:story-refs-resolve`) — not a hard-coded rule set. No such schema/evaluator exists
  anywhere yet; P1 below builds it, reusing `@forge/methods/src/expr.ts`'s already-built bounded
  expression grammar (the same one `FrameworkDerivedInput.from` already uses) rather than
  `@forge/engine/expr` (a different package; `@forge/methods` cannot depend upward into `@forge/engine`
  per the boundary graph, and does not need that grammar's full workflow-templating power for a flat
  `story.field op value` expression).
- **No `testCommands`-shaped registry exists anywhere in `ForgeConfig`** (`packages/schemas/src/config/
  schema.ts`, read in full) despite F-TEST-1 rule 4's "every layer has a single command... recorded in
  the KB." Given every other machine-consumed value in this codebase lives in structured config/YAML
  (gates, workflows, frameworks) with the KB reserved for human-readable rationale — and given
  `executionSchema.sharedMutablePaths[].command` already stores a literal shell-command string in
  config as direct precedent — P3 below adds a small `testCommands` field to `configSchema` as the real,
  machine-parseable source of truth, and records this as a `SPEC-QUESTIONS.md` entry rather than
  silently deciding it: the KB doc becomes the human-readable *description* of the same commands, not
  the thing `forge test run` actually parses.

---

## P1 — Definition of Ready/Done: profile schema and evaluator

**Mandate:** `09` §9.8's own profile-based, machine-checked DoR/DoD system, as real, loadable,
evaluable data — the foundation `story:dor` (P2) sits on.

**Spec:** `09` §9.8.

**Surface:** `@forge/methods/dod` (new `packages/methods/src/dod/` directory, exported via
`packages/methods/src/index.ts`)
- `dodProfileFileSchema` (zod): `{ profiles: Record<string, { ready: readonly DodCheck[]; done:
  readonly DodCheck[] }> }` where `DodCheck = string | { readonly check: string }` — a plain string is
  a bounded expression (`story.acceptance.length > 0`) evaluated via `@forge/methods/expr`. **Corrected
  during build** against `09` §9.8's *full* worked example (not just the `ready` list this plan's first
  draft quoted): the real `backend-default.done` list names nine `check:` ids
  (`build:typecheck`, `spec:ac-coverage`, `security:secrets-scan`, …) that are themselves other gates'
  own deterministic checks, not a small closed set this package could ever enumerate — `{ check: id }`
  is therefore **open-ended by design**, resolved by a caller-supplied function, never a hardcoded
  dispatch table. Recorded in `SPEC-QUESTIONS.md` rather than silently changed.
- `loadDodProfile(source, sourcePath): DodParseResult` / `readDodProfile(paths, path):
  Promise<DodParseResult>` — the same discriminated `{success, ...}` result shape
  `@forge/methods/schema`'s `loadFramework`/`readFramework` already establish (never throws on
  ordinary malformed YAML); validates every plain-string check as a real, parseable expression via
  `@forge/methods/expr`'s `parseExpression` — `{ check: id }` entries are structurally validated
  (non-empty string) only, never checked against a closed set.
- `evaluateDodProfile(profileFile, profileId, phase: 'ready' | 'done', context: DodContext,
  resolveCheck: (id: string) => boolean): readonly DodViolation[]` — pure, no I/O of its own; a plain
  string is evaluated via `@forge/methods/expr`'s `evaluateCondition` against `context`; a `{ check: id
  }` entry calls the injected `resolveCheck`. **M8's own real, concrete need is `ready`-phase
  evaluation only** (`G-Ready`'s `story:dor` check, P2) — `done`-phase evaluation is real, exercised by
  this piece's own tests for completeness (the schema and evaluator both support it structurally), but
  no P2–P10 piece calls it; wiring a story's transition to `done` through it is a later milestone's job
  (the story-lifecycle-transition mechanism, not a `G-*` gate check), recorded as a `SPEC-QUESTIONS.md`
  scope note, not silently built or silently dropped.
- P2's own `resolveCheck` implementation supplies real logic for exactly the two `check:` ids the
  `ready` list's own worked example names (`spec:story-refs-resolve`, `spec:no-blocking-open-questions`)
  and a fail-closed `false` (a real, reported violation, never a silent pass) for any other id — this
  piece itself stays fully decoupled from knowing what those ids mean.

**Checks:**
- A profile with `ready: ["story.acceptance.length > 0"]` evaluated against a story with zero
  acceptance criteria produces exactly one violation naming that expression; against a story with ≥1 it
  produces none.
- A profile referencing `check: spec:no-blocking-open-questions` against a context with an open,
  blocking `OQ-###` produces a violation; resolved/non-blocking open questions do not.
- A `check: something-unresolvable` entry whose injected `resolveCheck` returns `false` (the real,
  fail-closed default for an id the caller does not recognise) produces a real, reported violation, not
  a silent pass.
- `09` §9.8's own full worked `backend-default` profile (both `ready` and `done` lists, all thirteen
  entries) round-trips through `loadDodProfile` with zero issues — proving the open-ended `{ check: id
  }` design actually parses the real spec example, which the plan's first, closed-set draft would not
  have.
- `dod-profiles.yaml`'s own worked `backend-default` profile (both `ready` and `done` lists) round-trips
  through `dodProfileSchema` without loss.

**Depends on:** none (first piece; reuses only already-shipped `@forge/methods/expr`).

---

## P2 — `forge spec validate --rule <name>`: the six G-Ready/G-Stable governance checks, CLI-wired

**Mandate:** every `story:*`/`defect:*`/`rca:*` deterministic check `G-Ready.gate.yaml`/
`G-Stable.gate.yaml` already name, real and CLI-invocable.

**Spec:** `09` §9.3 Story quality rules 3/4/6, `13` §13.4 (`G-Stable`'s open-defect/RCA conditions).

**Surface:** `packages/cli/src/commands/spec.ts` (extended) +
`packages/cli/src/commands/spec/validate-rules.ts` (new)
- `type ValidateRuleId = 'definition-of-ready' | 'file-claim-overlap' | 'unbound-acceptance-criteria' |
  'oversized-stories' | 'open-sev1-sev2-defects' | 'unresolved-rca'`.
- `specValidateRule(ctx, rule: ValidateRuleId): Promise<{ rule: ValidateRuleId; errors: readonly
  RuleViolation[] }>` — `errors` is an array (the gate's own `failOn: 'errors > 0'` reads it as a
  count via `@forge/engine/expr`'s own `length` support, the identical shape `test:lint`/`test:typecheck`
  below already use).
  - `definition-of-ready`: loads each `ready`-or-later story's `dod_profile`, runs P1's
    `evaluateDodProfile(..., 'ready', ...)`.
  - `file-claim-overlap`: rule 4 — every pair of distinct `ready`(+later) stories whose `files_expected`
    globs overlap (reuses `@forge/engine/plan`'s already-built `globsOverlap`, matching the doc-comment
    precedent already set for shared-glob detection elsewhere in this codebase — `@forge/methods` cannot
    import `@forge/engine` per the boundary graph, but `@forge/cli` can import both).
  - `unbound-acceptance-criteria`: rule 3 — every `done`(+later, i.e. `in-review`/`verified`/`done`)
    story's every AC id has ≥1 `proves` edge in `SpecGraph` (reuses the already-built graph, zero new
    edge logic).
  - `oversized-stories`: rule 6 — any `ready`(+later) story with `size: 'L'`.
  - `open-sev1-sev2-defects`: any `Defect` with `severity` in `{Sev1, Sev2}` and no `status: closed`
    (or equivalent open/closed field — confirmed against the real `defect.ts` schema during build).
  - `unresolved-rca`: any closed Sev1/Sev2 `Defect` with no linked `RCA` artifact carrying a non-empty
    `prevention` array (13 §13.2 step 9: "Sev1/Sev2 defects require a prevention action").
- `bin.ts`: wires `spec validate --rule <name> [--json]` (rejecting an unrecognised `--rule` value with
  a real, typed usage error rather than falling through to the generic "not wired" message — matching
  `requireAllFlag`'s own established precedent for a real-but-misused command).

**Checks:**
- Each of the six rules has ≥1 fixture proving a real violation is caught and ≥1 fixture proving a
  clean project produces zero errors — not just the happy path.
- `file-claim-overlap` against two `ready` stories with genuinely disjoint globs (`src/billing/**` vs.
  `src/invoicing/**`) reports zero errors; against overlapping ones (`src/billing/**` vs.
  `src/billing/preview/**`) reports exactly one.
- `unbound-acceptance-criteria` against a `done` story with an AC id that appears in no `tests` entry
  anywhere reports it; an AC bound to exactly one test does not.
- `forge spec validate --rule definition-of-ready --json` run against a real fixture project prints
  valid JSON with a top-level `errors` field readable by `@forge/engine/expr`'s `length`/comparison
  grammar exactly as `G-Ready.gate.yaml`'s own `failOn: 'errors > 0'` expects — proven by actually
  running `evaluateGate` against the real gate definition and this real command, not by reasoning about
  the JSON shape in isolation.

**Depends on:** P1 (`definition-of-ready` rule).

---

## P3 — Test-command registry + normalised test-result reporter and AC binding (JS/TS, Python)

**Mandate:** `09` §9.5's binding rule as real, executable machinery — the base every remaining `forge
test *` piece reads from.

**Spec:** `09` §9.5, F-TEST-1 rule 4, F-TEST-7 rules 1–5.

**Surface:**
- `packages/schemas/src/config/schema.ts`: `testCommandsSchema` — `{ unit?: string; integration?:
  string; contract?: string; e2e?: string; nfr?: string; lint?: string; typecheck?: string }`, all
  optional literal shell-command strings (undefined = "this layer has no command; a rule that needs it
  reports a real, typed `missing-command` finding, never silently skips"), added to `configSchema` as
  `execution.testCommands` (`.strict()`, matching every other nested object); `defaults.ts`/`docs.ts`/
  the JSON Schema emission and `scripts/assert-schema-drift.mjs` baseline updated to match — the same
  mechanical extension `sharedMutablePathSchema` already set precedent for.
- `packages/cli/src/commands/loop/test/ecosystem.ts`: `detectEcosystem(paths): Promise<'js' | 'python'
  | 'unknown'>` — real filesystem probe (`package.json` vs. `pyproject.toml`/`pytest.ini`/`setup.cfg`),
  never guesses from file extensions alone.
- `packages/cli/src/commands/loop/test/reporter.ts`: `runAndNormalize(command, cwd, ecosystem):
  Promise<NormalizedTestReport>` — shells the given `testCommands` entry via the already-shared
  `runShellCommand` (reused, not reimplemented — `@forge/cli` already depends on `@forge/engine`), reads
  the tool's own JSON output (vitest's `--reporter=json`; pytest's `--json-report` via
  `pytest-json-report`, both real, standard, already-documented reporter formats for each ecosystem —
  confirmed against each tool's own real `--help`/docs during build, not assumed), and normalises into
  `NormalizedTestReport = { readonly outcomes: readonly TestOutcome[] }` where `TestOutcome = { readonly
  name: string; readonly acId: string | undefined; readonly status: 'pass' | 'fail' | 'skip' }`.
- `packages/cli/src/commands/loop/test/ac-binding.ts`: `extractAcId(testName: string): string |
  undefined` — the "generic fallback" `09` §9.5 explicitly sanctions: a real regex pull of a leading
  `AC-\d{3,4}-\d+` token, the *same* pattern `@forge/core/graph`'s own `TEST_NAME_AC_IDS` regex already
  uses (confirmed identical, not reinvented) so a name that satisfies the graph's own `proves` edge also
  satisfies this reporter.
- Writes `docs/forge/reports/test-results.json` (`{ v: 1, outcomes: [...] }`) via `@forge/core`'s
  already-built atomic FS write helpers.

**Checks:**
- A real vitest fixture project run through `runAndNormalize` with `--reporter=json` produces outcomes
  whose `acId` correctly extracts from a name like `"AC-014-2 returns 422 for an empty invoice"` and is
  `undefined` for a name with no AC prefix.
- A real pytest fixture project (`@pytest.mark.forge_ac("AC-014-2")`-annotated AND a plain
  AC-prefixed-name test with no marker) both bind correctly — the marker path and the regex-fallback
  path each get their own fixture.
- `testCommands.unit` undefined on a real config produces a typed `missing-command` result, not a
  thrown exception or a silent empty report.
- `docs/forge/reports/test-results.json` round-trips: written then re-read produces the identical
  `NormalizedTestReport`.

**Depends on:** none structurally (P1/P2 are a parallel track); ordered before P4–P7 because they all
read this piece's reporter.

---

## P4 — `forge test run` (+ `--rule lint`/`--rule typecheck`), CLI-wired

**Mandate:** `test:run`/`test:lint`/`test:typecheck` — every `G-Verify` check that isn't coverage or
flake-related.

**Spec:** F-TEST-7.

**Surface:** `packages/cli/src/commands/loop/test/run.ts` (replaces the `run`/`lint`/`typecheck` arms
of the current `USR-003` stub in `loop/test.ts`)
- `testRun(ctx, options: { rule?: 'lint' | 'typecheck' }): Promise<{ failed: number; errors: number;
  outcomes?: readonly TestOutcome[] }>` — default (no `--rule`): shells `testCommands.unit` (falling
  back to running every declared layer command in `testCommands` the project actually has, per F-TEST-1
  rule 4's "one command per layer" — the exact aggregation policy, e.g. unit+integration vs. unit only
  by default, is a real, judgement-bearing default recorded in `SPEC-QUESTIONS.md`, not left implicit),
  runs it through P3's `runAndNormalize`, writes `test-results.json`, reports `{ failed }` (count of
  `status: 'fail'` outcomes) for `G-Verify`'s own `test:run` check. `--rule lint`/`--rule typecheck`:
  shells `testCommands.lint`/`testCommands.typecheck` directly (these tools' own exit code and
  stderr/stdout, not the test-outcome normaliser — a linter/typechecker has no AC-bound "outcomes"),
  reporting `{ errors: N }` (parsed from the tool's own real machine output where one exists — eslint's
  `--format json`, `tsc`'s own diagnostic count — never a bare exit-code-to-boolean collapse that would
  make a 40-error and a 1-error run indistinguishable).
- `bin.ts`: wires `test run [--rule lint|typecheck] [--json]`.

**Checks:**
- Against a real fixture project with one deliberately failing unit test, `forge test run --json`
  reports `failed: 1`; a clean fixture reports `failed: 0`.
- `--rule lint` against a fixture with a deliberate lint violation reports `errors: 1` via the linter's
  own real JSON output, not a guessed count.
- `--rule typecheck` against a fixture with a deliberate type error reports `errors ≥ 1`.
- Running `evaluateGate` against the real `G-Verify.gate.yaml`'s `test:run`/`test:lint`/`test:typecheck`
  entries and this real command against both a clean and a broken fixture produces the correct
  `passed`/`failed` gate outcome end-to-end.

**Depends on:** P3.

---

## P5 — Oracle lint (F-TEST-2 banned patterns), `G-Verify`-wired

**Mandate:** `test:oracle-lint` — the check `13` §13.4 names for `G-Verify` that the shipped gate YAML
is still missing.

**Spec:** F-TEST-2.

**Surface:** `packages/cli/src/commands/loop/test/oracle-lint.ts`
- `runOracleLint(paths, testGlobs): Promise<{ errors: number; violations: readonly
  OracleLintViolation[] }>` — a real, deterministic **source-text scanner** over the project's own test
  files (deliberately *not* a new ESLint plugin package: F-TEST-2's five banned patterns are
  overwhelmingly syntactic/textual — `toBeDefined()`/`toBeTruthy()` as the sole assertion, a bare
  `try { … } catch { /* pass */ }`, unconditional `expect(true)`, a golden-file write with no approval
  header — and a lightweight, directly-unit-testable line/pattern scanner is proportionate scaffolding
  where a full AST-walking plugin package would not be; this trade-off and its one genuinely
  heuristic-only pattern (constants-derived-from-implementation, flagged as best-effort with a
  documented false-negative rate) are recorded in `SPEC-QUESTIONS.md`, not silently decided).
  Implements 4 of the 5 banned patterns with real precision; "asserting on a value read from the same
  code path that produced it" is explicitly **not** attempted (undecidable from source text alone
  without real dataflow analysis — recorded as a known, permanent gap, not a stub).
- `bin.ts`: wires `test run --rule oracle-lint [--json]` (reported as `{ errors }`, matching P4's own
  `--rule` shape rather than inventing a sibling command).
- `packages/templates/templates/checks/G-Verify.gate.yaml`: adds `test:oracle-lint` → `forge test run
  --rule oracle-lint --json`, `failOn: 'errors > 0'`.

**Checks:**
- A fixture test file whose only assertion is `expect(result).toBeDefined()` is flagged; one with a
  real value assertion alongside is not.
- A fixture with `try { risky() } catch {}` (empty catch, no assertion) is flagged.
- A fixture with `expect(true).toBe(true)` unconditionally is flagged.
- A fixture snapshot test with no recorded approval header is flagged; one with a real
  `// approved-by: <person> against AC-014-2`-shaped header is not.
- A clean, well-oracled fixture test file produces zero violations — not just that bad files fail.

**Depends on:** P4 (reuses its `--rule` CLI shape and JSON conventions).

---

## P6 — Coverage collection, AC coverage, and the coverage ratchet

**Mandate:** `story:ac-coverage`, `test:coverage`, and the still-missing `coverage:ratchet` check `13`
§13.4 names for `G-Verify`.

**Spec:** F-TEST-5, `09` §9.5's AC-coverage binding metric.

**Surface:** `packages/cli/src/commands/loop/test/coverage.ts` +
`packages/cli/src/commands/loop/test/ratchet.ts`
- `testCoverage(ctx, options: { rule?: 'acceptance-criteria' | 'ratchet' }): Promise<{ coverage?:
  number; regressions?: number }>` — default: reads the target project's own istanbul-shaped
  `coverage-summary.json` (wherever its `testCommands.unit`/`integration` runner already wrote it —
  never runs coverage collection itself; that is the declared command's own job), reports overall line
  `coverage` as a 0–100 number for `G-Verify`'s flat `test:coverage` floor. `--rule
  acceptance-criteria`: cross-references P3's `test-results.json` AC bindings against every `done`(+)
  story's AC ids from `SpecGraph` — `coverage = 100 * (ACs with ≥1 passing bound test) /
  (total ACs of done stories)`.
- `evaluateRatchet(achieved: PackageCoverageTotals, baseline: RatchetBaseline): { regressions:
  readonly string[]; raised: readonly string[]; next: RatchetBaseline }` — a real, pure, directly
  ported design (not a shared import — `scripts/lib/coverage-ratchet.mjs` lives outside `packages/` and
  protects FORGE's own suite) from the already-proven `scripts/lib/coverage-ratchet.mjs` pattern: per
  package/path-prefix totals, 0.5pp tolerance, never lowers a baseline, only raises it on genuine
  improvement. `--rule ratchet` reads/writes the baseline at `docs/forge/reports/coverage-baseline.json`
  in the *target* project (not FORGE's own `coverage-ratchet.json`), reports `{ regressions:
  regressions.length }`.
- `packages/templates/templates/checks/G-Verify.gate.yaml`: adds `coverage:ratchet` → `forge test
  coverage --rule ratchet --json`, `failOn: 'regressions > 0'`.
- `bin.ts`: wires `test coverage [--rule acceptance-criteria|ratchet] [--json]`.

**Checks:**
- `evaluateRatchet` against a baseline of 82% and an achieved 81.4% (within the 0.5pp tolerance) reports
  no regression; an achieved 80% does.
- `evaluateRatchet` against an achieved 90% *raises* the stored baseline for that package (ratchets up,
  never down) and the returned `next` reflects it.
- `--rule acceptance-criteria` against a fixture with one `done` story's AC bound to a passing test and
  another `done` story's AC with no bound test at all reports `coverage < 100`, naming which AC is
  missing.
- A malformed/missing `coverage-summary.json` produces a real, typed "no coverage data" finding, not a
  thrown exception or a silently-reported `coverage: 100`.

**Depends on:** P3 (AC binding), P4 (shares the `--rule` CLI conventions and `bin.ts` wiring pattern).

---

## P7 — Flake detection and quarantine

**Mandate:** `test:flaky` (`G-Stable`) and the still-missing `test:quarantine-cap` (`G-Verify`, per `13`
§13.4).

**Spec:** F-TEST-6.

**Surface:** `packages/cli/src/commands/loop/test/flaky.ts`
- Extends P4's `testRun` with a real retry-once-in-isolation classification step: any outcome that
  failed on the first pass is re-run alone (by name/file, whatever `testCommands.unit`'s own tool
  supports for single-test selection); consistent failure across both runs = real failure (unchanged
  `failed` count from P4); pass-on-retry = a flake **candidate**, recorded, never silently turned green
  (F-TEST-6's own explicit "retries are never used to make a gate pass" — the *original* failing run
  still counts in that invocation's own `test:run` result; only the rolling-rate bookkeeping below
  changes).
- `docs/forge/reports/flaky.json` (`{ v: 1, tests: Record<testId, { outcomes: readonly ('pass' |
  'fail')[] /* rolling last-20 window */; quarantined: boolean }> }`) — updated after every `forge test
  run` invocation, read/written via `@forge/core`'s atomic FS helpers (concurrent-safe, matching every
  other durable-state file in this codebase).
- `computeFlakeRate(outcomes: readonly ('pass' | 'fail')[]): number` — pure, rolling failure rate over
  the last 20 entries (fewer than 20 recorded runs uses whatever window exists — never fabricates
  history).
- `testFlaky(ctx): Promise<{ flaky: number; quarantined: number }>` — `flaky`: count of tests currently
  above the 2% default threshold (matches `G-Stable`'s own zero-tolerance `failOn: 'flaky > 0'` — by
  `G-Stable`, every flake must be paid down, quarantine or not). `quarantined`: count of tests over the
  cap-relevant quarantine set (default cap 5) — exceeding the cap is reported distinctly so
  `test:quarantine-cap`'s own `failOn` can key off it without conflating "some flakes exist" with "too
  many are quarantined."
- `bin.ts`: wires `test flaky [--json]`.
- `packages/templates/templates/checks/G-Verify.gate.yaml`: adds `test:quarantine-cap` → `forge test
  flaky --rule quarantine-cap --json`, `failOn: 'quarantined > 5'`.

**Checks:**
- `computeFlakeRate` against a synthetic 20-entry window with 1 failure reports 5%; with 0 failures
  reports 0%.
- A test whose rolling rate crosses the 2% default threshold is marked `quarantined: true` on the next
  `forge test run`; one that drops back below is not immediately un-quarantined without real
  justification (quarantine exit policy is a real, explicit design decision made during build, recorded
  in `SPEC-QUESTIONS.md` — F-TEST-6 does not specify an exit condition).
- A project with 6 quarantined tests reports `quarantined: 6` and a real `G-Verify`
  `test:quarantine-cap` evaluation against it fails (`6 > 5`); one with 5 passes.
- Retrying a genuinely, consistently-failing test never removes it from `test:run`'s own `failed` count
  — proven directly against P4's `testRun`, not asserted in isolation.

**Depends on:** P4 (retry hooks into its run loop), P3 (per-test identity for the rolling window).

---

## P8 — The `forge debug` RCA loop engine: ten phases, loop bounds, anti-thrash

**Mandate:** F-DEBUG-1/2 as real, bounded control flow — replacing the current "one unstructured
`diagnostician` agent turn budgeted at `maxTurns: 45`" with a real state machine that enforces the hard
gates the spec actually requires (no fix before a reproduction exists; three hypotheses minimum; a
repeated fix diff is refused, not re-attempted).

**Spec:** F-DEBUG-1, F-DEBUG-2.

**Surface:** `@forge/engine/rca` (new `packages/engine/src/rca/` directory: `loop.ts`, `bounds.ts`,
`anti-thrash.ts`, `types.ts`)
- `runRcaLoop(defect: DefectContext, deps: RcaLoopDeps): Promise<RcaLoopResult>` where `RcaLoopDeps`
  injects everything the loop needs to stay unit-testable against a fake: `runSession` (one real or
  fake agent turn, the same shape `runParticipantSession` in `@forge/engine/interaction` already
  establishes — reused directly, not reimplemented, since `@forge/engine/rca` sits in the same package),
  `runShell` (for REPRODUCE/PROVE's real command execution), `clock`, `now`.
- `RcaLoopResult` is a real discriminated union: `{ outcome: 'recorded'; record: RcaRecordDraft } |
  { outcome: 'needs-more-evidence'; instrumentationPlan: readonly string[] } | { outcome: 'escalated';
  reason: string; evidence: RcaEvidenceBundle }` — matching F-DEBUG-1 step 2's own explicit "this is a
  legitimate, useful outcome, not a failure" framing; the CLI layer (P9) decides what to *do* with each
  outcome, this function only ever reports what happened.
- The loop itself, phase by phase, as real control flow (not a single long agent prompt):
  - INTAKE: normalises the input `DefectContext` — refuses (typed error, not a thrown crash) if it
    cannot state "expected X, observed Y."
  - REPRODUCE: up to 5 attempts (`bounds.ts`'s `MAX_REPRODUCTION_ATTEMPTS`), each attempt a real command
    or generated-test run via `runShell`; exhausting the bound exits to `needs-more-evidence` with a
    real instrumentation-gap list, per F-DEBUG-2's own table — never silently proceeds to FIX without a
    real reproduction (the hard gate F-DEBUG-1 step 2 names explicitly).
  - ISOLATE: narrows scope; feeds HYPOTHESISE.
  - HYPOTHESISE/FALSIFY: requires ≥3 distinct hypotheses (a real, enforced count, not advisory);
    up to 3 rounds (`MAX_HYPOTHESIS_ROUNDS`) if all three survive or all three die; exceeding the bound
    escalates per F-DEBUG-2's table ("stronger model, then human, with the evidence file" — this piece
    reports the escalation `evidence` bundle; the actual "call a stronger model" policy is a P9/CLI
    concern, not this engine's).
  - DIAGNOSE: five-whys stop rule as a real loop-until-condition (stops at a decision/missing-check/
    wrong-assumption, not at a fixed depth) — bottoming out at "a typo" for a Sev1/Sev2 defect is a real,
    checked condition that forces one more why.
  - FIX: up to 3 attempts (`MAX_FIX_ATTEMPTS`); every attempted fix diff is hashed
    (`anti-thrash.ts`'s `hashFixDiff`, a real normalised hash — whitespace/comment-insensitive, matching
    F-DEBUG-2's own "near-identical diff (normalised)" wording) and checked against every prior attempt
    in this run; a repeat is refused outright (the loop is forced back to ISOLATE with a real, explicit
    "hypothesis space exhausted" note, never silently retried) — this is F-DEBUG-2's anti-thrash rule as
    real enforcement, not a comment. Exhausting the bound reverts every fix attempt and escalates.
  - PROVE: the REPRODUCE-phase reproduction now passes; for a race-condition diagnosis specifically, the
    proof additionally requires the fix to fail reliably when reverted in a scratch worktree (F-DEBUG-1
    step 8's own "otherwise the proof proves nothing" requirement, real, not a TODO).
  - PREVENT: Sev1/Sev2 defects require ≥1 real prevention action in the returned draft; the loop refuses
    to reach RECORD without one for those severities (F-DEBUG-1 step 9's own "closing one without a
    prevention action is refused").
  - Wall-clock (45 min) and cost-budget checks (`bounds.ts`) are real, checked at every phase boundary,
    not only at the end — a breach checkpoints and reports `escalated` with whatever partial evidence
    exists, never leaves a silent partial run.
- RECORD is deliberately **not** this piece's job — it returns an `RcaRecordDraft` (every field
  `rca.ts`'s real schema needs); writing the actual `RCA-###` artifact is P9's CLI-layer concern (the
  same "engine reports, CLI persists" split `@forge/engine/interaction` already uses).

**Checks:**
- A fake `runShell` that always fails REPRODUCE exhausts the bound and returns `needs-more-evidence`
  with a non-empty instrumentation plan — never attempts FIX.
- A fake session sequence that proposes fewer than 3 distinct hypotheses is rejected by the engine
  itself (a real, enforced minimum), not merely documented as a should.
- Two FIX attempts whose diffs differ only in whitespace/comments hash identically and the second is
  refused with an "exhausted" outcome, forcing re-ISOLATE — proven with a real
  whitespace-only-diff fixture, not just byte-identical ones.
- A Sev1 defect whose diagnosis reaches PREVENT with an empty prevention list is refused (typed error),
  a Sev3 is not required to supply one.
- A wall-clock fake clock that advances past 45 minutes mid-loop produces an `escalated` outcome with
  the real evidence gathered so far, not a hang or a silent success.
- The full happy path (a fake defect with a real, findable single-hypothesis-confirms-on-first-round
  bug) produces a `recorded` outcome whose `RcaRecordDraft` fields validate against the real `rcaSchema`
  from `packages/schemas/src/artifacts/rca.ts` unmodified.

**Depends on:** P4 (PROVE's real "affected test layer passes" check calls `forge test run`, injected via
`runShell` rather than imported directly — keeps `@forge/engine/rca` decoupled from `@forge/cli`, which
the boundary graph forbids it depending on anyway).

---

## P9 — `forge debug` CLI integration: real RCA-### artifacts, real lane fixes

**Mandate:** wire P8's engine to the real world — a real defect in, a real fix committed to a real lane,
a real `RCA-###` artifact out.

**Spec:** F-DEBUG-1 steps 7/8/10, `03` §3.2.5.

**Surface:** `packages/cli/src/commands/loop/debug.ts` (rewritten)
- `debugSymptom`/`debugFromFailure` (existing scaffolding kept — real `Defect` artifact creation is
  already correct and unaffected) now call `runRcaLoop` directly instead of `runWorkflow(debug.workflow
  .yaml)` — the same "a real, already-built mechanism exists; call it directly, no synthetic workflow
  document" precedent `forge review` already set, recorded as this piece's own `SPEC-QUESTIONS.md`
  entry (naming exactly why `debug.workflow.yaml`'s `run-rca`/`fix`/`prove-fix`/`record` four-step shape
  is superseded, and what happens to the now-orphaned workflow file — most likely deleted, matching
  "no scaffolding for its own sake," but decided during build against the real diff, not pre-decided
  here).
- `runRcaLoop`'s injected `runSession` is backed by a real `runAgentStep`-driven lane for the FIX phase
  specifically (the one phase that writes real files — every other phase's sessions are read-only,
  matching `runParticipantSession`'s own established scope) and read-only participant sessions
  otherwise; `runShell` is backed by the real `runShellCommand`.
- On a `recorded` outcome: writes the real `RCA-###` artifact via `writeArtifact` (schema-validated
  against `rcaSchema`, not hand-assembled front matter).
- On `needs-more-evidence`/`escalated`: writes no RCA artifact; reports the real outcome (instrumentation
  plan / evidence bundle) to the caller — `forge debug`'s own exit code/output distinguishes all three
  outcomes, never collapses `escalated` into a generic failure.
- `debug.workflow.yaml`: updated or removed to match whatever this piece's own `SPEC-QUESTIONS.md` entry
  decides.

**Checks:**
- A real, seeded defect (a genuinely broken fixture function with an obvious single root cause) run
  through `forge debug` end-to-end against a fake adapter produces a real `RCA-###` artifact that
  validates against `rcaSchema`, with a fix genuinely present in the resulting lane/merge.
- `--from-failure <runId>` against a real prior failed run's event log still produces the correct
  `Defect` scaffold (this existing behaviour is unchanged — a regression test, not new coverage).
- An `escalated` outcome (forced via a fake session that never falsifies any hypothesis) produces a real,
  non-zero, distinguishable exit code/output and writes no `RCA-###` artifact.

**Depends on:** P8.

---

## P10 — `swarm-review`: the real eight perspectives, severity, self-authorship, and the empty review

**Mandate:** close every gap the inventory found in the already-working `swarm-review` mechanism against
F-REVIEW-1/2's actual normative text.

**Spec:** F-REVIEW-1, F-REVIEW-2.

**Surface:** `packages/engine/src/interaction/types.ts` + `dispatch-agent-step.ts` (extended) +
`packages/cli/src/commands/loop/review.ts` (updated)
- `ReviewFinding` gains `severity: 'blocking' | 'major' | 'minor'` — each perspective session's
  `outputSchema` is extended from `{type: 'array', items: {type: 'string'}}` to an array of `{summary,
  severity}` objects; `findingsFromSession` and `mergeReviewReport` updated accordingly. On a
  collision (two perspectives reporting the same summary text), the merged finding keeps the **more
  severe** of the two ratings, not an arbitrary first-write-wins — a real, deliberate policy decision
  (the alternative, requiring matching severities, would silently drop a legitimate more-severe report;
  recorded once in code comments, not re-litigated in `SPEC-QUESTIONS.md` since it follows directly from
  "blocking findings must be resolved," i.e. under-reporting severity is the one failure mode that
  matters here).
- `DEFAULT_REVIEW_PERSPECTIVES` in `review.ts` becomes the real, fixed F-REVIEW-1 eight: `spec-
  conformance, design, correctness, security, performance, testing, operability, documentation`
  (replacing the current four) — each perspective's own prompt embeds that row's real "Asks" text from
  the `13` §13.3 table, not a bare label, so a participant session has the actual checklist question to
  answer.
- A real runtime CFG-501 check: `forge review` (and `dispatchSwarmReview` generally) refuses to dispatch
  when the reviewing agent id equals the authoring agent id for the diff under review (the compile-time
  CFG-501 invariant covers *overlay configuration*, never a live per-invocation check — this is the
  missing runtime half, using the real `ForgeError('CFG-501', ...)` code that already exists rather than
  allocating a new one).
- "Empty review is itself a finding": each perspective's structured output additionally carries
  `checked: readonly string[]` (what it actually examined); `mergeReviewReport` synthesises one extra
  `ReviewFinding` (`severity: 'minor'`, summary naming the perspective) whenever a perspective reports
  zero findings **and** an empty/missing `checked` list — a perspective with real findings, or with zero
  findings but a real, populated `checked` list, is not flagged (matching F-REVIEW-2's own literal
  "no findings *and* no evidence of having examined the failure paths").

**Checks:**
- Two perspectives reporting byte-identical summary text at `major` and `blocking` respectively merge
  into one finding at `blocking` — proven directly, not just asserted as intended.
- `forge review` invoked with the reviewing agent id equal to the diff's own last-committing agent id
  (from the real commit trailer) is refused with `CFG-501` before any session is dispatched — zero
  wasted sessions on a review that was always going to be refused.
