/**
 * Fixture process for `resume.test.ts`'s own real crash-then-resume proof — drives the CLI's own real
 * `runWorkflow` (`../../../../src/commands/run/run.ts`) against the slow fixture workflow
 * (`FIXTURE_WORKFLOW_SLOW_SOURCE`, `../helpers.ts`) to completion, so the parent test can `SIGKILL` this
 * process mid-run and confirm `resumeWorkflow` genuinely picks up where it left off.
 *
 * Run via `node --experimental-strip-types` (no build step; `.ts` files run directly) — the identical
 * pattern `packages/engine/test/e2e/fixtures/run-engine-child.ts` already establishes.
 */
import { ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG, type ForgeConfig } from '@forge/schemas/config';

import { runWorkflow } from '../../../../src/commands/run/run.ts';
import {
  CHECKS_ROOT,
  FIXTURE_WORKFLOW_ID,
  WORKFLOWS_ROOT,
  fixtureAdapter,
  fixtureExpressionContext,
} from '../helpers.ts';

const [, , projectRoot, runId, host] = process.argv;
if (projectRoot === undefined || runId === undefined || host === undefined) {
  throw new Error('usage: run-child.ts <projectRoot> <runId> <host>');
}

const config: ForgeConfig = {
  ...DEFAULT_CONFIG,
  execution: { ...DEFAULT_CONFIG.execution, retainLaneWorktrees: 'always' },
};

const deps = {
  paths: new ProjectPaths(projectRoot),
  projectRoot,
  config,
  adapter: fixtureAdapter(),
  workflowsRoot: WORKFLOWS_ROOT,
  checksRoot: CHECKS_ROOT,
};

try {
  await runWorkflow(deps, {
    workflowId: FIXTURE_WORKFLOW_ID,
    expressionContext: fixtureExpressionContext(),
    runId,
    host,
  });
  process.stdout.write('DONE\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}
