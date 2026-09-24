/**
 * `forge doctor --rebuild-index` — wires `runDoctor({ rebuildIndex: true })` straight through to
 * `@forge/kb`'s own real, already-built `rebuildIndex(tree, backend)` (via `../kb.ts`'s own `kbSync`).
 *
 * @see specs/03 §3.7
 * @see specs/21 E10
 * @see PLAN-M11.md P14
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openKbIndex } from '@forge/kb';

import { runDoctor } from '../../../src/commands/doctor/run-doctor.ts';
import { kbSearch } from '../../../src/commands/kb.ts';
import { writeKbEntryFixture } from '../helpers.ts';
import { KB_ROOT, SPECS_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('runDoctor({ rebuildIndex: true })', () => {
  it('rebuilds a real, current on-disk index from the current KB tree, findable via a real search after', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);

    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
      rebuildIndex: true,
    });
    expect(report.v).toBe(1);

    const hits = await kbSearch(
      { paths: project.paths, kbRoot: KB_ROOT, specsRoot: SPECS_ROOT, level: 'L1', env: {} },
      'Fixture knowledge entry',
    );
    expect(hits.some((hit) => hit.id === 'KB-ARCH-0001')).toBe(true);
  });

  it('restores a working index from a genuinely corrupted on-disk index file', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);

    await mkdir(path.join(project.dir, '.forge/state'), { recursive: true });
    // A genuinely corrupted index — neither a real sqlite database nor valid JSON.
    await writeFile(
      path.join(project.dir, '.forge/state/index.db'),
      'not a real sqlite file at all',
    );
    await writeFile(path.join(project.dir, '.forge/state/index.json'), '{not valid json either');

    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
      rebuildIndex: true,
    });
    expect(report.v).toBe(1);

    const hits = await kbSearch(
      { paths: project.paths, kbRoot: KB_ROOT, specsRoot: SPECS_ROOT, level: 'L1', env: {} },
      'Fixture knowledge entry',
    );
    expect(hits.some((hit) => hit.id === 'KB-ARCH-0001')).toBe(true);

    // A real, working backend opens cleanly afterward too, not merely `kbSearch`'s own internal one.
    const backend = openKbIndex(project.paths);
    try {
      expect(backend.search('Fixture').length).toBeGreaterThan(0);
    } finally {
      backend.close();
    }
  });

  it('degrades a genuinely broken index *storage location* into its own failed check, never throwing out of runDoctor', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);

    // Not a corrupted index *file* (which `openKbIndex` already tolerates gracefully — the case
    // above) but a broken *location*: `.forge/state` occupied by a plain file instead of a directory,
    // the one real case `openKbIndex` itself still throws for (`KB-012`).
    await rm(path.join(project.dir, '.forge/state'), { recursive: true, force: true });
    await writeFile(path.join(project.dir, '.forge/state'), 'not a directory at all');

    const report = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
      rebuildIndex: true,
    });

    expect(report.v).toBe(1);
    const rebuildCheck = report.checks.find((c) => c.id === 'rebuild-index');
    expect(rebuildCheck?.ok).toBe(false);
    expect(rebuildCheck?.severity).toBe('hard');
    expect(report.ok).toBe(false);
    // Every other, unrelated check still ran and reported its own real result.
    expect(report.checks.find((c) => c.id === 'node-version')?.ok).toBe(true);
  });
});
