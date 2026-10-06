/**
 * `runBindingCheck` — `specs/22` M15 P3, the binding engine: "revert the implementation, require the
 * named tests to fail, restore, require them to pass" — `PLAN-M15.md`'s own opening argument for the
 * whole milestone, made real for one story at a time.
 *
 * For a story's `filesExpected` (`09` §9.3's own `files_expected`), splits implementation paths from
 * test paths (`isTestPath`, `@forge/engine/dispatch` — the identical heuristic `run-plan.ts` already
 * uses for the same split, reused here read-only, never duplicated), creates a **scratch lane
 * worktree** (`@forge/vcs`'s own lane lifecycle, the identical mechanism `loop/debug.ts`'s RCA loop
 * already uses for a short-lived, synchronous, git-isolated purpose), and inside it:
 *
 * 1. Runs the story's named tests once, unmutated — this both discovers their real individual names
 *    (`TestOutcome.name`, not merely their file paths) and confirms the starting point is genuinely
 *    green. A test already failing before any mutation makes "did it fail BECAUSE OF the revert"
 *    unanswerable, so this is reported as `baseline-not-green`, never silently absorbed into the
 *    binding verdict.
 * 2. Reverts exactly the implementation paths (`@forge/vcs`'s `revertPathsToRevision`) to their
 *    content at `baseRevision` — never the test paths themselves, and never any file this story's own
 *    `filesExpected` does not name. Runs the same named tests again; whichever now fail are the real,
 *    disclosed binding evidence (`failedUnderMutation`); whichever still pass are reported
 *    **non-binding**, individually, by name — never silently dropped.
 * 3. Restores (`resetLaneWorktree`, `git reset --hard` + `clean -fd`, back to the lane's own starting
 *    commit) and re-runs the same named tests a third time, requiring all to pass again
 *    (`restoreVerified`) — proof the revert was real and reversible, not a residual, silently broken
 *    worktree.
 *
 * The lane worktree is always removed on every exit path a `finally` block CAN run on — every normal
 * return and every thrown exception — per `PLAN-M5.md` P2/M14 P35's own lane-cleanup discipline; this
 * piece never retains one, unlike `loop/debug.ts`'s own RCA lane (which keeps a *recorded fix* for
 * human review; there is no analogous "keep it" case here, only a check that either completed or
 * failed outright). The one real exception no `finally` anywhere can close: a `SIGKILL` (or an
 * equivalent host-level kill) during a run. Verified directly, not merely asserted
 * (`binding-sigkill.test.ts`, a real, detached, group-killed child process at several real points
 * during a genuine run): what stays absolutely true regardless is the MAIN repository, which this
 * function never performs a single git operation against (every revert/reset/checkout is scoped to the
 * lane worktree alone, by construction, not by a cleanup step that could itself be interrupted); what a
 * kill CAN leave behind is an orphaned lane worktree/branch, exactly the state `@forge/vcs`'s own
 * `listOrphanedWorktrees`/`removeLaneWorktree` already exist to discover and reclaim on a later pass —
 * the identical second-layer model `createLaneWorktree`'s own crash-safety already relies on everywhere
 * else in this codebase, not a gap specific to this piece.
 *
 * Deliberately does NOT itself decide "bound" vs "not bound," write a `MutationEvidence` artifact, or
 * allocate its own id: those are `PLAN-M15.md` P4's job (`forge test binding`, the stateless verb that
 * wraps this function, assembles the full record, and maps its outcome to an exit code). This function
 * is a pure, narrowly-scoped computation — given a story's claim and a project, what actually happened
 * when its implementation was reverted — testable on its own, with no artifact-writing or id-allocation
 * concerns of its own.
 *
 * **Honest about what it proves** (`PLAN-M15.md` P3's own Discloses line): binding to the change as a
 * whole, not per-hunk — a suite where one strong test carries several weak ones is over-credited by a
 * coarse, whole-file revert. Per-test attribution needs per-hunk mutation, not built here.
 *
 * @see specs/13 F-TEST-5
 * @see specs/22 M15 P3
 * @see PLAN-M15.md P3
 */
import type { Clock } from '@forge/core';
import { isTestPath } from '@forge/engine/dispatch';
import {
  createLaneWorktree,
  removeLaneWorktree,
  resetLaneWorktree,
  resolveRevision,
  revertPathsToRevision,
} from '@forge/vcs';

