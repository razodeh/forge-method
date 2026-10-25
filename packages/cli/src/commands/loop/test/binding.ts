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
import { ProjectPaths } from '@forge/core/fs';
import { isTestPath } from '@forge/engine/dispatch';
import type { StructuredTestCommand } from '@forge/schemas/config';
import {
  createLaneWorktree,
  removeLaneWorktree,
  resetLaneWorktree,
  resolveRevision,
  revertPathsToRevision,
  type LaneHandle,
} from '@forge/vcs';

import {
  renderTestCommandTemplate,
  runAndNormalize,
  runStructuredTestLayer,
  withTimeoutOverride,
  type RunAndNormalizeResult,
  type TestOutcome,
} from './reporter.ts';

const BINDING_LANE_STEP_ID = 'test-binding';

/**
 * Which real test-layer command this check runs, and how (`specs/22` M17 P4): the ORIGINAL M15 legacy
 * pair (a bare shell string plus the `detectEcosystem`-chosen ecosystem that picks vitest-JSON-or-
 * pytest-JUnit reading), or a structured `testCommands.<layer>` entry (`18` §18.3). A discriminated
 * union, not two independently-optional fields, so a caller can never construct the nonsensical "both"
 * or "neither" shape, and `canScopeTestLayer`/`runScopedLayer` below narrow on it with no extra guard.
 *
 * @see specs/18 §18.3
 * @see specs/22 M17 P4
 */
export type TestLayerIdentity =
  | { readonly testCommand: string; readonly ecosystem: 'js' | 'python' }
  | { readonly structuredCommand: StructuredTestCommand };

export type BindingCheckInput = BindingCheckInputCommon & TestLayerIdentity;

interface BindingCheckInputCommon {
  /** Absolute path to the real project repository — never itself mutated; every real file operation
   * this function performs happens inside its own scratch lane worktree. */
  readonly projectRoot: string;
  readonly runId: string;
  /** For the lane's own branch/path naming only — not otherwise interpreted. */
  readonly storyId: string;
  /** A story's own `files_expected` (`09` §9.3) — split internally into implementation and test paths
   * via `isTestPath`, the identical heuristic `run-plan.ts` already uses for the same split. */
  readonly filesExpected: readonly string[];
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
  /** The real environment every real run this check makes executes with (`bin.ts`'s own
   * `realEnvSnapshot()`, R10). Absent (a bare, env-less test call): `runAndNormalize`/
   * `runStructuredTestLayer` keep `shell: true` unconditionally — their own pre-existing fallback,
   * never a regression; only a caller that supplies a real one gets `resolvePosixShell` consulted
   * for it on Windows. */
  readonly env?: Readonly<Record<string, string>>;
}

/** `true` iff `input`'s own test-layer command can be run scoped to a closed set of real test paths
 * at all: a legacy string (`runAndNormalize`'s own native file-positional support, always) or a
 * structured entry that declares a `scope` template (`18` §18.3). `false` only for a structured entry
 * with none — see `runScopedLayer`'s own doc comment for why this is a refusal rather than a
 * degradation for THIS consumer, unlike `reporter.ts`'s own `runTestLayerCommand`. Checked once, by
 * both real callers (`runBindingCheck` below, `hunk-mutation.ts`'s own `runHunkMutationCheck`),
 * BEFORE any lane is ever created — a refusal this cheap costs nothing. */
export function canScopeTestLayer(input: TestLayerIdentity): boolean {
  return 'testCommand' in input || input.structuredCommand.scope !== undefined;
}

