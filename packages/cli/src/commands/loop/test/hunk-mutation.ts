/**
 * `runHunkMutationCheck` — `specs/22` M16 P12: `forge test binding --hunks`, the per-hunk mutation
 * engine. Runs `binding.ts`'s own M15 three-phase change-level check (baseline/revert/restore)
 * EXACTLY as `runBindingCheck` already does — byte-identical public behaviour for a caller that never
 * engages hunk mode, proven in `binding.test.ts`/`bin-binding.test.ts` by the refactor this piece's
 * own report records, and by this piece's own golden-equivalence test — and then, inside the SAME
 * already-open lane worktree (`binding.ts`'s own `createBindingLane`/`runChangeLevelCheck`, extracted
 * for exactly this reuse), for each of P11's real hunks over the story's implementation paths: applies
 * that one hunk's own reversal, runs the story's tests scoped exactly as the change-level check does,
 * classifies the result into one of five verdicts, then resets the lane back to `HEAD` before the next
 * mutant. Report-only: a hunk's own verdict never affects the exit code, which follows the
 * change-level result exactly as it does without `--hunks` (`13` F-TEST-10).
 *
 * **Granularity and `--max-hunks`.** Above `--max-hunks` real hunks, every hunk of one path collapses
 * into a single whole-file revert-and-run (`granularity: 'file'`); above `--max-hunks` distinct
 * *files* needing one, every hunk collapses into the single whole-change mutant the change-level check
 * already ran (`granularity: 'change'`) — relabelled, not re-run (zero extra test-command invocations:
 * the change-level check's own `mutated` run is reused verbatim). `hunks[]` always lists every real
 * hunk `computeHunks` returned, whatever the granularity: hunks sharing one path (at `file`) or every
 * hunk (at `change`) simply share the identical verdict the one, coarser mutant actually produced —
 * never a silently dropped subset (`13` F-TEST-10: "it never samples... a sampled result would read as
 * a verdict on hunks that were never run").
 *
 * **The load-failure credit rule tracks the MUTANT that actually ran, not the hunk's own nominal
 * kind.** A lone `TextHunk`, reversed alone at `granularity: 'hunk'`, is `invalid` when every failure
 * it causes is a `load` failure (a stillborn mutant proves nothing about an assertion). The identical
 * `TextHunk`, collapsed into a whole-file revert at `granularity: 'file'` (or the whole-change revert
 * at `granularity: 'change'`), takes the change-level load-failure credit instead — because the revert
 * that actually ran there is a whole-file (or whole-change) revert, the SAME mutant `runBindingCheck`'s
 * own single mutant phase already credits a load failure for. A `FileHunk` (added/deleted/binary/
 * mode-only/type-changed/submodule) has no finer form at all, so it always takes that same credit,
 * whatever `granularity` the run reports (`13` F-TEST-10; `hunks.ts`'s own `FileHunkReason`).
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P12
 * @see process/SPEC-QUESTIONS.md Q294 Decision 8, Amendment A12
 */
import { execa } from 'execa';

import {
  removeLaneWorktree,
  resetLaneWorktree,
  revertPathsToRevision,
  wrapGitFailure,
  type LaneHandle,
} from '@forge/vcs';

import {
  createBindingLane,
  runChangeLevelCheck,
  splitImplementationAndTestPaths,
  type BindingCheckInput,
  type BindingCheckOutcome,
  type ForHunkMode,
} from './binding.ts';
import { computeHunks, type Hunk, type TextHunk } from './hunks.ts';
import {
  runAndNormalize,
  type RunAndNormalizeResult,
  type TestFailureKind,
  type TestOutcome,
} from './reporter.ts';

/**
 * The plan's own "about two dozen" (`process/plans/PLAN-M16.md` P12), made concrete: this piece's own
 * chosen default for `--max-hunks` (stated and justified in the builder's own report, per the plan's
 * explicit delegation — "the default for `--max-hunks` is not fixed here... M16 P12 chooses it and
 * states it", `13` F-TEST-10). `bin.ts`'s own `test binding` dispatch uses this when `--max-hunks` is
 * not given.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P12
 */
export const DEFAULT_MAX_HUNKS = 25;

