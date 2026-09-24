/**
 * `classifyFailure`/`normaliseErrorSignature` — turning a real `StepOutcome` (`@forge/engine/dispatch`,
 * P15) into `06` §6.8's own nine-member `FailureClass`, and into the stable signature the never-retry
 * rule compares two attempts by.
 *
 * @see specs/06 §6.8
 * @see PLAN-M5.md P16
 */
import { createHash } from 'node:crypto';

import { ForgeError } from '@forge/core/errors';

import type { StepFailureInfo, StepOutcome } from '../dispatch/index.ts';
import type { FailureClass } from './types.ts';

function requireFailure(outcome: StepOutcome): StepFailureInfo {
  if (outcome.status !== 'failed' || outcome.failure === undefined) {
    throw new ForgeError('RUN-042', { stepId: outcome.stepId, status: outcome.status });
  }
  return outcome.failure;
}

/** `10` §10.3's own gate rejection is, structurally, exactly `06` §6.8's own `validation` example
 * ("output failed schema/contract"): a gate exists to check the step's own produced artifact against a
 * contract, and `GateRejected` means that check failed. */
function classifyGateFailure(): FailureClass {
  return 'validation';
}

/** 124 is the POSIX/GNU coreutils `timeout` utility's own conventional exit code for "the command was
 * killed because it ran out of time" — the one exit code with a genuinely standard, cross-platform
 * meaning. Every other exit code is workflow-author-specific (a lint command, a test command, and a
 * build command all fail with their own unrelated conventions, or none at all) and this dispatcher has
 * no way to know which a given `command` step's own `run` string was — the safest default treats an
 * arbitrary command failure as the tool the workflow itself ran going wrong, not specifically "the
 * generated tests failed" (`06` §6.8's own `test-failure` examples are about *generated* code, which a
 * bare shell command step has no concept of). */
function classifyCommandFailure(failure: StepFailureInfo): FailureClass {
  if (failure.code === '124') return 'timeout';
  return 'tool-error';
}

/** `SessionResult.error.code` (`@forge/adapter-kit`) is a genuinely open, adapter-defined string — no
 * registry exists for it anywhere in this codebase (confirmed by grep: `@forge/testkit`'s own
 * `FakePlatformAdapter` invents its own ad hoc codes — `INJECTED_FAILURE`, `UNKNOWN_MODEL`,
 * `SCRIPTED_ERROR` — none of which claim to be a real vocabulary). `'TOOL_ERROR'` is the one code this
 * milestone's own real callers (this dispatcher's own tests) actually use, matching `06` §6.8's own
 * `tool-error` example verbatim ("agent used a forbidden/failing command"). Everything else, including
 * an adapter session that crashed with no code at all (`runAgentStep`'s own `catch` block never sets
 * one), defaults to `transient` — the least harmful guess when nothing distinguishes "the platform
 * itself hiccuped" from any other kind of unrecognised adapter failure. */
function classifyAdapterFailure(failure: StepFailureInfo): FailureClass {
  if (failure.code === 'TOOL_ERROR') return 'tool-error';
  return 'transient';
}

/** `@forge/vcs`'s own error codes (confirmed by reading `errors.ts`/`git.ts`/`commit.ts`/`claims.ts`/
 * `merge-queue.ts` directly — the full real inventory is `VCS-INVALID-COMMIT-FIELD`,
 * `VCS-INVALID-AGENT-ROLE`, `VCS-MISSING-CONFLICT-RESOLVER`, `VCS-GIT-OPERATION-FAILED`,
 * `VCS-CLAIM-REVERT-FAILED`, `VCS-REGENERATE-COMMAND-FAILED`, `VCS-NOT-A-REPO`, `VCS-DIRTY-TREE`, plus
 * `runVcsStep`'s own `UNKNOWN` fallback for a non-`VcsError` throw): a `VCS-INVALID-*` code names a
 * genuinely malformed input — `06` §6.8's own `validation` class, not an infrastructure hiccup.
 * `VCS-MISSING-CONFLICT-RESOLVER` (`SPEC-QUESTIONS.md` Q77) means this *run's own configuration* lacks
 * something no retry of the identical step can supply — closer to `policy`'s own "fail immediately, no
 * retry, surface to human" handling than to anything retryable. Every other code defaults to
 * `transient`, including two (`VCS-NOT-A-REPO`, `VCS-DIRTY-TREE`) that are arguably closer to a
 * persistent, config-shaped problem than a hiccup — kept as the shared default anyway, deliberately: a
 * step hitting either would fail identically on a genuine retry, but the never-retry rule already
 * escalates on the *second* identical occurrence regardless of which class it started in, so a dedicated
 * mapping for these two would only change how quickly escalation happens, not whether it does — not
 * worth a third, narrower category for two codes this dispatcher has no test coverage exercising yet. */
