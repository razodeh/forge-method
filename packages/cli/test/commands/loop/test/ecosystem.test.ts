/**
 * `detectEcosystem` — `PLAN-M8.md` P3's own Checks section.
 *
 * @see specs/09 §9.5
 * @see PLAN-M8.md P3
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { detectEcosystem } from '../../../../src/commands/loop/test/ecosystem.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<{ readonly dir: string; readonly paths: ProjectPaths }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-ecosystem-'));
  dirs.push(dir);
  return { dir, paths: new ProjectPaths(dir) };
}

describe('detectEcosystem', () => {
  it('detects js from a real package.json', async () => {
    const { dir, paths } = await project();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    expect(await detectEcosystem(paths)).toBe('js');
  });

  it('detects python from a real pyproject.toml', async () => {
    const { dir, paths } = await project();
    await writeFile(path.join(dir, 'pyproject.toml'), '[project]\n', 'utf8');
    expect(await detectEcosystem(paths)).toBe('python');
  });

  it('detects python from a real pytest.ini when there is no pyproject.toml', async () => {
    const { dir, paths } = await project();
    await writeFile(path.join(dir, 'pytest.ini'), '[pytest]\n', 'utf8');
    expect(await detectEcosystem(paths)).toBe('python');
  });

  it('detects python from a real setup.cfg', async () => {
    const { dir, paths } = await project();
    await writeFile(path.join(dir, 'setup.cfg'), '[metadata]\n', 'utf8');
    expect(await detectEcosystem(paths)).toBe('python');
  });

  it('prefers js when both a package.json and a pyproject.toml exist', async () => {
    const { dir, paths } = await project();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(path.join(dir, 'pyproject.toml'), '[project]\n', 'utf8');
    expect(await detectEcosystem(paths)).toBe('js');
  });

  it('reports unknown for a project with neither real marker file', async () => {
    const { paths } = await project();
    expect(await detectEcosystem(paths)).toBe('unknown');
  });
});