/**
 * One hunk's own real verdict (`13` F-TEST-10). `killedBy` names the tests that demonstrated a real
 * assertion or crash failure (never a test attributed only via a `load` failure, even when that same
 * load failure is what makes the overall verdict `killed` at `file`/`change` granularity — see this
 * module's own header comment) — present if and only if `kind === 'killed'`. `reason` is a short,
 * stated cause, present for `kind === 'invalid'` (`'reversal-failed'` or `'load-failure'`) and for
 * `kind === 'skipped'` (the engine problem that kept the run from proceeding) — omitted (never `undefined`
 * as a value) everywhere else, the identical `exactOptionalPropertyTypes` convention `reporter.ts`'s
 * own `makeOutcome` already establishes.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P12
 */
export type HunkVerdict =
  | { readonly kind: 'killed'; readonly killedBy: readonly string[] }
  | { readonly kind: 'uncovered' }
  | { readonly kind: 'invalid'; readonly reason: 'reversal-failed' | 'load-failure' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'skipped'; readonly reason: string };

/** One hunk's own old/new range (`specs/22` M16 P13) — field for field the same shape
 * `packages/schemas/src/artifacts/mutation-evidence.ts`'s own `hunkRangeSchema` validates
 * (`{start, length}`), so a caller building a `hunkRun` record never has to re-shape this. @see
 * specs/22 M16 P13 */
export interface HunkRange {
  readonly start: number;
  readonly length: number;
}

/** One real hunk `computeHunks` returned, paired with the verdict the mutation engine actually
 * computed for it — `id`/`path` are `hunks.ts`'s own (`TextHunk`/`FileHunk` alike), the natural way to
 * identify a hunk `03` §3.2.5's own row 117 already anticipates ("per-hunk verdict plus whatever
 * identifies it — the hunk's own id from P11 is the natural choice").
 *
 * `ranges`/`contentHash` (`specs/22` M16 P13, additive: every caller of this module before this piece
 * constructed an entry with exactly `{id, path, verdict}`, and `hunk-mutation.test.ts`'s own pre-
 * existing suite, read in full before this change, asserts only `.verdict`/`.id`/`.path` individually
 * or an array's own length — never the whole entry via `toEqual`/`toMatchObject` — so adding fields
 * here breaks no existing assertion). `specs/18` §18.7's own hunk-list bullet names exactly
 * "id, path, ranges, content hash, verdict and killedBy" for the persisted `MutationEvidence` record
 * (`specs/22` M16 P13's own writer, `binding-evidence.ts`), which this module did not previously
 * expose at all — those two values lived only on the `Hunk` (`TextHunk`/`FileHunk`) objects
 * `computeHunks` returns, consumed here for their verdict alone and then discarded.
 *
 * A `TextHunk`-driven entry's `ranges`/`contentHash` are that hunk's own real `oldStart`/`oldCount`/
 * `newStart`/`newCount`/`contentHash` (`hunks.ts`) — zero re-derivation, zero additional git calls,
 * the identical data `runHunkMutants` already holds from its own `computeHunks` call.
 *
 * A `FileHunk`-driven entry (added/deleted/binary/mode-only/type-changed/submodule —
 * `FileHunkReason`) has NEITHER a sub-file range NOR a reversed hunk BODY to hash at all: `FileHunk`
 * itself (`hunks.ts`, M16 P11 — not this piece's file to edit, see this piece's own report) carries
 * only `{kind, id, path, reason}`, no blob ids, no line counts. Rather than fabricate numbers nothing
 * ever computed, or add a second git call this module's own cost budget ("zero additional git calls
 * needed") does not ask for, a `FileHunk`-driven entry's `ranges` is the stated sentinel
 * `{old: {0,0}, new: {0,0}}` — "no sub-file range: the whole file is the one unit of change," a value
 * no REAL `TextHunk` can ever also produce, since a genuine text hunk always changes at least one
 * side's own `length` — and its `contentHash` REUSES the `FileHunk`'s own `id` (already a real sha256
 * digest of `path`+`reason`+old/new git blob ids, `makeFileHunk`, `hunks.ts`) rather than a second,
 * redundant or invented hash: a file-level mutant's own identity IS its own answer to "what changed,"
 * there being no narrower one to compute. DECISION, reported in full by this piece.
 *
 * @see specs/18 §18.7
 * @see specs/22 M16 P13
 */
