/**
 * `forge run` over a workflow with no `merge` step (`PLAN-M13.md` P19, `06` §6.4 rule 4, `SPEC-QUESTIONS.md`
 * Q221): through the CLI's real context (`buildRunEngineContext`: the integration worktree and the integration
 * branch as the lane base), a second step sees the first step's output, the work lands on the integration branch
 * (not `main`), an inline step runs in the integration worktree, and the configured conflict policy is the one
 * the engine integrates with.
 *
 * @see specs/06 §6.4
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import type { ExpressionContext } from '@forge/engine/expr';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { runWorkflow } from '../../../src/commands/run/run.ts';
import {
  FIXTURE_WORKFLOW_ID,
  WORKFLOWS_ROOT,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
} from './helpers.ts';

afterEach(cleanupAll);

const INTEGRATION_BRANCH = 'forge/integration/current';

const CHAIN = `
id: ${FIXTURE_WORKFLOW_ID}
name: CLI chain
version: 1.0.0
description: Two dependent agent steps and an inline command, no merge step.

steps:
  - id: first
    kind: agent
    agent: engineer
    brief: briefs/implement.md
    produces: [ "first.txt" ]

  - id: second
    kind: agent
    agent: engineer
    brief: briefs/implement.md
    dependsOn: [ first ]
    produces: [ "second.txt" ]

  - id: check
    kind: command
    inline: true
    dependsOn: [ second ]
    run: 'test -f first.txt && test -f second.txt'
`;

// build-stage's own first step: creates (or switches to) the stage's integration branch. It runs in the integration
// worktree, so it is a no-op exactly when the run's integration branch is that branch.
const PREPARE_STAGE = `
id: ${FIXTURE_WORKFLOW_ID}
name: CLI prepare
version: 1.0.0
description: build-stage's prepare step, then one agent step.
inputs:
  - name: stageId
    type: string
    required: true
vars:
  integration_branch: 'forge/integration/{{stageId}}'
steps:
  - id: prepare
    kind: command
    run: 'git switch -c {{vars.integration_branch}} || git switch {{vars.integration_branch}}'
    inline: true
  - id: implement
    kind: agent
    agent: engineer
    brief: briefs/implement.md
    dependsOn: [ prepare ]
    produces: [ "first.txt" ]
`;

describe('forge run: lane visibility through the real CLI context', () => {
  it("a stage run's own prepare step (git switch to the stage integration branch) finds nothing to switch", async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`),
      PREPARE_STAGE,
    );
    await execa('git', ['commit', '--quiet', '-am', 'prepare workflow'], { cwd: project.dir });
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.endsWith(':implement'), {
      text: ['wrote first'],
      writeFiles: [{ relativePath: 'first.txt', content: 'first\n' }],
    });

    const result = await runWorkflow(testRunDeps(project, adapter), {
      workflowId: FIXTURE_WORKFLOW_ID,
      // A run input at the root of the context, as `forge run --stage` supplies it (`stageId` is not a declared key).
      expressionContext: {
        stageId: 'mvp',
        vars: { integration_branch: 'forge/integration/mvp' },
      } as unknown as ExpressionContext,
      runId: 'run-prepare',
      host: 'test-host',
    });

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') return;
    expect(result.runState.runStatus).toBe('completed');
    const onStage = await execa('git', ['ls-tree', '-r', '--name-only', 'forge/integration/mvp'], {
      cwd: project.dir,
    });
    expect(onStage.stdout).toContain('first.txt');
    // The user's own checkout stays on main.
    const head = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: project.dir });
    expect(head.stdout.trim()).toBe('main');
  });

  it('a project that customises the integration branch template but not the workflow var gets a clear refusal from the inline guard, and its own integration branch is intact', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`),
      PREPARE_STAGE,
    );
    await execa('git', ['commit', '--quiet', '-am', 'prepare workflow'], { cwd: project.dir });
    const custom = {
      ...project,
      config: {
        ...project.config,
        execution: { ...project.config.execution, integrationBranch: 'integ/{stage}' },
      },
    };

    const result = await runWorkflow(testRunDeps(custom, new FakePlatformAdapter()), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: {
        stageId: 'P3',
        vars: { integration_branch: 'forge/integration/P3' },
      } as unknown as ExpressionContext,
      runId: 'run-custom-branch',
      host: 'test-host',
    });

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') return;
    expect(result.runState.runStatus).toBe('failed');
    expect(result.runState.runFailure?.message).toContain('prepare');
    const branch = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: path.join(project.dir, '.forge/state/worktrees/integration-integ-P3'),
    });
    expect(branch.stdout.trim()).toBe('integ/P3');
  });

  it("the second step sees the first step's output, the inline step reads the integrated tree, and the work is on the integration branch, not main", async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${FIXTURE_WORKFLOW_ID}.workflow.yaml`),
      CHAIN,
    );
    await execa('git', ['commit', '--quiet', '-am', 'chain workflow'], { cwd: project.dir });

    const adapter = new FakePlatformAdapter();
    const seen = new Map<string, boolean>();
    adapter.script((request) => {
      seen.set(request.stepId, existsSync(path.join(request.cwd, 'first.txt')));
      return false;
    }, {});
    adapter.script((request) => request.stepId.endsWith(':first'), {
      text: ['wrote first'],
      writeFiles: [{ relativePath: 'first.txt', content: 'first\n' }],
    });
    adapter.script((request) => request.stepId.endsWith(':second'), {
      text: ['wrote second'],
      writeFiles: [{ relativePath: 'second.txt', content: 'second\n' }],
    });

    const result = await runWorkflow(testRunDeps(project, adapter), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-chain',
      host: 'test-host',
    });

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') return;
    expect(result.runState.runStatus).toBe('completed');
    expect(seen.get(`${FIXTURE_WORKFLOW_ID}:first`)).toBe(false);
    expect(seen.get(`${FIXTURE_WORKFLOW_ID}:second`)).toBe(true);
    const onIntegration = await execa('git', ['ls-tree', '-r', '--name-only', INTEGRATION_BRANCH], {
      cwd: project.dir,
    });
    expect(onIntegration.stdout.split('\n')).toEqual(
      expect.arrayContaining(['first.txt', 'second.txt']),
    );
    const onMain = await execa('git', ['ls-tree', '-r', '--name-only', 'main'], {
      cwd: project.dir,
    });
    expect(onMain.stdout).not.toContain('first.txt');
    // The user's checkout is untouched.
    expect(existsSync(path.join(project.dir, 'first.txt'))).toBe(false);
  });
});