import { runAndNormalize, type TestOutcome } from './reporter.ts';

const BINDING_LANE_STEP_ID = 'test-binding';

export interface BindingCheckInput {
  /** Absolute path to the real project repository — never itself mutated; every real file operation
   * this function performs happens inside its own scratch lane worktree. */
  readonly projectRoot: string;
  readonly runId: string;
  /** For the lane's own branch/path naming only — not otherwise interpreted. */
  readonly storyId: string;
  /** A story's own `files_expected` (`09` §9.3) — split internally into implementation and test paths
   * via `isTestPath`, the identical heuristic `run-plan.ts` already uses for the same split. */
  readonly filesExpected: readonly string[];
  readonly testCommand: string;
  readonly ecosystem: 'js' | 'python';
  /** Where the lane worktree is created from — ordinarily `'HEAD'`: the current state, implementation
   * included. Resolved once, at lane-creation time, into `revertedRange.toSha`. */
  readonly integrationBase: string;
  /** The revision implementation paths are reverted TO — the real "before this story" state. Resolved
   * into `revertedRange.fromSha`. Distinct from `integrationBase`: the lane starts AT the implementation
   * (`toSha`) and reverts specific paths BACK TO this earlier revision (`fromSha`). */
  readonly baseRevision: string;
  readonly clock: Clock;
  /** `QUALITY-BAR.md` R10: `runAndNormalize`'s own injected source of a unique temp file path (its
   * pytest branch's real need) — never this module's own `crypto.randomUUID()`/`os.tmpdir()` call. */
  readonly createTempPath: () => string;
  /** Overrides `reporter.ts`'s own `DEFAULT_TEST_RUN_TIMEOUT_MS` for all three runs this check makes
   * (`specs/22` M16 P10) — omitted, the default applies. The one real caller that ever sets this is
   * `bin.ts`'s own `--timeout-ms` flag on `forge test binding`; a later per-hunk piece (P11-P13) that
   * runs this same check N+3 times per story is the other real reason this exists — a tight override
   * is what keeps that loop fast rather than waiting out the full default on every one of those runs. */
  readonly timeoutMs?: number;
}

export interface BindingCheckCompleted {
  readonly outcome: 'completed';
  /** Every named test the baseline run discovered, by name — the full, real population
   * `failedUnderMutation` is checked to be a subset of. */
  readonly namedTests: readonly string[];
  /** Named tests that failed once the implementation was reverted — the real binding evidence. A test
   * in `namedTests` but NOT here is non-binding: it kept passing with the implementation gone. */
  readonly failedUnderMutation: readonly string[];
  /** Whether every named test passed again after the worktree was restored. `false` here is a real,
   * disclosed engine problem — never conflated with "no tests bind" by a caller. */
  readonly restoreVerified: boolean;
  readonly revertedRange: { readonly fromSha: string; readonly toSha: string };
  readonly ranAt: string;
}

