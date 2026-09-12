/**
 * `findManifestKind` — `19` §19.5 step 2's own "is there a real overlay.yaml/module.yaml here" check.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 */
import { isForgeError } from '@forge/core';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findManifestKind } from '../../src/install/manifest.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-extensions-manifest-'));
  dirs.push(dir);
  return dir;
}

describe('findManifestKind', () => {
  it('returns undefined for a directory with neither manifest file', async () => {
    const dir = await freshDir();
    expect(await findManifestKind(dir)).toBeUndefined();
  });

  it('returns undefined for a directory that does not exist', async () => {
    const dir = await freshDir();
    await rm(dir, { recursive: true, force: true });
    expect(await findManifestKind(dir)).toBeUndefined();
  });

  it('finds a real overlay.yaml', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme\n');
    expect(await findManifestKind(dir)).toBe('overlay');
  });

  it('finds a real module.yaml', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'module.yaml'), 'id: fm-fixture\n');
    expect(await findManifestKind(dir)).toBe('module');
  });

  it('does not mistake a directory named overlay.yaml for a manifest file', async () => {
    const dir = await freshDir();
    await mkdir(path.join(dir, 'overlay.yaml'));
    expect(await findManifestKind(dir)).toBeUndefined();
  });

  it('prefers overlay over module when both are somehow present, deterministically', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme\n');
    await writeFile(path.join(dir, 'module.yaml'), 'id: fm-fixture\n');
    expect(await findManifestKind(dir)).toBe('overlay');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports a permission error as a real ForgeError CFG-028, not as "no manifest here"',
    // POSIX permission bits only, and never as root — see packages/vcs/test/git.test.ts's identical
    // precedent for why.
    async () => {
      const dir = await freshDir();
      const manifestPath = path.join(dir, 'overlay.yaml');
      await writeFile(manifestPath, 'name: acme\n');
      await chmod(dir, 0o000);
      try {
        await findManifestKind(dir);
        expect.unreachable('findManifestKind should have thrown');
      } catch (error) {
        expect(isForgeError(error)).toBe(true);
        if (isForgeError(error)) expect(error.code).toBe('CFG-028');
      } finally {
        await chmod(dir, 0o755);
      }
    },
  );
});
