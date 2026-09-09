/**
 * `forge deploy <env>` — `03` §3.2.5: "Execute the delivery workflow for an environment." Real, thin
 * dispatch to `deliver-stage` (`10` §10.5) — the identical workflow `forge plan delivery` (`PLAN-M6.md`
 * C4's own `workflowIdForPlanPhase`) already dispatches to; a different CLI verb reaching the same real
 * workflow is not a duplicate mechanism, `10` §10.5 names exactly one delivery-shaped workflow at all.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.5
 */
import type { ExpressionContext } from '@forge/engine/expr';

import { runWorkflow, type DryRunResult, type RealRunResult, type RunDeps } from '../run/run.ts';

const DELIVER_STAGE_WORKFLOW_ID = 'deliver-stage';

/** The same narrow, honest `ExpressionContext` extension `implement.ts`'s own
 * `ImplementStoryExpressionContext` documents — `{{env}}` resolves against the top level. */
interface DeployExpressionContext extends ExpressionContext {
  readonly env: string;
}

export interface DeployOptions {
  readonly dryRun?: boolean;
  readonly host: string;
}

export async function deployEnvironment(
  deps: RunDeps,
  env: string,
  options: DeployOptions,
): Promise<DryRunResult | RealRunResult> {
  const expressionContext: DeployExpressionContext = { env };
  return runWorkflow(deps, {
    workflowId: DELIVER_STAGE_WORKFLOW_ID,
    expressionContext,
    dryRun: options.dryRun ?? false,
    host: options.host,
  });
}