export interface HunkMutationEntry {
  readonly id: string;
  readonly path: string;
  readonly ranges: { readonly old: HunkRange; readonly new: HunkRange };
  readonly contentHash: string;
  readonly verdict: HunkVerdict;
}

/** `HunkMutationEntry.ranges`/`.contentHash` for one real hunk `computeHunks` returned — see that
 * field's own doc comment for the full reasoning, including the `FileHunk` sentinel. Zero git calls:
 * every value read here is already a field of `hunk` itself. @see specs/22 M16 P13 */
function hunkIdentity(hunk: Hunk): Pick<HunkMutationEntry, 'ranges' | 'contentHash'> {
  if (hunk.kind === 'text') {
    return {
      ranges: {
        old: { start: hunk.oldStart, length: hunk.oldCount },
        new: { start: hunk.newStart, length: hunk.newCount },
      },
      contentHash: hunk.contentHash,
    };
  }
  return {
    ranges: { old: { start: 0, length: 0 }, new: { start: 0, length: 0 } },
    contentHash: hunk.id,
  };
}

/** How the text changes were actually mutated (`13` F-TEST-10): one mutant per hunk, one per file, or
 * one for the whole change — degrading in that order above `--max-hunks`, never by sampling.
 * @see specs/22 M16 P12 */
export type Granularity = 'hunk' | 'file' | 'change';

/** `runHunkMutationCheck`'s own additive report — present on `HunkMutationCheckResult` if and only if
 * the change-level check reached `'completed'` (see that interface's own doc comment for why). `hunks`
 * always lists every real hunk `computeHunks` found over the story's implementation paths, whatever
 * `granularity` ended up governing how they were mutated. @see specs/22 M16 P12 */
export interface HunkMutationReport {
  readonly granularity: Granularity;
  readonly baseSha: string;
  readonly headSha: string;
  readonly diffAlgorithm: 'myers';
  readonly hunks: readonly HunkMutationEntry[];
}

/**
 * `runHunkMutationCheck`'s own return shape. `outcome` is the UNCHANGED `BindingCheckOutcome` the
 * change-level check produced — identical to what `runBindingCheck` would have returned for the same
 * `input` (this piece's own golden-equivalence test proves it byte-for-byte) — and governs the exit
 * code exactly as it does without `--hunks` (`13` F-TEST-10's own "report-only").
 *
 * `hunkMutation` is present only when `outcome.outcome === 'completed'` AND at least one real hunk
 * was found (`specs/22` M16 P13 narrows this from the original M16 P12 "if and only if `'completed'`"
 * — see the second paragraph below for why that was not quite right either).
 *
 * **Every other change-level outcome** (`no-test-paths`, `baseline-not-green`, a tool-error, a
 * timeout, a zero-outcomes run) means the change-level check stopped before any mutant was ever
 * attempted — `runHunkMutants` (and the `computeHunks`/`chooseGranularity` call inside it) is never
 * even reached (`runHunkMutationCheck`'s own body returns right after `runChangeLevelCheck`, before
 * the hunk loop). The REAL reason this omits `hunkMutation` rather than reporting every real hunk
 * `skipped` is therefore not that the shas are unavailable (`runChangeLevelCheck` resolves
 * `toSha`/`fromSha` before the baseline test run even executes, so they ARE already known even when
 * baseline then fails) — it is that no `granularity` was ever actually chosen or acted on: reporting
 * one anyway would misleadingly imply a mutation strategy had been decided and run, when none was.
 * This is a DECISION, recorded and justified in the builder's own report, not a reading `13`
 * F-TEST-10's text forces by itself. The practical margin is wider than either framing suggests:
 * `bin.ts`'s own pre-existing outer shape (unrelated to this decision, shared with the non-hunks path)
 * already collapses the WHOLE envelope to the minimal `{v, ok, problem}` shape for every
 * non-`'completed'` outcome — `incomplete`/`passed`/`uncoveredHunks` are absent too — so omitting
 * `hunkMutation` here versus reporting every hunk `skipped` would be observably identical to a caller
 * either way.
 *
 * **`outcome.outcome === 'completed'` with ZERO real hunks found** (`specs/22` M16 P13, a round-2
 * gauntlet fix): reachable in ordinary use — `--base` resolved further back than the implementation's
 * own last real change (checking whether a newly-added test binds code that has not itself changed
 * since that earlier point) makes `computeHunks` return `hunks: []` over `implementationPaths` while
 * the change-level check above still reaches `'completed'` (reverting an UNCHANGED path is a real
 * no-op, so every named test correctly reads non-binding at the change level — a real, honest signal
 * `incomplete`/`nonBinding` already carries). `hunkMutation` is omitted here too, for a DIFFERENT but
 * related reason than the paragraph above: a `HunkMutationReport` with `hunks: []` would still carry a
 * real `granularity` and four all-zero verdict counts, observably IDENTICAL — to a project-authored
 * `failOn: 'uncoveredHunks > 0'` check reading only that one field — to "every hunk is genuinely
 * covered". Omitting it makes that field absent rather than falsely zero: `evaluateGate`'s own
 * `unreliableFailOn` treats a missing path as unable to show success, so such a check fails closed
 * instead of silently passing on nothing — the identical stance `13` F-TEST-9's own parity-oracle
 * counting algebra already takes ("a check that would print no passing and no failing case is
 * refused"), reapplied here. See `runHunkMutationCheck`'s own body for where this is decided.
 *
 * @see specs/13 F-TEST-10
 * @see specs/13 F-TEST-9
 * @see specs/22 M16 P12
 * @see specs/22 M16 P13
 */
