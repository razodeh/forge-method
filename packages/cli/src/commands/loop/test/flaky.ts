/**
 * `computeFlakeRate`/`recordFlakeOutcome`/`testFlaky` — F-TEST-6's own rolling flake tracking and
 * quarantine, for real. `docs/forge/reports/flaky.json`'s own round-trip; the retry-in-isolation step
 * itself lives in `run.ts` (it needs `testCommands`/`ecosystem`/`createTempPath`, the same
 * dependencies `runDefaultRule` already has) — this module owns the pure decision logic and the
 * state file, not the shelling-out.
 *
 * @see specs/13 §13.1 F-TEST-6
 * @see PLAN-M8.md P7
 */
import { ForgeError } from '@forge/core';
import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import type { ForgeConfig } from '@forge/schemas/config';

/** One `forge test run` invocation's own recorded flake signal for one test — see
 * `recordFlakeOutcome`'s own doc comment for exactly what "flaky" means here (it is **not** simply
 * "did the first pass fail"). */
export type FlakyOutcome = 'pass' | 'fail';

/** One test's own real rolling history. `outcomes` holds at most the last `FLAKY_WINDOW` entries,
 * oldest first; `quarantined` is a one-way latch — see `recordFlakeOutcome`'s own doc comment. */
export interface FlakyTestRecord {
  readonly outcomes: readonly FlakyOutcome[];
  readonly quarantined: boolean;
}

/** `docs/forge/reports/flaky.json`'s own real, versioned shape. Keyed by a **qualified** identity —
 * `run.ts`'s own `flakyKey(outcome)` (`<file>::<name>` when `TestOutcome.file` is known, `name`
 * alone otherwise) — never `TestOutcome.name` verbatim: a fresh critic round reproduced directly that
 * two different tests sharing a literal title in two different files (an entirely ordinary
 * occurrence — `test_serialize`/`test_init`/etc. recur across real test suites constantly) were
 * silently conflated under a bare-name key, letting a real, deterministic failure in one file get
 * recorded — and quarantined — as a "flake" because a same-named passing test in another file made
 * the retry-in-isolation step (itself also name-only, before this fix) report a false pass. */
export interface FlakyState {
  readonly v: 1;
  readonly tests: Readonly<Record<string, FlakyTestRecord>>;
}

/** The rolling window's own real size — F-TEST-6's own "default 2% over 20 runs." */
export const FLAKY_WINDOW = 20;
/** The default flake-rate threshold, as a percentage (0–100) — F-TEST-6's own "default 2%." */
export const FLAKY_RATE_THRESHOLD_PCT = 2;
/** The default quarantine cap — F-TEST-6's own "capped (default 5)." */
export const QUARANTINE_CAP = 5;

/** `quality.flake`'s own real, already-shipped config shape (`packages/schemas/src/config/
 * schema.ts`) — derived from `ForgeConfig` directly, not a second, hand-kept type, so the two can
 * never drift apart (the identical pattern `run.ts`'s own `TestCommands` already establishes for
 * `execution.testCommands`). A fresh critic round found the first draft never read this real,
 * already-schema-validated, already-documented config at all — `maxRatePct`/`window`/`quarantineCap`
 * were hardcoded module constants regardless of what a project's own `.forge/config.yaml` declared. */
export type FlakeConfig = ForgeConfig['quality']['flake'];

/** F-TEST-6's own literal defaults — identical to `packages/schemas/src/config/defaults.ts`'s own
 * `quality.flake` (confirmed directly) — used whenever a caller has no real project config to read
 * (a plain library call, a test). */
export const DEFAULT_FLAKE_CONFIG: FlakeConfig = {
  maxRatePct: FLAKY_RATE_THRESHOLD_PCT,
  window: FLAKY_WINDOW,
  quarantineCap: QUARANTINE_CAP,
};

/** The rolling failure rate over `outcomes`, as a percentage (0–100) — `PLAN-M8.md` P7's own Checks
 * section: a synthetic 20-entry window with 1 failure reports `5`; with 0 failures reports `0`. An
 * empty window (a brand-new test with no recorded runs yet) reports `0`, not `NaN` — never
 * fabricates history the way a `0/0` division would. */
export function computeFlakeRate(outcomes: readonly FlakyOutcome[]): number {
  if (outcomes.length === 0) return 0;
  const failures = outcomes.filter((outcome) => outcome === 'fail').length;
  return Number(((failures / outcomes.length) * 100).toFixed(2));
}