/**
 * Runs `input`'s own test-layer command, scoped to exactly `testPaths` — the one dispatcher every
 * baseline/mutated/restore run in this module, and every hunk/file mutant run in `hunk-mutation.ts`,
 * goes through, legacy or structured alike.
 *
 * Never called when `canScopeTestLayer(input)` is `false`: both real callers check that first and
 * return `BindingCheckOutcome`'s own `'structured-layer-needs-scope'` refusal instead of ever reaching
 * here (enforced by the `throw` below, which only a test calling this function directly, bypassing
 * both real entry points, could ever reach — R5: not a real branch to keep silent about).
 *
 * **DECISION** (`PLAN-M17.md` P4's own report has the full reasoning): a structured layer with NO
 * `scope` is a typed refusal here, never `reporter.ts`'s own `runTestLayerCommand`-style whole-suite
 * degradation. Binding's own mutation-credit algorithm (`runChangeLevelCheck` below) needs `namedTests`
 * to be a CLOSED, correctly-scoped population — "this story's own tests, and only those" — to mean
 * anything at all: running the whole project's suite instead and keeping every outcome would silently
 * fold unrelated tests into that population (an unrelated pre-existing failure anywhere in the project
 * would misreport `baseline-not-green` for a story that has nothing to do with it); trying to recover
 * the scoped subset afterward by matching `TestOutcome.file` against `testPaths` is not a safe,
 * format-independent operation either — confirmed directly against this codebase's own built-in
 * parsers: `vitest-json`/`jest-json` report an ABSOLUTE, realpath-resolved file (`reporter.ts`'s own
 * `runVitest` doc comment has the fuller reasoning for why that is not directly comparable to
 * `testPaths`'s project-relative form without guessing), `tap`/`go-test-json` report no file at all,
 * and `junit-xml` reports one only for the Mocha dialect. A silently wrong match — crediting an
 * unrelated test's failure as this story's own binding evidence, or the reverse — is worse than a
 * typed refusal that names exactly what to declare. The budget this piece sets for binding/hunk-
 * mutation's whole-suite fallback is therefore zero: `scope` must be declared, or the check refuses.
 *
 * @see specs/18 §18.3
 * @see specs/22 M17 P4
 */