export interface HunkMutationCheckResult {
  readonly outcome: BindingCheckOutcome;
  readonly hunkMutation?: HunkMutationReport;
}

/** `runHunkMutationCheck`'s own input, beyond the plain `BindingCheckInput` every change-level check
 * already takes. `maxHunks` must be a positive integer (`bin.ts`'s own `--max-hunks` parsing already
 * enforces this, `RUN-139`; this module trusts its caller and does not re-validate). @see specs/22 M16 P12 */
export interface HunkMutationOptions {
  readonly maxHunks: number;
}

/** Every named, baseline-passing test one mutant run made fail, keyed by name, with the `kind` of
 * failure attributed to it — `binding.ts`'s own private `namesFailedUnderMutation` re-derived with
 * `kind` preserved (that function discards it, correct for a change-level verdict that never needs to
 * tell an assertion failure from a load failure; a hunk's own verdict does, so this is a deliberate,
 * disclosed parallel implementation of the identical name/file-matching mechanism, not a shared helper
 * split in two). A named test matched directly by name carries whatever `kind` its own real outcome
 * reports; one recovered only via `TestOutcome.file` (a synthetic whole-file-load-failure outcome,
 * `reporter.ts`'s own `kind: 'load'`) carries that file outcome's own `kind` for every named test the
 * baseline discovered in that file — the whole file could not run, so none of its own tests ran either,
 * real binding evidence for each of them regardless of what the final verdict calls it. */
function classifyMutationOutcomes(
  namedTestsByFile: ReadonlyMap<string, readonly string[]>,
  knownNames: ReadonlySet<string>,
  outcomes: readonly TestOutcome[],
): ReadonlyMap<string, TestFailureKind | undefined> {
  const failedByName = new Map<string, TestFailureKind | undefined>();
  for (const outcome of outcomes) {
    if (outcome.status !== 'fail') continue;
    if (knownNames.has(outcome.name)) {
      failedByName.set(outcome.name, outcome.kind);
      continue;
    }
    if (outcome.file === undefined) continue;
    for (const name of namedTestsByFile.get(outcome.file) ?? []) {
      if (!failedByName.has(name)) failedByName.set(name, outcome.kind);
    }
  }
  return failedByName;
}

