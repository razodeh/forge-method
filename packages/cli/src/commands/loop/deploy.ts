/**
 * `forge deploy <env>` — `03` §3.2.5: "Execute the delivery workflow for an environment." Real, thin
 * dispatch to `deliver-stage` (`10` §10.5) — the identical workflow `forge plan delivery` (`PLAN-M6.md`
 * C4's own `workflowIdForPlanPhase`) already dispatches to; a different CLI verb reaching the same real
 * workflow is not a duplicate mechanism, `10` §10.5 names exactly one delivery-shaped workflow at all.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.5
 */
import { ForgeError } from '@forge/core/errors';
import type { ExpressionContext } from '@forge/engine/expr';
import { requireDestructiveConfirmation } from '@forge/engine/security';

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
  /** `20` §20.10 S7's own typed human confirmation — see `@forge/engine/security`'s own
   * `destructiveConfirmationPhrase(env, deps.config.project.name)` for the exact string a caller must
   * supply. Ignored entirely for `--dry-run` (a plan/print, never a real deploy) — the same "never
   * applies to a dry-run" carve-out `run.ts`'s own S8 wiring already makes for `assertCleanWorkingTree`. */
  readonly confirmation?: string;
}

export async function deployEnvironment(
  deps: RunDeps,
  env: string,
  options: DeployOptions,
): Promise<DryRunResult | RealRunResult> {
  if (options.dryRun !== true) {
    // `20` §20.10 S7 (`PLAN-M11.md` P11): the one real, wired production call site this new mechanism
    // has today — see `@forge/engine/security/destructive-confirmation.ts`'s own doc comment for why
    // `forge deploy <env>` is that site (the identical fact `taint-guard.ts` already established for
    // S6's "production targeting" surface) and for why a force-push is deliberately not among this
    // gate's own confirmable operations (S2 already forecloses it unconditionally, with no override).
    const decision = requireDestructiveConfirmation({
      operation: 'deploy',
      environment: env,
      resource: deps.config.project.name,
      policy: deps.config.security.destructiveOps,
      ...(options.confirmation !== undefined ? { confirmation: options.confirmation } : {}),
    });
    if (decision.refused) {
      throw new ForgeError('RUN-075', { reason: decision.reason });
    }
  }

  const expressionContext: DeployExpressionContext = { env };
  return runWorkflow(deps, {
    workflowId: DELIVER_STAGE_WORKFLOW_ID,
    expressionContext,
    dryRun: options.dryRun ?? false,
    host: options.host,
  });
}
