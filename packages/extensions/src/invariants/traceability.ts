/**
 * `checkTraceabilityNotDisabled` (I6) — `15` §15.10: "traceability edges required by the spec graph
 * cannot be disabled."
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import { REQUIRED_EDGES, type EdgeRule } from '@forge/core';

import { violation } from './violation.ts';
import type { DisabledTraceabilityEdge, InvariantViolation } from './types.ts';

/**
 * `09` §9.4's own table names which edges are actually `required: 'yes'` — the `advisory`/
 * `as-applicable`/`conditional` rows are not this invariant's concern, since `15` §15.10 says
 * "required," not "every edge the spec graph names."
 */
const REQUIRED_EDGE_RULES = REQUIRED_EDGES.filter((rule) => rule.required === 'yes');

/**
 * Whether `rule` covers `edge`. One `REQUIRED_EDGES` row (`NFR verifiedBy TEST/benchmark/monitor`)
 * writes its own `to` as a compound label naming three real targets at once, not a literal one — an
 * exact-string match against a caller's own concrete `DisabledTraceabilityEdge` (which always names
 * one real target, e.g. `TEST`) would never match that row at all, silently no-op'ing the one
 * required edge with more than one legal target. Splitting `rule.to` on `/` and checking membership
 * handles that row correctly while being a no-op for every other row, whose own `to` has no `/` in it
 * at all (`09` §9.4's table has no compound `from` among its `required: 'yes'` rows to mirror this
 * for).
 */
function ruleCoversEdge(rule: EdgeRule, edge: DisabledTraceabilityEdge): boolean {
  if (rule.from !== edge.from || rule.edge !== edge.edge) return false;
  return rule.to.split('/').includes(edge.to);
}

export function checkTraceabilityNotDisabled(
  disabledEdges: readonly DisabledTraceabilityEdge[],
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const edge of disabledEdges) {
    if (!REQUIRED_EDGE_RULES.some((rule) => ruleCoversEdge(rule, edge))) continue;
    violations.push(
      violation('I6', 'SPEC-501', { edgeKind: `${edge.from}:${edge.edge}:${edge.to}` }),
    );
  }
  return violations;
}