/** Turns one mutant run's own classified failures into a `HunkVerdict` — the one place the
 * `killed`/`uncovered`/`invalid` decision is made, shared by every mutant kind (a lone text hunk, a
 * whole-file revert, the whole-change revert). `countLoadAsKill` is which credit rule applies to THIS
 * mutant (this module's own header comment: it tracks what actually ran, not the hunk's nominal kind)
 * — `false` only for a lone `TextHunk` reversed alone at `granularity: 'hunk'`; `true` for every whole
 * -file or whole-change revert, `FileHunk` included. */
function toHunkVerdict(
  failedByName: ReadonlyMap<string, TestFailureKind | undefined>,
  countLoadAsKill: boolean,
): HunkVerdict {
  const names = [...failedByName.keys()];
  if (names.length === 0) return { kind: 'uncovered' };
  const nonLoad = names.filter((name) => failedByName.get(name) !== 'load').sort();
  if (nonLoad.length > 0) return { kind: 'killed', killedBy: nonLoad };
  // Every attributed failure here is a `load` failure: a stillborn mutant for a lone text hunk
  // (`13` F-TEST-10's own words), real change-level credit for a whole-file or whole-change revert.
  return countLoadAsKill
    ? { kind: 'killed', killedBy: [...names].sort() }
    : { kind: 'invalid', reason: 'load-failure' };
}

/** Runs the story's test command, scoped to `testPaths` exactly as the change-level check does, and
 * classifies the result into a `HunkVerdict` — the one dispatcher every mutant kind below calls once
 * its own revert (a hunk's patch, or a whole-file/whole-change revert) has already happened. A
 * `tool-error` becomes `skipped` (the run could not proceed for an engine reason, `13` F-TEST-10's own
 * words — "a failing baseline, for one" names only the FIRST, change-level-wide cause, which
 * `HunkMutationCheckResult.hunkMutation`'s own doc comment already stops short of this function; a
 * per-mutant tool-error is a second, genuinely distinct cause this function is where it belongs). Any
 * outcome whose own `kind` is `'timeout'` (`reporter.ts`'s own synthetic whole-run-timeout outcome)
 * becomes `timeout`, checked BEFORE classification for the identical reason
 * `runChangeLevelCheck`'s own mutated-run check already runs it before `namesFailedUnderMutation`: a
 * timed-out run proves nothing about any test, and classifying it anyway could misreport a kill or an
 * uncovered hunk from a run that never finished. Synchronous (never `async`): every real await this
 * engine needs already happened in whatever produced `run`; this is pure classification. */
function verdictFromRun(
  run: RunAndNormalizeResult,
  forHunkMode: ForHunkMode,
  countLoadAsKill: boolean,
): HunkVerdict {
  if (run.outcome === 'tool-error')
    return { kind: 'skipped', reason: `tool-error: ${run.message}` };
  if (run.outcome === 'missing-command') {
    // Unreachable through this module's own public entry point: `runAndNormalize` is always called
    // here with `input.testCommand`, a non-optional `string` on `BindingCheckInput` — the identical
    // overload narrowing `binding.ts`'s own calls already rely on. Checked explicitly (R5: a branch
    // only reachable by calling a private function directly, bypassing the real entry point, is not a
    // real branch to keep) rather than asserted away, matching this file's own "a stillborn mutant
    // proves nothing" stance toward never silently guessing a verdict.
    throw new Error(
      'forge/hunk-mutation: unreachable: testCommand is always a defined string here.',
    );
  }
  if (run.report.outcomes.some((outcome) => outcome.kind === 'timeout')) return { kind: 'timeout' };
  const failedByName = classifyMutationOutcomes(
    forHunkMode.namedTestsByFile,
    forHunkMode.knownNames,
    run.report.outcomes,
  );
  return toHunkVerdict(failedByName, countLoadAsKill);
}

/** Applies ONE `TextHunk`'s own reversal for real — `git apply -R --unidiff-zero` (the identical call
 * `hunks.ts`'s own `isPatchReversible` already makes for its `--check` form, minus `--check`), against
 * whatever `cwd`'s real on-disk content is RIGHT NOW. Never consults `hunk.reversible` (`hunks.ts`'s
 * own precomputed check): this engine resets the lane to the identical tree `reversible` was computed
 * against before every single mutant (this module's own "fresh reset-to-HEAD tree" rule), so the two
 * should always agree, and asking git itself for a REAL exit code, every time, is one source of truth
 * rather than two that could silently drift apart — the identical "confirmed directly, not assumed"
 * stance `hunks.ts`'s own header comment takes throughout. Returns whether it applied cleanly; a
 * genuine inability to even run `git apply` (not installed, not a repository) still throws, through
 * `wrapGitFailure`, exactly as `isPatchReversible` already does. */
