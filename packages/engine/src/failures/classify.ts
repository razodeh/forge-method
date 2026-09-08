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
  if (failure.code?.startsWith('VCS-INVALID-') === true) return 'validation';
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
  return 'transient';
}

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
    case 'telemetry':
    case 'unsupported':
      // Neither is ever actually constructed by any real handler in @forge/engine/dispatch: a
      // TelemetryError always escapes as a thrown RUN-038 (never folded into StepOutcome data), and
      // 'unsupported' has no real producer at all in this milestone's own built pieces — both kept only
      // because StepFailureInfo.source's own type includes them, so this switch must stay exhaustive.
      // 'transient' is the least harmful default should either somehow occur despite that.
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
