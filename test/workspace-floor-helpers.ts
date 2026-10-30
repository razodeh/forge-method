/**
 * Shared constants and walks for `test/workspace-floor.test.ts` and
 * `test/workspace-floor-heavy-subprocess.test.ts` — split out of the latter (this session's own
 * "CI capacity, not lock correctness" piece, following `SPEC-QUESTIONS.md` Q365's own precedent for
 * the `lock-stress` job) so the 3 real-subprocess-heavy tests that move into the dedicated
 * `heavy-subprocess` CI job can share the exact same repository walk and ignore-lists the ordinary,
 * fast structural checks that stay in the main run already use — the identical "shared, importable
 * module, not a runnable suite" shape this very file's own `IGNORED_PATHS` comments already establish
 * for dozens of other fixtures across the suite, just one level up (a repo-root `test/` helper, not a
 * package one — `test/setup.ts`/`test/global-setup.ts`/`test/non-forge-steps.ts` are the existing,
 * un-flagged precedent for a plain, non-`*.test.ts` file living directly under `test/`).
 *
 * Not a test file itself (no `describe`/`it`), so neither `vitest.config.ts`'s collection glob nor
 * the walk in `workspace-floor.test.ts` picks it up as one.
 *
 * @see specs/21 §21.1
 * @see specs/02 §2.2
 * @see SPEC-QUESTIONS.md Q365
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Shared timeout for the 3 real-subprocess tests now split into
 * `workspace-floor-heavy-subprocess.test.ts` (`vitest list` twice, `tsc --listFiles` once per
 * tsconfig) — deliberately one constant, not three separately-tuned numbers, so a future drift in any
 * one measurement does not need re-deriving individually.
 *
 * Previously `100_000`, then `1_200_000` (see that commit's own comment for the real CI evidence
 * behind the 1.2M-ms value — these 3 tests' own real elapsed time reaching as high as 452540ms under
 * the genuine contention of the full, unscoped monorepo suite running concurrently). Kept at the same
 * value after this split: isolating these 3 tests into their own dedicated `heavy-subprocess` CI job
 * (this session's own real fix for that same contention, `SPEC-QUESTIONS.md` Q365's own precedent
 * applied to CI capacity generally rather than lock correctness specifically) removes the *cause* of
 * the timeout pressure, but the ceiling itself is left generous rather than retuned down on no new
 * evidence — a follow-up with real isolated-job CI timing data can tighten it later.
 */
export const SUBPROCESS_HEAVY_TEST_TIMEOUT_MS = 1_200_000;

/** Workspace roots declared in `pnpm-workspace.yaml`, per `specs/02` §2.2. */
export const WORKSPACE_ROOTS = ['packages', 'tools', 'modules'] as const;

/** Build output, skipped at any depth. Never contains a source of record. */
export const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git', '.turbo']);

/**
 * The paths excluded by name, mirroring `vitest.config.ts`. `test/lint-rules.test.ts` writes a
 * fixture at the first entry below for the duration of a lint call, and this file's walks run in
 * parallel with it.
 *
 * Excluding *all* dot-directories was tried and is a defect: it put a failing test in `test/.hidden/`
 * beyond both the collection globs and this walk simultaneously, which is precisely the shared blind
 * spot the set-equality assertion (in `workspace-floor-heavy-subprocess.test.ts`) exists to rule out.
 *
 * Every other entry's own per-path justification (which plan/piece created it, and why it is
 * genuinely test-only, shared, or a real child process rather than a stray) is preserved inline
 * below, carried over verbatim from `workspace-floor.test.ts` when this Set moved here for the
 * `heavy-subprocess` CI-capacity split — this is the one and only copy, imported by both
 * `workspace-floor.test.ts` and `workspace-floor-heavy-subprocess.test.ts`.
 */