async function applyHunkReversal(laneDir: string, hunk: TextHunk): Promise<boolean> {
  const { patch } = hunk;
  if (patch === undefined) {
    // Unreachable: this module always calls `computeHunks` with `includePatches: true` (below), so
    // every real `TextHunk` it ever sees carries one. Checked explicitly for the identical "a branch a
    // test can only reach by bypassing the real entry point is not a real branch" reason
    // `verdictFromRun`'s own `missing-command` guard already states. Destructured into this local
    // `const` (never read as `hunk.patch` again below) so the narrowing survives into the arrow
    // function passed to `wrapGitFailure` -- TS does not carry a property narrowing across a closure
    // boundary, only a local binding's own.
    throw new Error(
      'forge/hunk-mutation: unreachable: a TextHunk has no patch although includePatches was requested.',
    );
  }
  const result = await wrapGitFailure(
    () =>
      execa('git', ['apply', '-R', '--unidiff-zero'], {
        cwd: laneDir,
        input: Buffer.from(patch, 'latin1'),
        reject: false,
      }),
    "applying a hunk's own reversal for real",
  );
  return result.exitCode === 0;
}

/** One `TextHunk`, reversed and run ALONE (`granularity: 'hunk'`): applies its own patch for real; a
 * reversal that does not apply cleanly is `invalid` before any test ever runs (`13` F-TEST-10's own
 * "the reversal did not apply cleanly"), never attempted as a test run at all. Otherwise runs the
 * story's tests and classifies with `countLoadAsKill: false` — the ONE mutant kind this module ever
 * applies that rule to (this module's own header comment). */
async function runTextHunkAlone(
  lane: LaneHandle,
  input: BindingCheckInput,
  hunk: TextHunk,
  testPaths: readonly string[],
  forHunkMode: ForHunkMode,
): Promise<HunkVerdict> {
  const applied = await applyHunkReversal(lane.path, hunk);
  if (!applied) return { kind: 'invalid', reason: 'reversal-failed' };
  const run = await runAndNormalize(
    input.testCommand,
    lane.path,
    input.ecosystem,
    input.createTempPath,
    undefined,
    undefined,
    testPaths,
    input.timeoutMs,
  );
  return verdictFromRun(run, forHunkMode, false);
}

/** One whole-file revert-and-run — the SAME procedure `runChangeLevelCheck`'s own mutated phase
 * already uses for the whole change, scoped here to the ONE path `relativePath` names
 * (`revertPathsToRevision(lane, fromSha, [relativePath])`, never the whole `implementationPaths`
 * list). Used for a `FileHunk` at any granularity, and for every `TextHunk` of one path once
 * `granularity` has degraded to `'file'` — always with `countLoadAsKill: true` (this module's own
 * header comment: the credit rule tracks the revert that actually ran, and this one is a whole-file
 * revert regardless of which hunk kind asked for it). */
async function runWholeFileMutant(
  lane: LaneHandle,
  input: BindingCheckInput,
  relativePath: string,
  fromSha: string,
  testPaths: readonly string[],
  forHunkMode: ForHunkMode,
): Promise<HunkVerdict> {
  await revertPathsToRevision(lane, fromSha, [relativePath]);
  const run = await runAndNormalize(
    input.testCommand,
    lane.path,
    input.ecosystem,
    input.createTempPath,
    undefined,
    undefined,
    testPaths,
    input.timeoutMs,
  );
  return verdictFromRun(run, forHunkMode, true);
}

