/**
 * `checkSeparationOfDuties` — `05` §5.2's own separation-of-duties rule, enforced at the point an
 * actual agent instance is actually assigned to an actual step (the runtime half; A1's own load-time
 * *shape* check, narrowed to `reviewer` alone, is the static half — `SPEC-QUESTIONS.md` Q97).
 *
 * @see specs/05 §5.2
 * @see PLAN-M6.md A6
 */
import type { SeparationOfDutiesRole, SeparationViolation } from './types.ts';

/**
 * One deliberate Surface addition beyond `PLAN-M6.md` A6's own literal four-parameter signature: a
 * fifth `role` parameter. The plan's own text names the check by role ("a reviewer/critic/
 * diagnostician/test-architect-tagged step...") but the four-parameter signature it also gives has no
 * field for which of the four a given call is checking — and `SeparationViolation.role` (this piece's
 * own return type) needs a real value to report, not a fabricated one. `authoredBy` is keyed by the
 * *reviewing* step's own id (not the id of the step under review) — the caller, who already holds the
 * real dependency graph (`StepNode.dependsOn`) and the run's own author history, resolves "which
 * predecessor step's artifact does this review step actually consume" and passes that predecessor's
 * recorded author in under this step's own key; this function's only job is the one real comparison
 * `05` §5.2 actually describes, not a second copy of graph-walking logic `ExecuteStepContext.laneRegistry`
 * and its own caller already have everything needed to do once.
 */
export function checkSeparationOfDuties(
  runId: string,
  stepId: string,
  agentInstanceId: string,
  authoredBy: ReadonlyMap<string, string>,
  role: SeparationOfDutiesRole,
): SeparationViolation | undefined {
  const author = authoredBy.get(stepId);
  if (author === undefined || author !== agentInstanceId) return undefined;
  return { runId, stepId, role, agentInstanceId };
}
