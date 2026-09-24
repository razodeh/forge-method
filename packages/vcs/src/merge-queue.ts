/**
 * The merge queue: `06` §6.5's own six-step pipeline as one serial call — rebase onto integration,
 * dispatch on conflict policy, pre-merge checks, `--no-ff` merge tagged with the step id, post-merge
 * checks, automatic (history-preserving) revert on post-merge failure. Serial by construction: one call
 * at a time, on one candidate; the caller owns queueing order across candidates (`06` §6.5: "Serial, one
 * merge at a time").
 *
 * "Spawn a merge-resolver step" (`agent` policy's own real behaviour) is `@forge/agents`/`@forge/engine`
 * content this package cannot reach (`SPEC-QUESTIONS.md` Q62 part 2) — this piece accepts a caller-
 * supplied async resolver instead, the same shape Q62 uses throughout. Likewise, scheduling a
 * `diagnostician` step and marking a lane `failed-integration` (both named in `06` §6.5 step 5) are
 * `@forge/engine` state/scheduling concerns; this piece performs the real git revert (its own domain) and
 * returns a `MergeOutcome` with everything a caller needs to do the rest. Emitting `MergeCompleted`/
 * `MergeReverted` events (`06` §6.5 step 6) is `@forge/telemetry`'s job, a package `@forge/vcs` has no
 * edge to — the same `MergeOutcome` is what a caller turns into that event.
 *
 * @see specs/06 §6.5
 * @see specs/20 §20.2 point 4
 * @see PLAN-M5.md P5
 */
import { execa } from 'execa';

import { assertSingleLine } from './commit.ts';
import { VcsError } from './errors.ts';
import { errorMessage, resolveRevision, wrapGitFailure } from './git.ts';
import type { LaneHandle, LaneId } from './lanes.ts';

export interface MergeCandidate {
  readonly handle: LaneHandle;
  /** The step id and run id a successful merge (or its revert) is tagged with, as `Forge-Step`/
   * `Forge-Run` trailers — the same trailer keys `commit.ts` uses for lane commits (`SPEC-QUESTIONS.md`
   * Q65), so the audit trail (`20` §20.9) stays consistently parseable whether a commit came from an
   * agent or from this piece. Not recoverable from `handle.branch` alone: `lanes.ts`'s own
   * `slugifyStepId` is lossy by design, so the *original* `stepId` has to be carried alongside the
   * handle, not re-derived from it. */
  readonly stepId: string;
  readonly runId: string;
  /** The step's own declared `produces` claim (`06` §6.7) — not used by this piece's own control flow
   * (claim *enforcement* already happened, `claims.ts`, before a candidate ever reaches the merge queue),
   * carried here only to forward into `MergeConflictDescription` as context for a resolver, matching
   * `06` §6.5 step 2's own language: a resolver needs "both lanes' intents," not just the raw conflict. */
  readonly declaredClaim: readonly string[];
  readonly conflictPolicy: 'agent' | 'human' | 'abort';
  /** `PLAN-M14.md` P18: a swarm-review lane's own bound verdict and the `REVIEW-NNN` id it came from --
   * `@forge/engine`'s own concern to compute and validate (`parseReviewVerdict`, `SPEC-QUESTIONS.md` Q232
   * decision 7), this package only formats what it is given. Present together or not at all:
   * `formatMergeCommitMessage` stamps `Forge-Review-Verdict: <reviewVerdict> (<reviewReportId>)` on the
   * merge commit only when both are set, never derived or inferred here. `reviewReportId` flows through
   * the identical newline guard `stepId`/`runId`/`laneId` already get (`assertSingleLine`) since it
   * ultimately comes from a document on a lane branch this package does not fully trust (a hand-edited
   * lane branch could forge an `id` with an embedded newline, `SPEC-QUESTIONS.md` Q229's threat model). */
  readonly reviewVerdict?: string | undefined;
  readonly reviewReportId?: string | undefined;
  /** `PLAN-M14.md` P35: when set, `processMergeCandidate` rebases with `git rebase --onto <integrationHead>
   * <replayFrom>` instead of the ordinary `git rebase <integrationHead>` — replaying only the lane's own
   * commits (`replayFrom..HEAD`), never a stacked predecessor's own commits that already reached the
   * integration branch some other way. Set by a caller only once it knows the lane really is built on a
   * predecessor whose own content has already landed: a stale, pre-resolution replay of that predecessor's
   * (superseded) commits could apply cleanly and silently reintroduce content a landing-time conflict
   * resolution had already rejected — this is what `replayFrom` exists to prevent, not an optimisation.
   * Must be an ancestor of the lane's own current HEAD (`VCS-GIT-OPERATION-FAILED` otherwise, checked before
   * any git state is touched); `undefined` (every candidate with no stacked predecessor, or one whose
   * predecessor has not landed yet) is the ordinary, unchanged rebase — this field changes nothing for the
   * common case. */
  readonly replayFrom?: string | undefined;
}

export interface ConflictedFile {
  readonly path: string;
  /** The raw porcelain XY status code for this path (`git status --porcelain=v1`; see `git-status(1)`'s
   * own table for the full list — `UU` both modified, `DU` deleted on the integration side and modified
   * on the lane side, `UD` the reverse, `AA` added on both sides, and so on). This is what actually
   * distinguishes a delete/modify (or add/add) conflict for a resolver: confirmed empirically that
   * `diff` below is only a one-line placeholder ("* Unmerged path <file>"), not real content, for
   * exactly those shapes — this status code is the signal `diff` cannot provide there. */
  readonly status: string;
}

