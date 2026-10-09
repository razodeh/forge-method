/**
 * `runDoctor` — assembling every real check into one real `DoctorReport`, and `03` §3.7's own
 * "exit code 5 if any hard prerequisite fails, 0 with warnings otherwise" contract.
 *
 * @see specs/03 §3.7
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runDoctor } from '../../../src/commands/doctor/run-doctor.ts';
import { KB_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('runDoctor', () => {
  it('reports v:1 and ok:true for a real, clean project — warnings-only never flips ok to false', async () => {
    const project = await createTestProject();
    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
    });
    expect(report.v).toBe(1);
    // No adapter injected is a real, honest `warning` (not `hard`) — a clean project with no adapter
    // still reports `ok: true` overall.
    expect(report.ok).toBe(true);
    expect(report.checks.length).toBeGreaterThan(5);
    expect(report.checks.map((c) => c.id)).toContain('node-version');
  });

  describe('(specs/22 M16 P9)', () => {
    // `10` §10.3 rule 8: "no path that enumerates every gate evaluates it." NOT the same claim as
    // "nothing under `packages/cli/src/commands/doctor/` touches `.forge/checks/` at all" -- that
    // broader claim is false: `run-doctor.ts` itself defines `CHECKS_ROOT = '.forge/checks'` and
    // passes it to `workflowValidateAll` (`../workflow.ts`), which reads that directory to confirm a
    // `kind: gate` step's referenced gate id actually exists (a referential check, over gate ids
    // only). The real, narrower claim this test needs -- confirmed by a project-wide grep with zero
    // hits for `evaluateGate`/`gateCheck`/`gateApprove`/`loadGateRegistry`/`@forge/engine/gates`
    // anywhere under that same directory -- is that nothing in `doctor` ENUMERATES every gate and
    // EVALUATES it (runs any gate's own deterministic checks). So `runDoctor`'s own report is
    // identical whether or not the real, shipped, phase-less `G-Parity.gate.yaml` is present on disk
    // — this is a real run against it present, not an assumption that absence proves tolerance.
    it('is unaffected by the real, shipped, phase-less G-Parity gate file being present on disk', async () => {
      const project = await createTestProject();
      await mkdir(path.join(project.dir, '.forge/checks'), { recursive: true });
      await writeFile(
        path.join(project.dir, '.forge/checks/G-Parity.gate.yaml'),
        await readFile(
          path.join(
            path.dirname(path.dirname(path.dirname(path.dirname(import.meta.dirname)))),
            'templates/templates/checks/G-Parity.gate.yaml',
          ),
          'utf8',
        ),
      );
      const report = await runDoctor({
        paths: project.paths,
        projectRoot: project.dir,
        config: project.config,
        env: {},
        processVersion: process.version,
      });
      expect(report.v).toBe(1);
      expect(report.ok).toBe(true);
      expect(report.checks.map((c) => c.id)).not.toContain('G-Parity');
    });
  });

  it('reports ok:false when a real hard check genuinely fails', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, '.forge/config.yaml'));
    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
    });
    expect(report.ok).toBe(false);
    const configCheck = report.checks.find((c) => c.id === 'config-validity');
    expect(configCheck?.ok).toBe(false);
    expect(configCheck?.severity).toBe('hard');
  });

  it('a real, unsupported process version alone is enough to fail the whole report', async () => {
    const project = await createTestProject();
    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: 'v18.0.0',
    });
    expect(report.ok).toBe(false);
  });

  it('degrades a real check that genuinely throws into its own failed entry, rather than crashing the whole report', async () => {
    // `checkDiagrams` hands raw `source:` text straight to the real Mermaid parser, which genuinely
    // throws (not returns a finding) for unparseable Mermaid — a critic round caught this could take
    // down every other real check's own result via a bare `Promise.all` rejection.
    const project = await createTestProject();
    await mkdir(path.join(project.dir, KB_ROOT, 'architecture/views'), { recursive: true });
    await writeFile(
      path.join(project.dir, KB_ROOT, 'architecture/views/fixture.mmd.yaml'),
      `id: DIAG-001
type: Diagram
schemaVersion: 1
title: Fixture diagram
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
kind: flowchart
notation: mermaid
source: |
  this is not real mermaid syntax at all
generated: false
depicts: []
explains: []
caption: A fixture flowchart.
alt_text: A fixture flowchart from A to B.
owner: architect
`,
    );

    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
    });

    expect(report.ok).toBe(false);
    const diagramsCheck = report.checks.find((c) => c.id === 'diagrams');
    expect(diagramsCheck?.ok).toBe(false);
    expect(diagramsCheck?.severity).toBe('hard');
    expect(diagramsCheck?.message).toContain('crashed');
    // Every other real check still ran and reported its own real result.
    expect(report.checks.find((c) => c.id === 'node-version')?.ok).toBe(true);
    expect(report.checks.length).toBeGreaterThan(10);
  });
});

describe('runDoctor — crashed-check degradation via a second, independent crashing check', () => {
  it('degrades a real, corrupted lock file (invalid JSON) into its own failed entry too', async () => {
    const project = await createTestProject();
    // `readRunLock` does a bare `JSON.parse` with no try/catch of its own — a truncated/corrupted
    // `.forge/state/lock.json` throws a real `SyntaxError` straight out of `checkStaleLock`, the
    // second of the four unguarded-throw checks a critic round flagged.
    await mkdir(path.join(project.dir, '.forge/state'), { recursive: true });
    await writeFile(path.join(project.dir, '.forge/state/lock.json'), '{not valid json');

    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
    });

    const staleLockCheck = report.checks.find((c) => c.id === 'stale-lock');
    expect(staleLockCheck?.ok).toBe(false);
    expect(staleLockCheck?.severity).toBe('hard');
    expect(staleLockCheck?.message).toContain('crashed');
  });
});
