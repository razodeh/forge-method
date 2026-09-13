/**
 * `forge audit` — `20` §20.9's own consolidated audit report, `PLAN-M11.md` P13's own Checks section
 * verbatim: a fixture run producing at least one real event in every real audit category is fully and
 * correctly reported by both output modes; `--since` correctly excludes events before the cutoff.
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, type NewForgeEvent } from '@forge/telemetry/events';

import { auditReport, formatAuditReport } from '../../src/commands/audit.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

/** Permission-based failures behave differently for root (bypasses permission checks entirely) and on
 * Windows (no POSIX permission bits) — the identical guard `@forge/telemetry`'s own
 * `packages/telemetry/test/events.test.ts` already uses for the same reason. */
const canTestPermissionFailures = process.platform !== 'win32' && process.getuid?.() !== 0;

function ev(overrides: Partial<NewForgeEvent> = {}): NewForgeEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    type: 'RunStarted',
    payload: {},
    ...overrides,
  };
}

describe('auditReport', () => {
  it('reports every real category at zero for a project with no runs at all', async () => {
    const project = await createTestProject();
    const report = await auditReport({ projectRoot: project.dir });
    expect(report.v).toBe(1);
    expect(report.since).toBeNull();
    expect(report.entries).toEqual([]);
    expect(report.counts['gate-decision']).toBe(0);
    expect(report.counts['destructive-confirmation']).toBe(0);
    expect(report.counts['mcp-call']).toBe(0);
    expect(report.unreadableRuns).toEqual([]);
  });

  it("commits to this command's own first-release v1 schema: exactly these top-level and counts keys, no more, no fewer", async () => {
    const project = await createTestProject();
    const report = await auditReport({ projectRoot: project.dir });

    expect(Object.keys(report).sort()).toEqual(
      ['v', 'since', 'counts', 'entries', 'unreadableRuns'].sort(),
    );
    expect(Object.keys(report.counts).sort()).toEqual(
      [
        'gate-decision',
        'ceiling-escalation',
        'policy-violation',
        'blocked-injection',
        'redacted-secret',
        'destructive-confirmation',
        'mcp-call',
        'artifact-write',
      ].sort(),
    );
  });

  it('reports at least one real entry in every real audit category present in the fixture run', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'GateApproved', stepId: 'gate-1', payload: { owner: 'alice' } }),
    );
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'GateRejected', stepId: 'gate-2', payload: { reason: 'no' } }),
    );
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'EscalationActive', stepId: 'step-1', payload: { approver: 'carol' } }),
    );
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'PolicyViolation', stepId: 'step-2', payload: {} }),
    );
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'InjectionAttemptBlocked', stepId: 'step-3', payload: {} }),
    );
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'SecretRedacted', stepId: 'step-4', payload: {} }),
    );
    await appendEvent(
      project.dir,
      'run-1',
      ev({
        type: 'ArtifactCreated',
        stepId: 'step-5',
        agentId: 'engineer',
        payload: { path: 'docs/forge/kb/x.md' },
      }),
    );

    const report = await auditReport({ projectRoot: project.dir });
    expect(report.counts['gate-decision']).toBe(2);
    expect(report.counts['ceiling-escalation']).toBe(1);
    expect(report.counts['policy-violation']).toBe(1);
    expect(report.counts['blocked-injection']).toBe(1);
    expect(report.counts['redacted-secret']).toBe(1);
    expect(report.counts['artifact-write']).toBe(1);
    expect(report.counts['destructive-confirmation']).toBe(0);
    expect(report.counts['mcp-call']).toBe(0);
    expect(report.entries.length).toBe(7);
  });

  it('--since excludes events before the cutoff and round-trips into the JSON report', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'PolicyViolation', ts: '2026-01-01T00:00:00.000Z', stepId: 'early' }),
    );
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'PolicyViolation', ts: '2026-02-01T00:00:00.000Z', stepId: 'late' }),
    );

    const report = await auditReport({ projectRoot: project.dir }, { since: '2026-01-15' });
    expect(report.since).toBe(new Date('2026-01-15').toISOString());
    expect(report.entries.map((entry) => entry.stepId)).toEqual(['late']);
    expect(report.counts['policy-violation']).toBe(1);

    // The stable v1 JSON contract round-trips through JSON.stringify/parse with no loss.
    const roundTripped = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(roundTripped).toEqual(report);
  });

  it('rejects an unparseable --since value with a real, registered USR-002 rather than silently applying no cutoff', async () => {
    const project = await createTestProject();
    await expect(
      auditReport({ projectRoot: project.dir }, { since: 'not-a-date' }),
    ).rejects.toMatchObject({ code: 'USR-002', details: { flag: '--since', value: 'not-a-date' } });
  });

  it('rejects a non-ISO-8601 --since value that new Date() would otherwise silently accept as host-locale/timezone-dependent, with USR-002', async () => {
    const project = await createTestProject();
    // `new Date('01/15/2026')` and `new Date('2026-01-15T00:00:00')` (no "Z"/offset) are both
    // successfully parsed by a bare `new Date(...)` but are locale/timezone-dependent per ECMA-262 —
    // `QUALITY-BAR.md` R10 forbids exactly this kind of host-dependent behaviour reaching a stable
    // `--json` contract.
    await expect(
      auditReport({ projectRoot: project.dir }, { since: '01/15/2026' }),
    ).rejects.toMatchObject({ code: 'USR-002' });
    await expect(
      auditReport({ projectRoot: project.dir }, { since: '2026-01-15T00:00:00' }),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('accepts a bare ISO-8601 date and a full ISO-8601 date-time with an explicit offset', async () => {
    const project = await createTestProject();
    const bareDate = await auditReport({ projectRoot: project.dir }, { since: '2026-01-15' });
    expect(bareDate.since).toBe('2026-01-15T00:00:00.000Z');
    const withOffset = await auditReport(
      { projectRoot: project.dir },
      { since: '2026-01-15T00:00:00+02:00' },
    );
    expect(withOffset.since).toBe('2026-01-14T22:00:00.000Z');
  });

  it('a corrupted run is reported in unreadableRuns rather than aborting the whole report', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-good',
      ev({ runId: 'run-good', type: 'PolicyViolation', stepId: 'pv' }),
    );
    const corruptRunDir = path.join(project.dir, '.forge', 'state', 'runs', 'run-corrupt');
    await mkdir(corruptRunDir, { recursive: true });
    await writeFile(path.join(corruptRunDir, 'events.ndjson'), 'not valid json\n');

    const report = await auditReport({ projectRoot: project.dir });
    expect(report.entries.map((entry) => entry.runId)).toEqual(['run-good']);
    expect(report.unreadableRuns.length).toBe(1);
    expect(report.unreadableRuns[0]?.runId).toBe('run-corrupt');

    const text = formatAuditReport(report);
    expect(text).toContain('Unreadable runs (1)');
    expect(text).toContain('run-corrupt');
  });

  // `canTestPermissionFailures` (top of file): chmod 0o000 has no Windows ACL equivalent, and root
  // ignores POSIX permission bits entirely, so neither platform would exercise the real
  // permission-denial failure this test targets — see `packages/vcs/test/git.test.ts`'s identical
  // precedent for the same class of mechanism.
  it.skipIf(!canTestPermissionFailures)(
    'wraps a genuine TelemetryError escaping queryAuditEvents (e.g. an unreadable runs/ directory itself) into a real, registered RUN-076, not a raw TelemetryError',
    async () => {
      const project = await createTestProject();
      const runsDir = path.join(project.dir, '.forge', 'state', 'runs');
      await mkdir(runsDir, { recursive: true });
      await chmod(runsDir, 0o000);

      let caught: unknown;
      try {
        await auditReport({ projectRoot: project.dir });
      } catch (error) {
        caught = error;
      } finally {
        await chmod(runsDir, 0o700);
      }

      expect(caught).toMatchObject({ code: 'RUN-076' });
    },
  );

  it('a categories filter narrows both the report entries and its own counts', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', ev({ type: 'PolicyViolation', stepId: 'pv' }));
    await appendEvent(project.dir, 'run-1', ev({ type: 'SecretRedacted', stepId: 'sr' }));

    const report = await auditReport(
      { projectRoot: project.dir },
      { categories: ['policy-violation'] },
    );
    expect(report.entries.map((entry) => entry.stepId)).toEqual(['pv']);
    expect(report.counts['policy-violation']).toBe(1);
    expect(report.counts['redacted-secret']).toBe(0);
  });
});