/** Updates one test's own rolling record with this invocation's own real flake signal.
 *
 * `isFlakeOccurrence` is **not** "did the first pass fail" — F-TEST-6's own explicit "consistent
 * failure = real [failure]; passes on retry = flake candidate" distinguishes a genuine, deterministic
 * bug (fails, and fails again on an isolated retry — already correctly blocking the gate via
 * `test:run`'s own `failed` count, with nothing flaky about it) from an actual flake (fails, then
 * passes on retry — a real, non-deterministic signal). Recording a deterministic failure into this
 * rolling window would conflate "how often is this test flaky" with "how often is this test simply
 * broken," and a permanently-broken test would then wrongly accumulate a **high** flake rate and get
 * quarantined — silently excluding a real, unfixed regression from the gate, the opposite of what
 * F-TEST-6's own quarantine mechanism exists for. So: `isFlakeOccurrence` is `true` only for the
 * "first pass failed, isolated retry passed" case; every other case (a clean first-pass pass, or a
 * first-pass failure the retry reproduces) records `'pass'` here — this window measures flakiness
 * specifically, not raw first-pass reliability (`SPEC-QUESTIONS.md` has the fuller record).
 *
 * `quarantined` is a real, disclosed one-way latch: once a test's rolling rate crosses
 * `FLAKY_RATE_THRESHOLD_PCT`, it stays quarantined even if a later window's own rate drops back below
 * — F-TEST-6 specifies no exit condition at all, and this piece builds no un-quarantine mechanism
 * (that belongs with the auto-created-STORY-and-deadline workflow F-TEST-6 also names, out of this
 * piece's own scope) — so unquarantining without a real, human decision would just silently re-admit
 * a test nothing has actually fixed.
 *
 * Quarantine is only ever considered once the window holds at least `config.window` real entries — a
 * fresh critic round reproduced directly that without this guard, a single flake occurrence on a
 * *brand-new* record (a 1-entry window) computes a `100`% rate and latches quarantine immediately,
 * contradicting F-TEST-6's own explicit "2% **over 20 runs**" framing (a rate is only meaningful once
 * measured against something close to the full window, not a single sample).
 *
 * `config` defaults to `DEFAULT_FLAKE_CONFIG` (F-TEST-6's own literal defaults) — a real caller
 * threads the target project's own `quality.flake` through (`run.ts`). */
export function recordFlakeOutcome(
  existing: FlakyTestRecord | undefined,
  isFlakeOccurrence: boolean,
  config: FlakeConfig = DEFAULT_FLAKE_CONFIG,
): FlakyTestRecord {
  const outcomes = [...(existing?.outcomes ?? []), isFlakeOccurrence ? 'fail' : 'pass'].slice(
    -config.window,
  ) as readonly FlakyOutcome[];
  const rate = computeFlakeRate(outcomes);
  const windowIsFull = outcomes.length >= config.window;
  const quarantined =
    (existing?.quarantined ?? false) || (windowIsFull && rate > config.maxRatePct);
  return { outcomes, quarantined };
}

const FLAKY_RELATIVE_PATH = 'docs/forge/reports/flaky.json';

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isFlakyOutcome(value: unknown): value is FlakyOutcome {
  return value === 'pass' || value === 'fail';
}

function isFlakyTestRecord(value: unknown): value is FlakyTestRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    Array.isArray(candidate['outcomes']) &&
    candidate['outcomes'].every(isFlakyOutcome) &&
    typeof candidate['quarantined'] === 'boolean'
  );
}

function isFlakyState(value: unknown): value is FlakyState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate['v'] !== 1) return false;
  const tests = candidate['tests'];
  return (
    typeof tests === 'object' &&
    tests !== null &&
    !Array.isArray(tests) &&
    Object.values(tests as Readonly<Record<string, unknown>>).every(isFlakyTestRecord)
  );
}

const EMPTY_FLAKY_STATE: FlakyState = { v: 1, tests: {} };

/** Reads `docs/forge/reports/flaky.json`, tolerating "never collected yet" as the real, correct empty
 * state (the same convention every other durable-state file in this piece establishes — `run.ts`
 * has no equivalent read, but `coverage.ts`'s own `readBaseline` is the identical precedent) — a
 * present-but-unusable file is a real, reportable problem instead, never silently reset.
 * @throws {ForgeError} `RUN-059` if the file exists but is not valid JSON, or not this function's own
 * real `{v: 1, tests: {...}}` shape — its own dedicated code, not a reuse of `test-results.json`'s
 * `RUN-058`: a fresh critic round found reusing RUN-058 here rendered a message naming the wrong file
 * kind and a remedy ("re-run `forge test run` to regenerate it") that is actively wrong for this file
 * specifically, since `run.ts`'s own default rule deliberately never persists over an unusable
 * `flaky.json` (`RUN-059`'s own doc comment in `codes.ts` has the fuller reasoning). */
