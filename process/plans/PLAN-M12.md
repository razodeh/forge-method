# PLAN-M12 — Release readiness

Source: `specs/22` M12. **Build:** `forge upgrade` with the full migration path and backups; `forge
export` (markdown-bundle, html); the performance benchmark suite with ratchets; Windows CI green;
documentation (README, getting-started, the method guide, the authoring guide, the adapter guide);
changesets release pipeline with provenance. **Depends on M11** (`22` §22.2's own sequencing:
`M10 ── M11 ── M12`, the terminal milestone before v1.0).

## The real, central finding this plan is built around

Three parallel research passes (before this plan was drafted) confirmed something the M12 spec's own
"Build" line does not literally name but that every one of its Acceptance criteria depends on: **the
real CLI dispatcher (`packages/cli/src/bin.ts`) wires only 6 of the ~30+ already-built, already-tested
commands this codebase has shipped since C1.** Not even `forge init` — SC1's own literal subject
("`npx forge-method init` on an empty directory... produces a complete Stage-1 plan") — is reachable
from a real shell today. `bin.ts`'s own doc comment discloses this as a deliberate M6 C9 scope boundary,
not an oversight: M6's own exit test only needed `agent validate --all`/`workflow validate --all`/
`template validate --all`/`--json status`, so nothing more was wired, and M8 P2/P4 added `spec validate
--rule`/`test run`/`test coverage`/`test flaky` narrowly because gate YAML files shell them directly.
Every other command (`init`, `run`/`resume`/`pause`/`abort`/`lanes`/`logs`/`gate`/`merge`, `implement`/
`debug`/`refactor`/`deploy`/`review`/`panel`/`ask`/`session`, `doctor`, `upgrade`, `module`, `overlay`,
`config`, `cost`, `export`, `uninstall`, `kb`, `spec new`, `adr`, `diagram`, `customize`, `compile`,
`preset`, `skill`, `mcp`, `audit`, `help`) exists only as a real, hand-tested plain function taking a
hand-built `*CommandContext` — never invoked through argv.

**This is the single largest, most foundational piece of M12, not a footnote.** `01` §1.8's SC1, SC2,
SC4, SC6, SC7, SC9 all name a literal `forge <verb>` invocation as their own proof; M12's own Acceptance
line's `npx forge-method@next works from a clean machine` and the Exit tests' own
`scripts/verify-success-criteria.mjs` cannot produce real evidence for any of them while the commands
they name are unreachable except through a test harness calling the function directly. Wiring the
dispatcher is therefore promoted from M6 C9's deliberately-deferred scope to M12's own first, blocking
subsystem — everything else in this plan (benchmarks, docs, the release pipeline, SC-verification)
either depends on it directly or is much harder to demonstrate honestly without it.

## Other real, pre-existing gaps and built-more-than-expected surfaces confirmed by direct inspection

- **`forge upgrade` is substantially built already** (M6 C7: `packages/cli/src/commands/upgrade/
  {run-upgrade,backup,migrate-artifacts,version,types,index}.ts`), not the from-scratch build the
  spec's own Build line phrasing might suggest. Real gaps, confirmed: (1) the backup format is a plain
  recursive directory copy, not `.tar.gz` as `03` §3.4 step 3 literally says (a disclosed, deliberate
  deviation per `SPEC-QUESTIONS.md` Q110 — no tar/archive library exists in this workspace yet); (2) no
  `forgeVersion` field exists anywhere in the real `Manifest` type, so "installed version" is derived
  from module rows instead (also Q110, also disclosed); (3) **the real, load-bearing gap**: `03` §3.3's
  own idempotency rule (a `forge:generated v=<ver> hash=<sha>` header on every generated file, with
  `keep-mine`/`take-theirs`/`merge`/`show-diff` conflict resolution on a hash mismatch) is entirely
  unimplemented — `runInit`'s `already-initialized` result just stops, and `runUpgrade` unconditionally
  regenerates content with no header/hash comparison at all. Re-running `forge init` on an existing
  project, or upgrading one with local edits to a generated file, has no real conflict-resolution path
  today.