// `packages/kb/test/lint/factories.ts` (PLAN-M3.md P10): shared, schema-validated `KbEntry`/`ADR`/
// `Component`/... builder functions, imported by four real `*.test.ts` files in the same directory —
// genuinely test-only code (it constructs adversarial/minimal fixtures, nothing else ever imports it),
// just structured as a plain importable module rather than a runnable suite, so `TEST_FILE`'s own
// `.test.`/`.spec.` naming heuristic — a proxy for "this is test code," not the actual invariant this
// walk enforces — never recognises it. Listed individually, the same as this set's one other entry,
// rather than exempting `test/` directories wholesale, which would blind this check to a real stray
// production file hiding there instead.
// `packages/telemetry/test/fixtures/append-and-hang.ts` (PLAN-M5.md P6): a standalone fixture *process*
// `events.test.ts` spawns via `child_process` (with `--experimental-strip-types`, this repository's own
// no-build-step convention) to prove the event log's `fsync`-before-return guarantee against a real
// `SIGKILL`, not merely "no error was thrown." It cannot be named `*.test.ts`/`*.spec.ts` without
// vitest's own collection glob trying to run it directly as a suite — it has no `describe`/`it` blocks,
// awaits at the top level, and ends in a deliberately never-resolving `setInterval`, so that attempt
// would hang the whole run. Genuinely test-only for the same reason as the `kb` entry above; listed
// individually for the same reason too.
// `packages/telemetry/test/fixtures/append-many.ts` (specs/22 M15 P14): the identical shape, one
// directory over — a standalone fixture process `events.test.ts` spawns, several at once via
// `child_process`, to prove `appendEvent`'s real cross-process file lock against genuinely concurrent
// OS processes, not merely concurrent in-process promises. Cannot be named `*.test.ts`/`*.spec.ts` for
// the same reason as `append-and-hang.ts` above (it has no `describe`/`it` blocks of its own); listed
// individually for the same reason too.
// `packages/engine/test/dispatch/helpers.ts` (PLAN-M5.md P15): a real `ExecuteStepContext` builder and
// `StepNode` fixture builder, imported by five real `*.test.ts` files in the same directory — the same
// "shared, importable module rather than a runnable suite" shape as the `kb` entry above, for the same
// reason unrecognised by `TEST_FILE`'s naming heuristic. Listed individually for the same reason too.
// `packages/engine/test/e2e/fixture-workflow.ts` (PLAN-M5.md P20): the shared fixture workflow, gate
// registry, and `RunEngineContext` builder every `test/e2e/*.test.ts` and `test/run/*.test.ts` file
// imports — the identical "shared, importable module, not a runnable suite" shape as the two entries
// above. `packages/engine/test/e2e/fixtures/run-engine-child.ts` (PLAN-M5.md P20): the real-child-
// process fixture `crash-resume.test.ts` spawns via `node --experimental-strip-types` (never imported,
// never run as a vitest suite) — the identical "genuinely test-only, unrecognised by `TEST_FILE`'s
// naming heuristic" shape `append-and-hang.ts` above is already listed for, and for the same reason.
// `packages/methods/test/fixtures/repo-strategy.ts` (PLAN-M6.md M2): the shared verbatim `11` §11.0
// `repo-strategy` YAML fixture string, imported by `test/schema/load.test.ts` and `test/score/*.test.ts`
// — the identical "shared, importable module, not a runnable suite" shape as the `kb`/`engine` entries
// above, for the same reason unrecognised by `TEST_FILE`'s naming heuristic.
// `packages/catalog/test/fixtures/postgresql.ts` (PLAN-M6.md C1): the shared verbatim `12` §12.2
// `postgresql` YAML fixture string, imported by `test/schema/load.test.ts`,
// `test/registry/registry.test.ts`, and `test/registry/validate.test.ts` — the identical shape as the
// `methods` entry above, for the same reason.
// `packages/agents/test/fixtures/architect.ts` (PLAN-M6.md A1): the shared verbatim `05` §5.3
// `architect` YAML fixture string, imported by `test/schema/load.test.ts`,
// `test/registry/registry.test.ts`, and `test/registry/resolve-extends.test.ts` — the identical shape.
// `packages/cli/test/entry/fixtures/node-version-guard.ts` (PLAN-M6.md C1): a standalone fixture
// *process* `test/entry/node-version.subprocess.test.ts` spawns via `child_process` (with
// `--experimental-strip-types`, this repository's own no-build-step convention) to prove `03` §3.1's
// exit(5) as a real, observable process exit code rather than a mocked function call — the identical
// "genuinely test-only, unrecognised by `TEST_FILE`'s naming heuristic" shape `append-and-hang.ts`
// above is already listed for, and for the same reason.
export const IGNORED_PATHS = new Set([
  'tools/lint-fixture/.fixtures',
  'packages/kb/test/lint/factories.ts',
  'packages/telemetry/test/fixtures/append-and-hang.ts',
  'packages/telemetry/test/fixtures/append-many.ts',
  'packages/engine/test/dispatch/helpers.ts',
  'packages/engine/test/e2e/fixture-workflow.ts',
  'packages/engine/test/e2e/fixtures/run-engine-child.ts',
  'packages/methods/test/fixtures/repo-strategy.ts',
  'packages/catalog/test/fixtures/postgresql.ts',
  'packages/agents/test/fixtures/architect.ts',
  'packages/cli/test/entry/fixtures/node-version-guard.ts',
  // `packages/cli/test/commands/helpers.ts` (PLAN-M6.md C3): shared, real test-project scaffolding
  // (a temp `ProjectPaths`, small real KB-entry/diagram fixtures) imported by every
  // `test/commands/*.test.ts` file — the identical "shared, importable module, not a runnable suite"
  // shape as the `kb`/`engine`/`methods`/`catalog`/`agents` entries above, for the same reason
  // unrecognised by `TEST_FILE`'s naming heuristic.
  'packages/cli/test/commands/helpers.ts',
  // `packages/cli/test/commands/run/helpers.ts` (PLAN-M6.md C4): the identical shape, one directory
  // deeper — shared real git-repo/workflow/gate fixture scaffolding for `test/commands/run/*.test.ts`.
  'packages/cli/test/commands/run/helpers.ts',
  // `packages/cli/test/commands/run/fixtures/run-child.ts` (PLAN-M6.md C4): the real crash-then-resume
  // child-process fixture `resume.test.ts` spawns and `SIGKILL`s — the identical "real child process
  // driven via `node --experimental-strip-types`, not a runnable suite" shape
  // `packages/engine/test/e2e/fixtures/run-engine-child.ts` above already establishes, for the
  // identical reason unrecognised by `TEST_FILE`'s naming heuristic.
  'packages/cli/test/commands/run/fixtures/run-child.ts',
  // `packages/cli/test/commands/loop/helpers.ts` (PLAN-M6.md C5): the identical shape as
  // `packages/cli/test/commands/run/helpers.ts` above, one directory over — shared real git-repo/
  // fixture-workflow/Story/agent scaffolding for `test/commands/loop/*.test.ts`.
  'packages/cli/test/commands/loop/helpers.ts',
  // `packages/cli/test/init/tier-stubs.ts` (PLAN-M13.md P5b): minimal `PlatformAdapter` stand-ins shared
  // by the tier-map, init and doctor test files — the identical "shared, importable module, not a
  // runnable suite" shape as the helper entries above.
  'packages/cli/test/init/tier-stubs.ts',
  // `packages/cli/test/commands/doctor/helpers.ts` (PLAN-M6.md C6): the identical shape as
  // `packages/cli/test/commands/run/helpers.ts` above, one directory over — shared real git-repo/
  // config/manifest fixture scaffolding for `test/commands/doctor/*.test.ts`.
  'packages/cli/test/commands/doctor/helpers.ts',
  // `packages/cli/test/commands/upgrade/helpers.ts` (PLAN-M6.md C7): the identical shape as
  // `packages/cli/test/commands/run/helpers.ts` above, one directory over — shared real
  // `runInit`-produced project fixture scaffolding for `test/commands/upgrade/*.test.ts`.
  'packages/cli/test/commands/upgrade/helpers.ts',
  // `packages/cli/test/commands/dispatch/dispatch-test-helpers.ts` (`specs/22` M17 P2): the
  // identical shape as `packages/cli/test/commands/helpers.ts` above, one directory over — shared
  // real `captureLogs`/`createConfiguredProject` fixture scaffolding (plus a re-export of
  // `../helpers.ts`'s own bare project and constants) imported by most `test/commands/
  // dispatch/*.test.ts` files, for the identical reason unrecognised by `TEST_FILE`'s naming
  // heuristic.
  'packages/cli/test/commands/dispatch/dispatch-test-helpers.ts',
  // `packages/cli/bin/` (PLAN-M6.md C9): the real `forge` CLI's own launcher, `bin/forge.mjs` — a
  // thin process-spawn wrapper (the identical shape `scripts/run-tests.mjs` already establishes at
  // the repo root), deliberately outside `src/` since it is not itself covered code (nothing calls
  // into it as a module; it only ever spawns a real child process) and, unlike `scripts/`, it lives
  // inside a real workspace package, so this walk would otherwise flag it as a stray. Still real,
  // typechecked source — `tsconfig.json`'s own root `include` array covers it directly, the identical
  // "typechecked by the root project, not a package project" precedent `scripts/**/*.mjs` already
  // sets, confirmed by the *other* real floor check (`every source file in the repository is
  // typechecked`, now in `workspace-floor-heavy-subprocess.test.ts`) still finding it.
  'packages/cli/bin',
  // `packages/adapter-claude-code/test/conformance/fixtures/mcp-server.ts` (PLAN-M7.md P9): a real,
  // standalone MCP stdio server *process* -- C16 (MCP grant fidelity)'s own conformance fixture,
  // spawned directly by the real Claude Code CLI/SDK under test (`command: process.execPath, args:
  // ['--experimental-strip-types', thisFile]`), never imported by any `*.test.ts` file and never run
  // as a vitest suite itself. Unlike the other entries in this set, this one *is* typechecked (a real
  // `.ts` file matched by `test/**/*.ts`) -- it is listed here only because it still needs the
  // identical "outside src/" exemption `run-child.ts` below already establishes, for the identical
  // "real child process run via `node --experimental-strip-types`, unrecognised by `TEST_FILE`'s
  // naming heuristic" reason.
  'packages/adapter-claude-code/test/conformance/fixtures/mcp-server.ts',
  // `packages/adapter-claude-code/test/conformance/live-gate.ts`,
  // `packages/adapter-claude-code/test/conformance/fixture-options.ts`, and
  // `packages/adapter-claude-code/test/conformance/create-warmed-adapter.ts` (PLAN-M7.md P9): three
  // shared, importable helper modules -- the live-run gate, the real `ConformanceOptions` fixture
  // builder, and the warm-up-session adapter factory -- imported by both `sdk.conformance.test.ts`
  // and `cli.conformance.test.ts`, never run as a suite of their own. The identical "shared,
  // importable module, not a runnable suite" shape `packages/kb/test/lint/factories.ts` above already
  // establishes, for the identical reason unrecognised by `TEST_FILE`'s naming heuristic.
  'packages/adapter-claude-code/test/conformance/live-gate.ts',
  'packages/adapter-claude-code/test/conformance/fixture-options.ts',
  'packages/adapter-claude-code/test/conformance/create-warmed-adapter.ts',
  // `packages/methods/test/fixtures/dod-profiles.ts` (PLAN-M8.md P1): the shared verbatim `09` §9.8
  // `dod-profiles.yaml` `backend-default` worked example, imported by `test/dod/load.test.ts` and
  // `test/dod/evaluate.test.ts` — the identical "shared, importable module, not a runnable suite"
  // shape `packages/methods/test/fixtures/repo-strategy.ts` above already establishes, for the same
  // reason unrecognised by `TEST_FILE`'s naming heuristic.
  'packages/methods/test/fixtures/dod-profiles.ts',
  // `packages/kb/test/adopt/fixtures.ts`, `packages/engine/test/adopt/fixtures.ts` (`PLAN-M10.md`
  // P15/P16): shared, importable SURVEY/INVENTORY/CARTOGRAPHY/INFERENCE fixture repositories and
  // scripted-adapter builders, imported across several `test/adopt/*.test.ts` files each — the
  // identical "shared, importable module, not a runnable suite" shape `packages/kb/test/lint/
  // factories.ts` above already establishes, for the same reason unrecognised by `TEST_FILE`'s
  // naming heuristic.
  'packages/kb/test/adopt/fixtures.ts',
  'packages/engine/test/adopt/fixtures.ts',
  // `packages/adapter-generic/test/fixtures/scripted-binary.ts` (`PLAN-M11.md` P8): a real,
  // standalone scripted external binary fixture -- the `07` §7.5/§7.6 conformance suite's own
  // spawned-process stand-in for a real external CLI tool (`node --experimental-strip-types`,
  // never imported by any `*.test.ts` file and never run as a vitest suite itself). The identical
  // "outside src/" exemption `mcp-server.ts` above already establishes, for the identical "real
  // child process run via `node --experimental-strip-types`, unrecognised by `TEST_FILE`'s naming
  // heuristic" reason. `scripted-binary-protocol.ts` is its sibling, shared types-plus-pure-matcher
  // module (imported by both the fixture itself and `scripted-binary-protocol.test.ts`) -- the
  // identical "shared, importable module, not a runnable suite" shape `packages/kb/test/lint/
  // factories.ts` above already establishes.
  'packages/adapter-generic/test/fixtures/scripted-binary.ts',
  'packages/adapter-generic/test/fixtures/scripted-binary-protocol.ts',
  // `packages/extensions/test/install/npm-fixture-registry.ts` (`PLAN-M11.md` P2): a real, local
  // HTTP server speaking minimal npm-registry protocol for `fetch-npm.test.ts`'s own npm-channel
  // round trip -- the identical "genuinely test-only, shared, importable module, unrecognised by
  // `TEST_FILE`'s naming heuristic" shape `packages/cli/test/commands/helpers.ts` above already
  // establishes, for a fixture rather than a suite.
  'packages/extensions/test/install/npm-fixture-registry.ts',
  // `packages/engine/test/e2e/crash-helpers.ts` (`PLAN-M11.md` P12): shared spawn/kill helpers
  // extracted so the new S12 orphan-free-crash adversarial test and the pre-existing E3
  // `crash-resume.test.ts` don't each hand-roll their own real child-process kill machinery -- the
  // identical "genuinely test-only, shared, importable module, unrecognised by `TEST_FILE`'s naming
  // heuristic" shape every other entry in this set already establishes.
  'packages/engine/test/e2e/crash-helpers.ts',
  // `packages/engine/test/dispatch/artifact-fixtures.ts` (`PLAN-M13.md` P7): valid on-disk artifact
  // builders shared by the output-contract tests, so a fake session can write a schema-valid
  // document -- the identical "genuinely test-only, shared, importable module, unrecognised by
  // `TEST_FILE`'s naming heuristic" shape every other entry in this set already establishes.
  'packages/engine/test/dispatch/artifact-fixtures.ts',
  // `packages/cli/test/commands/loop/test/fixtures/binding-check-child.ts` (`specs/22` M15 P3): the
  // real `runBindingCheck` fixture child `binding-sigkill.test.ts` spawns via `node
  // --experimental-strip-types` and `SIGKILL`s as a process group -- the identical "real child process,
  // never imported, never run as a vitest suite, unrecognised by `TEST_FILE`'s naming heuristic" shape
  // `packages/engine/test/e2e/fixtures/run-engine-child.ts` above already establishes, for the
  // identical reason.
  'packages/cli/test/commands/loop/test/fixtures/binding-check-child.ts',
  // `packages/cli/test/commands/parity/fixtures.ts` (`specs/22` M16 P2): shared, minimal
  // `ParityDeclaration`/`ParityCapture` builders imported by this directory's own test files -- the
  // identical "genuinely test-only, shared, importable module, unrecognised by `TEST_FILE`'s naming
  // heuristic" shape every other entry in this set already establishes.
  'packages/cli/test/commands/parity/fixtures.ts',
  // `packages/cli/test/commands/loop/test/fixtures/hunk-mutation-check-child.ts` (`specs/22` M16
  // P12): the real `runHunkMutationCheck` fixture child `hunk-mutation-sigkill.test.ts` spawns via
  // `node --experimental-strip-types` and `SIGKILL`s as a process group -- the identical "real child
  // process, never imported, never run as a vitest suite, unrecognised by `TEST_FILE`'s naming
  // heuristic" shape `binding-check-child.ts` above already establishes, for the identical reason.
  'packages/cli/test/commands/loop/test/fixtures/hunk-mutation-check-child.ts',
  // `packages/cli/test/commands/parity/http-fixtures.ts` (`specs/22` M16 P8): shared real-subprocess
  // HTTP server fixtures (a free-port picker, a parameterised `node:http` server script builder)
  // imported by this directory's own `http-server.test.ts`/`observe-http.test.ts` -- the identical
  // "genuinely test-only, shared, importable module, unrecognised by `TEST_FILE`'s naming heuristic"
  // shape `fixtures.ts` immediately above already establishes, for the identical reason.
  'packages/cli/test/commands/parity/http-fixtures.ts',
  // `packages/cli/test/commands/loop/test/fixtures/proof-sigkill-child.ts` (`specs/22` M17 P6): the
  // real `runTranslatorProof` fixture child `proof-sigkill.test.ts` spawns via `node
  // --experimental-strip-types` and `SIGKILL`s -- the identical "real child process, never imported,
  // never run as a vitest suite, unrecognised by `TEST_FILE`'s naming heuristic" shape
  // `binding-check-child.ts`/`hunk-mutation-check-child.ts` above already establish, for the
  // identical reason.
  'packages/cli/test/commands/loop/test/fixtures/proof-sigkill-child.ts',
  // `packages/cli/test/commands/parity/fixtures/crashing-no-handler-worker.ts` and
  // `.../crashing-normalize-worker.ts` (`specs/22` M17 P14): real worker-thread fixtures
  // `normalize-budget.test.ts` loads BY PATH (a `workerUrl` test seam), never imported by any
  // `*.test.ts` file and never run as a vitest suite themselves -- the identical "real child
  // process/thread, unrecognised by `TEST_FILE`'s naming heuristic" shape every sigkill-child entry
  // in this set already establishes, for the identical reason.
  'packages/cli/test/commands/parity/fixtures/crashing-no-handler-worker.ts',
  'packages/cli/test/commands/parity/fixtures/crashing-normalize-worker.ts',
  // `packages/cli/test/commands/parity/fixtures/isolation-signal-harness.ts` (`specs/22` M17 P14): a
  // standalone child-process harness `candidate-isolation.test.ts` spawns to receive a real signal on
  // a SEPARATE process from the test runner's own -- the identical "real child process, never
  // imported, never run as a vitest suite" shape the sigkill-child entries above already establish,
  // for the identical reason.
  'packages/cli/test/commands/parity/fixtures/isolation-signal-harness.ts',
  // `packages/cli/test/commands/parity/fixtures/crashing-no-handler-library-worker.ts` and
  // `.../crashing-normalize-library-worker.ts` (`specs/22` M17 P14 follow-up, Q317 Decision 8): real
  // worker-thread fixtures `normalize-library-budget.test.ts` loads BY PATH (a `workerUrl` test
  // seam), never imported by any `*.test.ts` file and never run as a vitest suite themselves -- the
  // identical "real child process/worker thread, never imported, never run as a vitest suite,
  // unrecognised by `TEST_FILE`'s naming heuristic" shape `crashing-no-handler-worker.ts`/
  // `crashing-normalize-worker.ts` above already establish, for the identical reason.
  'packages/cli/test/commands/parity/fixtures/crashing-no-handler-library-worker.ts',
  'packages/cli/test/commands/parity/fixtures/crashing-normalize-library-worker.ts',
]);