export type BindingCheckOutcome =
  | BindingCheckCompleted
  /** `filesExpected` named no test-shaped path at all (`splitImplementationAndTestPaths` found zero).
   * A real, distinct refusal, checked BEFORE any lane is created: `runAndNormalize`'s own `files`
   * parameter treats an empty array identically to "no scoping at all" (`reporter.ts`'s `runVitest`),
   * which would otherwise silently run and misattribute a project's ENTIRE test suite — the opposite
   * of `PLAN-M15.md` P3's own "run exactly those named tests." A round-1 gauntlet critic reproduced
   * this directly before this outcome existed. */
  | { readonly outcome: 'no-test-paths' }
  /** A named test was already failing before any mutation — "did the revert cause this" is
   * unanswerable, so no binding verdict is reported for any test. */
  | { readonly outcome: 'baseline-not-green'; readonly failing: readonly string[] }
  | { readonly outcome: 'baseline-tool-error'; readonly message: string }
  /** The BASELINE run itself timed out (`specs/22` M16 P10) — genuinely distinct from
   * `'baseline-not-green'`: that outcome means the named tests ran and at least one failed; this one
   * means they never finished at all, so there is no "already failing" fact to report either — binding
   * cannot be established, full stop, before any revert is even attempted. */
  | { readonly outcome: 'baseline-timeout' }
  /** The BASELINE run completed (no tool-error, no timeout) but matched or collected ZERO real
   * tests (`specs/22` M16 P10, a fresh critic round) — confirmed directly: a real vitest run whose
   * `testPaths` positional argument matches nothing on disk reports a genuine, well-formed, EMPTY
   * `testResults: []`, not an error of any kind `reporter.ts`'s own shape-validation (M16 P10) can
   * catch. Checked before `namedTests` is computed: an empty baseline is not "genuinely green," it
   * is "nothing was verified," and reporting `'completed'` with `namedTests: []` would be exactly the
   * vacuous, uncatchable pass `run.ts`'s own identical `outcomes.length === 0` guard already refuses
   * for the sibling `forge test run` path. */
  | { readonly outcome: 'baseline-zero-outcomes' }
  | { readonly outcome: 'mutated-tool-error'; readonly message: string }
  /** The MUTATED (reverted) run itself timed out (`specs/22` M16 P10) — a sibling of
   * `'mutated-tool-error'`, not the `'completed'` shape: the run never finished, so nothing it was
   * running can be reported as `failedUnderMutation` (real binding evidence) OR as non-binding
   * (a test that "kept passing" when it never got the chance to). Returned BEFORE
   * `namesFailedUnderMutation` is ever called with this run's own outcomes — `13` F-TEST-10's own "do
   * not let a timeout masquerade as a fail that then gets credited as real binding evidence." */
  | { readonly outcome: 'mutated-timeout' }
  /** The MUTATED run completed but matched or collected ZERO real tests (`specs/22` M16 P10) — the
   * identical "a well-formed, genuinely empty report is not evidence of anything" fact
   * `'baseline-zero-outcomes'` names, at the revert phase instead: `failedUnderMutation` would
   * otherwise silently compute to `[]` from an input that proves nothing, not from tests that
   * genuinely kept passing. */
  | { readonly outcome: 'mutated-zero-outcomes' }
  | { readonly outcome: 'restore-verification-tool-error'; readonly message: string };

/**
 * Maps a mutated-run's real outcomes back to the baseline's own named tests — `mutatedOutcomes` is
 * never trusted to name tests by the same strings `namedTests` does, because `reporter.ts`'s own
 * vitest/pytest normalisation reports a file that fails to even LOAD (an unresolved import — exactly
 * what reverting an implementation file a test imports produces) as one synthetic outcome whose own
 * `name` is `"<file> (file failed to load: <detail>)"`, not the real test names inside it (vitest
 * never got far enough to discover them). Confirmed directly, not assumed: a round-1 fixture-repo test
 * against this exact shape failed before this mapping existed, with the synthetic file-failure string
 * appearing in `failedUnderMutation` instead of the real, binding test's own name.
 *
 * A mutated outcome whose `name` matches a known named test exactly uses its own real `status`. An
 * unmatched outcome (a file-level failure) is attributed to EVERY named test the baseline discovered
 * in that same file (`TestOutcome.file`, populated identically by both runs) — the whole file could not
 * run, so none of its own named tests ran either, which is real binding evidence for each of them, not
 * information to silently drop because the string itself does not match.
 *
 * Never reached with a `kind: 'timeout'` outcome (`specs/22` M16 P10): `runBindingCheck`'s own caller
 * returns `'mutated-timeout'` before this function is ever invoked with one, so there is nothing to
 * special-case here — an earlier draft added a redundant `kind === 'timeout'` guard in this loop
 * anyway, found to be dead code unreachable through the public `runBindingCheck` entry point (R5: a
 * branch a test can only reach by calling this un-exported function directly, bypassing the real
 * caller's own guard, is not a real branch to keep) and removed. The structural fact that still holds
 * even if that caller-side guard were ever weakened: `reporter.ts`'s own synthetic timeout outcome
 * carries no `file` and a `name` no real test shares, so the two checks below would already decline
 * to credit it.
 */
function namesFailedUnderMutation(
  namedTestsByFile: ReadonlyMap<string, readonly string[]>,
  knownNames: ReadonlySet<string>,
  mutatedOutcomes: readonly TestOutcome[],
): readonly string[] {
  const failed = new Set<string>();
  for (const outcome of mutatedOutcomes) {
    if (outcome.status !== 'fail') continue;
    if (knownNames.has(outcome.name)) {
      failed.add(outcome.name);
      continue;
    }
    if (outcome.file === undefined) continue;
    for (const name of namedTestsByFile.get(outcome.file) ?? []) failed.add(name);
  }
  return [...failed];
}