/** `PLAN-M14.md` P35: the commit `REBASE_HEAD` names while a rebase is stopped on a real conflict — the
 * lane's own commit that failed to replay cleanly, which `subject`/`forgeStep` let a resolver (especially
 * an agent one, `PLAN-M14.md` P38) refer to by more than a bare sha. `forgeStep` is the commit's own
 * `Forge-Step` trailer (`buildCommitMessage`, `@forge/engine/dispatch`) when it has one — absent for a
 * commit this codebase itself never made (a hand-authored one on a hand-edited lane branch), not
 * fabricated. */
export interface MergeConflictCommit {
  readonly sha: string;
  readonly subject: string;
  readonly forgeStep?: string | undefined;
}

/** `PLAN-M14.md` P35: one conflict this landing's own rebase resolved — `MergeOutcome`'s `conflict-resolved`
 * kind carries one per resolution (`describeConflict`'s own `conflictedFiles`/`commit`, captured at the
 * moment the resolver actually resolved it), so a caller (`landLane`) can emit a `MergeConflict{reason:
 * 'resolved'}` event per real resolution rather than one that only ever describes the LAST of several. */
export interface MergeResolution {
  readonly files: readonly string[];
  readonly commit?: MergeConflictCommit | undefined;
}

/** Enough for a caller-supplied resolver (human or agent) to actually resolve the conflict: which files
 * and how each is conflicted, a best-effort diff, and where to find them on disk — plus the lane's own
 * declared intent, per `06` §6.5 step 2. */
export interface MergeConflictDescription {
  readonly laneId: LaneId;
  /** `PLAN-M14.md` P35: the step and run this lane belongs to — `laneId` alone is a slugified, lossy
   * rendering of the step id (`lanes.ts`'s own `slugifyStepId` doc comment), so a resolver that actually
   * needs to know "which step is this" (an agent resolver's own prompt, `PLAN-M14.md` P38) cannot recover
   * it from `laneId` alone. Populated by `processMergeCandidate` below from `MergeCandidate.stepId`/
   * `.runId`, always available there. `undefined` for a conflict this same type also describes at a
   * different point in the lane's life with no step/run of its own to name (`@forge/vcs`'s own in-lane
   * join, `join.ts`, `PLAN-M14.md` P34, out of this piece's own scope) — never fabricated. */
  readonly stepId?: string | undefined;
  readonly runId?: string | undefined;
  readonly declaredClaim: readonly string[];
  readonly conflictedFiles: readonly ConflictedFile[];
  /** `git diff`'s own conflict-marker output. Reliable for the most common shape (both sides modified
   * overlapping content) and for binary conflicts (a short, git-generated summary) — for a delete/modify
   * or rename/rename conflict specifically, git's own two-way diff renderer has no useful unified-diff
   * form to show and this is only a one-line placeholder ("* Unmerged path <file>"); `conflictedFiles`'
   * own status codes above are what carries real signal for those shapes instead. A resolver can always
   * inspect `worktreePath` directly too, for any shape. */
  readonly diff: string;
  readonly worktreePath: string;
  /** `PLAN-M14.md` P35: the lane's own commit `REBASE_HEAD` names (`git rev-parse --verify REBASE_HEAD`)
   * while this conflict is being described — absent when the worktree is not actually mid-rebase at the
   * moment of the check (this type's own in-lane-join use, `join.ts`, never rebases at all; a future,
   * differently-triggered conflict of this same shape). Never absent for a conflict `processMergeCandidate`
   * itself describes: its own rebase loop only ever calls `describeConflict` while a rebase is genuinely
   * stopped on a conflict. */
  readonly commit?: MergeConflictCommit | undefined;
}

/** `agent` and `human` policy both ultimately mean "call this" — which one it represents in practice is
 * entirely a property of *how the caller implemented it* (spawn a merge-resolver step vs. surface a
 * human modal and await a real decision), invisible to and no concern of this package. Only `abort` is
 * structurally different: it never calls a resolver at all.
 *
 * Unlike `PostMergeCheck` (whose own doc comment documents the opposite choice, deliberately), a
 * resolver that itself throws does *not* leave the lane worktree stuck: `processMergeCandidate` aborts
 * the in-progress rebase before letting the throw propagate, since — unlike a merge commit left sitting
 * on integration for a caller to inspect — a rebase left mid-progress blocks every further git operation
 * on that lane worktree, with no comparable inspection value to leaving it in place. */
export type MergeConflictResolver = (
  conflict: MergeConflictDescription,
) => Promise<'resolved' | 'unresolved'>;

export interface CheckResult {
  readonly passed: boolean;
  readonly summary: string;
}

/** `worktreeOrIntegrationPath`: a pre-merge check runs against the lane worktree (post-rebase); a
 * post-merge check runs against the integration worktree. Same shape, different path, by design — this
 * package has no opinion on what "typecheck" or "full test" means (`06` §6.5 steps 3/5's own examples),
 * only on *when* to run whatever the caller decides that is. */
export type PreMergeCheck = (worktreeOrIntegrationPath: string) => Promise<CheckResult>;
/** A check that itself throws (as opposed to returning `{ passed: false }`) is not treated as an
 * ordinary check failure — the throw propagates uncaught from `processMergeCandidate`, preserving the
 * distinction between "the check found something wrong" and "the check is broken." For a *post*-merge
 * check specifically, this means a throwing check leaves the merge commit sitting on integration's own
 * HEAD, unreverted — `processMergeCandidate` never gets the chance to run the revert step, and returns
 * no `MergeOutcome` at all to say so. A caller whose post-checks can throw needs to handle that recovery
 * itself (or ensure its checks only ever reject the merge via `{ passed: false }`, never by throwing). */