/**
 * Directories skipped only at the repository root, mirroring `vitest.config.ts`'s root-anchored
 * exclusions. Anchoring matters: skipping `specs`/`fixtures` at *any* depth is what let a failing
 * test in `packages/<pkg>/specs/` hide from the globs and from this walk simultaneously.
 *
 * `.claude` holds this repo's own `worktrees/` cache -- dozens of full nested checkouts of this
 * same repo, each with its own copy of every `*.test.ts` file. Collected by neither mechanism
 * before this entry existed: a real CI investigation found a local, unscoped `pnpm test` run
 * re-running one file 70-81 times, once per live worktree, which both masks real throughput
 * numbers and risks double-counting coverage/pass counts. A fresh CI checkout never has this
 * directory at all, so this is a local-dev-only fix, not a CI behavior change.
 */
export const IGNORED_ROOT_DIRECTORIES = new Set(['specs', 'fixtures', '.claude']);

/** Source and test file extensions, matching the collection globs in `vitest.config.ts`. */
export const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/** Test files, which `vitest.config.ts` collects and coverage excludes. */
export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Every `*.{test,spec}.*` file in the repository, at any extension and any depth.
 *
 * Walks from the repository root rather than from a list of workspace roots. The previous version
 * scanned exactly the four roots the collection globs used, so it shared their blind spot and
 * could never observe a file outside them — a failing test at the repo root or in `scripts/` was
 * invisible to both.
 */
