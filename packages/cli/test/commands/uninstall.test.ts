/**
 * `forge uninstall` — `03` §3.2.1: remove `.forge/` and (optionally) `docs/forge/`, with a real
 * backup and a `--yes`-gated confirmation.
 *
 * @see specs/03 §3.2.1
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import { uninstall } from '../../src/commands/uninstall.ts';
import { cleanupAll, createTestProject, registerCleanup } from './helpers.ts';

afterEach(cleanupAll);

const FIXED_CLOCK = { now: () => '2026-01-01T00:00:00.000Z' };

describe('uninstall', () => {
  it('refuses to run at all without --yes', async () => {
    const project = await createTestProject();
    await expect(
      uninstall(project.paths, project.dir, { yes: false }),
    ).rejects.toBeInstanceOf(ForgeError);
  });

  it('removes the real .forge/ directory and backs up its real content first', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge'), { recursive: true });
    await writeFile(path.join(project.dir, '.forge', 'config.yaml'), 'project: {}\n');

    const result = await uninstall(project.paths, project.dir, { yes: true, clock: FIXED_CLOCK });
    registerCleanup(result.backupDir);

    expect(existsSync(path.join(project.dir, '.forge'))).toBe(false);
    expect(result.removed).toEqual(['.forge']);
    expect(
      readFileSync(path.join(result.backupDir, '.forge', 'config.yaml'), 'utf8'),
    ).toBe('project: {}\n');
  });

  it('leaves docs/forge/ untouched unless removeDocs is explicitly true', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge'), { recursive: true });
    await mkdir(path.join(project.dir, 'docs', 'forge'), { recursive: true });
    await writeFile(path.join(project.dir, 'docs', 'forge', 'FORGE.md'), '# hi\n');

    const result = await uninstall(project.paths, project.dir, { yes: true, clock: FIXED_CLOCK });
    registerCleanup(result.backupDir);

    expect(existsSync(path.join(project.dir, 'docs', 'forge'))).toBe(true);
    expect(result.removed).toEqual(['.forge']);
  });

  it('also removes and backs up docs/forge/ when removeDocs is true', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge'), { recursive: true });
    await mkdir(path.join(project.dir, 'docs', 'forge'), { recursive: true });
    await writeFile(path.join(project.dir, 'docs', 'forge', 'FORGE.md'), '# hi\n');

    const result = await uninstall(project.paths, project.dir, {
      yes: true,
      removeDocs: true,
      clock: FIXED_CLOCK,
    });
    registerCleanup(result.backupDir);

    expect(existsSync(path.join(project.dir, 'docs', 'forge'))).toBe(false);
    expect([...result.removed].sort()).toEqual(['.forge', 'docs/forge']);
  });

  it('is a real, safe no-op (empty removed list) when there is nothing to remove', async () => {
    const project = await createTestProject();
    const result = await uninstall(project.paths, project.dir, { yes: true, clock: FIXED_CLOCK });
    registerCleanup(result.backupDir);
    expect(result.removed).toEqual([]);
  });

  it('places the backup outside the project root, as its own sibling directory', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge'), { recursive: true });
    const result = await uninstall(project.paths, project.dir, { yes: true, clock: FIXED_CLOCK });
    registerCleanup(result.backupDir);
    expect(path.dirname(result.backupDir)).toBe(path.dirname(project.dir));
  });
});