export type PostMergeCheck = (worktreeOrIntegrationPath: string) => Promise<CheckResult>;

export interface ProcessMergeCandidateOptions {
  /** A worktree already checked out on the integration branch (`forge/integration/<stage>` by default,
   * `06` §6.5) — creating and maintaining it is the caller's job, not this piece's, the same
   * forward-dependency shape every `@forge/vcs` piece uses for state it cannot itself own. */
  readonly integrationPath: string;
  /** Required unless `candidate.conflictPolicy` is `'abort'` — enforced at runtime (`VCS-MISSING-
   * CONFLICT-RESOLVER`), not in the type, since the requirement depends on a sibling value the type
   * system has no way to tie together here. */
  readonly conflictResolver?: MergeConflictResolver;
  /** Run in order against the lane worktree, post-rebase; stops at the first failure (`06` §6.5 step 3's
   * own "fast subset" framing values not running checks a first failure already made moot). */
  readonly preChecks: readonly PreMergeCheck[];
  /** Run in order against the integration worktree, post-merge; same stop-at-first-failure behaviour. */
  readonly postChecks: readonly PostMergeCheck[];
  /** `PLAN-M14.md` P35: the most resolutions this call will attempt before giving up — past it, the rebase
   * is aborted and the outcome is `{kind:'conflict-unresolved', reason:'resolution-cap'}` rather than
   * calling the resolver again; a resolver that itself never converges (a real, if rare, agent-resolver
   * failure mode, `PLAN-M14.md` P38) must not be allowed to loop this call forever. Defaults to
   * `DEFAULT_MAX_RESOLUTIONS` (5) when omitted; overridable so a test can prove the cap without
   * constructing that many real conflicts. */
  readonly maxResolutions?: number | undefined;
}

/** `ProcessMergeCandidateOptions.maxResolutions`'s own default — chosen as a generous-but-finite bound: a
 * real lane with more than a handful of independent conflicts against the current integration head is
 * itself a strong signal something is wrong (a lane badly out of date, or a resolver that keeps producing
 * content the next commit conflicts with again), better surfaced as a typed, actionable outcome than
 * retried indefinitely. */
const DEFAULT_MAX_RESOLUTIONS = 5;

export type MergeOutcome =
  | { readonly kind: 'clean'; readonly mergeCommitSha: string }
  /** After the rebase there was nothing left to merge: every commit of the lane was already in the integration
   * branch (dropped by the rebase as an equivalent patch, e.g. a lane stacked on another that landed and was
   * itself rewritten by its own rebase, `PLAN-M13.md` P38). No merge commit was made and no check was run; the
   * lane's content is in the integration branch. `git merge --no-ff` would report "Already up to date" and
   * `HEAD` would be another lane's merge commit, which a failing post-merge check would then revert. */
  | { readonly kind: 'already-integrated' }
  | {
      readonly kind: 'conflict-resolved';
      readonly mergeCommitSha: string;
      /** `PLAN-M14.md` P35: one entry per conflict this landing's own rebase actually resolved — more than
       * one when resolving an earlier conflict and continuing the rebase reveals a further, independent
       * one (`06` §6.5 step 2's own loop, `describeConflict`'s doc comment). In plan/rebase order: the
       * order a caller (`landLane`, `@forge/engine/dispatch`) would emit one `MergeConflict{reason:
       * 'resolved'}` event per entry, before the single `MergeCompleted` this whole landing produces. */
      readonly resolutions: readonly MergeResolution[];
    }
  | {
      readonly kind: 'conflict-unresolved';
      /** `PLAN-M14.md` P35: `'resolution-cap'` is reached without ever consulting `conflictPolicy`/
       * `conflictResolver` a second more time than `maxResolutions` allows — distinct from
       * `'resolver-unresolved'` (the resolver itself gave up on one specific conflict). */
      readonly reason: 'abort-policy' | 'resolver-unresolved' | 'resolution-cap';
      /** `PLAN-M14.md` P35: the paths in conflict at the moment this outcome was produced — read via the
       * same `conflictedFilePaths` this file's own loop already uses to detect a conflict in the first
       * place, so a caller (`landLane`'s own `MergeConflict` event) can name them without re-deriving
       * anything itself. Never empty: every path this reports here is, by construction, one the rebase
       * loop is genuinely stopped on. */
      readonly files: readonly string[];
      /** `PLAN-M14.md` P35: extra, reason-specific context with no field of its own — today, only
       * `'resolution-cap'` populates it (naming the cap actually hit, since `reason` alone does not say
       * what `maxResolutions` was configured to). Absent for the other two reasons, which the `reason`
       * string alone already fully explains. */
      readonly detail?: string | undefined;
    }
  | { readonly kind: 'pre-check-failed'; readonly checkResult: CheckResult }
  | {
      readonly kind: 'post-check-failed-reverted';
      readonly checkResult: CheckResult;
      readonly revertCommitSha: string;
    };

async function runChecksUntilFailure(
  checks: readonly ((path: string) => Promise<CheckResult>)[],
  targetPath: string,
): Promise<CheckResult | undefined> {
  for (const check of checks) {
    // Intentionally sequential — a later check may depend on state a caller expects only after an
    // earlier one has already run (e.g. lint before test), and "fast subset" (06 §6.5 step 3) means
    // stopping at the first failure is the point, not parallelising every check regardless.
    const result = await check(targetPath);
    if (!result.passed) return result;
  }
  return undefined;
}

