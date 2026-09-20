/**
 * `computeLiveBudgetState` — turns `@forge/telemetry/ledger`'s own real, on-disk event log into the
 * live `BudgetState` `canAdmit`/`onBudgetBreach` (`PLAN-M5.md` P17) need, so a real `forge run` can
 * actually consult them.
 *
 * `PLAN-M11.md` P11's own S9 investigation found `canAdmit`/`onBudgetBreach` real, correct, and fully
 * unit-tested — but `@forge/engine/run`'s own `runEngine` never constructed a real `BudgetState` at
 * all, so `Scheduler`'s own `canAdmit` constructor parameter always fell back to its documented
 * "always admit" default. That default's own doc comment reads "a caller with no budget concept pays
 * nothing for it" — true on its own terms, but no real caller (`@forge/cli`'s own
 * `buildRunEngineContext`) ever supplied one either, so a real `forge run` enforced no budget cap at
 * all regardless of what `.forge/config.yaml`'s own real `budget.perRunUsd`/`budget.dailyUsd` said —
 * the identical "the mechanism is real, the wiring to a real call site is not" shape `PLAN-M11.md` P10
 * already found for S5's control-token stripping. A second, compounding gap found in the same
 * investigation: nothing in `@forge/engine/dispatch` ever emitted a `UsageRecorded` event for a real
 * session either (fixed separately, `dispatch/steps.ts`'s own `runAgentWork`), so even a caller who
 * *did* wire `canAdmit` in would have projected every admission against a permanently-empty ledger.
 * This module is the third piece: a real way to turn that now-real ledger into a live `BudgetState`.
 *
 * `runSpentUsd` sums this run's own ledger only (`projectLedger(readEvents(projectRoot, runId))`).
 * `dailySpentUsd` sums every run's own ledger entries whose own `ts` falls on the same UTC calendar day
 * as `nowIso` — the identical "every real run this project has ever executed" sweep `@forge/cli`'s own
 * `forge cost` (`packages/cli/src/commands/cost.ts`'s `allLedgerEntries`) already performs, duplicated
 * here rather than imported: `@forge/engine` has no dependency edge onto `@forge/cli` (`02` §2.2's own
 * graph runs the other way), and the underlying "list every run directory, project each one's own
 * ledger" logic is small enough that duplicating it is the same deliberate, disclosed choice
 * `adapter-generic`'s own `session-handle.ts`/`changed-files.ts` already made against
 * `adapter-claude-code`'s proven shapes (`GAUNTLET-LOG.md`'s M11 P7 entry).
 *
 * **Disclosed, not fixed, in this same piece**: `06` §6.8's own retry machinery
 * (`@forge/engine/failures`'s `decideRetry`/`computeBackoff`) has zero production callers anywhere in
 * this codebase — `run-engine.ts`'s own `driveToCompletion` marks a failed step `'failed'` on its very
 * first attempt and never retries it. `attributedSpend`'s own "sums every entry for a stepId, across
 * every retry" property is real and correctly tested (`@forge/telemetry/ledger` P7's own test suite,
 * plus this piece's own `s9-budget-enforcement.test.ts`), but a real `forge run` today never actually
 * produces more than one `UsageRecorded` event for the same `stepId` to sum, since no real retry ever
 * happens. Building a full retry loop is judged disproportionate scope for a security-invariant piece
 * (a materially larger, riskier change than S9's own proportionate ask), the same judgement `taint-
 * guard.ts`'s own doc comment already made for S6's grant-escalation surface — recorded here, and in
 * `SPEC-QUESTIONS.md`, rather than silently implied to already work end to end.
 *
 * @see specs/06 §6.9
 * @see specs/20 §20.8
 * @see specs/20 §20.10 S9
 * @see PLAN-M5.md P17
 * @see PLAN-M11.md P11
 */
import path from 'node:path';

import { listDirEntriesSorted, type AbsolutePath } from '@forge/core/fs';
import { readEvents } from '@forge/telemetry/events';
import { projectLedger, type LedgerEntry } from '@forge/telemetry/ledger';

import type { BudgetState } from './types.ts';

/** `.forge/config.yaml`'s own real `budget` block (`@forge/schemas`' `budgetSchema`), re-declared
 * structurally rather than imported — `@forge/engine` has no dependency edge onto `@forge/schemas`'
 * config module for this one shape, the same "re-declared, not imported" choice `dispatch/types.ts`'s
 * own `MergeOutcome`/`LaneHandle` already make for `@forge/vcs`. */
export interface BudgetConfig {
  readonly perRunUsd: number;
  readonly dailyUsd: number;
  /** `budget.perStepUsdDefault`: the per-step ceiling for a model step whose workflow step and agent
   * declare none (`resolveStepCostCeilings`). Optional so a caller with no such value pays nothing. */
  readonly perStepUsdDefault?: number;
  readonly onBreach: 'pause' | 'finish-lanes' | 'abort';
}