- **`forge export`'s two real M12-named targets are already fully built and spec-compliant**
  (`exportMarkdownBundle`/`exportHtml` in `packages/cli/src/commands/export.ts`, reusing `@forge/kb`'s
  `parseKbTree` and `@forge/diagrams/render`'s `renderHtml` — no new rendering code needed).
  `exportThirdParty`'s `USR-003` for `jira`/`linear`/`github-issues` is `03` §3.2.7's own literal v1
  scope line ("first two + dry-run for the rest"), not a stub gap. The only real gap is dispatcher
  wiring, covered above.
- **No performance benchmark infrastructure exists at all** — no `pnpm bench` script, no ratchet
  mechanism for anything but test coverage (`scripts/check-coverage-ratchet.mjs` is coverage-only).
  `21` §21.5 fully specifies five numeric targets needing a real harness: cold start (`npx
  forge-method --version` < 1.5s warm cache), first frame (`forge status` < 400ms @ 100 artifacts),
  compile (< 1s @ 5 layers), KB pack (< 300ms @ 500 entries), index rebuild (< 5s @ 1000 entries) — plus
  a memory E2E assertion (Supervisor RSS < 400MB @ 4 lanes) and a ratcheted CLI bundle-size check.
- **CI already runs Windows from M1** (`.github/workflows/ci.yml`'s matrix: `ubuntu-latest`,
  `windows-latest`, three Node versions) — **but macOS is missing from the matrix entirely**, despite
  `21` §21.6 naming `ubuntu-latest, macos-latest, windows-latest` and M12's own Acceptance line wanting
  "the full matrix (3 OS × 3 Node)." Separately, **12 real `it.skipIf(...win32...)` call sites across 8
  test files** (`audit.test.ts`, `doctor/fix.test.ts`, `manifest.test.ts`, `overlay-fetch.test.ts`,
  `claims.test.ts` ×2, `git.test.ts`, `events.test.ts` ×5, `s12-orphan-free-crash.test.ts`) are real,
  currently-undischarged Windows gaps — almost all gated on Unix permission-bit semantics
  (`process.getuid?.()`) that don't map to Windows ACLs. `22` §22.1 rule 1 ("a skipped test... is a lie
  about coverage") means each needs either a real Windows-equivalent test or an explicit, named,
  permanent justification — not silence.
- **`scripts/verify-success-criteria.mjs` does not exist** — confirmed, a genuine from-scratch build.
- **No user-facing documentation exists at all**: no root `README.md`, no `docs/` directory, nothing
  matching "getting-started," "method guide," "authoring guide," or "adapter guide" anywhere. A
  from-scratch build, not a revision — and since nothing exists yet, there is no stale
  `@forge/adapter-codemachine` reference to correct (the descoping is simply the truth to write from
  the start).
- **The changesets release pipeline is partially scaffolded, not built.** `@changesets/cli` is a real
  root devDependency with a working `changeset` script and a configured `.changeset/config.json`
  (`access: public`, fixed `@forge/*`), but there is no `.github/workflows/release.yml` (or equivalent)
  running `changeset version`/`changeset publish`, and `ci.yml`'s own `permissions:` block has no
  `id-token: write` — required for real npm provenance (`02` §2.4's own literal pipeline: "changesets →
  version PR → tag → `npm publish --provenance`"). This is real, from-scratch CI/release work.
- **The CLI package cannot be published at all today, independent of the release pipeline.** Every
  package under `packages/*`, `@forge/cli` included, is `"private": true`. `@forge/cli`'s own
  `package.json` `name` field is `@forge/cli`, not `forge-method` (`02` §2.1's own tree comment names
  `forge-method` as the intended published name). No build step produces a `dist/` — `bin/forge.mjs`
  execs `src/bin.ts` directly via Node's native TS-stripping. `specs/23` open decision #1 (name/scope
  availability on npm) was never confirmed resolved. All of this needs a real decision before "publish
  a real v1.0" is possible, not just a flag flip.

## Real Surface deviations and decisions this plan commits to before building

- **The dispatcher is one new file, not a rewrite of `bin.ts`'s existing wiring.** `bin.ts`'s own
  already-wired commands (`agent validate --all`, `workflow validate --all`, `template validate --all`,
  `status`, `spec validate --rule`, `test run/coverage/flaky`) stay exactly as they are — gate YAML
  files shell these by exact invocation shape today, so changing their argv surface would break
  `G-Ready`/`G-Verify`/`G-Stable`. New commands are added as new `if` branches (or a small dispatch
  table, decided concretely by P1's own investigation) in the same file, following the same
  `*CommandContext`-construction pattern every already-wired branch uses.
- **Flag shape for each newly-wired command is decided against that command's own existing tests and
  the relevant spec section (`03` primarily), not invented fresh** — every command function already has
  a real, tested parameter shape; the dispatcher's job is argv-to-parameters translation and
  output/exit-code formatting matching the conventions `runStatusCommand`/`runTestRunCommand` etc.
  already establish (human-readable by default, `--json` stable-contract on the flag, non-zero exit on
  any real problem).
- **The `forge:generated` header/hash conflict-resolution mechanism is new, shared infrastructure**,
  not duplicated between `init` and `upgrade` — a single module (`packages/cli/src/generated-header.ts`
  or similar, exact location decided by its own piece) both writers call to stamp the header and both
  readers call to detect a hash mismatch, since `03` §3.3 and §3.4 both need the identical mechanism.
- **The backup-format and `forgeVersion`-field deviations (Q110) are accepted as final, not revisited**
  — no tar dependency is added, no new persisted manifest field is retrofitted, unless a piece's own
  investigation finds a concrete downstream reason M12 specifically needs either (recorded either way).
- **Documentation is hand-written Markdown committed to a new root `docs/` directory** (plus
  `README.md` at the repo root) — no doc-generation tooling is introduced; this milestone's own Build
  line names five documents, not a documentation *system*.
- **The release workflow targets npm's real OIDC-based provenance** (`id-token: write` permission,
  `npm publish --provenance`), gated behind whatever `specs/23` open decision #1's own resolution turns
  out to be for the real package name — investigated concretely by that piece, not assumed.

---

## P1 — The real CLI dispatcher: run lifecycle + init

**Mandate:** wire the commands SC1-SC3, SC7's own literal proof commands depend on — the single most
load-bearing family, built first so every later piece's own "does this genuinely work end-to-end"
check has a real CLI to run against.

**Spec:** `03` (relevant per-command sections), `22` §22.1 rules 3/4.

**Surface:** `packages/cli/src/bin.ts` (extended)
- `forge init` (real argv → `InitOptions` translation, per `03` §3.3 and `packages/cli/src/init/
  types.ts`'s own already-real shape) — including detecting `already-initialized` and reporting it
  honestly (not yet resolving conflicts — that is P3's own mandate).
- `forge run <workflow> [--stage <level>]`, `resume`, `pause`, `abort`, `lanes`, `logs`, `gate`,
  `merge` — every already-real function under `packages/cli/src/commands/run/`.

**Checks:** `npx forge-method init` (via the real local bin) on a fresh empty directory produces the
real Stage-1 artifact set SC1 names, with a real, non-zero exit and readable error on a bad flag; `forge
run build --stage mvp` genuinely dispatches a real run (against a real or fake adapter per the test's
own harness) and `resume`/`pause`/`abort`/`gate`/`merge`/`lanes`/`logs` are each exercised against a
real run's own real state, not merely parsed and discarded.

**Depends on:** nothing new outside already-real command functions.

---

## P2 — The real CLI dispatcher: module/overlay/distribution + doctor/audit/upgrade/export/config/cost

**Mandate:** wire M10/M11's own real distribution, security, and lifecycle surface — SC9's own literal
proof command (`forge overlay add`/apply) and M12's own named `upgrade`/`export` targets both live here.

**Spec:** `03`, `19` §19.5, `20` §20.9, `21` E10.

**Surface:** `packages/cli/src/bin.ts` (extended)
- `forge module add/remove/update`, `forge overlay add`, `forge upgrade [--dry-run] [--to <version>]`,
  `forge export <target>`, `forge doctor [--fix] [--rebuild-index] [--json]`, `forge audit [--since
  <date>] [--json]`, `forge config <get|set|edit>`, `forge cost`, `forge uninstall`.

**Checks:** each command's own existing test-level behavior is reachable identically through real argv
— a real `forge module add <source>` end-to-end against a real local-channel fixture; `forge doctor
--fix` against a real `corrupt-state/` fixture (reusing `21` E10's own fixture, per M11 P14); `forge
audit --json` output validates against its own real schema; `forge upgrade --dry-run` reports without
writing.

**Depends on:** P1 (shares the same dispatcher file; sequenced, not parallel, to avoid two pieces
racing edits to `bin.ts`'s own `main()` function).

---

## P3 — `forge:generated` header/hash and real re-init/upgrade conflict resolution

**Mandate:** `03` §3.3's own idempotency rule, confirmed entirely unbuilt — closes the real gap P1/P2's
own `init`/`upgrade` wiring exposes rather than papers over (re-running `init` on an existing project
with local edits currently has no real resolution path at all).

**Spec:** `03` §3.3, §3.4.

**Surface:** new shared module (exact path decided by this piece's own investigation, e.g.
`packages/cli/src/generated-header.ts`) + `packages/cli/src/init/run-init.ts` and `packages/cli/src/
commands/upgrade/run-upgrade.ts` (both extended to use it)
- Stamps `<!-- forge:generated v=<ver> hash=<sha> -->` on every generated file at write time.
- On a re-init/upgrade encountering an existing generated file: compares the stored hash against the
  file's real current content; unchanged → silently regenerate; changed → real `keep-mine`/
  `take-theirs`/`merge`/`show-diff` resolution (interactive by default, `--yes`-overridable per this
  project's established non-interactive convention).

**Checks:** an unedited generated file re-generates silently; a hand-edited one triggers real conflict
resolution with all four modes exercised; `--yes` picks a safe, named default (which one, decided and
disclosed by this piece) rather than silently guessing.

**Depends on:** P1 (needs `init` wired to be end-to-end testable through the real CLI, though the
underlying mechanism itself could be unit-tested independently if sequencing makes that useful).

---

## P4 — The real CLI dispatcher: remaining commands (kb/spec/adr/diagram/customize/compile/preset/
skill/mcp/help + the agent-facing loop family)

**Mandate:** completes the dispatcher — every command named in `bin.ts`'s own doc comment that P1-P3
don't already cover.

**Spec:** `03` (relevant per-command sections).

**Surface:** `packages/cli/src/bin.ts` (extended)
- `forge kb <sub>`, `forge spec new <type>`, `forge adr`, `forge diagram`, `forge customize`, `forge
  compile`, `forge preset`, `forge skill`, `forge mcp`, `forge help`.
- `forge implement/debug/refactor/deploy/review/panel/ask/session` (the agent-facing "loop" family —
  read `packages/cli/src/commands/loop/` directly for what's real vs. still-disclosed-gap per command,
  e.g. `merge.ts`'s own `--abort`-only `USR-003`, `plan.ts`'s `data`/`testing` `USR-003`s — these are
  spec-compliant partial scopes per prior milestones' own disclosures, not new gaps this piece invents
  or silently "completes").

**Checks:** every newly-wired command reachable with its own real, already-tested flag shape; every
already-disclosed partial-scope `USR-003` (documented in prior `SPEC-QUESTIONS.md` entries) still
throws the identical, correctly-worded refusal through the real CLI path, not a generic "not wired"
message.

**Depends on:** P1, P2 (dispatcher file sequencing).

---

## P5 — Performance benchmark suite with ratchets

**Mandate:** `21` §21.5's own five numeric targets, confirmed to have zero benchmark infrastructure
today beyond the unrelated coverage ratchet.

**Spec:** `21` §21.5, `02` §2.7 (cold start / first frame budgets).

**Surface:** new `scripts/bench.mjs` (or `packages/*/bench/` per-package, decided concretely by this
piece's own investigation of where the coverage-ratchet precedent puts shared tooling) + a new
ratchet-marks mechanism analogous to `scripts/lib/coverage-ratchet.mjs`
- Real, reproducible measurements for: cold start (`npx forge-method --version` warm-cache wall time),
  first frame (`forge status` on a real 100-artifact fixture), compile (5-layer fixture), KB pack
  (500-entry fixture), index rebuild (1000-entry fixture) — each compared against `21` §21.5's own
  literal numeric budget and against its own last-recorded mark (ratchet: allowed to improve, a
  regression past the recorded mark fails `--check`).
- `pnpm bench` (record/update marks) and `pnpm bench --check` (CI gate) root scripts.

**Checks:** each of the five benchmarks runs deterministically (seeded/fixed fixture sizes, no
wall-clock-sensitive flakiness by design) and fails `--check` when deliberately regressed past budget;
passes clean on the current, real codebase.

**Depends on:** P1 (needs `forge status`/`--version` reachable through the real CLI to benchmark the
real cold-start/first-frame path, not a bypassed direct function call).

---

## P6 — Windows CI closure: macOS matrix gap + the 12 real `skipIf(win32)` sites

**Mandate:** M12's own literal "CI green on the full matrix (3 OS × 3 Node)" — confirmed macOS is
entirely absent from `ci.yml`'s matrix, plus 12 real, named Windows-skip sites needing individual
resolution or explicit, permanent justification per `22` §22.1 rule 1.

**Spec:** `21` §21.6, `22` §22.1 rule 1, rule 6.

**Surface:** `.github/workflows/ci.yml` (matrix extended to `macos-latest`) + each of the 8 test files
named in the pre-plan research (`audit.test.ts`, `doctor/fix.test.ts`, `manifest.test.ts`,
`overlay-fetch.test.ts`, `claims.test.ts`, `git.test.ts`, `events.test.ts`, `s12-orphan-free-crash.
test.ts`)
- For each `skipIf(win32)` site: either a real Windows-equivalent assertion (if the underlying
  guarantee has a real Windows analogue worth testing — e.g. a different, real permission-denial
  mechanism) or a named, specific, permanent justification recorded in that test file's own comment and
  in `SPEC-QUESTIONS.md` (e.g. "Unix file-mode bits have no Windows equivalent; the underlying
  containment guarantee is proven by the surrounding non-platform-specific assertions in this same
  test") — never a bare skip with no rationale, which `22` §22.1 rule 1 calls "a lie about coverage."

**Checks:** CI is genuinely green on all 9 (3×3) matrix cells against the current `main`; every touched
test file's own skip (where retained) carries a real, reviewable justification, not a bare
`skipIf(process.platform === 'win32')` with no comment.

**Depends on:** nothing new outside already-real test infrastructure; independent of P1-P5.

---

## P7 — Documentation: README, getting-started, method guide, authoring guide, adapter guide

**Mandate:** M12's own literal five-document Build line, confirmed to be a complete, from-scratch gap.

**Spec:** `01` (vision, for framing), `03` (CLI surface, for getting-started accuracy), `07` (adapters),
`15`/`19` (customization/authoring).

**Surface:** new root `README.md` + new `docs/` directory (`docs/getting-started.md`, `docs/
method-guide.md`, `docs/authoring-guide.md`, `docs/adapter-guide.md`)
- Written against the real, current CLI surface P1-P4 land (not aspirational commands) — a
  getting-started doc naming a command that doesn't actually run is worse than no doc.
- The adapter guide covers both real adapters (`@forge/adapter-claude-code`, `@forge/adapter-generic`)
  and explicitly states the CodeMachine descoping as settled fact (matching `07` §7.4's own text),
  never as a still-open question.

**Checks:** every command/flag named in any doc is verified to actually run as documented against the
real, current CLI (a real smoke-test script, or a manual verification pass disclosed as such) — no
doc drift between what P7 describes and what P1-P4 actually shipped.

**Depends on:** P1, P2, P4 (needs the real CLI surface finalized to document it accurately).

---

## P8 — Changesets release pipeline with provenance, and the real publish decision

**Mandate:** `02` §2.4's own literal pipeline ("changesets → version PR → tag → `npm publish
--provenance`"), confirmed partially scaffolded (changesets config exists, no workflow, no
provenance-capable CI permissions) — plus the real, currently-unresolved "can this actually be
published" question (`private: true` everywhere, wrong package name, no build step, `specs/23` open
decision #1 unconfirmed).

**Spec:** `02` §2.4, `20` §20.x (`pnpm audit` in CI, no `postinstall` scripts), `specs/23` open
decision #1.

**Surface:** new `.github/workflows/release.yml` + `packages/cli/package.json` (real publish
configuration) + `specs/23` (open decision #1 resolved and recorded, matching this project's own
"resolve in place, don't silently drop" convention already used for the CodeMachine decision)
- Investigates and resolves concretely (not assumed): the real published package name (`forge-method`
  per `02` §2.1's own tree comment, contingent on npm availability actually being checked), whether
  `@forge/cli` ships raw TypeScript (relying on consumers' Node ≥20.19 native stripping, matching this
  project's own dev-toolchain floor) or gets a real build step, and which packages besides `@forge/cli`
  need `private: false` at all (per `02` §2.1's own scope, likely `@forge/cli` alone, decided
  concretely).
- `release.yml`: `changeset version` → PR, tag → `npm publish --provenance` with real `id-token: write`
  permission wired into the workflow.

**Checks:** a real dry-run publish (`npm publish --dry-run --provenance` or equivalent, against a real
built artifact) succeeds structurally; the workflow's own permissions are the minimum real set
provenance needs, not broadened speculatively.

**Depends on:** P1-P4 (the CLI needs to be a genuinely complete product before deciding how it ships).

---

## P9 — `scripts/verify-success-criteria.mjs` and the real SC1–SC11 evidence pass

**Mandate:** M12's own Exit tests literally name this script; it is the final, capstone piece that
proves the whole milestone (and the whole build) is honestly done — confirmed to not exist yet.

**Spec:** `01` §1.8 (SC1-SC11, verbatim), `22` (Exit tests).

**Surface:** new `scripts/verify-success-criteria.mjs`
- For each of SC1-SC11, runs (or orchestrates running) the real command/test that constitutes its own
  proof, per `01` §1.8's own literal text, and asserts success with recorded evidence (not merely "the
  suite is green" — the standing lesson this whole build has already learned twice, at M10 and again
  during M11's own final check, about independently verifying real completeness rather than trusting an
  aggregate pass).
- Where a criterion's own proof requires a live adapter or a real ≥50k-LOC external repo (SC4, SC6) and
  no such fixture exists in CI, this piece discloses that honestly (a `FORGE_LIVE=1`-gated path,
  matching the Exit tests' own `FORGE_LIVE=1 pnpm test -- --grep "live"` line) rather than fabricating a
  smaller proxy and calling it proof.

**Checks:** running the script against the real, current `main` after P1-P8 land produces a real
SC1-SC11 report; a deliberately broken criterion (e.g. a gate check disabled) is caught and reported by
name, not silently passed.

**Depends on:** P1-P8 (this is the capstone check across the whole milestone).

---

## Notes on sequencing and scope

- **P1-P4 (the CLI dispatcher) are strictly sequential with each other** (all four edit the same
  `bin.ts` `main()` function) but P5-P8 can proceed in parallel once their own specific dependency on
  the dispatcher (noted per-piece above) is satisfied — matching this build's own established "note
  real dependencies, don't force false parallelism" discipline.
- **P3 (generated-header/conflict-resolution) and P6 (Windows CI) are genuinely independent of the
  dispatcher work** in their own core logic, though P3 benefits from P1 already landing to test
  end-to-end through the real CLI rather than only at the function level.
- **Total: 9 pieces** — larger in aggregate LOC than M11 likely, concentrated in P1-P4's dispatcher
  work, but fewer independently-numbered pieces than M10/M11 since the dispatcher itself is one
  connected subsystem rather than several unrelated ones.
- Every piece follows the identical `BUILD-PROMPT.md` gauntlet-loop discipline already established
  across M1-M11: tests-first, a fresh context-free critic per round, judge-and-loop on real findings,
  two-commit pattern, `SPEC-QUESTIONS.md` entries for every real design decision, and — per the standing
  lesson from M10's real gap and M11's own final-check catches — **before declaring this milestone (and
  the whole v1.0 build) complete, independently verify every one of the 9 `## M12 P<n>` `GAUNTLET-LOG.
  md` entries actually exists, every named CLI command genuinely runs (not merely "is wired" per a
  piece's own self-report), and `scripts/verify-success-criteria.mjs` itself reports all 11 criteria
  met with real evidence — never trusting a clean full-suite run alone.**