async function conflictedFilePaths(laneWorktreePath: string): Promise<readonly string[]> {
  const { stdout } = await wrapGitFailure(
    () =>
      execa('git', ['diff', '--no-renames', '-z', '--name-only', '--diff-filter=U'], {
        cwd: laneWorktreePath,
      }),
    `listing conflicted files in the lane worktree at "${laneWorktreePath}"`,
  );
  return stdout.split('\0').filter((entry) => entry !== '');
}

/** Exported so the fallback below is directly testable with a deliberately-constructed `paths` entry
 * that `git status` genuinely has no record of, the same "export it, feed it a real edge case" pattern
 * `lanes.ts`'s own `parseWorktreeBlocks` already established — rather than mocking `execa` to simulate a
 * mismatch between this function's two real git calls (`conflictedFilePaths`, `git status` here), which
 * would need switching this whole file's `execa` import style just for one defensive branch. */
export async function conflictStatuses(
  laneWorktreePath: string,
  paths: readonly string[],
): Promise<readonly ConflictedFile[]> {
  const { stdout } = await wrapGitFailure(
    () => execa('git', ['status', '--porcelain=v1', '-z'], { cwd: laneWorktreePath }),
    `reading conflict status in the lane worktree at "${laneWorktreePath}"`,
  );
  const statusByPath = new Map<string, string>();
  for (const entry of stdout.split('\0').filter((e) => e !== '')) {
    statusByPath.set(entry.slice(3), entry.slice(0, 2));
  }
  // '??' (git's own porcelain code for "untracked," never a real conflict code) is deliberately not a
  // plausible real status: a path this function was asked about but git's own status has no record of
  // at all is itself the anomaly worth surfacing distinctly, not silently coercing to some other code.
  return paths.map((filePath) => ({ path: filePath, status: statusByPath.get(filePath) ?? '??' }));
}

/** Runs one rebase-family git subcommand (`rebase <ontoSha>` to start one, `rebase --continue` to resume
 * one after a resolution) in the lane worktree. A real content conflict is not this function's failure to
 * report as a `VcsError` — it is one of the expected outcomes `processMergeCandidate`'s own loop dispatches
 * on (`06` §6.5 step 2), and a *second*, independent conflict revealed only once an earlier one is resolved
 * and `--continue` is run is exactly as expected as the first one for any lane with more than one commit —
 * so a failed rebase step is only ever wrapped into a `VcsError` once confirmed, structurally, *not* to be
 * a content conflict: `git diff --name-only --diff-filter=U` reports zero unmerged paths for any other
 * kind of rebase failure (a hook rejection, a corrupt object, anything not about conflicting content), the
 * same "check the actual state, don't infer from an exit code alone" discipline `git.ts`'s own
 * `isNoCommitsYetResult` established for a different check. */
async function runRebaseStep(
  laneWorktreePath: string,
  args: readonly string[],
  context: string,
): Promise<'clean' | 'conflict'> {
  try {
    await execa('git', ['rebase', ...args], { cwd: laneWorktreePath });
    return 'clean';
  } catch (cause) {
    const conflicted = await conflictedFilePaths(laneWorktreePath);
    if (conflicted.length > 0) return 'conflict';
    throw new VcsError(
      {
        code: 'VCS-GIT-OPERATION-FAILED',
        message:
          `git rebase failed in the lane worktree at "${laneWorktreePath}" while ${context}, for a ` +
          `reason other than a content conflict (no unmerged paths were found): ${errorMessage(cause)}`,
        remedy:
          'This is not an ordinary merge conflict — inspect the lane worktree directly. See the ' +
          'underlying cause for the exact git error.',
      },
      { cause },
    );
  }
}

/** `PLAN-M14.md` P35: with `replayFrom`, `git rebase --onto <ontoSha> <replayFrom>` replays only the
 * lane's own commits (`replayFrom..HEAD`) — never a stacked predecessor's own commits, which already
 * reached `ontoSha` some other way and would otherwise be replayed a second time (the "stale pre-
 * resolution replay" this field exists to prevent, `MergeCandidate.replayFrom`'s own doc comment). Plain
 * `git rebase <ontoSha>` (no `--onto`) otherwise — byte-identical to this function's own pre-P35 behaviour. */
function attemptRebase(
  laneWorktreePath: string,
  ontoSha: string,
  replayFrom: string | undefined,
): Promise<'clean' | 'conflict'> {
  return replayFrom === undefined
    ? runRebaseStep(laneWorktreePath, [ontoSha], `rebasing onto "${ontoSha}"`)
    : runRebaseStep(
        laneWorktreePath,
        ['--onto', ontoSha, replayFrom],
        `rebasing onto "${ontoSha}", replaying only the lane's own commits after "${replayFrom}"`,
      );
}

/** `PLAN-M14.md` P35: checked before `attemptRebase` ever runs with a real `replayFrom` — `git rebase
 * --onto <newbase> <upstream>` computes what to replay as `<upstream>..HEAD`, which is only meaningful
 * when `<upstream>` is genuinely in the lane's own history; an `upstream` outside it (a caller error, or
 * a `baseSha` recorded against a lane that was since rebuilt) would otherwise silently replay the wrong
 * — potentially enormous, unrelated — set of commits rather than failing loudly. Checked here, not left
 * to git's own rebase to discover, so the failure is reported before any git state is touched (the lane
 * worktree stays exactly as it was) rather than after a rebase has already started. */