/** Every real run id this project has ever executed — `.forge/state/runs/<runId>/events.ndjson`'s own
 * parent directory, read directly rather than through `ProjectPaths` (this module only ever has a bare
 * `projectRoot` string, `ExecuteStepContext`'s own established shape). A project with no runs directory
 * yet (the very first run, still mid-flight, has already created its own — this only misses a *project*
 * with none at all, which cannot happen once any run has started) is a legitimate state, not an error —
 * the identical "yields nothing... is a legitimate state" stance `readEvents` itself already takes for
 * one run with no event log yet. */
async function listRunIds(projectRoot: string): Promise<readonly string[]> {
  const runsDir = path.join(projectRoot, '.forge', 'state', 'runs') as AbsolutePath;
  try {
    const entries = await listDirEntriesSorted(runsDir);
    return entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
  } catch (error) {
    // `listDirEntriesSorted` wraps every failure as `ForgeError('RUN-034')`, folding a genuinely
    // missing directory (a project with no runs yet) together with a real, unexpected one -- unwrapped
    // here via the standard `Error.cause` `ForgeError` itself sets, the same "distinguish ENOENT
    // structurally, not by message text" discipline `@forge/vcs`'s own `isNoCommitsYetResult` already
    // establishes.
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
}

/** The UTC calendar day (`YYYY-MM-DD`) a ledger entry's own `ts` (`21` §21.1's own ISO-8601 event
 * timestamp) falls on — UTC, not the host machine's own local timezone, so which runs count toward
 * "today" does not silently shift depending on where a run happens to execute. */
function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/** Every run's own ledger is projected independently, and a genuinely corrupt *other* run's own event
 * log (a real seq gap `readEvents` itself refuses to read past — `18` §18.4's own "seq gaps indicate
 * corruption" rule) is skipped rather than allowed to throw out of this function entirely: this
 * function's whole reason to exist is being called on *every scheduling tick* of the *current* run, and
 * an unrelated, already-broken run sitting in the same `.forge/state/runs/` directory must never be
 * able to halt an otherwise-healthy one just by existing. `currentRunId`'s own log is the one exception
 * — a genuine corruption there is this run's own real, current problem, and is allowed to propagate
 * rather than silently degrading `runSpentUsd`'s own accuracy for the one run a caller actually cares
 * about admitting steps into right now. */
async function allEntries(
  projectRoot: string,
  currentRunId: string,
): Promise<readonly LedgerEntry[]> {
  const runIds = await listRunIds(projectRoot);
  const entries: LedgerEntry[] = [];
  for (const runId of runIds) {
    if (runId === currentRunId) {
      entries.push(...(await projectLedger(readEvents(projectRoot, runId))));
      continue;
    }
    try {
      entries.push(...(await projectLedger(readEvents(projectRoot, runId))));
    } catch {
      // A different run's own corrupted log -- `forge doctor` is the real place to surface and repair
      // this (`18` §18.4's own "triggers forge doctor" text); this function only refuses to let it
      // crash budget enforcement for a run that has nothing to do with it.
      continue;
    }
  }
  return entries;
}

/** `nowIso` is the run's own injected clock (`ExecuteStepContext.now`, converted to an ISO string by
 * the caller), never `new Date()` read directly here — matching this whole package's own R10
 * determinism discipline (`specs/22`). Re-reads every real run's own event log fresh on every call —
 * deliberately not cached: a concurrent run's own spend can change `dailySpentUsd` between one call and
 * the next, and `20` §20.8's own "cost is a safety property" framing favours a slightly more expensive,
 * always-current read over a stale cached one that could let an already-breached period cap silently
 * keep admitting new steps. */
export async function computeLiveBudgetState(
  projectRoot: string,
  runId: string,
  nowIso: string,
  config: BudgetConfig,
): Promise<BudgetState> {
  const entries = await allEntries(projectRoot, runId);
  const today = utcDay(nowIso);
  const runSpentUsd = entries
    .filter((entry) => entry.runId === runId)
    .reduce((sum, entry) => sum + entry.costUsd, 0);
  const dailySpentUsd = entries
    .filter((entry) => utcDay(entry.ts) === today)
    .reduce((sum, entry) => sum + entry.costUsd, 0);
  return {
    perRunUsd: config.perRunUsd,
    perStepUsdDefault: config.perStepUsdDefault ?? 0,
    dailyUsd: config.dailyUsd,
    onBreach: config.onBreach,
    runSpentUsd,
    dailySpentUsd,
  };
}
