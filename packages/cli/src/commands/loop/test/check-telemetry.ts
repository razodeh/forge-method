/**
 * `emitBindingCheckTelemetry`/`emitExemptionDeclaredTelemetry` — `specs/22` M15 P11: real telemetry for
 * two of the Mandate's six metrics, both centered on `test:binding`/`forge test exempt`: binding pass
 * rate and non-binding test count per story, and exemptions opened/expired.
 *
 * Both write into the CURRENT real run's own event log, when one genuinely exists — the identical
 * `FORGE_RUN_ID`-gated stance `PLAN-M15.md` P7's own `assembleAndWriteEvidenceBundle` already takes for
 * `cost`/`reviews` ("no event log to read/write" for a standalone invocation outside any real `forge
 * run`). `forge story verify`'s `self-verify`/`done-check` steps and `G-Verify.gate.yaml`'s own
 * `test:binding` check both genuinely run with a real `FORGE_RUN_ID` in their own process env
 * (`runCommandStep`'s explicit env overlay, and `buildRunEngineContext`'s own `gateEnv`, respectively);
 * a human iterating locally at a bare shell does not, and this piece emits nothing for that case rather
 * than inventing a second, run-less event log to write into (`@forge/telemetry`'s own `ForgeEvent.runId`
 * is not optional on the type — there is structurally nowhere else for an event to live).
 *
 * `CheckRun` (`18` §18.4's own "Custom" group, genuinely reserved and never emitted anywhere in this
 * codebase before this piece — confirmed by grep) is the real `EventType` both use, each with its own
 * `kind:`-tagged payload, the identical "a new fact riding on an existing event type's own untyped
 * payload" precedent `StepProgress`'s own `kind: 'critic-round'` (`specs/22` M15 P9) and `SessionEvent`'s
 * own `kind: 'context-request'`/`'kb-read'` already establish — reused here rather than stretching
 * either of those two (both scoped to a dispatched STEP's own lifecycle; a binding check or an exemption
 * declaration is neither a step nor a session) or inventing a fourth custom `EventType` for what the
 * already-reserved "Custom" group's own documented purpose (no further elaboration beyond the bare name,
 * `specs/18` §18.4's own table) appears to exist for.
 *
 * Disclosed, pre-existing risk, not a new one this piece introduces: both call this strictly AFTER the
 * real work they describe has already durably committed (`appendExemption`'s own write, `checkBinding`'s
 * own result computation) — so a genuine I/O fault on THIS write (a full disk, a permissions problem) can
 * make an already-successful real operation surface as a thrown failure to its caller, or (crashing
 * between the two) silently lose just that one metric sample while leaving the real state fully intact.
 * Identical, already-shipped, unaddressed shape to `run/gate-commands.ts`'s own `emitGateEvent` (called
 * the same way, after `gateApprove`/`gateReject`/`gateWaive`'s own real state already changed) — this
 * piece matches the one true established CLI-layer convention rather than inventing a special, divergent
 * swallow-and-log path solely for these two new call sites.
 *
 * @see specs/22 M15 P11
 * @see PLAN-M15.md P11
 * @see PLAN-M15.md P7
 *
 * **`specs/22` M16 P15 addendum.** `BindingCheckTelemetryInput.hunkMutation`/`countHunkVerdicts` below
 * are this piece's own ADDITIVE extension: `forge test binding --hunks`'s own already-landed
 * `HunkMutationReport` (M16 P12/P13, `hunk-mutation.ts`) passed straight through, never re-derived —
 * this module is simply a SECOND place that tallies an already-decided `HunkVerdict.kind` into counts,
 * the identical "each call site derives its own already-known facts from the caller's own result"
 * convention `testsNamed`/`bound`/`nonBinding`/`exempted` above already establish across this file's
 * own two call sites (`bin.ts`'s `hunkMutationToJson` is the FIRST such tally, for the unrelated
 * `--json` envelope; it is private to `bin.ts`, which exports nothing, so it cannot be reused here).
 * `v` stays at 1 (`18` §18.4's payload-versioning rule, pinned by P1 and this piece): every field below
 * is optional and additive, and an existing `kind: 'binding'` payload with none of them parses and
 * renders identically to before (`report.ts`'s own golden test).
 *
 * @see specs/22 M16 P15
 */
import type { Clock } from '@forge/core';
import { SECRET_PATTERNS } from '@forge/extensions/skills';
import { appendEvent } from '@forge/telemetry/events';

import type { Granularity, HunkMutationReport, HunkVerdict } from './hunk-mutation.ts';