async function assertReplayFromInLaneHistory(
  laneWorktreePath: string,
  replayFrom: string,
): Promise<void> {
  const result = await execa('git', ['merge-base', '--is-ancestor', replayFrom, 'HEAD'], {
    cwd: laneWorktreePath,
    reject: false,
  });
  if (result.exitCode === 0) return;
  throw new VcsError({
    code: 'VCS-GIT-OPERATION-FAILED',
    message:
      `replayFrom "${replayFrom}" is not usable as a rebase --onto upstream in the lane worktree at ` +
      `"${laneWorktreePath}": ` +
      (result.exitCode === 1
        ? "it is not an ancestor of the lane's own current HEAD."
        : `checking failed: ${result.stderr}`),
    remedy:
      "replayFrom must be a commit reachable from the lane's own HEAD (ordinarily the lane's own " +
      'recorded baseSha) -- inspect the lane worktree directly.',
  });
}

/** Resumes a rebase after a resolver has fixed a conflict's content — may itself immediately reveal a
 * *further*, independent conflict on the lane's next commit, reported back the same way the first one
 * was so `processMergeCandidate`'s own loop routes it through the identical policy dispatch. */
function continueRebase(laneWorktreePath: string): Promise<'clean' | 'conflict'> {
  return runRebaseStep(laneWorktreePath, ['--continue'], 'continuing after a conflict resolution');
}

async function abortRebase(laneWorktreePath: string): Promise<void> {
  await wrapGitFailure(
    () => execa('git', ['rebase', '--abort'], { cwd: laneWorktreePath }),
    `aborting the in-progress rebase in the lane worktree at "${laneWorktreePath}"`,
  );
}

/** `PLAN-M14.md` P35: the lane's own commit `REBASE_HEAD` names, while a rebase is genuinely stopped on a
 * conflict — `undefined` (not thrown) when it does not resolve at all, since a caller of this type outside
 * `processMergeCandidate`'s own rebase loop (`join.ts`'s in-lane join, which never rebases) is not
 * mid-rebase to begin with (`MergeConflictDescription.commit`'s own doc comment). `--quiet` so a genuinely
 * absent `REBASE_HEAD` (the "not mid-rebase" case) does not itself print to stderr. */
async function describeRebaseHeadCommit(
  laneWorktreePath: string,
): Promise<MergeConflictCommit | undefined> {
  const rebaseHead = await execa('git', ['rev-parse', '--quiet', '--verify', 'REBASE_HEAD'], {
    cwd: laneWorktreePath,
    reject: false,
  });
  if (rebaseHead.exitCode !== 0) return undefined;
  const sha = rebaseHead.stdout.trim();
  const { stdout: subject } = await wrapGitFailure(
    () => execa('git', ['log', '-1', '--format=%s', sha], { cwd: laneWorktreePath }),
    `reading the conflicting commit's subject in the lane worktree at "${laneWorktreePath}"`,
  );
  const { stdout: forgeStepRaw } = await wrapGitFailure(
    () =>
      execa(
        'git',
        ['log', '-1', '--format=%(trailers:key=Forge-Step,valueonly,separator=%x1f)', sha],
        { cwd: laneWorktreePath },
      ),
    `reading the conflicting commit's own Forge-Step trailer in the lane worktree at "${laneWorktreePath}"`,
  );
  const forgeStep = forgeStepRaw.trim();
  return { sha, subject: subject.trim(), ...(forgeStep === '' ? {} : { forgeStep }) };
}

async function describeConflict(candidate: MergeCandidate): Promise<MergeConflictDescription> {
  const paths = await conflictedFilePaths(candidate.handle.path);
  const conflictedFiles = await conflictStatuses(candidate.handle.path, paths);
  const { stdout: diff } = await wrapGitFailure(
    () => execa('git', ['diff'], { cwd: candidate.handle.path }),
    `reading the conflict diff in the lane worktree at "${candidate.handle.path}"`,
  );
  const commit = await describeRebaseHeadCommit(candidate.handle.path);
  return {
    laneId: candidate.handle.laneId,
    stepId: candidate.stepId,
    runId: candidate.runId,
    declaredClaim: candidate.declaredClaim,
    conflictedFiles,
    diff,
    worktreePath: candidate.handle.path,
    ...(commit === undefined ? {} : { commit }),
  };
}

/** The resolver's own job ends at fixing content (`SharedPathStrategyOptions`-style delegation,
 * `SPEC-QUESTIONS.md` Q62) — staging the resolution is git plumbing, this piece's job, not something a
 * resolver should need to know how to do correctly. Separate from actually continuing the rebase
 * (`continueRebase` above), which may reveal a further conflict of its own. */
async function stageResolution(laneWorktreePath: string): Promise<void> {
  await wrapGitFailure(
    () => execa('git', ['add', '-A'], { cwd: laneWorktreePath }),
    `staging the conflict resolution in the lane worktree at "${laneWorktreePath}"`,
  );
}

function formatMergeCommitMessage(candidate: MergeCandidate): string {
  const lines = [
    `Merge lane ${candidate.handle.laneId} (${candidate.stepId})`,
    '',
    `Forge-Step: ${candidate.stepId}`,
    `Forge-Run: ${candidate.runId}`,
  ];
  // `PLAN-M14.md` P18: only when both are present -- the engine never sends either for a `clear` verdict
  // (it lands exactly like any other lane, no trailer, the piece's own mandate) or for a verdict that
  // never reaches this call at all (`incomplete`/`blocked` refuse the lane before it is ever queued).
  if (candidate.reviewVerdict !== undefined && candidate.reviewReportId !== undefined) {
    lines.push(`Forge-Review-Verdict: ${candidate.reviewVerdict} (${candidate.reviewReportId})`);
  }
  return lines.join('\n');
}

