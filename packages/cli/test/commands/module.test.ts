/**
 * `forge module <list|info>` (`add`/`remove`/`update` are real, named refusals).
 */
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  moduleAdd,
  moduleInfo,
  moduleList,
  moduleRemove,
  moduleUpdate,
} from '../../src/commands/module.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

describe('moduleList / moduleInfo', () => {
  it('lists every real, installed module row from the real manifest', async () => {
    const project = await createTestProject();
    const modules = await moduleList({ paths: project.paths, modulesDir: project.modulesDir });
    expect(modules.some((module) => module.id === 'fixture-mod')).toBe(true);
  });

  it('shows real manifest data plus real agent ids for one real module', async () => {
    const project = await createTestProject();
    const info = await moduleInfo(
      { paths: project.paths, modulesDir: project.modulesDir },
      'fixture-mod',
    );
    expect(info.manifest.id).toBe('fixture-mod');
    expect(info.agentIds).toContain('tester');
  });

  it('throws KB-015 for a module id that is not really installed', async () => {
    const project = await createTestProject();
    await expect(
      moduleInfo({ paths: project.paths, modulesDir: project.modulesDir }, 'not-real'),
    ).rejects.toMatchObject({ code: 'KB-015' });
  });

  it('throws CFG-017 when the project has never been initialized (no real manifest)', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, '.forge/manifest.yaml'));
    await expect(
      moduleList({ paths: project.paths, modulesDir: project.modulesDir }),
    ).rejects.toMatchObject({ code: 'CFG-017' });
  });

  it('reports a real, empty module list for a real manifest with no modules field at all', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, '.forge/manifest.yaml'), 'version: 1\n');
    const modules = await moduleList({ paths: project.paths, modulesDir: project.modulesDir });
    expect(modules).toEqual([]);
  });

  it('reports a real, empty agentIds list for the synthetic @forge/templates row', async () => {
    const project = await createTestProject();
    const info = await moduleInfo(
      { paths: project.paths, modulesDir: project.modulesDir },
      '@forge/templates',
    );
    expect(info.agentIds).toEqual([]);
  });
});

describe('moduleAdd / moduleRemove / moduleUpdate', () => {
  it('are real, named refusals — no per-module install/uninstall mechanism exists', () => {
    expect(() => moduleAdd()).toThrow(expect.objectContaining({ code: 'USR-003' }));
    expect(() => moduleRemove()).toThrow(expect.objectContaining({ code: 'USR-003' }));
    expect(() => moduleUpdate()).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });
});