/** The real split `PLAN-M15.md` P3's own Mandate names: "the implementation change set (the story's
 * claim less its declared test paths)." Exported so a caller assembling a `MutationEvidence` record
 * can report which paths were actually reverted without re-deriving the split itself.
 *
 * `isTestPath`, not `resolveStepClaim` — a disclosed deviation from `PLAN-M15.md` P3's own Surface
 * line, which names `resolveStepClaim` (`packages/engine/src/dispatch/outputs.ts`) for this split.
 * Checked directly before choosing: `resolveStepClaim` resolves a workflow STEP's own write-claim
 * globs from a compiled `StepNode`, not a concrete per-path test/implementation split from a plain
 * `files_expected` string array — using it here would mean synthesizing a fake `StepNode` purely to
 * reach a glob-match result `isTestPath` already gives directly, for the identical, already-proven
 * heuristic `run-plan.ts`'s own production code already applies to the same field (`files_expected.
 * filter(isTestPath)`). The Plan's own Surface line appears to have assumed a tighter structural
 * connection between the two than the real code supports. */
export function splitImplementationAndTestPaths(filesExpected: readonly string[]): {
  readonly implementationPaths: readonly string[];
  readonly testPaths: readonly string[];
} {
  const implementationPaths: string[] = [];
  const testPaths: string[] = [];
  for (const file of filesExpected) {
    (isTestPath(file) ? testPaths : implementationPaths).push(file);
  }
  return { implementationPaths, testPaths };
}