function formatRevertCommitMessage(candidate: MergeCandidate, mergeCommitSha: string): string {
  return [
    `Revert merge of lane ${candidate.handle.laneId} (${candidate.stepId})`,
    '',
    `This reverts commit ${mergeCommitSha}: its post-merge checks failed.`,
    '',
    `Forge-Step: ${candidate.stepId}`,
    `Forge-Run: ${candidate.runId}`,
  ].join('\n');
}

async function abortRevert(integrationPath: string): Promise<void> {
  await wrapGitFailure(
    () => execa('git', ['revert', '--abort'], { cwd: integrationPath }),
    `aborting the in-progress revert in the integration worktree at "${integrationPath}"`,
  );
}

/** `git revert -m 1 --no-commit` (stage the revert) then a separate `git commit` with our own tagged
 * message — `git revert`'s own `-m` flag means "mainline parent number" (which parent of the merge is
 * "the branch being reverted onto"), not "message" the way `git commit -m` does, so a custom, trailer-
 * bearing message needs the two-step form. History-preserving by construction (`20` §20.2 point 4: never
 * force-push, never rewrite published history) — this creates a new commit undoing the merge's changes;
 * it never touches the merge commit itself or anything before it.
 *
 * Reverting can itself conflict — a gauntlet verify round found this exact scenario: another candidate
 * merges into `integrationPath` while *this* candidate's own post-merge checks are still running (the
 * identical "one merge at a time" violation `abortMerge` already exists to fail safely from), and its
 * changes overlap what this revert would touch. Both git calls here are wrapped in one try so either
 * failure point (`revert --no-commit` itself, or the following `commit`, which can leave `REVERT_HEAD`
 * set just as a conflict would) gets the same cleanup — confirmed empirically that `git revert --abort`
 * cleans up either way.
 *
 * Exported so the "cleanup itself also fails" branch is directly testable with a deliberately-invalid
 * `mergeCommitSha` (git rejects it before `REVERT_HEAD` is ever set, so `git revert --abort` then fails
 * too, confirmed empirically) — the same "export it, feed it a real edge case" pattern used elsewhere in
 * this package, rather than constructing that exact race through the full `processMergeCandidate`
 * pipeline a second time. */
export async function revertMerge(
  integrationPath: string,
  mergeCommitSha: string,
  candidate: MergeCandidate,
): Promise<string> {
  try {
    await execa('git', ['revert', '-m', '1', '--no-commit', mergeCommitSha], {
      cwd: integrationPath,
    });
    await execa('git', ['commit', '-m', formatRevertCommitMessage(candidate, mergeCommitSha)], {
      cwd: integrationPath,
    });
  } catch (cause) {
    // The cleanup attempt must never let its own failure replace this diagnostic — it is almost always
    // what a caller actually needs to see (confirmed empirically as a real, not hypothetical, risk: see
    // abortMerge's own equivalent note below). If cleanup also fails, that fact is folded into the
    // message rather than silently discarded.
    let cleanupNote = '';
    try {
      await abortRevert(integrationPath);
    } catch (cleanupCause) {
      cleanupNote = ` (cleanup afterward also failed: ${errorMessage(cleanupCause)})`;
    }
    throw new VcsError(
      {
        code: 'VCS-GIT-OPERATION-FAILED',
        message:
          `reverting the merge commit "${mergeCommitSha}" in the integration worktree at ` +
          `"${integrationPath}" failed: ${errorMessage(cause)}${cleanupNote}`,
        remedy:
          "This can happen if integration moved again while this candidate's own post-merge checks " +
          'were still running (the "one merge at a time" contract this piece trusts its caller to hold) ' +
          '— inspect the integration worktree directly. See the underlying cause for the exact git error.',
      },
      { cause },
    );
  }
  const { stdout } = await wrapGitFailure(
    () => execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath }),
    `resolving the revert commit's sha in the integration worktree at "${integrationPath}"`,
  );
  return stdout.trim();
}

/** Aborts a `git merge` left in progress by a failure (a genuine conflict, or anything else) partway
 * through the merge step — `06` §6.5's own "Serial, one merge at a time" is a caller obligation this
 * piece trusts (documented on `processMergeCandidate` below), but *if* it's ever violated (integration's
 * HEAD moves between this candidate's rebase and its own merge step) or the merge fails for any other
 * reason, leaving `MERGE_HEAD` behind wedges every future call against the same `integrationPath`:
 * confirmed empirically that a subsequent, entirely unrelated candidate's own merge attempt fails
 * immediately ("Exiting because of an unresolved conflict") until a human runs `git merge --abort`
 * manually. Every other failure path in this file already cleans up after itself (`abortRebase`); the
 * merge step needs the equivalent for the same reason. */
async function abortMerge(integrationPath: string): Promise<void> {
  await wrapGitFailure(
    () => execa('git', ['merge', '--abort'], { cwd: integrationPath }),
    `aborting the in-progress merge in the integration worktree at "${integrationPath}"`,
  );
}

/** `06` §6.5's full pipeline for one candidate. `candidate.handle.branch` reaches `git merge`/`git
 * rebase` directly, never through `resolveRevision` first: unlike a caller-supplied ref (`baseSha`,
 * `integrationBase`), it is always `lanes.ts`'s own `laneBranchName` output, structurally guaranteed to
 * start with `forge/` and never flag-shaped (`slugifyStepId` never produces a leading `-`) — the same
 * "FORGE-generated, already ref-safe" trust `laneBranchName`'s own doc comment already establishes for
 * `runId`. Serial by construction: one call at a time, on one candidate; the caller owns queueing order
 * across candidates (`06` §6.5: "Serial, one merge at a time") — this piece does not itself lock or
 * serialise anything, and `abortMerge` above exists specifically to fail safely, not silently correctly,
 * if that trust is ever violated. */
