/**
 * `forge plan <product|architecture|data|init|testing|delivery|stages|stage <id>|replan>` — `03`
 * §3.2.3: each phase runs the real corresponding `10` §10.5 workflow via `runWorkflow`
 * (`PLAN-M6.md` C4's own Mandate text).
 *
 * `10` §10.5's own 20-workflow table has no distinct `data` or `testing` workflow id — `shape-solution`
 * (architecture) already covers "domain/data model" in its own Purpose column, and nothing in the
 * table names a standalone test-strategy-planning workflow at all (`verify-stage` is stage-level
 * *verification*, not test-strategy planning). Two of `03` §3.2.3's own nine phase names genuinely
 * have no real workflow to dispatch to — refused (`USR-003`) rather than guessed at, the same
 * discipline `forge adopt`/`forge discover` already establish for an identical shape of gap. See
 * `SPEC-QUESTIONS.md`.
 *
 * @see specs/03 §3.2.3
 * @see specs/10 §10.5
 */
import { ForgeError } from '@forge/core/errors';

export type PlanPhase =
  | 'product'
  | 'architecture'
  | 'data'
  | 'init'
  | 'testing'
  | 'delivery'
  | 'stages'
  | 'stage'
  | 'replan';

const PHASE_WORKFLOW_IDS: Readonly<Partial<Record<PlanPhase, string>>> = {
  product: 'define-product',
  architecture: 'shape-solution',
  init: 'initialize-project',
  delivery: 'deliver-stage',
  stages: 'plan-stages',
  stage: 'plan-stage',
  replan: 'replan',
};

/** Resolves `phase` to the real workflow id `forge run` should dispatch to.
 * @throws {ForgeError} `USR-003` for `data`/`testing`, which have no real corresponding workflow. */
export function workflowIdForPlanPhase(phase: PlanPhase): string {
  const workflowId = PHASE_WORKFLOW_IDS[phase];
  if (workflowId === undefined) {
    throw new ForgeError('USR-003', {
      feature: `forge plan ${phase} (no corresponding 10 §10.5 workflow)`,
    });
  }
  return workflowId;
}
