/**
 * The output contract check through the whole `forge run` path (`PLAN-M13.md` P7): a real
 * `runWorkflow` over a real git project, real prompt assembly, the real scheduler and event log, and a
 * `FakePlatformAdapter` whose session writes -- or fails to write -- the artifact the workflow's agent
 * step declares. This is the Q208 finding 4 reproduction: an agent step that ends ok without producing
 * its declared output must fail the step and block what depends on it, instead of being recorded
 * `StepSucceeded`.
 *
 * @see specs/05 §5.5
 * @see specs/06 §6.8
 * @see PLAN-M13.md P7
 * @see SPEC-QUESTIONS.md Q208
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import { runWorkflow } from '../../../src/commands/run/run.ts';
import { writeFixtureAgent } from '../loop/helpers.ts';
import {
  FIXTURE_GATE_ID,
  WORKFLOWS_ROOT,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
  type TestProject,
} from './helpers.ts';

afterEach(cleanupAll);

const WORKFLOW_ID = 'contract-wf';
const STEP_ID = `${WORKFLOW_ID}:write-epic`;
const GATE_STEP_ID = `${WORKFLOW_ID}:verify`;

const EPIC = `---
id: EPIC-001
type: Epic
schemaVersion: 1
title: An epic
status: draft
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: po
changelog: []
capability: CAP-001
stage: stage-1
goal: Ship it
scope_in: []
scope_out: []
stories: []
interfaces: []
data: []
exit_criteria: []
---

One paragraph.
`;

const WORKFLOW = (agent: string) => `
id: ${WORKFLOW_ID}
name: Output contract
version: 1.0.0
description: An agent step with a declared output, then a gate that depends on it.
steps:
  - id: write-epic
    kind: agent
    agent: ${agent}
    brief: briefs/implement.md
    produces: [ "docs/forge/**" ]
    outputs: [ { type: Epic } ]
  - id: verify
    kind: gate
    gate: ${FIXTURE_GATE_ID}
    dependsOn: [ write-epic ]
`;

async function projectFor(agent: string, write: boolean): Promise<TestProject> {
  const project = await createTestProject();
  await writeFixtureAgent(project.dir, agent, agent, { write });
  await writeFile(
    path.join(project.dir, WORKFLOWS_ROOT, `${WORKFLOW_ID}.workflow.yaml`),
    WORKFLOW(agent),
  );
  // A run refuses a dirty tree (`20` §20.10 S8): the new files are part of the project.
  await execa('git', ['add', '-A'], { cwd: project.dir });
  await execa('git', ['commit', '--quiet', '-m', 'contract workflow'], { cwd: project.dir });
  return project;
}

async function run(project: TestProject, adapter: FakePlatformAdapter, runId: string) {
  const result = await runWorkflow(testRunDeps(project, adapter), {
    workflowId: WORKFLOW_ID,
    expressionContext: fixtureExpressionContext(),
    runId,
    host: 'test-host',
  });
  if (result.kind !== 'run') throw new Error('expected a real run');
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(project.dir, runId)) events.push(event);
  return { result, events };
}

function eventsFor(events: readonly ForgeEvent[], stepId: string): string[] {
  return events.filter((event) => event.stepId === stepId).map((event) => event.type);
}

describe('forge run: an agent step with a declared output', () => {
  it('completes when the session wrote a valid artifact at its registry path, and the dependent gate runs', async () => {
    const project = await projectFor('po', true);
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['wrote the epic'],
      writeFiles: [{ relativePath: 'docs/forge/specs/epics/EPIC-001.md', content: EPIC }],
    });
    const { result, events } = await run(project, adapter, 'run-contract-ok');
    expect(result.runState.runStatus).toBe('completed');
    expect(eventsFor(events, STEP_ID)).toContain('StepSucceeded');
    expect(eventsFor(events, GATE_STEP_ID)).toContain('GateApproved');
  });

  it('FAILS the run when the session ended ok but wrote nothing (the write-forbidden retro case): StepFailed carries RUN-084, nothing depending on it runs', async () => {
    const project = await projectFor('em', false);
    const adapter = new FakePlatformAdapter();
    // What the real session did: think, answer, write no file (its grant forbids writing).
    adapter.script(() => true, {
      text: ['a fine retrospective, in chat only'],
      writeFiles: [{ relativePath: 'docs/forge/specs/epics/EPIC-001.md', content: EPIC }],
    });
    const { result, events } = await run(project, adapter, 'run-contract-forbidden');

    expect(result.runState.runStatus).toBe('failed');
    const stepEvents = eventsFor(events, STEP_ID);
    expect(stepEvents).toContain('SessionEnded');
    expect(stepEvents).toContain('StepFailed');
    expect(stepEvents).not.toContain('StepSucceeded');
    const failed = events.find((event) => event.type === 'StepFailed' && event.stepId === STEP_ID);
    const payload = JSON.stringify(failed?.payload);
    expect(payload).toContain('RUN-084');
    expect(payload).toContain('tools.write: false');
    expect(payload).toContain('docs/forge/specs/epics/EPIC-*.md');
    // Blocked by the failure policy: the gate that depends on this step never started.
    expect(eventsFor(events, GATE_STEP_ID)).toEqual([]);
  });

  it('FAILS the run, RUN-083, when a write-capable agent wrote an artifact that does not validate', async () => {
    const project = await projectFor('po', true);
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['wrote it'],
      writeFiles: [
        {
          relativePath: 'docs/forge/specs/epics/EPIC-001.md',
          content: EPIC.replace(/^goal: .*\n/m, ''),
        },
      ],
    });
    const { result, events } = await run(project, adapter, 'run-contract-invalid');
    expect(result.runState.runStatus).toBe('failed');
    const failed = events.find((event) => event.type === 'StepFailed' && event.stepId === STEP_ID);
    const payload = JSON.stringify(failed?.payload);
    expect(payload).toContain('RUN-083');
    expect(payload).toContain('EPIC-001.md');
    expect(payload).toContain('goal');
    expect(eventsFor(events, GATE_STEP_ID)).toEqual([]);
  });
});
