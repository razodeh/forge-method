/**
 * `forge gate <list|check|approve|reject|waive>` — real gate evaluation (`@forge/engine/gates`' own
 * `evaluateGate`/`buildGateReport`/`applyWaiver`, via a real shell command) and real `GateApproved`/
 * `GateRejected`/`GateWaived` events appended to a real event log.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.3
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ArtifactDocument, validateArtifact } from '@forge/core/artifacts';
import { appendEvent, readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { DEFAULT_CONFIG, type ForgeConfig } from '@forge/schemas/config';

import { configGet, configSet, CONFIG_REL_PATH } from '../../../src/commands/config.ts';
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
  AGENTS_ROOT,
  CHECKS_ROOT,
  FIXTURE_GATE_ID,
  cleanupAll,
  createTestProject,
  type TestProject,
} from './helpers.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Writes a real, schema-valid `.forge/config.yaml` for `project` — the fixture project this file's own
 * `createTestProject` builds never writes one on disk (only an in-memory `ForgeConfig` for `forge run`'s
 * own wiring), so `gate-commands.ts`'s own `resolveWaiverMaxDays` falls back to the documented default (90)
 * for any test that does not call this. `gates.waiverMaxDays` here can override that default for a test
 * that is genuinely about something else (fallback-to-an-older-waiver ordering) and would otherwise need
 * its own literal expiries widened well past 90 days to stay meaningful. */
async function writeConfig(
  project: TestProject,
  overrides: {
    readonly gates?: { readonly waiverMaxDays: number };
    /** `PLAN-M14.md` P17's own "relocated `paths.reports` followed": a real config overriding where
     * `GateReport` documents (and everything else under `paths.*`) live. */
    readonly paths?: ForgeConfig['paths'];
  } = {},
): Promise<void> {
  await writeFile(
    path.join(project.dir, CONFIG_REL_PATH),
    YAML.stringify({ ...DEFAULT_CONFIG, ...overrides }),
  );
}

/** `expect.stringContaining` is typed `any`; the assertion is a string match, so say so. */
const like = (text: string): string => expect.stringContaining(text) as string;

/** `expect.objectContaining` is typed `any` too; the assertion is that a thrown error's `cause` is
 * another `ForgeError` of the given `code` (`resolveApprover`'s own unknown-agent case, `PLAN-M14.md`
 * P15), so say so. */
const causedBy = (code: string): { readonly code: string } =>
  expect.objectContaining({ code }) as { readonly code: string };

afterEach(cleanupAll);

function ctx(
  project: TestProject,
  runId = 'run-1',
  marker?: GateCommandContext['marker'],
): GateCommandContext {
  return {
    paths: project.paths,
    projectRoot: project.dir,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
    runId,
    ...(marker === undefined ? {} : { marker }),
  };
}

/** A minimal, real, schema-valid `.forge/agents/<id>.yaml` this file writes directly — not
 * `writeFixtureAgent` (`commands/loop/helpers.ts`'s own fixture, always `may_approve: []`), since
 * `resolveApprover`'s own real `readProjectAgent` call (`PLAN-M14.md` P15) needs a specific
 * `gates.may_approve` per test. No prompt file is written: `readProjectAgent` only parses and validates
 * the YAML (`readAgentDefinition`), never checks that `prompt.system` names a file that exists. */
async function writeAgent(
  project: TestProject,
  id: string,
  mayApprove: readonly string[] = [],
): Promise<void> {
  await mkdir(path.join(project.dir, AGENTS_ROOT), { recursive: true });
  await writeFile(
    path.join(project.dir, AGENTS_ROOT, `${id}.yaml`),
    `id: ${id}
name: ${id}
version: 1.0.0
tier: core
mandate: Fixture mandate for ${id}.
decisions_owned: []
persona:
  voice: terse
  stance: pragmatic
  disagreement_style: direct
inputs:
  required: []
  optional: []
outputs:
  - type: X
    schema: x.schema.json
    path: x.md
kb_write: []
kb_propose: []
tools:
  read: true
  write: false
  exec: []
  network: false
  git_commit: none
  deploy: false
model:
  tier: balanced
  thinking: medium
limits:
  max_turns: 10
  wall_clock_ms: 600000
  max_cost_usd: 2.0
parallel_safety:
  file_ownership: []
  exclusive: false
gates:
  produces_evidence_for: []
  may_approve: ${JSON.stringify(mayApprove)}
prompt:
  system: prompts/${id}.system.md
`,
  );
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

  // `PLAN-M14.md` P20: a failing, attached `warn` check never fails the gate, but is still reported —
  // end to end, from an attached `*.check.yaml` through `gateCheck`'s own real evaluation to both the
  // `--json`-shaped return value and the human-readable `formatGateReport` text.
  it('a failing attached warn check leaves the gate passing, reported in warnings and in formatGateReport', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'G-Warn.gate.yaml'),
      `id: G-Warn
checks:
  deterministic:
    - id: ok
      run: "echo '{\\"ok\\":true}'"
      failOn: "!ok"
  advisory: []
openQuestionsPolicy: warn
`,
    );
    await mkdir(path.join(project.dir, '.forge/overrides/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/overrides/checks/acme.check.yaml'),
      `id: acme:warn-only
run: "echo '{\\"violations\\":1}'"
failOn: "violations > 0"
remedy: "fix it"
appliesTo: { gates: [G-Warn] }
severity: warn
`,
    );
    const report = await gateCheck(ctx(project), 'G-Warn');
    expect(report.passed).toBe(true);
    expect(report.checks.every((check) => check.checkId !== 'acme:warn-only')).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({ checkId: 'acme:warn-only', passed: false });
    expect(formatGateReport(report)).toContain('WARN acme:warn-only');
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

