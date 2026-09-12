/**
 * `fetchLocalOverlay` — `19` §19.5's local-path channel. `PLAN-M11.md` P1's own literal Checks: a
 * real local directory round-trips; an invalid local directory (no manifest file) is refused with a
 * named error; checksums are deterministic and stable across two fetches of the identical content.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 */
import { isForgeError } from '@forge/core';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { fetchLocalOverlay } from '../../src/install/fetch-local.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-extensions-fetch-local-'));
  dirs.push(dir);
  return dir;
}

async function expectForgeError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable('fetchLocalOverlay should have thrown');
  } catch (error) {
    expect(isForgeError(error)).toBe(true);
    if (isForgeError(error)) expect(error.code).toBe(code);
  }
}

describe('fetchLocalOverlay', () => {
  it('round-trips a real local directory containing overlay.yaml', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme-standards\nversion: 1.0.0\n');

    const result = await fetchLocalOverlay(dir);

    expect(result.path).toBe(path.resolve(dir));
    expect(result.manifestKind).toBe('overlay');
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('round-trips a real local directory containing module.yaml', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'module.yaml'), 'id: fm-fixture\nversion: 1.0.0\n');

    const result = await fetchLocalOverlay(dir);

    expect(result.manifestKind).toBe('module');
  });

  it('refuses a directory with no manifest file, named CFG-027', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'README.md'), 'not a manifest\n');

    await expectForgeError(fetchLocalOverlay(dir), 'CFG-027');
  });

  it('refuses a path that does not exist, named CFG-026', async () => {
    const dir = await freshDir();
    await rm(dir, { recursive: true, force: true });

    await expectForgeError(fetchLocalOverlay(dir), 'CFG-026');
  });

  it('refuses a path that is a file, not a directory, named CFG-026', async () => {
    const dir = await freshDir();
    const filePath = path.join(dir, 'not-a-directory.txt');
    await writeFile(filePath, 'hello\n');

    await expectForgeError(fetchLocalOverlay(filePath), 'CFG-026');
  });

  it('produces a deterministic checksum, stable across two fetches of identical content', async () => {
    const dirA = await freshDir();
    const dirB = await freshDir();
    await writeFile(path.join(dirA, 'overlay.yaml'), 'name: acme-standards\nversion: 1.0.0\n');
    await writeFile(path.join(dirB, 'overlay.yaml'), 'name: acme-standards\nversion: 1.0.0\n');

    const resultA = await fetchLocalOverlay(dirA);
    const resultB = await fetchLocalOverlay(dirB);

    expect(resultA.checksum).toBe(resultB.checksum);
  });

  it('changes the checksum when the manifest content changes', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme-standards\nversion: 1.0.0\n');
    const before = await fetchLocalOverlay(dir);
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme-standards\nversion: 2.0.0\n');
    const after = await fetchLocalOverlay(dir);

    expect(before.checksum).not.toBe(after.checksum);
  });

  it('wraps a checksum-phase failure (a symlink in the source directory) as a ForgeError VCS-009, not a raw VcsError', async () => {
    const dir = await freshDir();
    await writeFile(path.join(dir, 'overlay.yaml'), 'name: acme-standards\nversion: 1.0.0\n');
    await symlink('/etc/hosts', path.join(dir, 'escape-link'));

    await expectForgeError(fetchLocalOverlay(dir), 'VCS-009');
  });
});