function classifyVcsFailure(failure: StepFailureInfo): FailureClass {
  if (failure.code === 'VCS-MISSING-CONFLICT-RESOLVER') return 'policy';
  // A lane whose merge was reverted cannot be merged again in this run (`PLAN-M13.md` P38): a retry fails identically.
  if (failure.code === 'VCS-LANE-REVERTED') return 'policy';
  // `PLAN-M14.md` P34: an in-lane join (`createLaneForStep`, `lane-base.ts`) that conflicted under the
  // `abort` policy -- `06` §6.8's own `conflict` example verbatim ("contradictory inputs"), the identical
  // mapping `classifyMergeFailure`'s own `MERGE-CONFLICT-UNRESOLVED` already gives for the analogous
  // landing-time conflict.
  if (failure.code === 'LANE-JOIN-CONFLICT') return 'conflict';
  if (failure.code?.startsWith('VCS-INVALID-') === true) return 'validation';
  // `PLAN-M14.md` P38: `createAgentConflictResolver`'s own five refusal/guardrail codes
  // (`MERGE-RESOLVER-NO-STEP`/`-READ-ONLY`/`-BUDGET`/`-TREE-MOVED`/`-OUT-OF-CLAIM`, `dispatch/
  // conflict-resolver.ts`) are thrown as `VcsError`s (the identical "no registry, no ForgeError" shape
  // `VCS-MISSING-CONFLICT-RESOLVER` already has -- `MERGE` is not one of `codes.ts`'s own ten closed
  // prefixes), so they reach this function through `failure.code` exactly the same way. Deliberately left
  // to fall through to `transient` below rather than given a dedicated `policy` mapping of their own: this
  // classifier's own established stance for a VCS-shaped code with no test coverage yet (the paragraph
  // above, for `VCS-NOT-A-REPO`/`VCS-DIRTY-TREE`) applies here too, and P16's own retry loop has no
  // production caller regardless (this file's own `prompt`-case comment below has the fuller "why this
  // still matters only for `06` §6.8's classification, not a live retry, today" reasoning) -- verified,
  // not silently unconsidered (`packages/engine/test/failures/classify.test.ts`).
  return 'transient';
}

/** The three real `merge`-sourced failure codes `runMergeStep` (`steps.ts`) constructs, added
 * specifically for this classifier (`SPEC-QUESTIONS.md` Q77) rather than sniffed from message text.
 * `MERGE-CONFLICT-UNRESOLVED` is `06` §6.8's own `conflict` example verbatim ("contradictory inputs").
 * `MERGE-PRE-CHECK-FAILED`/`MERGE-POST-CHECK-FAILED` name `06` §6.5's own pre/post-merge check sets
 * ("typecheck, lint, affected unit tests" / "full build + full test + contract tests") — genuinely
 * test-shaped work, closer to `test-failure`'s own "up to N self-fix loops, then diagnostician" handling
 * than to a bare `validation` failure. */
function classifyMergeFailure(failure: StepFailureInfo): FailureClass {
  if (failure.code === 'MERGE-CONFLICT-UNRESOLVED') return 'conflict';
  if (failure.code === 'MERGE-PRE-CHECK-FAILED' || failure.code === 'MERGE-POST-CHECK-FAILED') {
    return 'test-failure';
  }
  // A merge check that cannot run because the project's configuration cannot supply it (`PLAN-M13.md` P38): the same
  // step fails identically on every retry until a human sets `execution.testCommands`, so it is `policy`, not
  // `transient`.
  if (
    failure.code === 'MERGE-CHECKS-UNCONFIGURED' ||
    failure.code === 'MERGE-CHECK-COMMAND-INVALID'
  ) {
    return 'policy';
  }
  // `MERGE-REVIEW-INCOMPLETE` (`PLAN-M14.md` P18): a swarm-review lane's own committed verdict is not
  // `concerns`/`clear` (`incomplete`, `blocked`, or a missing/unparseable field), or it is the implement
  // lane such a review reviews (P38 stacking). The same committed report fails identically on every
  // retry of the merge itself -- only a fresh review, a human decision, changes it -- the identical
  // "this run's own state lacks something no retry of the identical step can supply" reasoning
  // `VCS-MISSING-CONFLICT-RESOLVER` above already gives for `classifyVcsFailure`'s own `policy` mapping.
  if (failure.code === 'MERGE-REVIEW-INCOMPLETE') return 'policy';
  return 'transient';
}