export function findTestFiles(relativeDir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    if (relativeDir === '' && IGNORED_ROOT_DIRECTORIES.has(entry.name)) continue;
    const relative = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    if (IGNORED_PATHS.has(relative)) continue;
    if (entry.isDirectory()) {
      found.push(...findTestFiles(relative));
    } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      found.push(relative);
    }
  }
  return found.sort();
}

/**
 * Shells out to the real `vitest list --json`, deduped to one entry per file.
 *
 * Measured isolated duration ~24-28s (its higher samples; see `M14-AGENT-NOTES.md`, `M14 P45`) —
 * real-subprocess-heavy, which is why every caller of this function now lives in
 * `workspace-floor-heavy-subprocess.test.ts`, not here.
 */
export function collectedTestFiles(): readonly string[] {
  const listed = JSON.parse(
    execFileSync('node', ['scripts/run-tests.mjs', 'list', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      // Node's own default `maxBuffer` (1 MB) — fine when this repo had a few dozen test files, but
      // `vitest list --json` emits one entry per *test*, not per file, and the repo has grown past
      // 4600 tests across 200+ files. A first version of this call with no explicit `maxBuffer` hit
      // `ENOBUFS` here, not as a real regression in this piece's own content but because the suite
      // itself had grown enough to cross Node's default ceiling. 64 MB is a wide margin above the
      // current real output size, not a number tuned to just barely fit today's count.
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as readonly { file: string }[];
  // `vitest list --json` emits one entry per *test*, not per file, so the paths must be deduped
  // before they can be compared with a file walk.
  return [
    ...new Set(
      listed.map((entry) => path.relative(repoRoot, entry.file).split(path.sep).join('/')),
    ),
  ].sort();
}