export async function readFlakyState(paths: ProjectPaths): Promise<FlakyState> {
  const target = paths.resolveWithin(FLAKY_RELATIVE_PATH);
  if (!(await pathExists(target))) return EMPTY_FLAKY_STATE;
  const raw = await readTextFile(target);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ForgeError('RUN-059', {
      path: FLAKY_RELATIVE_PATH,
      detail: `not valid JSON: ${describeCause(cause)}`,
    });
  }
  if (!isFlakyState(parsed)) {
    throw new ForgeError('RUN-059', {
      path: FLAKY_RELATIVE_PATH,
      detail: 'does not have the real { v: 1, tests: {...} } shape',
    });
  }
  return parsed;
}

/** Writes `state` to `docs/forge/reports/flaky.json`, atomically. */
export async function writeFlakyState(paths: ProjectPaths, state: FlakyState): Promise<void> {
  const target = paths.resolveWithin(FLAKY_RELATIVE_PATH);
  await writeFileAtomic(target, `${JSON.stringify(state, null, 2)}\n`);
}

/** `test:flaky` (`G-Stable`)/`test:quarantine-cap` (`G-Verify`), for real — a plain, read-only report
 * over the already-updated `flaky.json` (updated by `run.ts`'s own default rule, after every real
 * `forge test run`; this function runs no tests itself). `flaky`: every test currently above
 * `config.maxRatePct`, quarantined or not — F-TEST-6's own "every flake must be paid down,
 * quarantine or not" (`G-Stable`'s own zero-tolerance `failOn: 'flaky > 0'`). `quarantined`: the
 * total count of tests currently latched `quarantined: true` — `test:quarantine-cap`'s own
 * `failOn: 'quarantined > 5'` (`G-Verify.gate.yaml`'s own literal default) reads this count directly.
 * `flakyTests`/`quarantinedTests` name every test counted in `flaky`/`quarantined` — F-TEST-6's own
 * explicit "quarantine is visible in every gate report" demands naming *which* test, not just a bare
 * count (the identical "a real finding needs a real name, not just a number" precedent
 * `TestCoverageResult.missingAcIds` already establishes).
 *
 * `problems`, when non-empty, names a real reason this could not be answered (a present-but-unusable
 * `flaky.json`) — never a thrown exception, matching every other `forge test *` piece's own "fail
 * closed, report honestly" discipline. A fresh critic round reproduced directly that forcing
 * `flaky`/`quarantined` to `0` in that case — the first draft's own choice — makes `evaluateGate`
 * (`@forge/engine/gates`), which reads only the numeric `failOn` fields and never `problems` itself,
 * report a **clean pass** on a check that could not actually be verified: fed the first draft's own
 * `problems`-carrying-but-zeroed JSON straight through the real `evaluateGate`, both `test:flaky` and
 * `test:quarantine-cap` came back `passed: true`. Every sibling in this milestone forces its own count
 * toward the *failing* direction on a real problem (`TestRunResult.failed`, `TestCoverageResult.
 * coverage`/`regressions`) — `flaky`/`quarantined` are forced *up* here for the identical reason,
 * past both checks' own real thresholds, so a gate that cannot be trusted to reflect the truth never
 * silently reads as passing. */
export async function testFlaky(
  paths: ProjectPaths,
  config: FlakeConfig = DEFAULT_FLAKE_CONFIG,
): Promise<{
  readonly flaky: number;
  readonly quarantined: number;
  readonly flakyTests?: readonly string[];
  readonly quarantinedTests?: readonly string[];
  readonly problems?: readonly string[];
}> {
  let state: FlakyState;
  try {
    state = await readFlakyState(paths);
  } catch (cause) {
    return {
      flaky: 1,
      quarantined: config.quarantineCap + 1,
      problems: [describeCause(cause)],
    };
  }
  const entries = Object.entries(state.tests);
  // A test's own `quarantined` flag is included even when the *current* window's rate has since
  // dipped back under the threshold: quarantine is a one-way latch (`recordFlakeOutcome`'s own doc
  // comment) — nothing has actually fixed a quarantined test just because its recent runs happened to
  // be clean, and F-TEST-6's own "every flake must be paid down, quarantine or not" means quarantine
  // status alone is already sufficient evidence for `G-Stable`'s own zero-tolerance count.
  const flakyTests = entries
    .filter(
      ([, record]) => record.quarantined || computeFlakeRate(record.outcomes) > config.maxRatePct,
    )
    .map(([key]) => key);
  const quarantinedTests = entries.filter(([, record]) => record.quarantined).map(([key]) => key);
  return flakyTests.length === 0 && quarantinedTests.length === 0
    ? { flaky: 0, quarantined: 0 }
    : {
        flaky: flakyTests.length,
        quarantined: quarantinedTests.length,
        flakyTests,
        quarantinedTests,
      };
}