export async function runBindingCheck(input: BindingCheckInput): Promise<BindingCheckOutcome> {
  const { implementationPaths, testPaths } = splitImplementationAndTestPaths(input.filesExpected);
  // Checked before any lane exists: `runAndNormalize`'s own `files` parameter treats `[]` identically
  // to "no scoping at all" (see this outcome's own doc comment above) — an empty `testPaths` is never
  // a safe "run everything" fallback here, it is a real precondition failure this function must refuse
  // outright, the same way `createLaneWorktree` is never reached for any other refused input either.
  if (testPaths.length === 0) {
    return { outcome: 'no-test-paths' };
  }

  const lane = await createLaneWorktree(input.projectRoot, {
    runId: input.runId,
    stepId: `${BINDING_LANE_STEP_ID}-${input.storyId}`,
    integrationBase: input.integrationBase,
  });
  try {
    const toSha = await resolveRevision(lane.path, 'HEAD');
    const fromSha = await resolveRevision(lane.path, input.baseRevision);

    const baseline = await runAndNormalize(
      input.testCommand,
      lane.path,
      input.ecosystem,
      input.createTempPath,
      undefined,
      undefined,
      testPaths,
      input.timeoutMs,
    );
    if (baseline.outcome === 'tool-error') {
      return { outcome: 'baseline-tool-error', message: baseline.message };
    }
    // Checked BEFORE `namedTests` is even computed (`specs/22` M16 P10): a baseline timeout means the
    // named tests this check would discover never finished running at all — there is no "already
    // failing" fact here the way `'baseline-not-green'` reports one, so that outcome would misreport
    // what actually happened.
    if (baseline.report.outcomes.some((outcome) => outcome.kind === 'timeout')) {
      return { outcome: 'baseline-timeout' };
    }
    // `specs/22` M16 P10 (a fresh critic round): a real vitest/pytest run that matched or collected
    // ZERO tests is a genuine, well-formed, EMPTY report — not malformed (`reporter.ts`'s own
    // shape-validation does not and should not refuse it) and not a timeout — so neither check above
    // catches it. Confirmed directly: `testPaths` naming a file vitest's own positional matching
    // fails to resolve to anything reports exactly this. Reported as `'completed'` with
    // `namedTests: []` it would read as "genuinely green, nothing to revert" -- a vacuous pass this
    // check must refuse the same way `run.ts`'s own identical `outcomes.length === 0` guard already
    // does for `forge test run`.
    if (baseline.report.outcomes.length === 0) {
      return { outcome: 'baseline-zero-outcomes' };
    }
    const namedTests = baseline.report.outcomes.map((outcome) => outcome.name);
    const failingAtBaseline = baseline.report.outcomes
      .filter((outcome) => outcome.status === 'fail')
      .map((outcome) => outcome.name);
    if (failingAtBaseline.length > 0) {
      return { outcome: 'baseline-not-green', failing: failingAtBaseline };
    }
    const knownNames = new Set(namedTests);
    const namedTestsByFile = new Map<string, string[]>();
    for (const outcome of baseline.report.outcomes) {
      if (outcome.file === undefined) continue;
      const existing = namedTestsByFile.get(outcome.file);
      if (existing === undefined) namedTestsByFile.set(outcome.file, [outcome.name]);
      else existing.push(outcome.name);
    }

    await revertPathsToRevision(lane, fromSha, implementationPaths);
    const mutated = await runAndNormalize(
      input.testCommand,
      lane.path,
      input.ecosystem,
      input.createTempPath,
      undefined,
      undefined,
      testPaths,
      input.timeoutMs,
    );
    if (mutated.outcome === 'tool-error') {
      return { outcome: 'mutated-tool-error', message: mutated.message };
    }
    // Checked BEFORE `namesFailedUnderMutation` is ever called (`specs/22` M16 P10): a mutated run
    // that times out proves nothing about any test — crediting it as `'completed'` with an empty
    // `failedUnderMutation` would read as "every test is non-binding," which is a different, false
    // claim from "this check could not finish." See `BindingCheckOutcome.mutated-timeout`'s own doc
    // comment for the fuller reasoning, and `namesFailedUnderMutation`'s own doc comment for why it
    // needs no matching guard of its own: this check already keeps it from ever seeing one.
    if (mutated.report.outcomes.some((outcome) => outcome.kind === 'timeout')) {
      return { outcome: 'mutated-timeout' };
    }
    // `specs/22` M16 P10: the identical "a well-formed, genuinely empty report proves nothing" fact
    // the baseline check above already refuses -- here, crediting it as `'completed'` with
    // `failedUnderMutation: []` would read as "every test kept passing under mutation" (non-binding,
    // by name), when in truth NONE of them ran at all to even have an opinion.
    if (mutated.report.outcomes.length === 0) {
      return { outcome: 'mutated-zero-outcomes' };
    }
    const failedUnderMutation = namesFailedUnderMutation(
      namedTestsByFile,
      knownNames,
      mutated.report.outcomes,
    );

    await resetLaneWorktree(lane, toSha);
    const restored = await runAndNormalize(
      input.testCommand,
      lane.path,
      input.ecosystem,
      input.createTempPath,
      undefined,
      undefined,
      testPaths,
      input.timeoutMs,
    );
    if (restored.outcome === 'tool-error') {
      return { outcome: 'restore-verification-tool-error', message: restored.message };
    }
    // A restore-run timeout gets no dedicated outcome of its own: its own synthetic outcome's
    // `status: 'fail'` already makes `.every(... === 'pass')` false below, the identical "a real,
    // disclosed engine problem" signal a genuinely failed restore already reports via
    // `restoreVerified: false` (`BindingCheckCompleted`'s own doc comment) — a caller cannot mistake
    // either case for binding evidence, since `restoreVerified` never feeds `failedUnderMutation`.
    // The `.length > 0` guard (`specs/22` M16 P10, a fresh critic round) closes the identical
    // zero-outcomes gap the baseline and mutated phases both got a dedicated outcome for, here folded
    // into the boolean instead: `[].every(...)` is VACUOUSLY true in JS, so a restore run that
    // matched zero tests would otherwise report "verified" having proven nothing at all.
    const restoreVerified =
      restored.report.outcomes.length > 0 &&
      restored.report.outcomes.every((outcome) => outcome.status === 'pass');

    return {
      outcome: 'completed',
      namedTests,
      failedUnderMutation,
      restoreVerified,
      revertedRange: { fromSha, toSha },
      ranAt: input.clock.now(),
    };
  } finally {
    // Never retained: unlike `loop/debug.ts`'s own RCA lane (which keeps a *recorded fix* for human
    // review), nothing this function ever produces is worth keeping a worktree alive for -- a caller
    // investigating an `engine-failure`-shaped outcome has the returned `message`/`failing` detail, not
    // a lane to inspect. `VcsError` from this call itself is deliberately allowed to propagate (never
    // swallowed) -- a lane that fails to clean up is a real, disclosed problem, not a silent no-op.
    await removeLaneWorktree(input.projectRoot, lane, { retain: false });
  }
}
