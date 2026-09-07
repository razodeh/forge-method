/**
 * `06` §6.2's own plan-compilation rules 2–6, chained into the one public entry point everything
 * downstream (scheduler, gate evaluation, resume — none built yet) actually calls: P10's own `compilePlan`
 * (rule 1) → contract-freeze implicit dependencies (rule 2) → resource-claim overlap, serialising or
 * rejecting as ambiguous (rule 3) → cycle rejection with a rendered Mermaid graph (rule 5) → critical path
 * and estimated cost (rule 6).
 *
 * **Rule 4 ("insert gate nodes at their declared positions; a gate depends on everything in its phase")
 * is only half-implemented, deliberately.** "Insert gate nodes at their declared positions" is already
 * fully satisfied by P10's own `compilePlan`: a `gate`-kind step compiles like any other leaf, using
 * whatever `dependsOn` its author already declared at its own YAML position (`10` §10.1's own worked
 * example: `contracts-gate` explicitly depends on `freeze-contracts`). "A gate depends on everything in
 * its phase" is a different, *automatic* dependency-insertion this piece cannot build: `phase` names one
 * of `10` §10.2's own ten *lifecycle* phases (Intake, Plan, Design, ...) — a run-level concept spanning
 * potentially many separate workflow invocations — and appears nowhere in `@forge/engine/workflow`'s own
 * `WorkflowStep` type or in this package's own `StepNode`. There is no field on either type recording
 * which lifecycle phase a given step belongs to for this piece to group steps by and insert edges from.
 * Building a fake, partial version of "phase" (e.g. treating declaration order within one workflow's own
 * `steps:` list as a stand-in for a phase boundary, or inventing a phase field nothing authors) would be
 * exactly the "faking a capability with no real mechanism behind it" this milestone has already explicitly
 * ruled out once (`SPEC-QUESTIONS.md` Q62's own agent/role-resolution scoping: "a step dispatcher that
 * fakes role-awareness with no real roster behind it would be worse than one that visibly has none").
 * Left for whichever later piece actually threads the ten-phase lifecycle through a real run.
 *
 * @see specs/06 §6.2, §6.6, §6.7
 * @see specs/10 §10.1, §10.2
 * @see PLAN-M5.md P11
 */
import { ForgeError } from '@forge/core/errors';

import type { ExpressionContext } from '../expr/index.ts';
import type { Workflow } from '../workflow/index.ts';
import { compilePlan } from './compile.ts';
import { computeCriticalPath } from './critical-path.ts';
import { detectCycles, renderCycleAsMermaid } from './cycles.ts';
import { applyClaimOverlaps, buildClaimIntervalMap, insertContractDependencies } from './dependencies.ts';
import type { RunPlanResult } from './types.ts';

/** `06` §6.2's own full plan-compilation pipeline, rules 1–3 and 5–6 (rule 4's own scope boundary is
 * documented at the top of this file). Stops and reports at the *first* stage that fails — unlike P10's
 * own `compilePlan`, which collects every issue across an entire tree in one pass, each stage here
 * operates on the *previous* stage's own complete output, so a claim-overlap issue found against a plan
 * that failed to compile at all (missing fanout expansions, say) would be checking incomplete, already-
 * known-wrong data — the identical "do not compound a more fundamental problem with cascading noise on
 * top of it" reasoning `@forge/engine/plan`'s own `checkPlanConsistency` (P10, `SPEC-QUESTIONS.md` Q72)
 * already established for its own, single-stage version of the same principle. */
export function compileRunPlan(workflow: Workflow, context: ExpressionContext): RunPlanResult {
  const compiled = compilePlan(workflow, context);
  if (!compiled.success) return compiled;

  const withContracts = insertContractDependencies(compiled.nodes);
  const claims = buildClaimIntervalMap(withContracts);
  const withClaims = applyClaimOverlaps(withContracts, claims);
  if (!withClaims.success) return withClaims;

  let cycle: ReturnType<typeof detectCycles>;
  try {
    cycle = detectCycles(withClaims.nodes);
  } catch (cause) {
    if (!(cause instanceof ForgeError)) throw cause;
    // `instanceof` against a generic class (`ForgeError<TCode extends ForgeErrorCode = ForgeErrorCode>`)
    // narrows `cause` to `ForgeError<any>`, not `ForgeError<ForgeErrorCode>` -- a real TypeScript/
    // typescript-eslint limitation (type parameters are erased at runtime, so `instanceof` has nothing to
    // narrow *with*), making `cause.code` itself type as `any`. `String(...)` forces a real, safe `string`
    // out of it; the actual runtime value is unaffected (`ForgeErrorCode` members are already plain
    // strings).
    return { success: false, issues: [{ code: String(cause.code), message: cause.message }] };
  }
  if (cycle !== undefined) {
    return {
      success: false,
      issues: [
        {
          code: 'dependency-cycle',
          message: `A dependency cycle was found: ${cycle.cycle.join(' -> ')}.\n\n${renderCycleAsMermaid(cycle.cycle)}`,
        },
      ],
    };
  }

  return { success: true, nodes: withClaims.nodes, criticalPath: computeCriticalPath(withClaims.nodes), claims };
}
