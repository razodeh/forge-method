/**
 * `buildGateReport` — `10` §10.3's own rule 4: "every gate evaluation writes a `GateReport` artifact...
 * with the exact command output." This piece emits the *data* only; writing it to
 * `docs/forge/reports/gates/` as a real artifact document is `@forge/core`'s already-built front-matter
 * writer's job (`GateReport`'s own doc comment in `types.ts` has the fuller reasoning for why this type is
 * deliberately not `@forge/schemas`' identically-named artifact type).
 *
 * A pure function of `(gate, result)` alone — no wall-clock read, no injected `now` — is exactly what makes
 * rule 3's own idempotence ("gates are re-runnable and idempotent") checkable at all: re-evaluating the
 * identical gate against identical check output must produce a byte-identical report, which a report
 * carrying its own generation timestamp could never satisfy. `waiver.ts`'s own `waiverAppliedAt` does not
 * threaten this: it is copied straight through from `result`, itself already fixed by `applyWaiver` at the
 * `now` it was actually called with, not freshly read here.
 *
 * `gateId` and `openQuestionsPolicy` are sourced from `gate` (the definition being reported on), not
 * `result` — properties of the gate itself, declared once regardless of any particular evaluation, unlike
 * `passed`/`checks`/`waiver`/`waiverAppliedAt`, which are properties of *this* evaluation. A verify round
 * found an earlier version split these inconsistently (`gateId` from `gate`, `openQuestionsPolicy` from
 * `result`) with no real reason for the difference — for any output of the real `evaluateGate`→
 * `applyWaiver` pipeline the two sources always agree anyway (`evaluateGate` itself only ever copies both
 * from the same `gate` it was given), so this only matters for a caller passing a mismatched `(gate,
 * result)` pair directly, which this piece treats as caller error to route consistently, not a case to
 * specially detect.
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 */
import { isApproved } from './waiver.ts';
import type { GateDefinition, GateEvaluationResult, GateReport } from './types.ts';

export function buildGateReport(gate: GateDefinition, result: GateEvaluationResult): GateReport {
  return {
    gateId: gate.id,
    passed: result.passed,
    approved: isApproved(result),
    checks: result.checks,
    waiver: result.waiver,
    waiverAppliedAt: result.waiverAppliedAt,
    openQuestionsPolicy: gate.openQuestionsPolicy,
  };
}