// Within `gates.waiverMaxDays`'s own default cap (90 days, `PLAN-M14.md` P16) of the real, unmocked clock
// every test below that uses this constant runs under (`ctx()` supplies no `clock` override) -- computed
// relative to `Date.now()` rather than a fixed far-future literal so it never itself goes stale under that
// same cap.
const WAIVER_EXPIRES_AT = new Date(Date.now() + 30 * DAY_MS).toISOString();
const WAIVER = { reason: 'known flaky', owner: 'radwan', expiresAt: WAIVER_EXPIRES_AT };

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
    // Unrelated to gates.waiverMaxDays itself (this test is about newest-first fallback ordering): a
    // generous configured cap so this test's own long-lived literal expiries below need no rewriting.
    await writeConfig(project, { gates: { waiverMaxDays: 3650 } });
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
    // Unrelated to gates.waiverMaxDays itself (this test is about lapsing, not the cap): a generous
    // configured cap so this test's own long-lived literal expiries below need no rewriting.
    await writeConfig(project, { gates: { waiverMaxDays: 3650 } });
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

// `PLAN-M14.md` P19, `SPEC-QUESTIONS.md` Q232 decision 8, `05` §5.2 / `10` §10.3 rule 6 / `20` §20.10 S6:
// an agent never approves (or waives) a gate that a step it ran produced evidence for in the same run --
// enforced under the real FORGE session marker (`PLAN-M14.md` P15) the identical way GATE-508/510 are,
// before any check command runs. Every gate below passes its own deterministic check (`errors:0`): the
// point is that GATE-511 fires independently of whether the checks themselves would allow approval,
// including for `gateWaive`, which would otherwise hit GATE-509 ("nothing to waive") on a passing gate.
describe('an agent never approves a gate it produced evidence for in the same run (PLAN-M14.md P19)', () => {
  const evidenceGate = (id: string, evidenceType: string, roles = '[human, sre]'): string =>
    `id: ${id}\n` +
    'checks:\n' +
    '  deterministic:\n' +
    '    - id: t\n' +
    `      run: "echo '{\\"errors\\":0}'"\n` +
    '      failOn: "errors > 0"\n' +
    `approval:\n  roles: ${roles}\n` +
    `evidence:\n  - artifact: ${evidenceType}\n`;

  it('GATE-511 via the StepStarted gateEvidence source, for both approve and waive; no event appended', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Ev1', evidenceGate('G-Ev1', 'InterfaceContract'));
    await writeAgent(project, 'sre', ['G-Ev1']);
    await appendEvent(project.dir, 'run-p19a', {
      type: 'StepStarted',
      runId: 'run-p19a',
      ts: '2026-01-01T00:00:00.000Z',
      stepId: 'wf:propose',
      agentId: 'sre',
      payload: { gateEvidence: ['G-Ev1'] },
    });
    const marker = { runId: 'run-p19a', stepId: 'design', agentId: 'sre' };
    await expect(gateApprove(ctx(project, 'run-p19a', marker), 'G-Ev1')).rejects.toMatchObject({
      code: 'GATE-511',
      details: { gateId: 'G-Ev1', agentId: 'sre' },
    });
    await expect(
      gateWaive(ctx(project, 'run-p19a', marker), 'G-Ev1', WAIVER),
    ).rejects.toMatchObject({ code: 'GATE-511', details: { gateId: 'G-Ev1', agentId: 'sre' } });
    const events = await collectEvents(project, 'run-p19a');
    expect(events.some((e) => e.type === 'GateApproved' || e.type === 'GateWaived')).toBe(false);
  });

  it('GATE-511 via the ArtifactCreated source, matching the gate\'s own "evidence:" type', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Ev2', evidenceGate('G-Ev2', 'ArchitectureSpec'));
    await writeAgent(project, 'sre', ['G-Ev2']);
    await appendEvent(project.dir, 'run-p19b', {
      type: 'ArtifactCreated',
      runId: 'run-p19b',
      ts: '2026-01-01T00:00:00.000Z',
      stepId: 'wf:propose',
      agentId: 'sre',
      payload: { type: 'ArchitectureSpec', id: 'ARCH-001' },
    });
    const marker = { runId: 'run-p19b', stepId: 'design', agentId: 'sre' };
    await expect(gateApprove(ctx(project, 'run-p19b', marker), 'G-Ev2')).rejects.toMatchObject({
      code: 'GATE-511',
    });
  });

  it('the Type(*) grammar matches by name only: an ArtifactCreated of type ADR conflicts with evidence "ADR(*)"', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Ev3', evidenceGate('G-Ev3', 'ADR(*)'));
    await writeAgent(project, 'sre', ['G-Ev3']);
    await appendEvent(project.dir, 'run-p19c', {
      type: 'ArtifactCreated',
      runId: 'run-p19c',
      ts: '2026-01-01T00:00:00.000Z',
      agentId: 'sre',
      payload: { type: 'ADR', id: 'ADR-0011' },
    });
    const marker = { runId: 'run-p19c', stepId: 'design', agentId: 'sre' };
    await expect(gateApprove(ctx(project, 'run-p19c', marker), 'G-Ev3')).rejects.toMatchObject({
      code: 'GATE-511',
    });
  });

  it('a DIFFERENT agent (not the one who produced evidence) still approves the identical gate', async () => {
    const project = await createTestProject();
    await writeGate(
      project,
      'G-Ev4',
      evidenceGate('G-Ev4', 'InterfaceContract', '[human, sre, platform]'),
    );
    await writeAgent(project, 'sre', ['G-Ev4']);
    await writeAgent(project, 'platform', ['G-Ev4']);
    await appendEvent(project.dir, 'run-p19d', {
      type: 'StepStarted',
      runId: 'run-p19d',
      ts: '2026-01-01T00:00:00.000Z',
      agentId: 'sre',
      payload: { gateEvidence: ['G-Ev4'] },
    });
    const otherMarker = { runId: 'run-p19d', stepId: 'design', agentId: 'platform' };
    await expect(
      gateApprove(ctx(project, 'run-p19d', otherMarker), 'G-Ev4'),
    ).resolves.toMatchObject({ approver: 'agent platform' });
  });

  it('a human approver ignores the same-run evidence entirely', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Ev5', evidenceGate('G-Ev5', 'InterfaceContract', '[human]'));
    await appendEvent(project.dir, 'run-p19e', {
      type: 'StepStarted',
      runId: 'run-p19e',
      ts: '2026-01-01T00:00:00.000Z',
      agentId: 'sre',
      payload: { gateEvidence: ['G-Ev5'] },
    });
    const summary = await gateApprove(ctx(project, 'run-p19e'), 'G-Ev5');
    expect(summary.approver).toBe('human');
  });

  it('evidence recorded in ANOTHER run is not consulted', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Ev6', evidenceGate('G-Ev6', 'InterfaceContract'));
    await writeAgent(project, 'sre', ['G-Ev6']);
    await appendEvent(project.dir, 'run-other-p19', {
      type: 'StepStarted',
      runId: 'run-other-p19',
      ts: '2026-01-01T00:00:00.000Z',
      agentId: 'sre',
      payload: { gateEvidence: ['G-Ev6'] },
    });
    const marker = { runId: 'run-p19f', stepId: 'design', agentId: 'sre' };
    await expect(gateApprove(ctx(project, 'run-p19f', marker), 'G-Ev6')).resolves.toMatchObject({
      approver: 'agent sre',
    });
  });

  it('neither source present: the agent approves normally', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Ev7', evidenceGate('G-Ev7', 'InterfaceContract'));
    await writeAgent(project, 'sre', ['G-Ev7']);
    const marker = { runId: 'run-p19g', stepId: 'design', agentId: 'sre' };
    await expect(gateApprove(ctx(project, 'run-p19g', marker), 'G-Ev7')).resolves.toMatchObject({
      approver: 'agent sre',
    });
  });

  it('a StepStarted naming a DIFFERENT gate in its own gateEvidence does not conflict with THIS gate', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Ev8', evidenceGate('G-Ev8', 'InterfaceContract'));
    await writeAgent(project, 'sre', ['G-Ev8']);
    await appendEvent(project.dir, 'run-p19h', {
      type: 'StepStarted',
      runId: 'run-p19h',
      ts: '2026-01-01T00:00:00.000Z',
      agentId: 'sre',
      payload: { gateEvidence: ['G-Other'] },
    });
    const marker = { runId: 'run-p19h', stepId: 'design', agentId: 'sre' };
    await expect(gateApprove(ctx(project, 'run-p19h', marker), 'G-Ev8')).resolves.toMatchObject({
      approver: 'agent sre',
    });
  });

  it('checked after the ordinary role/may_approve authorisation: an agent not in approval.roles at all still gets GATE-508, not GATE-511', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Ev9', evidenceGate('G-Ev9', 'InterfaceContract', '[human]'));
    await writeAgent(project, 'sre', ['G-Ev9']);
    await appendEvent(project.dir, 'run-p19i', {
      type: 'StepStarted',
      runId: 'run-p19i',
      ts: '2026-01-01T00:00:00.000Z',
      agentId: 'sre',
      payload: { gateEvidence: ['G-Ev9'] },
    });
    const marker = { runId: 'run-p19i', stepId: 'design', agentId: 'sre' };
    await expect(gateApprove(ctx(project, 'run-p19i', marker), 'G-Ev9')).rejects.toMatchObject({
      code: 'GATE-508',
    });
  });
});