describe('formatAuditReport', () => {
  it('renders every real category, including the two with zero entries, in a stable human-readable report', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'PolicyViolation', stepId: 'pv-1', payload: { policy: 'network:none' } }),
    );

    const report = await auditReport({ projectRoot: project.dir });
    const text = formatAuditReport(report);

    expect(text).toContain('Policy violations (1)');
    expect(text).toContain('pv-1');
    expect(text).toContain('Destructive-operation confirmations (0)');
    expect(text).toContain('MCP calls (0)');
    expect(text).toContain('(none recorded)');
    expect(text).toContain('forge audit — every recorded event, all time');
  });

  it('truncates a pathologically large payload in the human-readable report, but never in the JSON report', async () => {
    const project = await createTestProject();
    const hugeValue = 'x'.repeat(5000);
    await appendEvent(
      project.dir,
      'run-1',
      ev({ type: 'PolicyViolation', stepId: 'huge', payload: { blob: hugeValue } }),
    );

    const report = await auditReport({ projectRoot: project.dir });
    // The JSON report — this command's own stable contract — never loses data.
    expect((report.entries[0]?.payload as { blob: string }).blob).toBe(hugeValue);

    const text = formatAuditReport(report);
    expect(text).toContain('truncated for display');
    expect(text.length).toBeLessThan(hugeValue.length);
  });

  it('names the real --since cutoff in the human-readable header when one was given', async () => {
    const project = await createTestProject();
    const report = await auditReport(
      { projectRoot: project.dir },
      { since: '2026-01-01T00:00:00.000Z' },
    );
    expect(formatAuditReport(report)).toContain('since 2026-01-01T00:00:00.000Z');
  });
});