/**
 * Chooses `granularity` (`13` F-TEST-10: degrades `hunk` → `file` → `change` above `--max-hunks`,
 * never by sampling). The SAME configured bound governs both steps — a DECISION, stated and justified
 * in the builder's own report rather than silently invented: the plan explicitly leaves the further,
 * file-to-change bound to this piece's own call ("above some further bound (your own call, state and
 * justify it)"), and the cost driver is identical at both levels (one mutant is one extra test-command
 * run, `13` F-TEST-10's own "N + 3 runs" framing), so the single number an operator already chose for
 * "how many extra hunk-level runs am I willing to pay for" is reapplied, unchanged, as the cap on how
 * many extra FILE-level runs the next degradation step may cost, rather than inventing a second,
 * independently-justified constant with no real basis of its own.
 */
function chooseGranularity(hunks: readonly Hunk[], maxHunks: number): Granularity {
  if (hunks.length <= maxHunks) return 'hunk';
  const distinctFiles = new Set(hunks.map((hunk) => hunk.path)).size;
  if (distinctFiles <= maxHunks) return 'file';
  return 'change';
}

/** Groups `hunks` by `path`, in the order each path FIRST appears in `hunks` — `hunks` is already in
 * `computeHunks`'s own deterministic (git tree) order, so this grouping is deterministic too (R10): it
 * never depends on anything this module itself iterates in an unordered way. */
function groupByPath(hunks: readonly Hunk[]): ReadonlyMap<string, readonly Hunk[]> {
  const byPath = new Map<string, Hunk[]>();
  for (const hunk of hunks) {
    const existing = byPath.get(hunk.path);
    if (existing === undefined) byPath.set(hunk.path, [hunk]);
    else existing.push(hunk);
  }
  return byPath;
}

/** The real per-hunk/file/change mutation loop, run against the SAME already-open `lane` the
 * change-level check just finished with — `forHunkMode.toSha` is the exact tree the restore phase
 * already reset the lane back to, and this function resets to it again before EVERY mutant it runs
 * (this module's own "fresh reset-to-HEAD tree" rule, confirmed against `13` F-TEST-10's own "reverse
 * one hunk at a time": never stacked on a prior hunk's own reversal), including the very first, so the
 * guarantee holds unconditionally rather than depending on exactly what the restore phase happened to
 * leave on disk. */
async function runHunkMutants(
  lane: LaneHandle,
  input: BindingCheckInput,
  implementationPaths: readonly string[],
  testPaths: readonly string[],
  forHunkMode: ForHunkMode,
  options: HunkMutationOptions,
): Promise<HunkMutationReport> {
  const parsed = await computeHunks({
    cwd: lane.path,
    baseSha: forHunkMode.fromSha,
    headSha: forHunkMode.toSha,
    implementationPaths,
    includePatches: true,
  });
  const granularity = chooseGranularity(parsed.hunks, options.maxHunks);

  let entries: readonly HunkMutationEntry[];
  if (granularity === 'change') {
    // Relabelled, not re-run (`13` F-TEST-10's own Mandate: "just runBindingCheck's own existing
    // single mutant, relabelled, not a new code path") -- zero extra test-command invocations.
    const failedByName = classifyMutationOutcomes(
      forHunkMode.namedTestsByFile,
      forHunkMode.knownNames,
      forHunkMode.mutatedOutcomes,
    );
    const verdict = toHunkVerdict(failedByName, true);
    entries = parsed.hunks.map((hunk) => ({
      id: hunk.id,
      path: hunk.path,
      ...hunkIdentity(hunk),
      verdict,
    }));
  } else if (granularity === 'file') {
    const byPath = groupByPath(parsed.hunks);
    const verdictByPath = new Map<string, HunkVerdict>();
    for (const filePath of byPath.keys()) {
      await resetLaneWorktree(lane, forHunkMode.toSha);
      verdictByPath.set(
        filePath,
        await runWholeFileMutant(
          lane,
          input,
          filePath,
          forHunkMode.fromSha,
          testPaths,
          forHunkMode,
        ),
      );
    }
    entries = parsed.hunks.map((hunk) => {
      const verdict = verdictByPath.get(hunk.path);
      if (verdict === undefined) {
        throw new Error(
          `forge/hunk-mutation: unreachable: "${hunk.path}" was grouped but never run.`,
        );
      }
      return { id: hunk.id, path: hunk.path, ...hunkIdentity(hunk), verdict };
    });
  } else {
    const built: HunkMutationEntry[] = [];
    for (const hunk of parsed.hunks) {
      await resetLaneWorktree(lane, forHunkMode.toSha);
      const verdict =
        hunk.kind === 'file'
          ? await runWholeFileMutant(
              lane,
              input,
              hunk.path,
              forHunkMode.fromSha,
              testPaths,
              forHunkMode,
            )
          : await runTextHunkAlone(lane, input, hunk, testPaths, forHunkMode);
      built.push({ id: hunk.id, path: hunk.path, ...hunkIdentity(hunk), verdict });
    }
    entries = built;
  }

  // Leaves the lane clean for its caller's own `removeLaneWorktree`, whatever the last mutant did to
  // the tree -- the identical "never retained, always put back" discipline `runChangeLevelCheck`'s own
  // restore phase already follows.
  await resetLaneWorktree(lane, forHunkMode.toSha);

  return {
    granularity,
    baseSha: parsed.baseSha,
    headSha: parsed.headSha,
    diffAlgorithm: parsed.diffAlgorithm,
    hunks: entries,
  };
}

