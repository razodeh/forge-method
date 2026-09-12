/**
 * `21` E10's own literal acceptance test: "`corrupt-state/` is diagnosed; `--fix` and `--rebuild-index`
 * restore a working project." Built as a real, programmatically-constructed corrupt project (this
 * doctor test suite's own established convention — every sibling test file in this directory builds
 * its own fixture state on top of `createTestProject` rather than a static, checked-in fixture
 * directory; see `SPEC-QUESTIONS.md` for the record of reading E10's "fixture project" this way),
 * carrying all three real corruptions E10 names at once: a stale project lock (a dead pid),
 * a genuinely corrupted on-disk search index, and an orphaned lane worktree.
 *
 * @see specs/21 E10
 * @see PLAN-M11.md P14
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { runDoctor } from '../../../src/commands/doctor/run-doctor.ts';
import { kbSearch } from '../../../src/commands/kb.ts';
import { acquireRunLock } from '../../../src/commands/run/lock.ts';
import { KB_ROOT, SPECS_ROOT, cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

/** A real, schema-valid, *lint-clean* KB entry — deliberately not the shared `writeKbEntryFixture`
 * from `../helpers.ts`, whose own `sources: [{ ref: ADR-0001 }]` names an ADR this project never
 * creates, a real dangling-reference `kb-lint` finding unrelated to anything this test means to
 * exercise (`21` E10's own three named corruptions, not a fourth this fixture would otherwise add by
 * accident). Written directly at the KB root (`KB_ROOT/KB-ARCH-0001.md`, not nested under
 * `architecture/`) so `kb:orphan`'s own "no inbound link and not in a root section" rule does not fire
 * either — the identical, deliberate root-section exemption `checkOrphans` (`@forge/kb/lint`) already
 * gives every top-level KB document. */
async function writeCleanKbEntryFixture(project: TestProject): Promise<void> {
  const relPath = `${KB_ROOT}/KB-ARCH-0001.md`;
  await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
  await writeFile(
    path.join(project.dir, relPath),
    `---
id: KB-ARCH-0001
type: knowledge
section: architecture
title: Fixture knowledge entry
status: active
confidence: verified
owner: architect
sources:
  - kind: human
    ref: architect
created: 2026-01-01
updated: 2026-01-01
review_by: 2027-06-01
supersedes: []
superseded_by: null
related: []
diagrams: []
tags: []
applies_to: []
---

## Verification

Confirmed directly against the real system.
`,
  );
}

async function spawnDeadPid(): Promise<number> {
  const child = spawn('node', ['-e', 'process.exit(0)']);
  const pid = child.pid;
  if (pid === undefined) throw new Error('child process failed to spawn (no pid)');
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
}

/** Builds the real `corrupt-state/` project E10 describes: a real git repo with a real, valid config/
 * manifest (so nothing *else* is wrong), plus all three named real corruptions layered on top. */
async function createCorruptStateProject() {
  const project = await createTestProject();
  await writeCleanKbEntryFixture(project);

  // 1. A stale project lock, naming a real, now-dead pid.
  const deadPid = await spawnDeadPid();
  await acquireRunLock(project.paths, {
    pid: deadPid,
    host: 'corrupt-state-host',
    runId: 'corrupt-state-run',
    startedAt: '2026-01-01T00:00:00.000Z',
  });

  // 2. A corrupted on-disk search index — neither a real sqlite database nor valid JSON.
  await mkdir(path.join(project.dir, '.forge/state'), { recursive: true });
  await writeFile(path.join(project.dir, '.forge/state/index.db'), 'not a real sqlite file at all');
  await writeFile(path.join(project.dir, '.forge/state/index.json'), '{not valid json either');

  // 3. An orphaned lane worktree — a real, forge-namespaced worktree `forge doctor` has no live run's
  //    own lane registry to exclude against, so it is genuinely orphaned from a standalone invocation's
  //    point of view.
  await execa(
    'git',
    ['worktree', 'add', '-b', 'forge/run-1/implement-abcd1234', '.forge/state/worktrees/orphan'],
    { cwd: project.dir },
  );

  return project;
}

describe('corrupt-state/ (21 E10)', () => {
  it('is diagnosed accurately by a plain `forge doctor` run', async () => {
    const project = await createCorruptStateProject();

    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
    });

    expect(report.checks.find((c) => c.id === 'stale-lock')?.ok).toBe(false);
    expect(report.checks.find((c) => c.id === 'orphaned-worktrees')?.ok).toBe(false);
    // Nothing that should have stayed healthy was accidentally flagged too.
    expect(report.checks.find((c) => c.id === 'config-validity')?.ok).toBe(true);
    expect(report.checks.find((c) => c.id === 'manifest-structure')?.ok).toBe(true);
  });

  it('`--fix` plus `--rebuild-index` genuinely restore a working project, confirmed by a plain re-run', async () => {
    const project = await createCorruptStateProject();

    const restored = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
      fix: true,
      rebuildIndex: true,
    });

    // Both real fixes were genuinely applied, not merely attempted.
    expect(restored.fixes?.find((f) => f.id === 'stale-lock')?.applied).toBe(true);
    expect(restored.fixes?.find((f) => f.id === 'orphaned-worktrees')?.applied).toBe(true);

    // Re-running plain `forge doctor` afterward confirms the restoration is real and durable, not an
    // artifact of the single in-memory report `--fix` itself returned.
    const after = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
    });
    for (const id of [
      'stale-lock',
      'orphaned-worktrees',
      'config-validity',
      'manifest-structure',
      'kb-lint',
      'spec-graph',
      'diagrams',
      'secret-references',
    ]) {
      expect(after.checks.find((c) => c.id === id)?.ok, `${id} should be ok after restoration`).toBe(
        true,
      );
    }
    // `dangling-lane-branches` is the one deliberate exception: `--fix` never auto-deletes a lane
    // branch (real, possibly-unmerged commits — see `fix.ts`'s own doc comment), so the orphaned
    // worktree's own branch is now, correctly, reported as newly dangling rather than silently
    // destroyed. This is honest, expected behaviour, not a restoration gap `--fix` failed to close.
    expect(after.checks.find((c) => c.id === 'dangling-lane-branches')?.ok).toBe(false);
    // Every real *hard* prerequisite is satisfied — `report.ok` reads only off `severity: 'hard'`
    // failures (`DoctorReport`'s own contract), and a dangling branch is `warning`, not `hard`.
    expect(after.ok).toBe(true);

    // The search index is a real, working index again too — not merely reported clean.
    const hits = await kbSearch(
      { paths: project.paths, kbRoot: KB_ROOT, specsRoot: SPECS_ROOT, level: 'L1' },
      'Fixture knowledge entry',
    );
    expect(hits.some((hit) => hit.id === 'KB-ARCH-0001')).toBe(true);
  });
});
