/**
 * `forge gate <list|check|approve|reject|waive>` — real gate evaluation (`@forge/engine/gates`' own
 * `evaluateGate`/`buildGateReport`/`applyWaiver`, via a real shell command) and real `GateApproved`/
 * `GateRejected`/`GateWaived` events appended to a real event log.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.3
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import {
  gateApprove,
  gateCheck,
  gateList,
  gateReject,
  gateWaive,
  type GateCommandContext,
} from '../../../src/commands/run/gate-commands.ts';
import {
  CHECKS_ROOT,
  FIXTURE_GATE_ID,
  cleanupAll,
  createTestProject,
  type TestProject,
} from './helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject, runId = 'run-1'): GateCommandContext {
  return { paths: project.paths, projectRoot: project.dir, checksRoot: CHECKS_ROOT, runId };
}

async function collectEvents(project: TestProject, runId: string) {
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(project.dir, runId)) events.push(event);
  return events;
}

describe('gateList', () => {
  it('lists every real gate definition from the checks directory', async () => {
    const project = await createTestProject();
    const gates = await gateList(ctx(project));
    expect(gates.map((gate) => gate.id)).toEqual([FIXTURE_GATE_ID]);
  });
});

describe('gateCheck', () => {
  it('evaluates a real gate with a real, passing shell check, emitting no event', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'G-Pass.gate.yaml'),
      `id: G-Pass
checks:
  deterministic:
    - id: ok
      run: "echo '{\\"ok\\":true}'"
      failOn: "!ok"
  advisory: []
openQuestionsPolicy: warn
`,
    );
    const report = await gateCheck(ctx(project), 'G-Pass');
    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(1);
    expect(await collectEvents(project, 'run-1')).toEqual([]);
  });

  it('evaluates a real gate with a real, failing shell check', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'G-Fail.gate.yaml'),
      `id: G-Fail
checks:
  deterministic:
    - id: bad
      run: "echo '{\\"ok\\":false}'"
      failOn: "!ok"
  advisory: []
openQuestionsPolicy: warn
`,
    );
    const report = await gateCheck(ctx(project), 'G-Fail');
    expect(report.passed).toBe(false);
  });

  it('throws RUN-050 for an unregistered gate id', async () => {
    const project = await createTestProject();
    await expect(gateCheck(ctx(project), 'G-No-Such-Gate')).rejects.toMatchObject({
      code: 'RUN-050',
    });
  });
});

describe('gateApprove / gateReject', () => {
  it('appends a real GateApproved event carrying the given reason', async () => {
    const project = await createTestProject();
    await gateApprove(ctx(project, 'run-approve'), FIXTURE_GATE_ID, 'looks good');
    const events = await collectEvents(project, 'run-approve');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'GateApproved',
      payload: { gateId: FIXTURE_GATE_ID, reason: 'looks good' },
    });
  });

  it('appends a real GateRejected event carrying the given reason', async () => {
    const project = await createTestProject();
    await gateReject(ctx(project, 'run-reject'), FIXTURE_GATE_ID, 'not ready');
    const events = await collectEvents(project, 'run-reject');
    expect(events[0]).toMatchObject({
      type: 'GateRejected',
      payload: { gateId: FIXTURE_GATE_ID, reason: 'not ready' },
    });
  });
});

describe('gateWaive', () => {
  it('applies a real waiver over a real (failing) evaluation and appends a real GateWaived event', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'G-Fail.gate.yaml'),
      `id: G-Fail
checks:
  deterministic:
    - id: bad
      run: "echo '{\\"ok\\":false}'"
      failOn: "!ok"
  advisory: []
openQuestionsPolicy: warn
`,
    );
    const report = await gateWaive(ctx(project, 'run-waive'), 'G-Fail', {
      reason: 'known flaky check',
      owner: 'radwan',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(report.waiver).toEqual({
      reason: 'known flaky check',
      owner: 'radwan',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(report.approved).toBe(true);

    const events = await collectEvents(project, 'run-waive');
    expect(events[0]).toMatchObject({
      type: 'GateWaived',
      payload: { gateId: 'G-Fail', reason: 'known flaky check', owner: 'radwan' },
    });
  });

  it('throws RUN-050 for an unregistered gate id', async () => {
    const project = await createTestProject();
    await expect(
      gateWaive(ctx(project), 'G-No-Such-Gate', {
        reason: 'r',
        owner: 'o',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'RUN-050' });
  });
});