/**
 * `forge test binding --story <id> --hunks --base <ref> [--max-hunks <n>]` (`13` F-TEST-10; `03`
 * §3.2.5 row 117). Creates ONE lane (`binding.ts`'s own `createBindingLane`), runs the change-level
 * check against it (`runChangeLevelCheck`), and — only once that check reaches `'completed'` — keeps
 * running hunk/file/change mutants against the SAME lane before removing it, exactly once, in this
 * function's own `finally` (the identical exception-safety shape `runBindingCheck`'s own `try`/
 * `finally` already establishes, now wrapping more work rather than less).
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P12
 */
export async function runHunkMutationCheck(
  input: BindingCheckInput,
  options: HunkMutationOptions,
): Promise<HunkMutationCheckResult> {
  const { implementationPaths, testPaths } = splitImplementationAndTestPaths(input.filesExpected);
  if (testPaths.length === 0) {
    return { outcome: { outcome: 'no-test-paths' } };
  }

  const lane = await createBindingLane(input);
  try {
    const changeLevel = await runChangeLevelCheck(lane, input, implementationPaths, testPaths);
    if (changeLevel.forHunkMode === undefined) {
      // The change-level check stopped before any mutant was ever attempted -- `runHunkMutants`
      // (below) is never reached, so no `granularity` was ever chosen. See `HunkMutationCheckResult`'s
      // own doc comment for why this DECISION omits `hunkMutation` entirely, for that reason, rather
      // than reporting every hunk `skipped`.
      return { outcome: changeLevel.outcome };
    }
    const hunkMutation = await runHunkMutants(
      lane,
      input,
      implementationPaths,
      testPaths,
      changeLevel.forHunkMode,
      options,
    );
    // `specs/22` M16 P13 (round-2 gauntlet fix): `computeHunks` (inside `runHunkMutants`) found ZERO
    // real hunks over `implementationPaths` -- reachable in ordinary use whenever `--base` resolves
    // further back than the implementation's own last real change (checking whether a newly-added
    // test binds code that has not itself changed since that earlier point; the change-level check
    // above already reports the real signal for that case, `failedUnderMutation: []`, since reverting
    // an unchanged path is a no-op). A `HunkMutationReport` with `hunks: []` would still carry a
    // `granularity` and four all-zero verdict counts -- observably IDENTICAL, to a project-authored
    // `failOn: 'uncoveredHunks > 0'` check reading only that one field, to "every hunk is genuinely
    // covered". See `HunkMutationCheckResult`'s own doc comment for the full DECISION: omitted
    // entirely, the identical treatment the change-level-never-reached-'completed' branch above
    // already gets, so a reader of either the `--json` envelope or a written `MutationEvidence`
    // record never sees a `revert-hunks` shape with nothing in it.
    if (hunkMutation.hunks.length === 0) {
      return { outcome: changeLevel.outcome };
    }
    return { outcome: changeLevel.outcome, hunkMutation };
  } finally {
    await removeLaneWorktree(input.projectRoot, lane, { retain: false });
  }
}
