/**
 * An empty claim means no write, through the whole `forge run` path (`PLAN-M13.md` P36, `06` §6.7, `20` §20.1): a real
 * `runWorkflow` over a real git project, real prompt assembly, the real `resolveClaimPolicy`, and a `FakePlatformAdapter`
 * session (which, like a real adapter's tool layer, refuses a write when the request's `tools.write` is false). The agent's
 * own definition has `tools.write: true` in every case; only the step's claim differs.
 *
 * A real out-of-claim write under `strict` (`06` §6.7 as amended, `SPEC-QUESTIONS.md` Q232 decision 1)
 * also fails the step, and so the run, since `PLAN-M14.md` P3.
 *
 * @see specs/06 §6.7
 * @see PLAN-M13.md P36
 * @see PLAN-M14.md P3
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SessionRequest } from '@forge/adapter-kit';
import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import { runWorkflow } from '../../../src/commands/run/run.ts';
import { writeFixtureAgent } from '../loop/helpers.ts';
import {
  WORKFLOWS_ROOT,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
  type TestProject,
} from './helpers.ts';

afterEach(cleanupAll);

const WORKFLOW_ID = 'empty-claim-wf';
const STEP_ID = `${WORKFLOW_ID}:work`;

const WORKFLOW = (claim: string) => `
id: ${WORKFLOW_ID}
name: An empty claim means no write
version: 1.0.0
description: One agent step whose claim varies.
steps:
  - id: work
    kind: agent
    agent: backend
    brief: briefs/implement.md${claim}
`;

async function projectWith(
  claim: string,
  autonomy: 'supervised' | 'guided' | 'autonomous',
): Promise<TestProject> {
  const base = await createTestProject();
  // A write-capable implementation agent: its definition is the same whatever the step declares.
  await writeFixtureAgent(base.dir, 'backend', 'Backend', { write: true, code: true });
  await writeFile(
    path.join(base.dir, WORKFLOWS_ROOT, `${WORKFLOW_ID}.workflow.yaml`),
    WORKFLOW(claim),
  );
  await execa('git', ['add', '-A'], { cwd: base.dir });
  await execa('git', ['commit', '--quiet', '-m', 'claim workflow'], { cwd: base.dir });
  return { ...base, config: { ...base.config, execution: { ...base.config.execution, autonomy } } };
}

async function run(project: TestProject, writes: readonly string[], runId: string) {
  const requests: SessionRequest[] = [];
  const adapter = new FakePlatformAdapter();
  adapter.script(
    (request) => {
      requests.push(request);
      return true;
    },
    {
      text: ['done'],
      writeFiles: writes.map((relativePath) => ({
        relativePath,
        content: 'export const x = 1;\n',
      })),
    },
  );
  const result = await runWorkflow(testRunDeps(project, adapter), {
    workflowId: WORKFLOW_ID,
    expressionContext: fixtureExpressionContext(),
    runId,
    host: 'test-host',
  });
  if (result.kind !== 'run') throw new Error('expected a real run');
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(project.dir, runId)) events.push(event);
  return { result, requests, events };
}

const LEVELS = ['supervised', 'guided', 'autonomous'] as const;

describe('forge run: a step with no outputs and no produces', () => {
  for (const autonomy of LEVELS) {
    it(`gets tools.write === false under ${autonomy}, and the session's write is refused, though its agent may write`, async () => {
      const project = await projectWith('', autonomy);
      const { result, requests, events } = await run(
        project,
        ['src/anywhere.ts'],
        `run-empty-${autonomy}`,
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]?.tools.write).toBe(false);
      expect(requests[0]?.systemPrompt.text).toContain(
        'no write: this step declares no outputs or produces',
      );
      // The refusal is the fake's tool layer saying so; the step itself is not what fails here.
      expect(events.some((event) => event.type === 'PolicyViolation')).toBe(false);
      expect(result.runState.runStatus).toBe('completed');
      const tree = (
        await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: project.dir })
      ).stdout;
      expect(tree).not.toContain('src/anywhere.ts');
    });
  }
});

describe('forge run: a step that declares produces', () => {
  it('keeps the agent write grant, and the claim still confines it (strict): a stray write is reverted, traced, and (PLAN-M14.md P3) fails the run', async () => {
    const project = await projectWith('\n    produces: [ "src/**" ]', 'supervised');
    const { result, requests, events } = await run(
      project,
      ['src/ok.ts', 'lib/stray.ts'],
      'run-empty-claimed',
    );
    expect(requests[0]?.tools.write).toBe(true);
    const violation = events.find(
      (event) => event.type === 'PolicyViolation' && event.stepId === STEP_ID,
    );
    expect(violation?.payload).toMatchObject({
      kind: 'out-of-claim-write',
      stepFailed: true,
      paths: ['lib/stray.ts'],
      totalReverted: 1,
    });
    // `06` §6.7 as amended (`SPEC-QUESTIONS.md` Q232 decision 1): `supervised` resolves `strict`, so this
    // real out-of-claim write now fails the step and the run, not only under an `outputs`-declared step.
    expect(result.runState.runStatus).toBe('failed');
    const failed = events.find((event) => event.type === 'StepFailed' && event.stepId === STEP_ID);
    expect(JSON.stringify(failed?.payload)).toContain('RUN-104');
    expect(JSON.stringify(failed?.payload)).toMatch(/Remedy/i);
  });
});
