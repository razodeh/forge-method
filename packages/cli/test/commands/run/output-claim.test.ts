/**
 * Outputs are the claim, through the whole `forge run` path (`PLAN-M13.md` P14, `06` §6.7 as amended,
 * `SPEC-QUESTIONS.md` Q212): a real `runWorkflow` over a real git project, real prompt assembly, the real
 * `resolveClaimPolicy` for each autonomy level and for an adopted project, and a `FakePlatformAdapter`
 * session that writes exactly the step's declared output. The step declares no `produces`: before P14 the
 * `strict` levels reverted the output and the run failed with RUN-083 ("add the path to `produces`").
 *
 * Since `PLAN-M14.md` P3 (`SPEC-QUESTIONS.md` Q232 decision 1), a real out-of-claim write under `strict`
 * fails the step -- and so the whole run -- at the claim itself (`RUN-104`), before the output check ever
 * runs: reverted exactly as P14 already proved, no longer silent.
 *
 * @see specs/06 §6.7
 * @see PLAN-M13.md P14
 * @see PLAN-M14.md P3
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

const WORKFLOW_ID = 'claim-wf';
const STEP_ID = `${WORKFLOW_ID}:write-epic`;
const GATE_STEP_ID = `${WORKFLOW_ID}:verify`;
const EPIC_PATH = 'docs/forge/specs/epics/EPIC-001.md';
const STRAY_PATH = 'src/stray.ts';

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

const WORKFLOW = (extra: string) => `
id: ${WORKFLOW_ID}
name: Outputs are the claim
version: 1.0.0
description: An agent step that declares an output and no produces, then a gate.
steps:
  - id: write-epic
    kind: agent
    agent: po
    brief: briefs/implement.md
    outputs: [ { type: Epic } ]${extra}
  - id: verify
    kind: gate
    gate: ${FIXTURE_GATE_ID}
    dependsOn: [ write-epic ]
`;

async function projectWith(
  autonomy: 'supervised' | 'guided' | 'autonomous',
  adopted: boolean,
  workflow: string = WORKFLOW(''),
): Promise<TestProject> {
  const base = await createTestProject();
  await writeFixtureAgent(base.dir, 'po', 'po', { write: true });
  await writeFile(path.join(base.dir, WORKFLOWS_ROOT, `${WORKFLOW_ID}.workflow.yaml`), workflow);
  await execa('git', ['add', '-A'], { cwd: base.dir });
  await execa('git', ['commit', '--quiet', '-m', 'claim workflow'], { cwd: base.dir });
  return {
    ...base,
    config: {
      ...base.config,
      execution: { ...base.config.execution, autonomy },
      project: { ...base.config.project, adopted },
    },
  };
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

function typesFor(events: readonly ForgeEvent[], stepId: string): string[] {
  return events.filter((event) => event.stepId === stepId).map((event) => event.type);
}

const CASES = [
  ['autonomous', false],
  ['supervised', false],
  ['guided', false],
  ['guided', true],
] as const;

describe('forge run: a step whose session writes exactly its declared output', () => {
  for (const [autonomy, adopted] of CASES) {
    const label = `${autonomy}${adopted ? ' + adopted' : ''}`;

    it(`completes under ${label}: the output is kept, nothing is reverted, the dependent gate runs`, async () => {
      const project = await projectWith(autonomy, adopted);
      const adapter = new FakePlatformAdapter();
      adapter.script(() => true, {
        text: ['wrote the epic'],
        writeFiles: [{ relativePath: EPIC_PATH, content: EPIC }],
      });
      const { result, events } = await run(
        project,
        adapter,
        `run-claim-ok-${autonomy}-${String(adopted)}`,
      );
      expect(result.runState.runStatus).toBe('completed');
      expect(typesFor(events, STEP_ID)).toContain('StepSucceeded');
      expect(typesFor(events, GATE_STEP_ID)).toContain('GateApproved');
      const reverts = events.filter(
        (event) =>
          event.type === 'LaneCommitted' &&
          (event.payload as { reason?: string } | undefined)?.reason === 'claim-revert',
      );
      expect(reverts).toEqual([]);
    });

    it(`under ${label} a write outside the declared output is still reverted, the output survives, and (PLAN-M14.md P3) the run fails`, async () => {
      const project = await projectWith(autonomy, adopted);
      const adapter = new FakePlatformAdapter();
      adapter.script(() => true, {
        text: ['wrote the epic and a stray file'],
        writeFiles: [
          { relativePath: EPIC_PATH, content: EPIC },
          { relativePath: STRAY_PATH, content: 'export const leak = 1;\n' },
        ],
      });
      const { result, events } = await run(
        project,
        adapter,
        `run-claim-stray-${autonomy}-${String(adopted)}`,
      );
      // `06` §6.7 as amended (`SPEC-QUESTIONS.md` Q232 decision 1): the out-of-claim write is reverted
      // exactly as before, but the step -- and so the whole run -- now fails too.
      expect(result.runState.runStatus).toBe('failed');
      const revert = events.find(
        (event) =>
          event.type === 'LaneCommitted' &&
          event.stepId === STEP_ID &&
          (event.payload as { reason?: string } | undefined)?.reason === 'claim-revert',
      );
      expect(revert).toBeDefined();
      const violation = events.find(
        (event) => event.type === 'PolicyViolation' && event.stepId === STEP_ID,
      );
      expect(violation?.payload).toMatchObject({
        kind: 'out-of-claim-write',
        policy: 'strict',
        stepFailed: true,
        paths: [STRAY_PATH],
        totalReverted: 1,
      });
      const failed = events.find(
        (event) => event.type === 'StepFailed' && event.stepId === STEP_ID,
      );
      expect(JSON.stringify(failed?.payload)).toContain('RUN-104');
      // What `forge logs`/`--json` surfaces: the step's own remedy travels with the code.
      expect(JSON.stringify(failed?.payload)).toMatch(/Remedy/i);
      // The dependent gate never runs: a step whose claim was violated is never announced ready.
      expect(typesFor(events, GATE_STEP_ID)).toEqual([]);
    });
  }

  it('a step that declares outputs AND produces keeps the union: a `produces` path survives next to the output', async () => {
    const project = await projectWith(
      'autonomous',
      false,
      WORKFLOW('\n    produces: [ "src/**" ]'),
    );
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['wrote both'],
      writeFiles: [
        { relativePath: EPIC_PATH, content: EPIC },
        { relativePath: STRAY_PATH, content: 'export const declared = 1;\n' },
      ],
    });
    const { result, events } = await run(project, adapter, 'run-claim-union');
    expect(result.runState.runStatus).toBe('completed');
    expect(
      events.filter(
        (event) =>
          event.type === 'LaneCommitted' &&
          (event.payload as { reason?: string } | undefined)?.reason === 'claim-revert',
      ),
    ).toEqual([]);
  });

  it('a session that writes only a stray file fails the run with RUN-104 under every level: the claim violation is caught before the output check ever runs (PLAN-M14.md P3)', async () => {
    for (const [autonomy, adopted] of CASES) {
      const project = await projectWith(autonomy, adopted);
      const adapter = new FakePlatformAdapter();
      adapter.script(() => true, {
        text: ['forgot the epic'],
        writeFiles: [{ relativePath: STRAY_PATH, content: 'x\n' }],
      });
      const { result, events } = await run(
        project,
        adapter,
        `run-claim-none-${autonomy}-${String(adopted)}`,
      );
      expect(result.runState.runStatus).toBe('failed');
      const failed = events.find(
        (event) => event.type === 'StepFailed' && event.stepId === STEP_ID,
      );
      expect(JSON.stringify(failed?.payload)).toContain('RUN-104');
      expect(JSON.stringify(failed?.payload)).toMatch(/Remedy/i);
      expect(typesFor(events, GATE_STEP_ID)).toEqual([]);
    }
  });
});
