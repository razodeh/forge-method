/**
 * `forge implement <storyId>` — `03` §3.2.5's single-story engineering loop: real, thin dispatch to
 * `implement-story` (`10` §10.5), the same `runWorkflow` (`PLAN-M6.md` C4) every other named-workflow
 * command in this module reuses unchanged — no second execution mechanism.
 *
 * `implement-story.workflow.yaml`'s own two required inputs are `storyId` and `ownerRole`; the CLI's
 * own literal surface (`03` §3.2.5's table) only ever names `storyId` — `ownerRole` is not guessed at
 * or defaulted, it is read from the real Story artifact's own already-required `owner_role` field
 * (`09` §9.3), the one place a real answer already exists.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.5
 */

import { buildRunExpressionContext } from '../run/expression-context.ts';
import { runWorkflow, type DryRunResult, type RealRunResult, type RunDeps } from '../run/run.ts';

const IMPLEMENT_STORY_WORKFLOW_ID = 'implement-story';

export interface ImplementOptions {
  readonly specsRoot: string;
  readonly dryRun?: boolean;
  readonly host: string;
}

export async function implementStory(
  deps: RunDeps,
  storyId: string,
  options: ImplementOptions,
): Promise<DryRunResult | RealRunResult> {
  // The same context `forge run implement-story --story <id>` builds (`PLAN-M13.md` P21): the owner role and the
  // claim come from the Story document, and the refusals (a blocked or delivered story, a role that would break
  // `10` §10.6's separations, an unsafe id) are the same ones.
  const { context } = await buildRunExpressionContext(
    deps,
    IMPLEMENT_STORY_WORKFLOW_ID,
    { story: storyId },
    options.specsRoot,
  );
  return runWorkflow(deps, {
    workflowId: IMPLEMENT_STORY_WORKFLOW_ID,
    expressionContext: context,
    dryRun: options.dryRun ?? false,
    host: options.host,
  });
}
