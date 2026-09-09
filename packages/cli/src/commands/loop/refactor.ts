/**
 * `forge refactor <target> --goal <text>` — `03` §3.2.5's bounded, test-guarded refactor: real, thin
 * dispatch to `refactor` (`10` §10.5).
 *
 * `refactor.workflow.yaml`'s own one required input is `goal`; `target` is not a declared workflow
 * input at all (nothing in the real template reads it), but is still threaded through
 * `expressionContext` regardless — a future template revision that does start referencing
 * `{{target}}` should not need this piece's own code to change to see it.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.5
 */
import type { ExpressionContext } from '@forge/engine/expr';

import { runWorkflow, type DryRunResult, type RealRunResult, type RunDeps } from '../run/run.ts';

const REFACTOR_WORKFLOW_ID = 'refactor';

/** `@forge/engine/expr`'s own `resolvePath` resolves `{{goal}}`/`{{target}}` against
 * `ExpressionContext` at the top level, but that type's own declared shape is a closed seven-field
 * interface with no index signature — the same narrow extension `implement.ts`'s own
 * `ImplementStoryExpressionContext` already documents for the identical reason. */
interface RefactorExpressionContext extends ExpressionContext {
  readonly target: string;
  readonly goal: string;
}

export interface RefactorOptions {
  readonly dryRun?: boolean;
  readonly host: string;
}

export async function refactorTarget(
  deps: RunDeps,
  target: string,
  goal: string,
  options: RefactorOptions,
): Promise<DryRunResult | RealRunResult> {
  const expressionContext: RefactorExpressionContext = { target, goal };
  return runWorkflow(deps, {
    workflowId: REFACTOR_WORKFLOW_ID,
    expressionContext,
    dryRun: options.dryRun ?? false,
    host: options.host,
  });
}