/** The `ForgeError` codes prompt assembly raises for a permanent, config-shaped refusal. */
const PROMPT_POLICY_CODES: ReadonlySet<string> = new Set([
  'RUN-039',
  // A `swarm-review` step with no perspectives (`PLAN-M13.md` P17): the same workflow fails identically.
  'RUN-046',
  'RUN-056',
  'RUN-077',
  'RUN-078',
  'RUN-079',
  'RUN-080',
  'RUN-081',
  'CFG-003',
  'CFG-004',
  'CFG-053',
  'CFG-054',
  'KB-013',
  'KB-014',
]);

/** Maps a real `StepOutcome`'s own failure to `06` §6.8's own nine-member table. Throws `RUN-042` for a
 * succeeded outcome — classifying "what went wrong" makes no sense when nothing did, the same
 * structural/config-error-throws split this whole package already holds for malformed input elsewhere
 * (`@forge/engine/dispatch`'s own `RUN-039`/`RUN-040`/`RUN-041`). */
export function classifyFailure(outcome: StepOutcome): FailureClass {
  const failure = requireFailure(outcome);
  switch (failure.source) {
    case 'gate':
      return classifyGateFailure();
    case 'command':
      return classifyCommandFailure(failure);
    case 'adapter':
      return classifyAdapterFailure(failure);
    case 'vcs':
      return classifyVcsFailure(failure);
    case 'merge':
      return classifyMergeFailure(failure);
    case 'prompt':
      // Only the codes assembly raises for a *config-shaped* refusal (a missing agent/brief/prompt file, an
      // unmapped model tier, a grant above its ceiling, an adapter that cannot carry a system prompt, a
      // blank task, a bad escalation) fail identically on every retry: `06` §6.8's "fail immediately,
      // surface to a human" class. Anything else -- a raw or wrapped file-system error (`EMFILE`,
      // `ENOSPC`, `RUN-034`), a locked index -- is an infrastructure hiccup and stays retryable.
      return failure.code !== undefined && PROMPT_POLICY_CODES.has(failure.code)
        ? 'policy'
        : 'transient';
    case 'elicit':
      // A question no answer was given for, or one whose answer broke the question's rules (`PLAN-M13.md` P20):
      // asking again cannot change either until a human supplies the answer, so it is `06` §6.8's "fail
      // immediately, surface to a human" class.
      return 'policy';
    case 'claim':
      // `enforceClaim` found a `strict` step wrote outside its claim (`PLAN-M14.md` P3, `SPEC-QUESTIONS.md`
      // Q232 decision 1): the same session writing the same stray path violates the same claim identically
      // on every retry, so it is `06` §6.8's "fail immediately, surface to a human" class, exactly like
      // `elicit` above and the `prompt`-sourced policy codes.
      return 'policy';
    case 'output':
      // `RUN-108` (`PLAN-M14.md` P14, `SPEC-QUESTIONS.md` Q232 decision 7): a swarm-review step's merged
      // verdict is `blocked`. The report itself is a valid, committed document -- this is not the P7
      // output-contract check failing (that stays `validation`, below) -- and re-running the identical
      // session over the identical diff fails identically: `06` §6.8's own "fail immediately, no retry,
      // surface to a human" class, the same as `elicit` and the `claim`-sourced codes above.
      // `implement-story.workflow.yaml`'s own `review` step declares `retryOn: [validation]`; classifying
      // this `policy` instead is what keeps that retry from firing on a blocked review.
      if (failure.code === 'RUN-108') return 'policy';
      // A declared output that is absent or fails its schema is `06` §6.8's own `validation` example
      // ("output failed schema/contract"), whichever of the two it was: `onFailure`/`retry` then apply as
      // for any other step failure. (Retrying a session that could not write is futile when the cause is
      // the agent's grant, `RUN-084`, but the never-retry rule already escalates the second identical
      // failure, and the retry loop has no production caller yet, `PLAN-M11.md` P11.)
      return 'validation';
    case 'telemetry':
    case 'unsupported':
      // 'telemetry' is constructed in one place: `runAgentWork` when the session's answer cannot be written
      // to its run record (`result.md`, `PLAN-M13.md` P12) -- a disk hiccup a retry may well clear, so
      // 'transient'. (A TelemetryError from the event log itself still escapes as a thrown RUN-038.)
      // 'unsupported' has no real producer at all in this milestone's own built pieces, kept only because
      // StepFailureInfo.source's own type includes it, so this switch must stay exhaustive; 'transient' is
      // the least harmful default should it somehow occur.
      return 'transient';
  }
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_TOKEN_PATTERN = /\b[0-9a-f]{6,}\b/gi;
const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;
const ABSOLUTE_PATH_PATTERN = /\/[^\s"'()]+/g;

/** How many of a path token's own trailing `/`-delimited segments survive normalisation — a bounded
 * heuristic, not a real project-root detection (this function has no filesystem access, only a bare
 * string): 1 segment alone (an earlier version of this fix) still collided two *different* files that
 * happen to share a basename and line:col, a real risk in a monorepo with several `index.ts`/`errors.ts`
 * files across packages — confirmed as a genuine, if narrower, residual false-collision case by this
 * piece's own gauntlet-loop verify round. 2 covers that specific case (`packages/vcs/src/errors.ts` and
 * `packages/core/src/errors/codes.ts` now normalise to distinct `errors.ts`/`codes.ts` trailing
 * segments) without needing to guess at a real project root. Not a complete fix, and cannot be: no fixed
 * N ever fully resolves "how many segments are the variable machine-specific prefix vs. the meaningful
 * project-relative path" without knowing where the real root is — accepted as a bounded approximation,
 * the same "narrower, not a growing blacklist" stance this codebase already takes for `isNonBlank`'s own
 * residual Unicode-category gaps (`SPEC-QUESTIONS.md` Q76). */
const PRESERVED_PATH_SEGMENTS = 2;

/** The part of an absolute path token that is genuinely bug-identifying, not run-to-run noise: its own
 * trailing `PRESERVED_PATH_SEGMENTS` `/`-delimited segments, which for a real compiler/tool error
 * includes the filename (plus whatever `:line:col` suffix follows it, already part of the same token
 * since neither character is excluded by `ABSOLUTE_PATH_PATTERN`) and its immediate parent directory.
 * Everything *before* that — the checkout/tmp-dir/lane-worktree location that varies across runs — is
 * the part worth discarding. `.filter(Boolean)` drops empty segments from a trailing slash
 * (`/repo/src/`), so that case still returns `src`, not ''. */
function trailingPathSegments(pathToken: string): string {
  const segments = pathToken.split('/').filter((segment) => segment.length > 0);
  return segments.slice(-PRESERVED_PATH_SEGMENTS).join('/');
}

/** Strips the parts of a real error message that vary run-to-run for the *identical* underlying bug —
 * a tmp-dir path, a commit sha, a session/run id, a timestamp — so two runs that hit the same real
 * failure produce the same normalised text, while still distinguishing two genuinely different failures.
 * A path keeps its own trailing segments (`trailingPathSegments`) rather than being discarded outright:
 * a compiler/lint/test error's own real bug-identifying content is almost always right there (the
 * filename and `:line:col`), and discarding the whole path collapses two *different* bugs that both
 * happen to reference an absolute path — true of nearly every real tool error message — into one
 * indistinguishable signature, defeating this function's entire purpose. Order matters: the path pass
 * runs first, so a UUID/hex-looking segment it preserves (a lane worktree's own random suffix, say) is
 * still caught by the passes after it rather than needing its own special-casing; a UUID is still
 * replaced before the generic hex-token pass specifically, or its own dashes would split it into
 * partially-replaced fragments instead of one clean `<uuid>` token. */
function normaliseMessage(message: string): string {
  return message
    .replace(ABSOLUTE_PATH_PATTERN, (match) => `<path>/${trailingPathSegments(match)}`)
    .replace(UUID_PATTERN, '<uuid>')
    .replace(TIMESTAMP_PATTERN, '<timestamp>')
    .replace(HEX_TOKEN_PATTERN, '<hex>');
}

/** A stable signature for the never-retry rule (`06` §6.8) to compare two attempts by: `source`/`code`/
 * a normalised `message`, hashed (not returned as raw text) so two long, path-and-timestamp-heavy
 * messages that normalise identically produce one short, easily-stored/compared value. `sha256`, the
 * same real hash function `@forge/vcs`'s own `slugifyStepId` already uses for an unrelated but
 * structurally identical "turn variable text into a short, stable token" need — truncated to 16 hex
 * characters, ample collision resistance for comparing attempts within one step's own retry history,
 * not a security boundary. Throws `RUN-042` for a succeeded outcome, the same as `classifyFailure`. */
export function normaliseErrorSignature(outcome: StepOutcome): string {
  const failure = requireFailure(outcome);
  const normalised = `${failure.source}|${failure.code ?? ''}|${normaliseMessage(failure.message)}`;
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}