export async function runScopedLayer(
  input: BindingCheckInput,
  cwd: string,
  testPaths: readonly string[],
): Promise<Exclude<RunAndNormalizeResult, { readonly outcome: 'missing-command' }>> {
  if ('testCommand' in input) {
    return runAndNormalize(
      input.testCommand,
      cwd,
      input.ecosystem,
      input.createTempPath,
      undefined,
      undefined,
      testPaths,
      input.timeoutMs,
      input.env,
    );
  }
  const { structuredCommand } = input;
  if (structuredCommand.scope === undefined) {
    throw new Error(
      'forge/binding: unreachable: runScopedLayer called with no scope declared -- canScopeTestLayer must be checked first.',
    );
  }
  // `input.timeoutMs` (`bin.ts`'s own `--timeout-ms` flag): `withTimeoutOverride` (`reporter.ts`)
  // is where this lands -- see its own doc comment for why `runStructuredTestLayer` itself needs no
  // change. A critic round reproduced directly that the first draft passed `structuredCommand`
  // straight through unmodified, silently dropping this override for every structured, scoped run.
  const rendered = renderTestCommandTemplate(structuredCommand.scope, { files: testPaths });
  return runStructuredTestLayer(
    withTimeoutOverride(structuredCommand, input.timeoutMs),
    cwd,
    new ProjectPaths(cwd),
    input.createTempPath,
    rendered,
    input.env,
  );
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
  /** `input`'s own structured test-layer command declares no `scope` template (`specs/22` M17 P4,
   * `18` §18.3's degradation table) — checked BEFORE any lane is created, the identical "a real,
   * distinct refusal, cheap to report" treatment `'no-test-paths'` above already gets. See
   * `runScopedLayer`'s own doc comment (this file) for why this is a refusal rather than a
   * whole-suite degradation for this consumer specifically. */
  | { readonly outcome: 'structured-layer-needs-scope' }
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
 * unmatched outcome WITH a usable `file` (one `namedTestsByFile` actually has an entry for —
 * `TestOutcome.file`, populated identically by both runs) is attributed to EVERY named test the
 * baseline discovered in that same file — the whole file could not run, so none of its own named
 * tests ran either, which is real binding evidence for each of them, not information to silently
 * drop because the string itself does not match.
 *
 * **An unmatched outcome with NO usable file attribution at all — `file` absent, or set to
 * something `namedTestsByFile` has no entry for — is attributed to EVERY named test the BASELINE
 * discovered, project-wide, not silently dropped** (`specs/22` M17 P4, a critic round's own direct
 * reproduction, the most severe finding against this piece: a structured layer's own chosen
 * `format` can genuinely have no way to signal which file crashed at all — confirmed directly
 * against a real `node --test --test-reporter=junit` run where a reverted `require('./impl.js')`
 * crashes the whole file before any test registers: Node's own JUnit reporter emits one synthetic
 * `<testcase name="impl.test.js">` — named after the FILE, not any real test, with no file
 * attribute whatsoever, since `junit-xml.ts`'s own parser, confirmed directly against pytest,
 * Jest+jest-junit, this monorepo's own Vitest and Node's own `--test-reporter=junit`, never reads
 * one for any of those four real dialects — every KNOWN test silently read as "kept passing," a
 * false `non-binding`/`uncovered` verdict for a revert that genuinely broke everything, the exact
 * inverse of what a mutation check exists to prove). This is DELIBERATELY the widest possible
 * fallback, not the narrowest: with no file to narrow by, crediting every known test NOT already
 * confirmed otherwise (rather than guessing at a subset, or dropping the signal) is the one choice
 * that can never again produce that false negative.
 *
 * **"Every known test" excludes any test with its OWN real, directly-matched, NON-failing outcome
 * elsewhere in this SAME run** (`confirmedPassing`, below — `specs/22` M17 P4, a second critic
 * round's own direct construction): a story with a genuinely non-binding "pure tautology" test in
 * its OWN, unaffected file, run alongside the real "adds two numbers" whose own file crashes under
 * mutation, must not have the tautology swept up by the fallback purely because an UNRELATED file
 * in the same run happened to crash — that would be exactly the false "this is bound" result
 * `test:binding` exists to prevent, the mirror image of the false negative above. This exclusion is
 * evidence-scoped, not file-scoped: it does not try to reconstruct which file the unattributed
 * failure came from (the whole problem is that nothing in the run says), it only withholds credit
 * from a name this run can directly, positively vouch for.
 *
 * The residual, accepted cost is narrower than the original bug and strictly one-directional: a
 * name with NO other outcome at all in this run (one whose own file ALSO never ran, for an
 * unrelated reason, and which the baseline nonetheless discovered) is still credited by the
 * project-wide fallback — a real, disclosed over-credit risk, never a silent drop, and never
 * reachable for a test the run can actually show was fine (the identical "a stillborn mutant proves
 * nothing, but a vacuous pass proves nothing EITHER, so never read ambiguity as success" principle
 * this whole file already applies everywhere else: the `*-zero-outcomes` outcomes, the
 * `restoreVerified` zero-length guard).
 *
 * Never reached with a `kind: 'timeout'` outcome (`specs/22` M16 P10): `runBindingCheck`'s own caller
 * returns `'mutated-timeout'` before this function is ever invoked with one, so there is nothing to
 * special-case here — an earlier draft added a redundant `kind === 'timeout'` guard in this loop
 * anyway, found to be dead code unreachable through the public `runBindingCheck` entry point (R5: a
 * branch a test can only reach by calling this un-exported function directly, bypassing the real
 * caller's own guard, is not a real branch to keep) and removed.
 */
function namesFailedUnderMutation(
  namedTestsByFile: ReadonlyMap<string, readonly string[]>,
  knownNames: ReadonlySet<string>,
  mutatedOutcomes: readonly TestOutcome[],
): readonly string[] {
  // Names with their OWN real, directly-matched, NON-failing outcome somewhere in THIS SAME run --
  // confirmed fine, and never overridden by the project-wide fallback below, however many unrelated
  // whole-file crashes that fallback also fires for (`specs/22` M17 P4, a critic round's own direct
  // construction: a story with a genuinely non-binding "pure tautology" test living in its OWN,
  // unaffected file, plus the real "adds two numbers" test whose own file crashes under mutation --
  // without this exclusion, the project-wide fallback below would credit the tautology too, purely
  // because SOME OTHER, unrelated file in the same run happened to crash, which is exactly the false
  // "this test is bound" result `test:binding` exists to prevent). Computed once, over every
  // outcome, before the main loop below ever applies the fallback -- order-independent, so it does
  // not matter whether the confirming "pass" outcome or the fallback-triggering one comes first in
  // `mutatedOutcomes`.
  const confirmedPassing = new Set<string>();
  for (const outcome of mutatedOutcomes) {
    if (outcome.status !== 'fail' && knownNames.has(outcome.name)) {
      confirmedPassing.add(outcome.name);
    }
  }
  const fallbackNames = [...knownNames].filter((name) => !confirmedPassing.has(name));

  const failed = new Set<string>();
  for (const outcome of mutatedOutcomes) {
    if (outcome.status !== 'fail') continue;
    if (knownNames.has(outcome.name)) {
      failed.add(outcome.name);
      continue;
    }
    const namesInFile = outcome.file === undefined ? undefined : namedTestsByFile.get(outcome.file);
    if (namesInFile !== undefined) {
      for (const name of namesInFile) failed.add(name);
      continue;
    }
    // No usable file attribution at all -- see this function's own doc comment for the full
    // reasoning. Credits every known test NOT already confirmed passing above, never silently
    // drops the signal, and never overrides a test's own, separately-observed real result.
    for (const name of fallbackNames) failed.add(name);
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

/**
 * Creates the one scratch lane `runBindingCheck` and (`specs/22` M16 P12) the hunk-mutation engine
 * both run their own real work against — extracted so both create it identically, from one call
 * shape, rather than two independently-drifting `createLaneWorktree` calls. The caller owns removal
 * (`removeLaneWorktree`, in its own `try`/`finally` around whatever it does with the lane this
 * returns) — this function's own job is creation alone, so that EITHER caller's exception-safety
 * guarantee ("the lane is removed on every exit path, normal or thrown") lives in exactly the frame
 * that holds the handle, never split across two functions that could disagree about who cleans up.
 *
 * @see specs/22 M15 P3
 * @see specs/22 M16 P12
 */
export async function createBindingLane(input: BindingCheckInput): Promise<LaneHandle> {
  return createLaneWorktree(input.projectRoot, {
    runId: input.runId,
    stepId: `${BINDING_LANE_STEP_ID}-${input.storyId}`,
    integrationBase: input.integrationBase,
  });
}

/**
 * Everything a hunk-mode caller (`specs/22` M16 P12's own `hunk-mutation.ts`) needs, beyond the plain
 * `BindingCheckOutcome`, to keep mutating the SAME already-open lane once the change-level check
 * reaches `'completed'` — present only then (every other outcome means there is no trustworthy green
 * baseline to mutate against at all, so hunk mode stops at the identical point `runBindingCheck`
 * itself would have returned early). `toSha`/`fromSha` are the resolved shas the restore step has
 * already reset the lane back to and reverted from, respectively — a hunk mutant's own "fresh
 * reset-to-HEAD tree" (`13` F-TEST-10) is `resetLaneWorktree(lane, toSha)`, the identical call this
 * function's own restore phase already made once. `namedTestsByFile`/`knownNames` are the identical
 * baseline-derived maps `namesFailedUnderMutation` already closes over, re-exposed (not re-computed)
 * so a hunk's own per-test, per-KIND attribution can reuse the SAME name/file-matching mechanism
 * without this file's own private helper having to change its return type to carry a `kind` the
 * change-level verdict never needed. `mutatedOutcomes` is the raw outcomes of the already-completed,
 * whole-change mutant run — the one a `granularity: 'change'` hunk report relabels rather than
 * re-running (`specs/22` M16 P12's own Mandate: "just runBindingCheck's own existing single mutant,
 * relabelled, not a new code path").
 */
export interface ForHunkMode {
  readonly toSha: string;
  readonly fromSha: string;
  readonly namedTestsByFile: ReadonlyMap<string, readonly string[]>;
  readonly knownNames: ReadonlySet<string>;
  readonly mutatedOutcomes: readonly TestOutcome[];
}

/** `runChangeLevelCheck`'s own return shape: the plain outcome every caller (hunked or not) reports,
 * plus (`specs/22` M16 P12) `forHunkMode`, populated if and only if `outcome.outcome === 'completed'`. */
export interface ChangeLevelCheckResult {
  readonly outcome: BindingCheckOutcome;
  readonly forHunkMode?: ForHunkMode;
}

/**
 * Runs M15's own three-phase change-level check (baseline/revert/restore) against an ALREADY-OPEN
 * lane — the exact body `runBindingCheck`'s own `try` block used to run directly, extracted
 * (`specs/22` M16 P12) so a caller that wants to keep running MORE mutants against the SAME lane
 * afterward (the hunk-mutation engine) can call this directly, once, inside its own
 * `createBindingLane`/`removeLaneWorktree` pair, instead of going through `runBindingCheck` (which
 * would create a SECOND lane and re-run these same three phases a second time — exactly the
 * "N + 3 runs," never "N + 6," cost `13` F-TEST-10 states). Never creates or removes `lane` itself:
 * if this throws, the lane is left open for the CALLER's own `finally` to reclaim, identically to how
 * `runBindingCheck`'s own `finally` already reclaims a throw from this exact body today.
 *
 * @see specs/22 M15 P3
 * @see specs/22 M16 P12
 */
export async function runChangeLevelCheck(
  lane: LaneHandle,
  input: BindingCheckInput,
  implementationPaths: readonly string[],
  testPaths: readonly string[],
): Promise<ChangeLevelCheckResult> {
  const toSha = await resolveRevision(lane.path, 'HEAD');
  const fromSha = await resolveRevision(lane.path, input.baseRevision);

  const baseline = await runScopedLayer(input, lane.path, testPaths);
  if (baseline.outcome === 'tool-error') {
    return { outcome: { outcome: 'baseline-tool-error', message: baseline.message } };
  }
  // Checked BEFORE `namedTests` is even computed (`specs/22` M16 P10): a baseline timeout means the
  // named tests this check would discover never finished running at all — there is no "already
  // failing" fact here the way `'baseline-not-green'` reports one, so that outcome would misreport
  // what actually happened.
  if (baseline.report.outcomes.some((outcome) => outcome.kind === 'timeout')) {
    return { outcome: { outcome: 'baseline-timeout' } };
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
    return { outcome: { outcome: 'baseline-zero-outcomes' } };
  }
  const namedTests = baseline.report.outcomes.map((outcome) => outcome.name);
  const failingAtBaseline = baseline.report.outcomes
    .filter((outcome) => outcome.status === 'fail')
    .map((outcome) => outcome.name);
  if (failingAtBaseline.length > 0) {
    return { outcome: { outcome: 'baseline-not-green', failing: failingAtBaseline } };
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
  const mutated = await runScopedLayer(input, lane.path, testPaths);
  if (mutated.outcome === 'tool-error') {
    return { outcome: { outcome: 'mutated-tool-error', message: mutated.message } };
  }
  // Checked BEFORE `namesFailedUnderMutation` is ever called (`specs/22` M16 P10): a mutated run
  // that times out proves nothing about any test — crediting it as `'completed'` with an empty
  // `failedUnderMutation` would read as "every test is non-binding," which is a different, false
  // claim from "this check could not finish." See `BindingCheckOutcome.mutated-timeout`'s own doc
  // comment for the fuller reasoning, and `namesFailedUnderMutation`'s own doc comment for why it
  // needs no matching guard of its own: this check already keeps it from ever seeing one.
  if (mutated.report.outcomes.some((outcome) => outcome.kind === 'timeout')) {
    return { outcome: { outcome: 'mutated-timeout' } };
  }
  // `specs/22` M16 P10: the identical "a well-formed, genuinely empty report proves nothing" fact
  // the baseline check above already refuses -- here, crediting it as `'completed'` with
  // `failedUnderMutation: []` would read as "every test kept passing under mutation" (non-binding,
  // by name), when in truth NONE of them ran at all to even have an opinion.
  if (mutated.report.outcomes.length === 0) {
    return { outcome: { outcome: 'mutated-zero-outcomes' } };
  }
  const failedUnderMutation = namesFailedUnderMutation(
    namedTestsByFile,
    knownNames,
    mutated.report.outcomes,
  );

  await resetLaneWorktree(lane, toSha);
  const restored = await runScopedLayer(input, lane.path, testPaths);
  if (restored.outcome === 'tool-error') {
    return { outcome: { outcome: 'restore-verification-tool-error', message: restored.message } };
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
    outcome: {
      outcome: 'completed',
      namedTests,
      failedUnderMutation,
      restoreVerified,
      revertedRange: { fromSha, toSha },
      ranAt: input.clock.now(),
    },
    forHunkMode: {
      toSha,
      fromSha,
      namedTestsByFile,
      knownNames,
      mutatedOutcomes: mutated.report.outcomes,
    },
  };
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
  // Checked before any lane exists, the identical "cheap, before any real work" treatment the guard
  // just above already gets (`specs/22` M17 P4, `canScopeTestLayer`'s own doc comment has the full
  // reasoning for why this is a refusal rather than a degradation).
  if (!canScopeTestLayer(input)) {
    return { outcome: 'structured-layer-needs-scope' };
  }

  const lane = await createBindingLane(input);
  try {
    const result = await runChangeLevelCheck(lane, input, implementationPaths, testPaths);
    return result.outcome;
  } finally {
    // Never retained: unlike `loop/debug.ts`'s own RCA lane (which keeps a *recorded fix* for human
    // review), nothing this function ever produces is worth keeping a worktree alive for -- a caller
    // investigating an `engine-failure`-shaped outcome has the returned `message`/`failing` detail, not
    // a lane to inspect. `VcsError` from this call itself is deliberately allowed to propagate (never
    // swallowed) -- a lane that fails to clean up is a real, disclosed problem, not a silent no-op.
    await removeLaneWorktree(input.projectRoot, lane, { retain: false });
  }
}