export async function processMergeCandidate(
  candidate: MergeCandidate,
  options: ProcessMergeCandidateOptions,
): Promise<MergeOutcome> {
  assertSingleLine('stepId', candidate.stepId);
  assertSingleLine('runId', candidate.runId);
  // `PLAN-M14.md` P18: the identical guard, for the identical reason -- `reviewReportId` is optional
  // (most candidates carry neither review field at all), so only checked when actually present.
  if (candidate.reviewReportId !== undefined) {
    assertSingleLine('reviewReportId', candidate.reviewReportId);
  }
  // laneId is not, in general, structurally guaranteed newline-free the way handle.branch is: a
  // reconstructed LaneHandle (e.g. after a crash-resume, via listOrphanedWorktrees, or a caller building
  // one directly) is not provably the untouched output of createLaneWorktree the way a freshly-created
  // one is — the LaneId brand is a compile-time-only guard a bare `as LaneId` defeats. Confirmed
  // empirically that a hand-built LaneHandle with a newline-laden laneId reached this function and
  // produced a commit with a forged-looking second Forge-Step line in its subject before this check
  // existed — validating it explicitly, not trusting the construction path, closes that.
  assertSingleLine('laneId', candidate.handle.laneId);

  // A lane whose merge was reverted (a failing post-merge check) can never be merged again: the revert commit stays
  // in the integration history, so a later `git merge` of the same branch is "Already up to date" (or brings only the
  // commits made since, with the reverted changes still undone). Refused, not reported as integrated (`PLAN-M13.md`
  // P38: the lane is an ancestor of HEAD all the same, and its content is not in it).
  const priorRevert = await execa(
    'git',
    [
      'log',
      'HEAD',
      '-1',
      '--format=%H',
      '--fixed-strings',
      '--grep',
      `Revert merge of lane ${candidate.handle.laneId} (`,
    ],
    { cwd: options.integrationPath, reject: false },
  );
  if (priorRevert.exitCode === 0 && priorRevert.stdout.trim() !== '') {
    throw new VcsError({
      code: 'VCS-LANE-REVERTED',
      message: `lane "${candidate.handle.laneId}" was merged into the integration branch and reverted (commit ${priorRevert.stdout.trim()}) because its post-merge check failed, so its content is not in the branch and merging the same branch again cannot restore it.`,
      remedy:
        'Fix the cause and run again in a NEW run (a lane is named by its run and step, so this run cannot make a second lane for the step), or revert the revert commit in the integration worktree by hand after inspecting it.',
    });
  }

  // `PLAN-M14.md` P35: checked before any git state is touched (assertReplayFromInLaneHistory's own doc
  // comment) — a bad replayFrom must never reach `git rebase --onto` itself.
  if (candidate.replayFrom !== undefined) {
    await assertReplayFromInLaneHistory(candidate.handle.path, candidate.replayFrom);
  }
  const integrationHeadSha = await resolveRevision(options.integrationPath, 'HEAD');
  let rebaseState = await attemptRebase(
    candidate.handle.path,
    integrationHeadSha,
    candidate.replayFrom,
  );
  // `PLAN-M14.md` P35: one entry per conflict actually resolved -- `MergeOutcome`'s own `conflict-resolved`
  // doc comment has the fuller "why a list, not a count" reasoning.
  const resolutions: MergeResolution[] = [];
  // `PLAN-M14.md` P35: how many resolutions this call has already spent — checked BEFORE the resolver is
  // ever called again, so a cap of N lets the resolver run at most N times, never N+1 (the mutation
  // evidence this piece pins: "cap removed: count 6" for a cap of 5 -- the resolver must be called exactly
  // the cap, not the cap plus the one that would have revealed the cap was exceeded).
  const maxResolutions = options.maxResolutions ?? DEFAULT_MAX_RESOLUTIONS;
  let resolutionCount = 0;

  // A loop, not a single if-branch: resolving one conflict and continuing the rebase can immediately
  // reveal a *second*, independent conflict on the lane's next commit — ordinary for any lane with more
  // than one commit, not an edge case. Each iteration re-dispatches on policy exactly like the first.
  while (rebaseState === 'conflict') {
    if (candidate.conflictPolicy === 'abort') {
      // `PLAN-M14.md` P35: `files` read before the abort below, while the conflict markers this reports
      // still exist in the worktree -- never the fuller `describeConflict` (no resolver will ever see this
      // one under `abort`, so its diff/commit are not worth the extra git calls).
      const files = await conflictedFilePaths(candidate.handle.path);
      await abortRebase(candidate.handle.path);
      return { kind: 'conflict-unresolved', reason: 'abort-policy', files };
    }
    if (options.conflictResolver === undefined) {
      await abortRebase(candidate.handle.path);
      throw new VcsError({
        code: 'VCS-MISSING-CONFLICT-RESOLVER',
        message:
          `candidate.conflictPolicy is "${candidate.conflictPolicy}", which requires a conflict, but ` +
          'no conflictResolver was supplied.',
        remedy: 'Pass a conflictResolver in the options, or set conflictPolicy to "abort".',
      });
    }
    if (resolutionCount >= maxResolutions) {
      const files = await conflictedFilePaths(candidate.handle.path);
      await abortRebase(candidate.handle.path);
      return {
        kind: 'conflict-unresolved',
        reason: 'resolution-cap',
        files,
        detail: `stopped after reaching the resolution cap of ${String(maxResolutions)}`,
      };
    }
    // A gauntlet verify round found that every *documented* exit from this loop cleans up the rebase
    // first, but a conflictResolver (or describeConflict's own git calls) itself throwing — a realistic
    // failure mode for what `06` §6.5 calls "spawn a merge-resolver step," a whole separate agent
    // invocation that can crash or time out — did not, leaving the lane worktree stuck mid-rebase with
    // no VcsError of its own explaining why. The resolver's own thrown value is preserved exactly and
    // re-thrown unwrapped (it may already be a well-formed VcsError from describeConflict, or an
    // arbitrary caller-defined error type) — only the cleanup is added, best-effort: if the abort itself
    // also fails here, the original resolver/describeConflict error is still what the caller most needs
    // to see, so that secondary failure is swallowed rather than replacing it.
    // `PLAN-M14.md` P35: described once, kept, and reused for `resolutions` below on success -- not
    // re-derived, so the `files`/`commit` a `MergeConflict{reason:'resolved'}` event later reports are
    // exactly what the resolver itself was actually shown, not a fresh (possibly already-stale) re-read.
    let conflict: MergeConflictDescription;
    let resolution: 'resolved' | 'unresolved';
    try {
      conflict = await describeConflict(candidate);
      resolution = await options.conflictResolver(conflict);
    } catch (cause) {
      try {
        await abortRebase(candidate.handle.path);
      } catch {
        // Best-effort cleanup; see the comment above for why its own failure is not surfaced here.
      }
      throw cause;
    }
    if (resolution === 'unresolved') {
      await abortRebase(candidate.handle.path);
      return {
        kind: 'conflict-unresolved',
        reason: 'resolver-unresolved',
        files: conflict.conflictedFiles.map((file) => file.path),
      };
    }
    resolutionCount += 1;
    resolutions.push({
      files: conflict.conflictedFiles.map((file) => file.path),
      ...(conflict.commit === undefined ? {} : { commit: conflict.commit }),
    });
    await stageResolution(candidate.handle.path);
    rebaseState = await continueRebase(candidate.handle.path);
  }

  // Nothing left to merge (see `MergeOutcome`'s `already-integrated`): the rebase dropped every commit of the lane.
  const covered = await execa(
    'git',
    ['merge-base', '--is-ancestor', candidate.handle.branch, 'HEAD'],
    { cwd: options.integrationPath, reject: false },
  );
  if (covered.exitCode === 0) return { kind: 'already-integrated' };
  if (covered.exitCode !== 1) {
    throw new VcsError({
      code: 'VCS-GIT-OPERATION-FAILED',
      message: `checking whether lane branch "${candidate.handle.branch}" is already in the integration worktree at "${options.integrationPath}" failed: ${covered.stderr}`,
      remedy: 'Inspect the integration worktree and the lane branch directly with git.',
    });
  }

  const preCheckFailure = await runChecksUntilFailure(options.preChecks, candidate.handle.path);
  if (preCheckFailure !== undefined) {
    return { kind: 'pre-check-failed', checkResult: preCheckFailure };
  }

  try {
    await execa(
      'git',
      ['merge', '--no-ff', candidate.handle.branch, '-m', formatMergeCommitMessage(candidate)],
      { cwd: options.integrationPath },
    );
  } catch (cause) {
    // Same "cleanup must not replace the diagnostic" care as revertMerge above — a gauntlet verify round
    // found that when this cleanup itself fails (e.g. the merge failed for a reason that never actually
    // set MERGE_HEAD, so there is genuinely nothing for `git merge --abort` to abort), the ORIGINAL merge
    // failure was being silently replaced by abortMerge's own unrelated "nothing to abort" error.
    let cleanupNote = '';
    try {
      await abortMerge(options.integrationPath);
    } catch (cleanupCause) {
      cleanupNote = ` (cleanup afterward also failed: ${errorMessage(cleanupCause)})`;
    }
    throw new VcsError(
      {
        code: 'VCS-GIT-OPERATION-FAILED',
        message:
          `merging lane branch "${candidate.handle.branch}" into the integration worktree at ` +
          `"${options.integrationPath}" failed: ${errorMessage(cause)}${cleanupNote}`,
        remedy:
          "This should not happen for a lane already successfully rebased onto integration's current " +
          'head, unless integration moved again after that rebase (the "one merge at a time" contract ' +
          'this piece trusts its caller to hold) — inspect the integration worktree directly. See the ' +
          'underlying cause for the exact git error.',
      },
      { cause },
    );
  }
  const { stdout: mergeCommitShaRaw } = await wrapGitFailure(
    () => execa('git', ['rev-parse', 'HEAD'], { cwd: options.integrationPath }),
    `resolving the new merge commit's sha in the integration worktree at "${options.integrationPath}"`,
  );
  const mergeCommitSha = mergeCommitShaRaw.trim();

  const postCheckFailure = await runChecksUntilFailure(options.postChecks, options.integrationPath);
  if (postCheckFailure !== undefined) {
    const revertCommitSha = await revertMerge(options.integrationPath, mergeCommitSha, candidate);
    return { kind: 'post-check-failed-reverted', checkResult: postCheckFailure, revertCommitSha };
  }

  return resolutions.length > 0
    ? { kind: 'conflict-resolved', mergeCommitSha, resolutions }
    : { kind: 'clean', mergeCommitSha };
}
