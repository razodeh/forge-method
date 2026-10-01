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
  | { readonly outcome: 'mutated-tool-error'; readonly message: string }
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
    );
    if (baseline.outcome === 'tool-error') {
      return { outcome: 'baseline-tool-error', message: baseline.message };
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
    );
    if (mutated.outcome === 'tool-error') {
      return { outcome: 'mutated-tool-error', message: mutated.message };
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
    );
    if (restored.outcome === 'tool-error') {
      return { outcome: 'restore-verification-tool-error', message: restored.message };
    }
    const restoreVerified = restored.report.outcomes.every((outcome) => outcome.status === 'pass');

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
