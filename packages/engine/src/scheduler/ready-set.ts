/**
 * `06` §6.3's own ready-set definition: "nodes whose dependencies are `succeeded` and whose resource
 * claims don't conflict with a running node."
 *
 * @see specs/06 §6.3
 * @see PLAN-M5.md P12
 */
import { globsOverlap, type StepNode } from '../plan/index.ts';
import type { StepStatus } from './types.ts';

/** `06` §6.2's own rule 3 (`@forge/engine/plan`'s own `applyClaimOverlaps`, `Q73`) already inserts an
 * explicit `dependsOn` edge between any two *compile-time-detectable* overlapping claims, so two such
 * steps should never actually reach the ready set at the same time via dependency ordering alone. This
 * check is `06` §6.3's own separate, run-time restatement of the identical rule, kept as a real second
 * check rather than assumed redundant: `applyClaimOverlaps`'s own glob-overlap detection is a deliberately
 * bounded approximation (`Q73`), so a genuine overlap it cannot detect at compile time is exactly the
 * shape this run-time check exists to still catch, using the identical `globsOverlap` — the two checks
 * share one glob-comparison function rather than risk disagreeing about what "overlap" means. */
export function computeReadySet(
  nodes: readonly StepNode[],
  statuses: ReadonlyMap<string, StepStatus>,
  runningClaims: readonly string[],
): readonly StepNode[] {
  return nodes.filter((node) => {
    const status = statuses.get(node.id) ?? 'pending';
    if (status !== 'pending') return false;

    const dependenciesSucceeded = node.dependsOn.every((dep) => statuses.get(dep) === 'succeeded');
    if (!dependenciesSucceeded) return false;

    const claimsConflict = node.produces.some((glob) =>
      runningClaims.some((running) => globsOverlap(glob, running)),
    );
    return !claimsConflict;
  });
}
