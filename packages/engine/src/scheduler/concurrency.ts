/**
 * `06` §6.3's own three concurrency-limit classes (global, per-agent, per-resource-class) plus the
 * adapter-reported one.
 *
 * @see specs/06 §6.3
 * @see PLAN-M5.md P12
 */
import type { AdmissionCandidate, ConcurrencyLimits, RunningCounts } from './types.ts';

/** A `NaN` limit value (never a legitimate one this module itself produces — this file's own doc comment
 * already disclaims deciding what limits *should* be, only enforcing whatever it is handed, so a corrupt
 * value can only ever arrive from a caller) is treated as the most restrictive possible limit (`0`,
 * blocking everything on that axis), not as "unlimited." Every *other* degenerate numeric value a caller
 * could hand this function (`0`, a negative number, `Infinity`) already fails this same safe direction on
 * its own, purely because `count >= that value` behaves sensibly for all of them — `NaN` is the one value
 * for which `count >= NaN` is `false` regardless of `count`, silently disabling the entire limit axis
 * instead of restricting it. A verify round confirmed this concretely for all three call sites below
 * (`adapterMax` — which, left unguarded, would have corrupted the *combined* `Math.min` global limit too,
 * not just the adapter ceiling — `perAgent`, and `perResourceClass`) through the real, public
 * `Scheduler.next()` API, e.g. an "exclusive" (limit-1) agent silently admitting 50 concurrent steps. */
function safeLimit(limit: number): number {
  return Number.isNaN(limit) ? 0 : limit;
}

/** All four limit classes must pass for a candidate to be admitted — an absent entry in a `perAgent`/
 * `perResourceClass` map means "no limit configured for this specific key," not "admit unconditionally
 * regardless of the global limit": the global gate is checked unconditionally, every other gate is
 * checked only when both the candidate names a class *and* a limit exists for it. `adapterMax` (`06` §6.3:
 * "to respect provider rate limits") folds into the same global gate as `limits.global`, taking whichever
 * of the two is the tighter bound — both describe "how many sessions may run at once," just from two
 * different sources (an operator's own `--concurrency` flag vs. a platform's own reported ceiling), not
 * two independent things to check separately. */
export function admitsMoreConcurrency(
  candidate: AdmissionCandidate,
  limits: ConcurrencyLimits,
  running: RunningCounts,
): boolean {
  const effectiveGlobalLimit =
    limits.adapterMax !== undefined ? Math.min(limits.global, limits.adapterMax) : limits.global;
  if (running.global >= safeLimit(effectiveGlobalLimit)) return false;

  const agent = candidate.node.agent;
  if (agent !== undefined) {
    const agentLimit = limits.perAgent.get(agent);
    if (agentLimit !== undefined && (running.perAgent.get(agent) ?? 0) >= safeLimit(agentLimit))
      return false;
  }

  const resourceClass = candidate.resourceClass;
  if (resourceClass !== undefined) {
    const classLimit = limits.perResourceClass.get(resourceClass);
    if (
      classLimit !== undefined &&
      (running.perResourceClass.get(resourceClass) ?? 0) >= safeLimit(classLimit)
    )
      return false;
  }

  return true;
}
