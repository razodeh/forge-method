/**
 * `forge doctor`'s `disclosures` check — `specs/22` M15 P10's own Mandate: "surfaced by `forge
 * doctor` as a count so it cannot rot unseen." `warning`-only: an open disclosure is the Mandate's own
 * stated point (an honest, visible trade-off/gap/exemption/stopped-loop), never a reason to fail a
 * project's build.
 *
 * @see specs/22 M15 P10
 * @see PLAN-M15.md P10
 */
import { afterEach, describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';
import { appendEvent } from '@forge/telemetry/events';

import { appendExemption } from '../../../src/commands/loop/test/exemptions.ts';
import { runDoctor } from '../../../src/commands/doctor/run-doctor.ts';
import { kbDisclose, kbDiscloseResolve } from '../../../src/commands/kb.ts';
import { cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

async function disclosuresCheck(project: TestProject) {
  const report = await runDoctor({
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    env: {},
    processVersion: process.version,
  });
  return { check: report.checks.find((c) => c.id === 'disclosures'), report };
}

describe('doctor disclosures', () => {
  it('passes cleanly ("none open") for a project that has never recorded one', async () => {
    const project = await createTestProject();
    const { check, report } = await disclosuresCheck(project);
    expect(check?.ok).toBe(true);
    expect(check?.severity).toBe('warning');
    expect(check?.message).toContain('none open');
    expect(report.ok).toBe(true);
  });

  it('reports a real, open count once a disclosure is recorded, without failing the overall report', async () => {
    const project = await createTestProject();
    await kbDisclose(
      {
        paths: project.paths,
        kbRoot: project.config.paths.kb,
        specsRoot: '',
        level: 'L1',
        env: {},
      },
      {
        kind: 'trade-off',
        summary: 'coverage is project-wide',
        owner: 'architect',
        sources: [{ kind: 'decision', ref: 'ADR-0011' }],
      },
    );

    const { check, report } = await disclosuresCheck(project);

    expect(check?.ok).toBe(true);
    expect(check?.severity).toBe('warning');
    expect(check?.message).toContain('1 open');
    // A `warning`-severity check never flips the overall report: `03` §3.7's own exit-code contract
    // reads `ok` off `hard` failures only.
    expect(report.ok).toBe(true);
  });

  it('counts a real, currently-in-force exemption too, with no separate Disclosure document written for it', async () => {
    const project = await createTestProject();
    const { appendExemption } = await import('../../../src/commands/loop/test/exemptions.ts');
    const { SYSTEM_CLOCK } = await import('@forge/core');
    await appendExemption(
      project.paths,
      project.config.paths.reports,
      SYSTEM_CLOCK,
      { testId: 'STORY-001: timing-guard', reason: 'r', owner: 'alice', expiry: '2099-01-01' },
      { projectRoot: project.dir, runId: undefined },
    );

    const { check } = await disclosuresCheck(project);

    expect(check?.message).toContain('1 open');
  });

  // `specs/22` M15 P10's own round-1 gauntlet critic reproduced live that a corrupt `kb/disclosures.md`
  // (one real, valid, unresolved row sitting next to one that fails its own schema) made this check
  // silently report "none open" -- `forge doctor`'s own ONE JOB for this piece ("surfaced... so it
  // cannot rot unseen") going silently wrong in exactly the scenario it matters most.
  it('surfaces a real, open disclosure PLUS a visible corrupt-entry note, never silently reporting "none open" when the ledger is only partly readable', async () => {
    const project = await createTestProject();
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(project.paths.resolveWithin(project.config.paths.kb), { recursive: true });
    const text = [
      '---',
      'type: Disclosure',
      'schemaVersion: 1',
      'title: Disclosure register',
      'status: active',
      'created: 2026-09-30',
      'updated: 2026-09-30',
      'revision: 1',
      'author: alice',
      'changelog:',
      '  - revision: 1',
      '    date: 2026-09-30',
      '    by: alice',
      '    summary: seeded for a corruption test',
      'disclosures:',
      '  - id: DISC-001',
      '    kind: trade-off',
      '    summary: a real, valid, unresolved disclosure',
      '    owner: alice',
      '    sources:',
      '      - kind: human',
      '        ref: x',
      '    resolved: false',
      '  - id: DISC-002',
      '    kind: known-gap',
      '    summary: missing its own required owner field',
      '    sources:',
      '      - kind: human',
      '        ref: y',
      '    resolved: false',
      '---',
      '',
    ].join('\n');
    await writeFile(
      project.paths.resolveWithin(`${project.config.paths.kb}/disclosures.md`),
      text,
      'utf8',
    );

    const { check } = await disclosuresCheck(project);

    expect(check?.message).toContain('1 open');
    expect(check?.message).toContain('could not be read');
    // Still never a hard failure on THIS check's own account -- the identical "a warning check never
    // flips the overall report" stance this file's own earlier tests already establish. (The overall
    // `report.ok` is correctly `false` here, but via the pre-existing `kb-lint` check, which genuinely
    // does hard-fail on a schema-invalid KB document -- a separate, already-established signal this
    // test is not about; see `kb-lint`'s own test coverage for that.)
    expect(check?.ok).toBe(true);
    expect(check?.severity).toBe('warning');
  });

  // Nothing in the prior tests exercises all four of the Mandate's own named kinds at once, with one of
  // them already resolved -- the combination that actually proves the count correctly SUMS every live,
  // open source while EXCLUDING a resolved one, not just that each source works in isolation.
  it('correctly sums an open real Disclosure, an in-force exemption, and a synthesized stopped-critic-loop, while excluding an already-resolved real Disclosure', async () => {
    const project = await createTestProject();
    const kbCtx = {
      paths: project.paths,
      kbRoot: project.config.paths.kb,
      specsRoot: '',
      level: 'L1' as const,
      env: {},
    };
    const openId = await kbDisclose(kbCtx, {
      kind: 'trade-off',
      summary: 'an open, real disclosure',
      owner: 'architect',
      sources: [{ kind: 'decision', ref: 'ADR-0011' }],
    });
    const resolvedId = await kbDisclose(kbCtx, {
      kind: 'known-gap',
      summary: 'a gap that has since been closed',
      owner: 'architect',
      sources: [{ kind: 'human', ref: 'x' }],
    });
    await kbDiscloseResolve(kbCtx, {
      id: resolvedId,
      reason: 'fixed in a later piece',
      by: 'architect',
    });
    const { SYSTEM_CLOCK } = await import('@forge/core');
    await appendExemption(
      project.paths,
      project.config.paths.reports,
      SYSTEM_CLOCK,
      {
        testId: 'STORY-001: timing-guard',
        reason: 'a real wall-clock timing guard',
        owner: 'alice',
        expiry: '2099-01-01',
      },
      { projectRoot: project.dir, runId: undefined },
    );
    const cause = new ForgeError('RUN-113', {
      stepId: 'wf:review',
      file: 'x.md',
      rounds: 1,
      count: 1,
    });
    await appendEvent(project.dir, 'run-001', {
      runId: 'run-001',
      ts: '2026-09-30T00:00:00.000Z',
      type: 'StepFailed',
      stepId: 'wf:review',
      payload: { source: 'output', code: 'RUN-113', message: cause.message, cause },
    });

    const { check } = await disclosuresCheck(project);

    // Exactly 3 open: the one real open Disclosure, the in-force exemption, and the synthesized
    // stopped-critic-loop -- the resolved Disclosure must NOT be counted.
    expect(check?.message).toContain('3 open');
    expect(check?.message).not.toContain('4 open');
    expect(check?.ok).toBe(true);
    expect(check?.severity).toBe('warning');
    expect(openId).toMatch(/^DISC-\d{3}$/);
  });
});
