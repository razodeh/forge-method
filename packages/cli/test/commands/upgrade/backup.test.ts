/**
 * `createBackup` — a real `.forge/` copy (excluding `state/`/`backups/` themselves) plus a real
 * `specsRoot` copy, retaining only the last 5 real backups.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { Clock } from '@forge/core';

import { specNew } from '../../../src/commands/spec.ts';
import { createBackup } from '../../../src/commands/upgrade/backup.ts';
import { cleanupAll, createTestProject, SPECS_ROOT } from './helpers.ts';

afterEach(cleanupAll);

function fakeClock(iso: string): Clock {
  return { now: () => iso };
}

describe('createBackup', () => {
  it('copies real .forge content (manifest, workflows, agents) into a real, timestamped backup dir', async () => {
    const project = await createTestProject();
    const relPath = await createBackup(
      project.paths,
      project.dir,
      fakeClock('2026-01-01T00:00:00.000Z'),
      SPECS_ROOT,
    );

    expect(relPath).toBe('.forge/backups/2026-01-01T00-00-00-000Z');
    const manifestExists = await readdir(path.join(project.dir, relPath));
    expect(manifestExists).toContain('manifest.yaml');
    expect(manifestExists).toContain('workflows');
    expect(manifestExists).toContain('agents');
  });

  it('excludes .forge/state and .forge/backups from the real backup', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/state'), { recursive: true });
    await writeFile(path.join(project.dir, '.forge/state/lock.json'), '{}');

    const relPath = await createBackup(
      project.paths,
      project.dir,
      fakeClock('2026-01-01T00:00:00.000Z'),
      SPECS_ROOT,
    );
    const entries = await readdir(path.join(project.dir, relPath));
    expect(entries).not.toContain('state');
    expect(entries).not.toContain('backups');
  });

  it('also backs up the real specsRoot content — the tree applyArtifactMigrations actually mutates', async () => {
    const project = await createTestProject();
    const doc = await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: project.config.paths.kb },
      'Vision',
      'A fixture vision',
    );

    const relPath = await createBackup(
      project.paths,
      project.dir,
      fakeClock('2026-01-01T00:00:00.000Z'),
      SPECS_ROOT,
    );

    const backedUpDoc = await readdir(path.join(project.dir, relPath, path.dirname(doc.path)));
    expect(backedUpDoc).toContain(path.basename(doc.path));
  });

  it('is a real, honest no-op for the specsRoot copy when specsRoot does not exist at all', async () => {
    const project = await createTestProject();
    const relPath = await createBackup(
      project.paths,
      project.dir,
      fakeClock('2026-01-01T00:00:00.000Z'),
      'docs/forge/specs-that-do-not-exist',
    );
    // Never throws, and the real .forge/ half of the backup still happened.
    const entries = await readdir(path.join(project.dir, relPath));
    expect(entries).toContain('manifest.yaml');
  });

  it('retains only the real last 5 backups, oldest pruned first', async () => {
    const project = await createTestProject();
    const timestamps = [
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
      '2026-01-05T00:00:00.000Z',
      '2026-01-06T00:00:00.000Z',
    ];
    for (const timestamp of timestamps) {
      await createBackup(project.paths, project.dir, fakeClock(timestamp), SPECS_ROOT);
    }

    const backupsDir = path.join(project.dir, '.forge/backups');
    const entries = (await readdir(backupsDir)).sort();
    expect(entries).toHaveLength(5);
    expect(entries).not.toContain('2026-01-01T00-00-00-000Z');
    expect(entries).toContain('2026-01-06T00-00-00-000Z');
  });
});