// `PLAN-M14.md` P15, `SPEC-QUESTIONS.md` Q232 decision 9: `forge gate approve|waive` under the real
// FORGE session marker (`@forge/core/session-marker`) is refused unless the gate names agents and
// `may_approve` lists it -- `resolveApprover` (`gate-commands.ts`) reads `ctx.marker`.
describe('the real FORGE session marker resolves who is approving/waiving (PLAN-M14.md P15)', () => {
  const PASSING_ROLE_GATE = (id: string, approval: string): string =>
    FAILING_GATE.replace('G-Fail', id).replace('errors\\":2', 'errors\\":0') +
    `approval:\n${approval}\n`;

  it('(a) a marker naming a real agent whose role the gate does not name (roles: [human]) is GATE-508, no event', async () => {
    const project = await createTestProject();
    await writeAgent(project, 'architect', []);
    // `FIXTURE_GATE_ID` declares no `approval:` block at all -- the spec default `roles: [human]`.
    await expect(
      gateApprove(
        ctx(project, 'run-1', { runId: 'run-1', stepId: 'design', agentId: 'architect' }),
        FIXTURE_GATE_ID,
      ),
    ).rejects.toMatchObject({ code: 'GATE-508' });
    expect(await collectEvents(project, 'run-1')).toEqual([]);
  });

  it('(b) a marker naming an agent the gate DOES name, whose own roster entry lists it in may_approve, is approved as that agent', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Ag2', PASSING_ROLE_GATE('G-Ag2', '  roles: [human, sre]'));
    await writeAgent(project, 'sre', ['G-Ag2']);
    const summary = await gateApprove(
      ctx(project, 'run-b', { runId: 'run-b', stepId: 'deploy', agentId: 'sre' }),
      'G-Ag2',
    );
    expect(summary.approver).toBe('agent sre');
    const [event] = await collectEvents(project, 'run-b');
    expect(event).toMatchObject({ payload: { approver: 'agent sre' } });
  });

  it('(c) alwaysHuman still refuses a named agent under a real marker (GATE-508, details.approver names the agent) for BOTH approve and waive, 03 section 3.6', async () => {
    const project = await createTestProject();
    await writeGate(
      project,
      'G-Prod',
      `${PASSING_ROLE_GATE('G-Prod', '  roles: [human, sre]')}autonomyOverride: alwaysHuman\n`,
    );
    // Not `architect`: `@forge/agents`'s own loader refuses ANY non-empty `may_approve` for that one id
    // outright (`05` §5.2's own roster rule, load-time-checkable only for `architect` specifically) --
    // orthogonal to this test, which is about `alwaysHuman` overriding an otherwise-valid `may_approve`.
    await writeAgent(project, 'sre', ['G-Prod']);
    const marker = { runId: 'run-c', stepId: 'ship', agentId: 'sre' };
    await expect(gateApprove(ctx(project, 'run-c', marker), 'G-Prod')).rejects.toMatchObject({
      code: 'GATE-508',
      details: { approver: 'agent sre' },
    });
    // `gateWaive`'s own identical `approver.kind === 'human' ? 'human' : \`agent ...\`` ternary
    // (`resolveApprover`, `PLAN-M14.md` P15): resolveApprover refuses via `GATE-510`/`approverRefusal`
    // long before any check runs (`G-Prod`'s own checks pass, exactly as `gateApprove`'s above never ran
    // them either), so the identical marker and gate exercise `gateWaive`'s own agent branch too, not
    // only `gateApprove`'s.
    await expect(gateWaive(ctx(project, 'run-c', marker), 'G-Prod', WAIVER)).rejects.toMatchObject({
      code: 'GATE-508',
      details: { approver: 'agent sre' },
    });
  });

  it("(d) a marker naming this run with NO agent id (a run's own command step) is GATE-510 for approve and waive; check still works; reject records the marker", async () => {
    const project = await createTestProject();
    const marker = { runId: 'run-1', stepId: 'deploy' };

    await expect(gateApprove(ctx(project, 'run-1', marker), FIXTURE_GATE_ID)).rejects.toMatchObject(
      { code: 'GATE-510' },
    );
    expect(await collectEvents(project, 'run-1')).toEqual([]);

    // `resolveApprover` refuses before `evaluateFresh` ever runs (like `approve`'s own "before any check
    // command runs"), so this fires the identical way regardless of whether the gate's own checks pass --
    // the already-passing fixture gate is reused rather than a bespoke failing one.
    await expect(
      gateWaive(ctx(project, 'run-1', marker), FIXTURE_GATE_ID, WAIVER),
    ).rejects.toMatchObject({ code: 'GATE-510' });
    expect(await collectEvents(project, 'run-1')).toEqual([]);

    // `check` never approves or waives anything -- unaffected by the marker.
    const report = await gateCheck(ctx(project, 'run-1', marker), FIXTURE_GATE_ID);
    expect(report.passed).toBe(true);

    // `reject` still works, and records who: the marker itself, since there is no approver identity.
    await gateReject(ctx(project, 'run-1', marker), FIXTURE_GATE_ID, 'not ready');
    const events = await collectEvents(project, 'run-1');
    const rejected = events.find((e) => e.type === 'GateRejected');
    expect(rejected).toMatchObject({
      type: 'GateRejected',
      payload: { gateId: FIXTURE_GATE_ID, reason: 'not ready', approver: 'run run-1 step deploy' },
    });
  });

  it('(e) a marker whose own runId does not match the resolved --run is discarded (byte-identical to no marker): even an agent that WOULD be approved under its own run is refused (GATE-508) as a human fallback the gate does not name', async () => {
    const project = await createTestProject();
    // Deliberately names ONLY the agent role (no `human`), with `may_approve` covering it: an agent
    // marker for THIS run would be approved outright -- proving the mismatched marker below is genuinely
    // discarded (not merely refused for an unrelated reason) requires an outcome that would otherwise
    // differ, not just another route to the same GATE-508. Not `architect`: `@forge/agents`'s own loader
    // refuses ANY non-empty `may_approve` for that one id outright (`05` §5.2's own roster rule).
    await writeGate(
      project,
      'G-PlatformOnly',
      PASSING_ROLE_GATE('G-PlatformOnly', '  roles: [platform]'),
    );
    await writeAgent(project, 'platform', ['G-PlatformOnly']);
    await expect(
      gateApprove(
        ctx(project, 'run-real', {
          runId: 'run-other',
          stepId: 'design',
          agentId: 'platform',
        }),
        'G-PlatformOnly',
      ),
    ).rejects.toMatchObject({ code: 'GATE-508' });
  });

  it('(f) a marker naming an agent id the project roster does not recognise is GATE-508 with a RUN-056 cause', async () => {
    const project = await createTestProject();
    await expect(
      gateApprove(
        ctx(project, 'run-1', { runId: 'run-1', stepId: 'design', agentId: 'ghost' }),
        FIXTURE_GATE_ID,
      ),
    ).rejects.toMatchObject({
      code: 'GATE-508',
      cause: causedBy('RUN-056'),
    });
  });

  it('a genuine I/O failure reading the marker-named agent (not a missing/malformed one) propagates UNWRAPPED, never misreported as GATE-508', async () => {
    const project = await createTestProject();
    // `readProjectAgent`'s own doc comment: only ENOENT/ENOTDIR (a genuinely missing agent) becomes
    // `RUN-056`; every other I/O failure "propagates unchanged so it stays retryable". A directory
    // squatting where the agent's own file must be reproduces exactly that: `readTextFile` throws a
    // generic `RUN-034` (EISDIR), not `RUN-056` -- `resolveApprover` must rethrow it as-is, not rewrap it
    // into a `GATE-508` "roster does not recognise" refusal, which would misreport a transient I/O defect
    // as an authorisation decision.
    await mkdir(path.join(project.dir, AGENTS_ROOT, 'dir-not-file.yaml'), { recursive: true });
    await expect(
      gateApprove(
        ctx(project, 'run-1', { runId: 'run-1', stepId: 'design', agentId: 'dir-not-file' }),
        FIXTURE_GATE_ID,
      ),
    ).rejects.toMatchObject({ code: 'RUN-034' });
  });

  it('(g) no marker at all: byte-identical to every gate command run before this piece (the whole surrounding suite already proves this; this is the explicit statement)', async () => {
    const project = await createTestProject();
    const summary = await gateApprove(ctx(project, 'run-g'), FIXTURE_GATE_ID, 'fine');
    expect(summary.approver).toBe('human');
    await gateReject(ctx(project, 'run-g2'), FIXTURE_GATE_ID, 'no');
    const [rejected] = await collectEvents(project, 'run-g2');
    expect(rejected?.payload).toEqual({ gateId: FIXTURE_GATE_ID, reason: 'no' });
  });

  it('gateReject records NO approver field for every marker shape besides a bare run-only marker -- an agent marker, a run id that does not match ctx.runId with an agent, and one without', async () => {
    const project = await createTestProject();
    await writeAgent(project, 'sre', []);

    // A marker naming a real agent for THIS run: `gateReject` makes no authorisation decision at all
    // (unlike `gateApprove`/`gateWaive`), so it must not look like one by recording who -- the identical
    // "records nothing it did not actually decide" contract test (g) already proves for "no marker".
    await gateReject(
      ctx(project, 'run-agent', { runId: 'run-agent', stepId: 'ship', agentId: 'sre' }),
      FIXTURE_GATE_ID,
      'agent marker',
    );
    const [agentEvent] = await collectEvents(project, 'run-agent');
    expect(agentEvent?.payload).toEqual({ gateId: FIXTURE_GATE_ID, reason: 'agent marker' });

    // A marker whose own runId does not match ctx.runId, WITH an agent id: discarded exactly as
    // `gateApprove`/`gateWaive` discard it (test (e)).
    await gateReject(
      ctx(project, 'run-real-1', { runId: 'run-other-1', stepId: 'design', agentId: 'sre' }),
      FIXTURE_GATE_ID,
      'mismatched run + agent',
    );
    const [mismatchAgentEvent] = await collectEvents(project, 'run-real-1');
    expect(mismatchAgentEvent?.payload).toEqual({
      gateId: FIXTURE_GATE_ID,
      reason: 'mismatched run + agent',
    });

    // A marker whose own runId does not match ctx.runId, with NO agent id either (what would otherwise
    // be a bare run-only marker, but for a DIFFERENT run): discarded the identical way.
    await gateReject(
      ctx(project, 'run-real-2', { runId: 'run-other-2', stepId: 'deploy' }),
      FIXTURE_GATE_ID,
      'mismatched run, no agent',
    );
    const [mismatchBareEvent] = await collectEvents(project, 'run-real-2');
    expect(mismatchBareEvent?.payload).toEqual({
      gateId: FIXTURE_GATE_ID,
      reason: 'mismatched run, no agent',
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
      `waived by radwan until ${WAIVER_EXPIRES_AT}: known flaky`,
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
    // The verdict line, the one FAIL line -- and, since PLAN-M14.md P17, a trailing `report: <path>` line
    // naming the real GateReport document this check also wrote.
    expect(text.split('\n')).toHaveLength(3);
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
      expiresAt: WAIVER_EXPIRES_AT,
    });
    expect(report.waiver).toEqual({
      reason: 'known flaky check',
      owner: 'radwan',
      expiresAt: WAIVER_EXPIRES_AT,
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

// `PLAN-M14.md` P16, `SPEC-QUESTIONS.md` Q232 decision 10: `gates.waiverMaxDays` (default 90) and
// `--owner` an identifier.
describe('gateWaive — gates.waiverMaxDays and --owner (PLAN-M14.md P16)', () => {
  it('GATE-512: refuses --expires exactly one millisecond past the cap, naming maxDays, and appends nothing', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    const grantedAt = Date.parse('2026-01-01T00:00:00.000Z');
    const at = (iso: string) => ({ ...ctx(project, 'r-91'), clock: { now: () => iso } as never });
    await expect(
      gateWaive(at(new Date(grantedAt).toISOString()), 'G-Fail', {
        ...WAIVER,
        expiresAt: new Date(grantedAt + 90 * DAY_MS + 1).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'GATE-512', details: { maxDays: 90 } });
    expect(await collectEvents(project, 'r-91')).toEqual([]);
  });

  it('accepts --expires exactly maxDays (90) after grant, and records it', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    const grantedAt = Date.parse('2026-01-01T00:00:00.000Z');
    const at = (iso: string) => ({ ...ctx(project, 'r-90'), clock: { now: () => iso } as never });
    const expiresAt = new Date(grantedAt + 90 * DAY_MS).toISOString();
    await gateWaive(at(new Date(grantedAt).toISOString()), 'G-Fail', { ...WAIVER, expiresAt });
    const events = await collectEvents(project, 'r-90');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'GateWaived', payload: { expiresAt } });
  });

  it('GATE-513: refuses a non-identifier --owner ("the team": a real word, not a single token), and appends nothing', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await expect(
      gateWaive(ctx(project, 'r-owner'), 'G-Fail', { ...WAIVER, owner: 'the team' }),
    ).rejects.toMatchObject({ code: 'GATE-513' });
    expect(await collectEvents(project, 'r-owner')).toEqual([]);
  });

  it('a hand-appended waiver beyond the default cap is skipped by check/approve (GATE-507), and honoured once gates.waiverMaxDays is configured wide enough to cover it', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    const grantedAt = Date.parse('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date(grantedAt + 400 * DAY_MS).toISOString();
    // After grant and before this same expiry (so applyWaiver's own lapse check never fires), but more
    // than 90 (the default cap) and less than 400 days after grant.
    const checkAt = new Date(grantedAt + 200 * DAY_MS).toISOString();
    await appendEvent(project.dir, 'r-400', {
      type: 'GateWaived',
      runId: 'r-400',
      ts: new Date(grantedAt).toISOString(),
      payload: {
        gateId: 'G-Fail',
        reason: 'known flaky',
        owner: 'radwan',
        expiresAt,
        evaluation: {
          passed: false,
          checks: [
            { checkId: 'bad', passed: false },
            { checkId: 'fine', passed: true },
          ],
        },
      },
    });
    const at = (iso: string) => ({ ...ctx(project, 'r-400'), clock: { now: () => iso } as never });

    // Default cap (90 days): the 400-day-out waiver is skipped, exactly as an expired or malformed one.
    const skipped = await gateCheck(at(checkAt), 'G-Fail');
    expect(skipped.waiver).toBeUndefined();
    await expect(gateApprove(at(checkAt), 'G-Fail')).rejects.toMatchObject({ code: 'GATE-507' });

    // A configured cap wide enough to cover it: the identical, unchanged waiver is now honoured.
    await writeConfig(project, { gates: { waiverMaxDays: 400 } });
    const honoured = await gateCheck(at(checkAt), 'G-Fail');
    expect(honoured.waiver).toEqual({ reason: 'known flaky', owner: 'radwan', expiresAt });
    await expect(gateApprove(at(checkAt), 'G-Fail')).resolves.toMatchObject({ basis: 'waiver' });
  });
});

describe('gates.waiverMaxDays config (forge config get/set, PLAN-M14.md P16)', () => {
  it('round-trips through configSet/configGet', async () => {
    const project = await createTestProject();
    await writeConfig(project);
    await configSet({ paths: project.paths }, 'gates.waiverMaxDays', '30');
    expect(await configGet({ paths: project.paths }, 'gates.waiverMaxDays')).toBe(30);
  });

  it('refuses 0 and a non-numeric value, without writing them', async () => {
    const project = await createTestProject();
    await writeConfig(project);
    await expect(
      configSet({ paths: project.paths }, 'gates.waiverMaxDays', '0'),
    ).rejects.toMatchObject({ code: 'CFG-001' });
    await expect(
      configSet({ paths: project.paths }, 'gates.waiverMaxDays', 'x'),
    ).rejects.toMatchObject({ code: 'CFG-001' });
    expect(await configGet({ paths: project.paths }, 'gates.waiverMaxDays')).toBe(90);
  });

  it('a config.yaml written before this piece, with no gates key at all, still loads and gate commands still fall back to the documented default (90)', async () => {
    const project = await createTestProject();
    const withoutGates: Record<string, unknown> = { ...DEFAULT_CONFIG };
    delete withoutGates['gates'];
    await writeFile(path.join(project.dir, CONFIG_REL_PATH), YAML.stringify(withoutGates));
    expect(await configGet({ paths: project.paths }, 'project.name')).toBeDefined();

    await writeGate(project, 'G-Fail', FAILING_GATE);
    await expect(
      gateWaive(ctx(project, 'r-noconf'), 'G-Fail', {
        ...WAIVER,
        expiresAt: new Date(Date.now() + 91 * DAY_MS).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'GATE-512', details: { maxDays: 90 } });
  });

  it('a project with no .forge/config.yaml at all yet still falls back to the documented default (90) -- gate commands do not require forge config set to have run even once', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await expect(
      gateWaive(ctx(project, 'r-nofile'), 'G-Fail', {
        ...WAIVER,
        expiresAt: new Date(Date.now() + 91 * DAY_MS).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'GATE-512', details: { maxDays: 90 } });
  });

  it('a real .forge/config.yaml that is invalid for a reason entirely unrelated to gates surfaces CFG-001 on every failing gate command too (check/approve/waive) -- a new coupling: before this piece, gate commands never read config.yaml at all, so an unrelated config defect never affected any of them', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    await writeFile(path.join(project.dir, CONFIG_REL_PATH), 'version: not-a-number\n');
    // `gateCheck`/`gateApprove` only read config at all once their own gate evaluation has a failing
    // check (`coveringWaiver`'s/`gateApprove`'s own `evaluated.passed` guard) -- `G-Fail` always does.
    await expect(gateCheck(ctx(project, 'r-badconf-check'), 'G-Fail')).rejects.toMatchObject({
      code: 'CFG-001',
    });
    await expect(gateApprove(ctx(project, 'r-badconf-approve'), 'G-Fail')).rejects.toMatchObject({
      code: 'CFG-001',
    });
    await expect(
      gateWaive(ctx(project, 'r-badconf-waive'), 'G-Fail', WAIVER),
    ).rejects.toMatchObject({
      code: 'CFG-001',
    });
  });
});

// `PLAN-M14.md` P17: `forge gate check|approve|waive` write the real `GateReport` artifact
// (`<paths.reports>/gates/<gate>-<ts>.md`), and the digests `GateApproved`/`GateWaived` record verify
// against the fenced text that report file carries.
describe('gate report files (PLAN-M14.md P17)', () => {
  function ctxAt(project: TestProject, runId: string, iso: string): GateCommandContext {
    return { ...ctx(project, runId), clock: { now: () => iso } };
  }

  function gatesDir(project: TestProject): string {
    return path.join(project.dir, 'docs', 'forge', 'reports', 'gates');
  }

  async function readReport(project: TestProject, reportPath: string): Promise<ArtifactDocument> {
    const text = await readFile(path.join(project.dir, reportPath), 'utf8');
    return ArtifactDocument.parse(text, reportPath);
  }

  it('gateCheck writes a real, schema-valid GateReport file under docs/forge/reports/gates/, numbered GATE-001, then GATE-002', async () => {
    const project = await createTestProject();
    const first = await gateCheck(
      ctxAt(project, 'r-1', '2026-03-04T12:00:00.000Z'),
      FIXTURE_GATE_ID,
    );
    expect(first.reportPath).toBe(
      `docs/forge/reports/gates/${FIXTURE_GATE_ID}-2026-03-04T12-00-00.000Z.md`,
    );
    const firstDoc = await readReport(project, first.reportPath);
    expect(firstDoc.frontMatter).toMatchObject({
      id: 'GATE-001',
      type: 'GateReport',
      gate: FIXTURE_GATE_ID,
      outcome: 'passed',
      evaluatedAt: '2026-03-04T12:00:00.000Z',
    });
    expect(validateArtifact(firstDoc)).toEqual({ valid: true });

    const second = await gateCheck(
      ctxAt(project, 'r-1', '2026-03-04T12:05:00.000Z'),
      FIXTURE_GATE_ID,
    );
    expect(second.reportPath).not.toBe(first.reportPath);
    const secondDoc = await readReport(project, second.reportPath);
    expect(secondDoc.frontMatter).toMatchObject({ id: 'GATE-002' });
  });

  it('an existing GATE-007 report already on disk makes the next id GATE-008', async () => {
    const project = await createTestProject();
    await mkdir(gatesDir(project), { recursive: true });
    await writeFile(
      path.join(gatesDir(project), 'G-Old-2020-01-01T00-00-00.000Z.md'),
      [
        '---',
        'id: GATE-007',
        'type: GateReport',
        'schemaVersion: 1',
        'title: an older report',
        'status: passed',
        'created: 2020-01-01',
        'updated: 2020-01-01',
        'revision: 1',
        'author: gatekeeper',
        'changelog: []',
        '---',
        '',
        'an older report, hand-placed',
        '',
      ].join('\n'),
    );
    const report = await gateCheck(ctx(project), FIXTURE_GATE_ID);
    const doc = await readReport(project, report.reportPath);
    expect(doc.frontMatter).toMatchObject({ id: 'GATE-008' });
  });

  it('gateApprove writes the report BEFORE appending GateApproved, whose payload and returned summary both carry the matching reportPath', async () => {
    const project = await createTestProject();
    const summary = await gateApprove(ctx(project, 'r-appr'), FIXTURE_GATE_ID, 'fine');
    expect(summary.reportPath).toMatch(
      new RegExp(`^docs/forge/reports/gates/${FIXTURE_GATE_ID}-.*\\.md$`),
    );
    const [event] = await collectEvents(project, 'r-appr');
    expect(event).toMatchObject({
      type: 'GateApproved',
      payload: { reportPath: summary.reportPath },
    });
    const doc = await readReport(project, summary.reportPath);
    expect(doc.frontMatter).toMatchObject({ outcome: 'passed', gate: FIXTURE_GATE_ID });
  });

  it('a plain file squatting where the gates/ directory itself needs to be created throws a typed RUN-034, and records no GateApproved', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, 'docs', 'forge', 'reports'), { recursive: true });
    await writeFile(
      path.join(project.dir, 'docs', 'forge', 'reports', 'gates'),
      'a plain file squatting the gates/ directory path',
    );
    await expect(
      gateApprove(ctx(project, 'r-squat'), FIXTURE_GATE_ID, 'fine'),
    ).rejects.toMatchObject({
      code: 'RUN-034',
    });
    expect(await collectEvents(project, 'r-squat')).toEqual([]);
  });

  it('gateWaive writes a report with outcome: waived, naming the waived gate', async () => {
    const project = await createTestProject();
    await writeGate(project, 'G-Fail', FAILING_GATE);
    const report = await gateWaive(ctx(project, 'r-wv'), 'G-Fail', WAIVER);
    const doc = await readReport(project, report.reportPath);
    expect(doc.frontMatter).toMatchObject({ outcome: 'waived', gate: 'G-Fail' });
  });

  it("the fenced stdout in the written report is exactly the text whose sha256 the GateApproved event's digest records -- the digests verify against it", async () => {
    const project = await createTestProject();
    // Split across two shell variables (18 chars each, neither half alone `ghp_[A-Za-z0-9]{36}`-shaped)
    // and concatenated only in the command's OWN stdout at run time -- unlike the pre-existing "collapses
    // pretty-printed JSON..." test above (whose secret sits in a `printf` literal this piece's own
    // `renderGateReportFile` now ALSO renders, unredacted, as the check's declared `run:` line, `10` §10.3
    // rule 4's own "the exact command output" being about stdout/stderr, not the project-authored command
    // that produced it), this keeps the full token out of the `run:` text `renderGateReportFile` embeds
    // verbatim, so the assertions below are genuinely about stdout redaction, not a `run:` line artifact.
    const token = `ghp_${'b'.repeat(36)}`;
    await writeGate(
      project,
      'G-Sec2',
      [
        'id: G-Sec2',
        'checks:',
        '  deterministic:',
        '    - id: sec',
        '      run: |',
        `        a="ghp_${'b'.repeat(18)}"`,
        `        b="${'b'.repeat(18)}"`,
        '        printf \'{"errors":0,"token":"%s%s"}\' "$a" "$b"',
        '      failOn: "errors > 0"',
        '',
      ].join('\n'),
    );
    const summary = await gateApprove(ctx(project, 'r-verify'), 'G-Sec2', 'ok');
    const digest = summary.checks[0]?.stdoutSha256;
    expect(digest).toMatch(/^[0-9a-f]{64}$/);

    const text = await readFile(path.join(project.dir, summary.reportPath), 'utf8');
    expect(text).not.toContain(token);
    expect(text).toContain('[REDACTED]');
    const fenced = /```\n([\s\S]*?)\n```/.exec(text)?.[1];
    expect(fenced).toBeDefined();
    expect(fenced).not.toContain(token);
    expect(
      createHash('sha256')
        .update(fenced ?? '', 'utf8')
        .digest('hex'),
    ).toBe(digest);
  });

  it('a relocated paths.reports is followed: the report lands under the configured root, not the default', async () => {
    const project = await createTestProject();
    await writeConfig(project, { paths: { ...DEFAULT_CONFIG.paths, reports: 'custom/reports' } });
    const report = await gateCheck(ctx(project), FIXTURE_GATE_ID);
    expect(report.reportPath.startsWith('custom/reports/gates/')).toBe(true);
    await expect(access(path.join(project.dir, report.reportPath))).resolves.toBeUndefined();
    // the default location was never touched
    await expect(access(gatesDir(project))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('formatGateReport/formatGateApproval append a `report: <path>` line once a report was written', async () => {
    const project = await createTestProject();
    const report = await gateCheck(ctx(project), FIXTURE_GATE_ID);
    expect(formatGateReport(report)).toContain(`report: ${report.reportPath}`);

    const summary = await gateApprove(ctx(project, 'r-fmt'), FIXTURE_GATE_ID, 'fine');
    expect(formatGateApproval(FIXTURE_GATE_ID, summary)).toContain(`report: ${summary.reportPath}`);
  });

  // Mutation evidence the plan's own brief names explicitly: "documentProblems skipped: forced-invalid
  // front matter written." A clock whose `now()` is not a real ISO instant makes `renderGateReportFile`
  // build a document whose own `evaluatedAt`/`created`/`updated` fail `gateReportSchema` -- exactly the
  // shape `documentProblems` exists to catch before anything reaches disk (the identical real-precedent
  // technique `swarm-review-step.test.ts`'s own "a report the engine builds invalid is not written" case
  // uses for `ReviewReport`).
  it('a clock producing a non-ISO instant makes the engine build an invalid GateReport: documentProblems catches it, a typed error propagates, and nothing is written or appended', async () => {
    const project = await createTestProject();
    const badClock = { ...ctx(project, 'r-badclock'), clock: { now: () => 'not-a-real-instant' } };

    await expect(gateApprove(badClock, FIXTURE_GATE_ID, 'fine')).rejects.toThrow(RangeError);
    expect(await collectEvents(project, 'r-badclock')).toEqual([]);
    await expect(access(gatesDir(project))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // The overflow companion to `CFG-010` (`IdAllocator`) and `RUN-109` (`reserveIds`): a hand-placed
  // `GATE-999` (the highest id a 3-digit idWidth allows) must refuse a new id outright, never silently
  // issue a 4-digit one `GATE_REPORT_ID_PATTERN`'s own exact-width group could never read back.
  it('GATE-514: refuses a new id once reports/gates/ already holds GATE-999, and writes nothing', async () => {
    const project = await createTestProject();
    await mkdir(gatesDir(project), { recursive: true });
    await writeFile(
      path.join(gatesDir(project), 'G-Old-2020-01-01T00-00-00.000Z.md'),
      [
        '---',
        'id: GATE-999',
        'type: GateReport',
        'schemaVersion: 1',
        'title: the last id this idWidth allows',
        'status: passed',
        'created: 2020-01-01',
        'updated: 2020-01-01',
        'revision: 1',
        'author: gatekeeper',
        'changelog: []',
        '---',
        '',
        'already at the ceiling',
        '',
      ].join('\n'),
    );
    await expect(gateCheck(ctx(project), FIXTURE_GATE_ID)).rejects.toMatchObject({
      code: 'GATE-514',
      details: { max: 999 },
    });
    // only the hand-placed GATE-999 file is there -- nothing new was written
    expect(await readdir(gatesDir(project))).toEqual(['G-Old-2020-01-01T00-00-00.000Z.md']);
  });
});
