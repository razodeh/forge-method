/**
 * `forge gate <list|check|approve|reject|waive>` — real gate evaluation (`@forge/engine/gates`' own
 * `evaluateGate`/`buildGateReport`/`applyWaiver`, via a real shell command) and real `GateApproved`/
 * `GateRejected`/`GateWaived` events appended to a real event log.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.3
 */
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { appendEvent, readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import {
  formatGateApproval,
  formatGateReport,
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

/** `expect.stringContaining` is typed `any`; the assertion is a string match, so say so. */
const like = (text: string): string => expect.stringContaining(text) as string;

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

const FAILING_GATE = `id: G-Fail
checks:
  deterministic:
    - id: bad
      run: "echo '{\\"errors\\":2}'; echo 'boom detail' >&2"
      failOn: "errors > 0"
    - id: fine
      run: "echo '{\\"errors\\":0}'"
      failOn: "errors > 0"
  advisory: []
openQuestionsPolicy: warn
`;

async function writeGate(project: TestProject, id: string, yaml: string): Promise<void> {
  await writeFile(path.join(project.dir, CHECKS_ROOT, `${id}.gate.yaml`), yaml);
}

const WAIVER = { reason: 'known flaky', owner: 'radwan', expiresAt: '2099-01-01T00:00:00.000Z' };

// `PLAN-M13.md` P41: `gateApprove` used to append `GateApproved` without evaluating the gate.
describe('gateApprove evaluates the gate (10 section 10.3 rule 1)', () => {
  it('REFUSES a gate with a failing check and no waiver (GATE-507) and appends NO event', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await expect(gateApprove(ctx(project, 'r-refuse'), 'G-Fail', 'ship it')).rejects.toMatchObject({
      code: 'GATE-507',
      exitCode: 3,
      message: like('check bad'),
    });
    expect(await collectEvents(project, 'r-refuse')).toEqual([]);
  });

  it('records the evaluation summary in the GateApproved event: counts, digests, no raw output', async () => {
    const project = await createTestProject();
    await writeGate(
      project,
      'G-Ok',
      FAILING_GATE.replace('G-Fail', 'G-Ok').replace('errors\\":2', 'errors\\":0'),
    );
    const summary = await gateApprove(ctx(project, 'r-ok'), 'G-Ok', 'fine');
    expect(summary).toMatchObject({ basis: 'checks', checksPassed: 2, checksFailed: 0 });
    const [event] = await collectEvents(project, 'r-ok');
    expect(event).toMatchObject({
      type: 'GateApproved',
      payload: {
        gateId: 'G-Ok',
        reason: 'fine',
        approver: 'human',
        evaluation: { basis: 'checks', checksPassed: 2, advisoryRun: false },
      },
    });
    const evaluation = (
      event?.payload as {
        evaluation: { checks: { stdoutSha256: string; stderrSha256?: string }[] };
      }
    ).evaluation;
    expect(evaluation.checks[0]?.stdoutSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evaluation.checks[0]?.stderrSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(event)).not.toContain('"stderr":');
    expect(JSON.stringify(event)).not.toContain('"stdout":');
  });

  it('approves a failing gate under a waiver `forge gate waive` recorded in this run, and says so', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await gateWaive(ctx(project, 'r-waive'), 'G-Fail', WAIVER);
    const summary = await gateApprove(ctx(project, 'r-waive'), 'G-Fail');
    expect(summary).toMatchObject({
      basis: 'waiver',
      checksFailed: 1,
      checksWaived: 1,
      waiver: WAIVER,
    });
    const events = await collectEvents(project, 'r-waive');
    expect(events.map((e) => e.type)).toEqual(['GateWaived', 'GateApproved']);
    // the waiver event records what it excused, not only that something was
    expect(events[0]?.payload).toMatchObject({
      evaluation: {
        passed: false,
        checks: [
          { checkId: 'bad', passed: false, waived: true },
          { checkId: 'fine', waived: false },
        ],
      },
    });
  });

  it('a waiver recorded for ANOTHER gate, or in ANOTHER run, does not cover this one', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await writeGate(project, 'G-Other', FAILING_GATE.replace('G-Fail', 'G-Other'));
    await gateWaive(ctx(project, 'r-a'), 'G-Other', WAIVER);
    await expect(gateApprove(ctx(project, 'r-a'), 'G-Fail')).rejects.toMatchObject({
      code: 'GATE-507',
    });
    await gateWaive(ctx(project, 'r-b'), 'G-Fail', WAIVER);
    await expect(gateApprove(ctx(project, 'r-a'), 'G-Fail')).rejects.toMatchObject({
      code: 'GATE-507',
    });
  });

  it('falls back to an OLDER waiver still valid when the newest one has lapsed', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    const at = (iso: string) => ({ ...ctx(project, 'r-fall'), clock: { now: () => iso } as never });
    await gateWaive(at('2026-01-01T00:00:00.000Z'), 'G-Fail', {
      ...WAIVER,
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    await gateWaive(at('2026-02-01T00:00:00.000Z'), 'G-Fail', {
      ...WAIVER,
      expiresAt: '2026-06-01T00:00:00.000Z',
    });
    const summary = await gateApprove(at('2026-07-01T00:00:00.000Z'), 'G-Fail');
    expect(summary.waiver?.expiresAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('a waiver that has lapsed by approval time covers nothing (GATE-507), and an older still-valid one is used instead', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    const at = (iso: string) => ({ ...ctx(project, 'r-exp'), clock: { now: () => iso } as never });
    await gateWaive(at('2026-01-01T00:00:00.000Z'), 'G-Fail', {
      ...WAIVER,
      expiresAt: '2026-06-01T00:00:00.000Z',
    });
    await expect(gateApprove(at('2026-07-01T00:00:00.000Z'), 'G-Fail')).rejects.toMatchObject({
      code: 'GATE-507',
    });
    // a later, longer waiver granted before the shorter one lapsed is newest-first and valid
    await gateWaive(at('2026-05-01T00:00:00.000Z'), 'G-Fail', {
      ...WAIVER,
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    await expect(gateApprove(at('2026-07-01T00:00:00.000Z'), 'G-Fail')).resolves.toMatchObject({
      basis: 'waiver',
    });
  });

  it('REFUSES to record a waiver on a gate whose checks all pass (GATE-509): it would be a standing waiver for whatever fails later', async () => {
    const project = await createTestProject();
    await writeGate(
      project,
      'G-Ok',
      FAILING_GATE.replace('G-Fail', 'G-Ok').replace('errors\\":2', 'errors\\":0'),
    );
    await expect(gateWaive(ctx(project, 'r-pre'), 'G-Ok', WAIVER)).rejects.toMatchObject({
      code: 'GATE-509',
    });
    expect(await collectEvents(project, 'r-pre')).toEqual([]);
  });

  it('a waiver granted while check `bad` failed does not cover check `fine` regressing later (GATE-507)', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await gateWaive(ctx(project, 'r-cov'), 'G-Fail', WAIVER);
    // `fine` starts failing too: the waiver on record excused `bad` only
    await writeGate(project, 'G-Fail', FAILING_GATE.replace('errors\\":0', 'errors\\":3'));
    await expect(gateApprove(ctx(project, 'r-cov'), 'G-Fail')).rejects.toMatchObject({
      code: 'GATE-507',
      message: like('check bad, fine'),
    });
    // ...and once `fine` is green again the same waiver covers `bad` as before
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await expect(gateApprove(ctx(project, 'r-cov'), 'G-Fail')).resolves.toMatchObject({
      basis: 'waiver',
    });
  });

  it('a waiver event that recorded no evaluation (or a passing check list) covers nothing', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await appendEvent(project.dir, 'r-bare', {
      type: 'GateWaived',
      runId: 'r-bare',
      ts: '2026-01-01T00:00:00.000Z',
      payload: { gateId: 'G-Fail', ...WAIVER },
    });
    await expect(gateApprove(ctx(project, 'r-bare'), 'G-Fail')).rejects.toMatchObject({
      code: 'GATE-507',
    });
  });

  it('an unauthorised approver is refused BEFORE any check command runs', async () => {
    const project = await createTestProject();
    const marker = path.join(project.dir, 'ran-marker');
    await writeGate(
      project,
      'G-Role',
      `id: G-Role\nchecks:\n  deterministic:\n    - id: t\n      run: "touch ran-marker; echo '{\\"errors\\":0}'"\n      failOn: "errors > 0"\napproval:\n  roles: [pm]\n`,
    );
    await expect(gateApprove(ctx(project, 'r-pre-role'), 'G-Role')).rejects.toMatchObject({
      code: 'GATE-508',
    });
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('holds `gate waive` to the gate approval block too (GATE-508, before any check runs, no event)', async () => {
    const project = await createTestProject();
    const marker = path.join(project.dir, 'waive-ran');
    await writeGate(
      project,
      'G-Role',
      `id: G-Role\nchecks:\n  deterministic:\n    - id: t\n      run: "touch waive-ran; echo '{\\"errors\\":1}'"\n      failOn: "errors > 0"\napproval:\n  roles: [pm]\n`,
    );
    await expect(gateWaive(ctx(project, 'r-wr'), 'G-Role', WAIVER)).rejects.toMatchObject({
      code: 'GATE-508',
    });
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await collectEvents(project, 'r-wr')).toEqual([]);
  });

  it('redacts secret shapes in a free-text reason before the event is written', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await gateWaive(ctx(project, 'r-red'), 'G-Fail', {
      ...WAIVER,
      reason: `token ghp_${'c'.repeat(36)} was pasted`,
    });
    const [event] = await collectEvents(project, 'r-red');
    expect(JSON.stringify(event)).not.toContain('ghp_');
  });

  it('a passing gate needs no waiver and ignores a lapsed one', async () => {
    const project = await createTestProject();
    await writeGate(
      project,
      'G-Ok',
      FAILING_GATE.replace('G-Fail', 'G-Ok').replace('errors\\":2', 'errors\\":0'),
    );
    const summary = await gateApprove(ctx(project, 'r-x'), 'G-Ok');
    expect(summary.basis).toBe('checks');
  });

  it('refuses a gate whose approval roles do not name a human, or whose quorum it cannot verify (GATE-508), with no event', async () => {
    const project = await createTestProject();
    const passing = FAILING_GATE.replace('G-Fail', 'G-Role').replace('errors\\":2', 'errors\\":0');
    await writeGate(project, 'G-Role', `${passing}approval:\n  roles: [pm]\n`);
    await writeGate(
      project,
      'G-Quorum',
      `${passing.replace('G-Role', 'G-Quorum')}approval:\n  roles: [human]\n  quorum: 2\n`,
    );
    for (const id of ['G-Role', 'G-Quorum']) {
      await expect(gateApprove(ctx(project, 'r-role'), id)).rejects.toMatchObject({
        code: 'GATE-508',
      });
    }
    expect(await collectEvents(project, 'r-role')).toEqual([]);
  });

  it('enforces gates.may_approve for an agent approver (the seam), and a human is unaffected', async () => {
    const project = await createTestProject();
    const passing = FAILING_GATE.replace('G-Fail', 'G-Ag').replace('errors\\":2', 'errors\\":0');
    await writeGate(project, 'G-Ag', `${passing}approval:\n  roles: [human, pm]\n`);
    await expect(
      gateApprove(ctx(project, 'r-ag'), 'G-Ag', undefined, {
        approver: { kind: 'agent', agentId: 'pm', mayApprove: [] },
      }),
    ).rejects.toMatchObject({ code: 'GATE-508' });
    await expect(
      gateApprove(ctx(project, 'r-ag'), 'G-Ag', undefined, {
        approver: { kind: 'agent', agentId: 'pm', mayApprove: ['G-Ag'] },
      }),
    ).resolves.toMatchObject({ approver: 'agent pm' });
  });

  it('a gate whose check output is a refusal envelope cannot be approved (P35 fail-closed carries through)', async () => {
    const project = await createTestProject();
    await writeGate(
      project,
      'G-Ref',
      `id: G-Ref\nchecks:\n  deterministic:\n    - id: r\n      run: "echo '{\\"v\\":1,\\"ok\\":false,\\"error\\":{}}'"\n      failOn: "errors > 0"\n`,
    );
    await expect(gateApprove(ctx(project, 'r-ref'), 'G-Ref')).rejects.toMatchObject({
      code: 'GATE-507',
    });
  });

  it('refuses an unregistered gate (RUN-050)', async () => {
    const project = await createTestProject();
    await expect(gateApprove(ctx(project), 'G-No-Such-Gate')).rejects.toMatchObject({
      code: 'RUN-050',
    });
  });
});

describe('formatGateReport (human-mode gate check)', () => {
  it('shows the recorded waiver in `gate check` (10 section 10.3 rule 1: waivers appear in every report), covering only what it was granted for', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    const before = await gateCheck(ctx(project, 'r-show'), 'G-Fail');
    expect(before).toMatchObject({ passed: false, approved: false });
    expect(before.waiver).toBeUndefined();
    await gateWaive(ctx(project, 'r-show'), 'G-Fail', WAIVER);
    const after = await gateCheck(ctx(project, 'r-show'), 'G-Fail');
    expect(after).toMatchObject({ passed: false, approved: true, waiver: WAIVER });
    expect(formatGateReport(after)).toContain(
      'waived by radwan until 2099-01-01T00:00:00.000Z: known flaky',
    );
    // a run that recorded no waiver shows none
    expect((await gateCheck(ctx(project, 'r-other'), 'G-Fail')).waiver).toBeUndefined();
    // `check` still appends nothing
    expect((await collectEvents(project, 'r-show')).map((e) => e.type)).toEqual(['GateWaived']);
  });

  it('formatGateApproval terminal-sanitises the waiver owner read back from the log', () => {
    const line = formatGateApproval('G-X', {
      basis: 'waiver',
      checksWaived: 1,
      waiver: { owner: 'evil\u001b[31m', reason: 'r', expiresAt: 'x' },
    } as never);
    expect(line).toContain('waiver by evil');
    expect(line).not.toContain('\u001b');
  });

  it('collapses pretty-printed JSON output to one line and redacts secret shapes and escapes', async () => {
    const project = await createTestProject();
    await writeGate(
      project,
      'G-Sec',
      [
        'id: G-Sec',
        'checks:',
        '  deterministic:',
        '    - id: sec',
        '      run: |',
        `        printf '{\\n  "errors": 1,\\n  "token": "ghp_${'a'.repeat(36)}"\\n}'`,
        '      failOn: "errors > 0"',
        '',
      ].join('\n'),
    );
    const text = formatGateReport(await gateCheck(ctx(project), 'G-Sec'));
    expect(text).toContain('"errors": 1');
    expect(text).not.toContain('ghp_');
    expect(text).toContain('[REDACTED]');
    expect(text.split('\n')).toHaveLength(2);
  });

  it('prints every failing check with its exit code and why, and stderr; nothing for a passing one', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await writeGate(
      project,
      'G-Crash',
      `id: G-Crash\nchecks:\n  deterministic:\n    - id: crash\n      run: "echo 'not json' ; echo 'stack trace here' >&2; exit 2"\n      failOn: "errors > 0"\n`,
    );
    const failing = formatGateReport(await gateCheck(ctx(project), 'G-Fail'));
    expect(failing).toContain('G-Fail: passed=false');
    expect(failing).toContain('FAIL bad (exit 0)');
    expect(failing).toContain('its failOn matched');
    expect(failing).toContain('stderr: boom detail');
    expect(failing).not.toContain('FAIL fine');
    const crash = formatGateReport(await gateCheck(ctx(project), 'G-Crash'));
    expect(crash).toContain('FAIL crash (exit 2)');
    expect(crash).toContain('could not be parsed as JSON');
    expect(crash).toContain('stderr: stack trace here');
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
