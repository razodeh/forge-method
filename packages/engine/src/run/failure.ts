/**
 * The reason a run ended `failed`, recorded on the `RunFailed` event so the log (the only source of truth,
 * `18` §18.4) always says why (`PLAN-M13.md` P12, `Q210`, `Q208` finding 1).
 *
 * A run used to fail with a bare `RunFailed` whenever the scheduler had nothing left to admit and some step
 * had not succeeded, whichever of several very different causes was behind it: a step that failed, a step
 * whose reservation no longer fit the budget, or one that nothing could ever admit. Only the first has its
 * own event. `diagnoseRun` names every step that did not finish and the one cause that stopped it.
 *
 * @see specs/06 §6.3, §6.9
 * @see specs/18 §18.4
 */
import type { AdmissionDecision } from '../budget/admit.ts';
import type { StepNode } from '../plan/index.ts';
import type { ConcurrencyLimits, StepStatus } from '../scheduler/types.ts';

/** A refusal by admission control: which cap, and the numbers that did not fit. */
export type BudgetRefusal = Extract<AdmissionDecision, { readonly admit: false }>;

/** Why one step never ran. `dependency-failed` and `dependency-unfinished` point at the nearest
 * unfinished ancestor, not the root cause; the root is the failed step or the refused one listed alongside. */
export type UnfinishedCause =
  | ({ readonly kind: 'budget' } & Omit<BudgetRefusal, 'admit' | 'stepId'>)
  | { readonly kind: 'dependency-failed'; readonly dependencyId: string }
  | { readonly kind: 'dependency-unfinished'; readonly dependencyId: string }
  | { readonly kind: 'concurrency'; readonly detail: string }
  | { readonly kind: 'not-admitted' };

export interface UnfinishedStep {
  readonly stepId: string;
  readonly cause: UnfinishedCause;
}

export type RunFailureReason =
  /** Admission control refused every ready step. */
  | 'budget'
  /** At least one step ran and failed. */
  | 'step-failed'
  /** Steps never ran and nothing above explains it (concurrency 0, a caller's own `canAdmit`). */
  | 'no-admissible-step'
  /** The run could not be set up (a step's agent file could not be read to resolve its cost ceiling). */
  | 'setup'
  /** Nothing failed or is pending, yet not every step succeeded (a skipped step). */
  | 'incomplete';

/** What `RunFailed` carries as its payload. The list of unfinished steps is capped: a fanout over a
 * thousand stories must not write a thousand-entry event; `unfinishedTotal` keeps the true count. */
export interface RunFailureRecord {
  readonly reason: RunFailureReason;
  readonly message: string;
  /** At most `MAX_RECORDED_UNFINISHED` ids; `failedTotal` keeps the true count. */
  readonly failedSteps: readonly string[];
  readonly failedTotal: number;
  /** Budget refusals first, then everything else in plan order, capped: the entry the CLI and the
   * `BudgetBreached` event name is therefore always present however many steps were blocked. */
  readonly unfinished: readonly UnfinishedStep[];
  readonly unfinishedTotal: number;
}

export const MAX_RECORDED_UNFINISHED = 25;

/** Two decimals, or four for a sub-cent amount, so a small budget's refusal never reads as "$0.00". */
function usd(value: number): string {
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
}

function describeCap(level: 'run' | 'period'): string {
  return level === 'run' ? 'run budget (budget.perRunUsd)' : 'daily budget (budget.dailyUsd)';
}

/** One human sentence for a budget refusal: the step, its reservation, what was spent and the cap. */
export function describeBudgetRefusal(refusal: {
  readonly stepId: string;
  readonly level: 'run' | 'period';
  readonly reservationUsd: number;
  readonly spentUsd: number;
  readonly capUsd: number;
}): string {
  const remaining = Math.max(0, refusal.capUsd - refusal.spentUsd);
  return (
    `step ${refusal.stepId} reserves ${usd(refusal.reservationUsd)}, and ${usd(refusal.spentUsd)} already spent plus that ` +
    `would reach the ${describeCap(refusal.level)} of ${usd(refusal.capUsd)} (${usd(remaining)} remains)`
  );
}

export interface DiagnoseInput {
  readonly nodes: readonly StepNode[];
  readonly status: (stepId: string) => StepStatus;
  /** The refusals admission control recorded on the last scheduling tick, in the scheduler's order. */
  readonly budgetRefusals: ReadonlyMap<string, BudgetRefusal>;
  readonly limits: ConcurrencyLimits;
}