export interface BindingCheckTelemetryInput {
  readonly projectRoot: string;
  readonly runId: string | undefined;
  readonly clock: Clock;
  readonly storyId: string;
  /** Every test the binding check actually named and ran (`result.namedTests.length`). */
  readonly testsNamed: number;
  /** Tests that genuinely failed when the implementation was reverted (`result.failedUnderMutation.length`). */
  readonly bound: number;
  /** Tests that did NOT fail when reverted — the raw count, BEFORE any exemption is applied
   * (`rawNonBinding.length`): the ground-truth number this piece's own Mandate exists to measure,
   * recorded even when an exemption later covers some of them — undercounting via a valid exemption
   * would be exactly the kind of hidden gap a later milestone's falsification effort is supposed to
   * catch, not one this metric should itself launder away. */
  readonly nonBinding: number;
  /** Of `nonBinding`, how many a currently-valid (not stale, not expired) exemption actually covers
   * (`application.nonBinding.length` is `nonBinding - exempted`). */
  readonly exempted: number;
  /** `specs/22` M15 P11 metric 4b: any exemption this SAME check discovered was already expired
   * (`ExemptionApplication.expiredExemptions`, mapped to their own ids) — a real, timestamped
   * occurrence (the moment a real check ran and found a stale exemption), bundled onto the same
   * `CheckRun` event rather than a second one, since both facts are learned at the identical real
   * moment, inside the identical function call (`applyExemptions`). Omitted (not an empty array) when
   * none were found. */
  readonly expiredExemptionIds?: readonly string[];
  /** `specs/22` M16 P15: present only when `forge test binding --hunks` genuinely ran the hunk-
   * mutation engine for THIS check (`runOneStoryBinding`'s own `raw.hunkMutation`, `bin.ts`) — never
   * the plain change-level check, and never set at all from `story.ts`'s own `checkBinding` call site,
   * which has no `--hunks` surface. Passed through whole, never pre-counted by the caller: this
   * module is the one place a `HunkMutationReport` becomes telemetry-shaped counts, so a caller and
   * this file's own payload shape can never silently drift out of agreement about how a verdict is
   * counted. */
  readonly hunkMutation?: HunkMutationReport;
}

/** `specs/22` M16 P15: tallies an already-decided `HunkVerdict.kind` per hunk into the five counts
 * `forge report`'s own new hunk line reads — a frequency count over verdicts `hunk-mutation.ts` already
 * decided, never a second opinion about what a hunk's own verdict IS (that engine stays exactly where
 * P12/P13 already built it). */
function countHunkVerdicts(report: HunkMutationReport): {
  readonly granularity: Granularity;
  readonly killedHunks: number;
  readonly uncoveredHunks: number;
  readonly invalidHunks: number;
  readonly timeoutHunks: number;
  readonly skippedHunks: number;
} {
  const count = (kind: HunkVerdict['kind']): number =>
    report.hunks.filter((hunk) => hunk.verdict.kind === kind).length;
  return {
    granularity: report.granularity,
    killedHunks: count('killed'),
    uncoveredHunks: count('uncovered'),
    invalidHunks: count('invalid'),
    timeoutHunks: count('timeout'),
    skippedHunks: count('skipped'),
  };
}

/** `specs/22` M15 P11 metrics 1 and 4b. Scoped to the two real "check this story's binding status" call
 * sites (`story.ts`'s `checkBinding`, `bin.ts`'s `runOneStoryBinding`) — deliberately NOT
 * `runRawBindingCheck`'s own pre-check inside `forge test exempt` (a different real occurrence,
 * "is this one specific test non-binding right now," not "what is this story's own binding pass
 * rate," and already about to get its own `kind: 'exemption-declared'` event if it succeeds). */
export async function emitBindingCheckTelemetry(input: BindingCheckTelemetryInput): Promise<void> {
  if (input.runId === undefined) return;
  await appendEvent(
    input.projectRoot,
    input.runId,
    {
      type: 'CheckRun',
      runId: input.runId,
      ts: input.clock.now(),
      payload: {
        kind: 'binding',
        storyId: input.storyId,
        testsNamed: input.testsNamed,
        bound: input.bound,
        nonBinding: input.nonBinding,
        exempted: input.exempted,
        ...(input.expiredExemptionIds === undefined || input.expiredExemptionIds.length === 0
          ? {}
          : { expiredExemptionIds: input.expiredExemptionIds }),
        ...(input.hunkMutation === undefined ? {} : countHunkVerdicts(input.hunkMutation)),
      },
    },
    { valuePatterns: SECRET_PATTERNS },
  );
}

export interface ExemptionDeclaredTelemetryInput {
  readonly projectRoot: string;
  readonly runId: string | undefined;
  readonly clock: Clock;
  readonly exemptionId: string;
  readonly testId: string;
  readonly owner: string;
  readonly expiry: string;
}

/** `specs/22` M15 P11 metric 4a: fired once, right after `appendExemption`'s own write genuinely
 * commits — never before, so a refused or failed declaration (a bad `--reason`, an id-exhausted
 * registry, a lock timeout) records no event for an exemption that was never actually durable. */
export async function emitExemptionDeclaredTelemetry(
  input: ExemptionDeclaredTelemetryInput,
): Promise<void> {
  if (input.runId === undefined) return;
  await appendEvent(
    input.projectRoot,
    input.runId,
    {
      type: 'CheckRun',
      runId: input.runId,
      ts: input.clock.now(),
      payload: {
        kind: 'exemption-declared',
        exemptionId: input.exemptionId,
        testId: input.testId,
        owner: input.owner,
        expiry: input.expiry,
      },
    },
    { valuePatterns: SECRET_PATTERNS },
  );
}