function concurrencyDetail(node: StepNode, limits: ConcurrencyLimits): string | undefined {
  if (limits.global <= 0) return `the global concurrency limit is ${String(limits.global)}`;
  if (node.agent !== undefined) {
    const perAgent = limits.perAgent.get(node.agent);
    if (perAgent !== undefined && perAgent <= 0) {
      return `the concurrency limit for agent ${String(node.agent)} is ${String(perAgent)}`;
    }
  }
  return undefined;
}

/** Explains a run that did not complete. Never returns "no reason": every unfinished step is classified,
 * and the run-level reason and message always name something a reader can act on. */
export function diagnoseRun(input: DiagnoseInput): RunFailureRecord {
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const failedSteps = input.nodes
    .filter((node) => input.status(node.id) === 'failed')
    .map((node) => node.id);

  const unfinished: UnfinishedStep[] = [];
  for (const node of input.nodes) {
    if (input.status(node.id) !== 'pending') continue;
    const failedDependency = node.dependsOn.find((id) => input.status(id) === 'failed');
    if (failedDependency !== undefined) {
      unfinished.push({
        stepId: node.id,
        cause: { kind: 'dependency-failed', dependencyId: failedDependency },
      });
      continue;
    }
    const pendingDependency = node.dependsOn.find(
      (id) => byId.has(id) && input.status(id) !== 'succeeded',
    );
    if (pendingDependency !== undefined) {
      unfinished.push({
        stepId: node.id,
        cause: { kind: 'dependency-unfinished', dependencyId: pendingDependency },
      });
      continue;
    }
    const refusal = input.budgetRefusals.get(node.id);
    if (refusal !== undefined) {
      unfinished.push({
        stepId: node.id,
        cause: {
          kind: 'budget',
          level: refusal.level,
          reservationUsd: refusal.reservationUsd,
          spentUsd: refusal.spentUsd,
          capUsd: refusal.capUsd,
        },
      });
      continue;
    }
    const detail = concurrencyDetail(node, input.limits);
    unfinished.push({
      stepId: node.id,
      cause: detail === undefined ? { kind: 'not-admitted' } : { kind: 'concurrency', detail },
    });
  }

  const firstBudget = unfinished.find((entry) => entry.cause.kind === 'budget');
  // Budget refusals lead the recorded list, so the cap on it can never cut off the one entry that decides the
  // run's reason (a fanout of blocked dependents ahead of it in plan order would otherwise push it out).
  const ordered = [
    ...unfinished.filter((entry) => entry.cause.kind === 'budget'),
    ...unfinished.filter((entry) => entry.cause.kind !== 'budget'),
  ];
  const base = {
    failedSteps: failedSteps.slice(0, MAX_RECORDED_UNFINISHED),
    failedTotal: failedSteps.length,
    unfinished: ordered.slice(0, MAX_RECORDED_UNFINISHED),
    unfinishedTotal: unfinished.length,
  };

  if (firstBudget?.cause.kind === 'budget') {
    const { cause } = firstBudget;
    return {
      reason: 'budget',
      message:
        `no step could be admitted within the budget: ` +
        describeBudgetRefusal({ stepId: firstBudget.stepId, ...cause }),
      ...base,
    };
  }
  if (failedSteps.length > 0) {
    const blocked = unfinished.length;
    return {
      reason: 'step-failed',
      message:
        `${String(failedSteps.length)} step(s) failed (${failedSteps.slice(0, 5).join(', ')}` +
        `${failedSteps.length > 5 ? ', ...' : ''})` +
        (blocked > 0 ? ` and ${String(blocked)} dependent step(s) never ran` : ''),
      ...base,
    };
  }
  if (unfinished.length > 0) {
    const first = unfinished[0];
    const why =
      first === undefined
        ? ''
        : first.cause.kind === 'concurrency'
          ? `: ${first.cause.detail}`
          : first.cause.kind === 'dependency-unfinished'
            ? `: step ${first.stepId} waits on ${first.cause.dependencyId}, which never ran`
            : ': the scheduler admitted nothing and no budget refusal was recorded';
    return {
      reason: 'no-admissible-step',
      message: `${String(unfinished.length)} step(s) never ran${why}`,
      ...base,
    };
  }
  const skipped = input.nodes.filter((node) => input.status(node.id) === 'skipped');
  return {
    reason: 'incomplete',
    message: `the run finished with ${String(skipped.length)} skipped step(s) and no failure`,
    ...base,
  };
}
