/**
 * `probeSourcePaths`/`writeOverlayFile`/`cleanDeclaredOutputs`/`readDeclaredOutputContent` — the
 * overlay-in, clean-around mechanics `13` F-TEST-9's observation bullets require: inputs (and a
 * library surface's own probe) written from bytes the harness already loaded, never re-read from
 * disk; declared outputs cleaned before and after a case so a stale file cannot leak; a symlink in an
 * output path refused rather than followed.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 */
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ForgeError } from '@forge/core/errors';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanDeclaredOutputs,
  probeSourcePaths,
  readDeclaredOutputContent,
  writeOverlayFile,
  writeProbeOverlay,
} from '../../../src/commands/parity/overlay.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-overlay-'));
  dirs.push(dir);
  return dir;
}

describe('probeSourcePaths (specs/22 M16 P3)', () => {
  it('finds a single probe path in a plain run string', () => {
    expect(probeSourcePaths('node .forge/parity/probes/foo.mjs')).toEqual([
      '.forge/parity/probes/foo.mjs',
    ]);
  });

  it('finds no probe path when the run string names an ordinary program', () => {
    expect(probeSourcePaths('pnpm test')).toEqual([]);
  });

  it('finds a quoted probe path containing a space, unquoted', () => {
    expect(probeSourcePaths("node '.forge/parity/probes/with space.mjs'")).toEqual([
      '.forge/parity/probes/with space.mjs',
    ]);
  });

  it('finds every probe-shaped word, not only the first', () => {
    expect(
      probeSourcePaths(
        'node --loader .forge/parity/probes/loader.mjs .forge/parity/probes/foo.mjs',
      ),
    ).toEqual(['.forge/parity/probes/loader.mjs', '.forge/parity/probes/foo.mjs']);
  });

  it('is empty for a malformed/unvettable command rather than throwing', () => {
    expect(probeSourcePaths('echo "$(whoami)"')).toEqual([]);
  });
});

describe('writeOverlayFile (specs/22 M16 P3)', () => {
  it('writes the exact given bytes at the declared destination, creating parent directories, mode 0644 regardless of platform default', async () => {
    const root = await scratchRoot();
    await writeOverlayFile(root, 'nested/dir/input.txt', Buffer.from('hello overlay', 'utf8'));
    const full = path.join(root, 'nested', 'dir', 'input.txt');
    await expect(readFile(full, 'utf8')).resolves.toBe('hello overlay');
    const stats = await lstat(full);
    expect((stats.mode & 0o777).toString(8)).toBe('644');
  });

  it('refuses (RUN-120) when the destination already exists, and never overwrites it', async () => {
    const root = await scratchRoot();
    await mkdir(path.join(root, 'exists-dir'), { recursive: true });
    await writeFile(path.join(root, 'exists-dir', 'already-there.txt'), 'original', 'utf8');
    await expect(
      writeOverlayFile(
        root,
        'exists-dir/already-there.txt',
        Buffer.from('attempted overwrite', 'utf8'),
      ),
    ).rejects.toMatchObject({ code: 'RUN-120' });
    await expect(
      readFile(path.join(root, 'exists-dir', 'already-there.txt'), 'utf8'),
    ).resolves.toBe('original');
  });

  it('a thrown refusal is a real ForgeError, not a bare Error', async () => {
    const root = await scratchRoot();
    await writeFile(path.join(root, 'x.txt'), 'y', 'utf8');
    await expect(writeOverlayFile(root, 'x.txt', Buffer.from('z'))).rejects.toBeInstanceOf(
      ForgeError,
    );
  });

  it('refuses (RUN-125) a destination that passes through an IN-PROJECT symlink, never writing through it to the symlink’s real target -- ProjectPaths.resolveWithin alone does not catch this (it only refuses a target OUTSIDE the project)', async () => {
    const root = await scratchRoot();
    await mkdir(path.join(root, 'safe-dir'), { recursive: true });
    await symlink(path.join(root, 'safe-dir'), path.join(root, 'subdir'));
    await expect(
      writeOverlayFile(root, 'subdir/leaked.txt', Buffer.from('should never land here')),
    ).rejects.toMatchObject({ code: 'RUN-125' });
    await expect(readFile(path.join(root, 'safe-dir', 'leaked.txt'), 'utf8')).rejects.toThrow();
  });
});

describe('writeProbeOverlay (specs/22 M16 P3)', () => {
  it('writes the exact given bytes at the destination, mode 0644, overwriting an existing file rather than refusing it', async () => {
    const root = await scratchRoot();
    await mkdir(path.join(root, '.forge', 'parity', 'probes'), { recursive: true });
    const probePath = path.join(root, '.forge', 'parity', 'probes', 'probe.mjs');
    await writeFile(probePath, 'old bytes', 'utf8');
    await writeProbeOverlay(
      root,
      '.forge/parity/probes/probe.mjs',
      Buffer.from('new reviewed bytes', 'utf8'),
    );
    await expect(readFile(probePath, 'utf8')).resolves.toBe('new reviewed bytes');
    const stats = await lstat(probePath);
    expect((stats.mode & 0o777).toString(8)).toBe('644');
  });

  it('refuses (RUN-125) a destination that passes through an in-project symlink, exactly as writeOverlayFile does', async () => {
    const root = await scratchRoot();
    await mkdir(path.join(root, 'safe-dir'), { recursive: true });
    await symlink(path.join(root, 'safe-dir'), path.join(root, 'subdir'));
    await expect(
      writeProbeOverlay(root, 'subdir/leaked.txt', Buffer.from('should never land here')),
    ).rejects.toMatchObject({ code: 'RUN-125' });
    await expect(readFile(path.join(root, 'safe-dir', 'leaked.txt'), 'utf8')).rejects.toThrow();
  });
});

describe('cleanDeclaredOutputs (specs/22 M16 P3)', () => {
  it('deletes an existing declared output file', async () => {
    const root = await scratchRoot();
    await mkdir(path.join(root, 'out'), { recursive: true });
    await writeFile(path.join(root, 'out', 'result.txt'), 'stale', 'utf8');
    await cleanDeclaredOutputs(root, [{ path: 'out/result.txt' }]);
    await expect(readFile(path.join(root, 'out', 'result.txt'), 'utf8')).rejects.toThrow();
  });

  it('is a no-op when the declared output does not exist at all', async () => {
    const root = await scratchRoot();
    await expect(
      cleanDeclaredOutputs(root, [{ path: 'never-existed.txt' }]),
    ).resolves.toBeUndefined();
  });

  it('the stale-leak scenario: a decoy file at the exact declared path, written before a case that never touches it, must not survive cleaning (the decoy-file test item 4 names)', async () => {
    const root = await scratchRoot();
    await mkdir(path.join(root, 'out'), { recursive: true });
    await writeFile(path.join(root, 'out', 'result.txt'), 'DECOY FROM A PRIOR RUN', 'utf8');
    await cleanDeclaredOutputs(root, [{ path: 'out/result.txt' }]);
    const content = await readDeclaredOutputContent(root, { path: 'out/result.txt' });
    expect(content).toEqual({ mode: 'absent' });
  });

  it('refuses (RUN-125) a declared output path that passes through a symlink, and does not delete through it', async () => {
    const root = await scratchRoot();
    await mkdir(path.join(root, 'real-target'), { recursive: true });
    await writeFile(path.join(root, 'real-target', 'result.txt'), 'protected', 'utf8');
    await symlink(path.join(root, 'real-target'), path.join(root, 'link-dir'));
    await expect(
      cleanDeclaredOutputs(root, [{ path: 'link-dir/result.txt' }]),
    ).rejects.toMatchObject({ code: 'RUN-125' });
    await expect(readFile(path.join(root, 'real-target', 'result.txt'), 'utf8')).resolves.toBe(
      'protected',
    );
  });

  it('cleans every declared output in the list, independently', async () => {
    const root = await scratchRoot();
    await writeFile(path.join(root, 'a.txt'), 'a', 'utf8');
    await writeFile(path.join(root, 'b.txt'), 'b', 'utf8');
    await cleanDeclaredOutputs(root, [{ path: 'a.txt' }, { path: 'b.txt' }]);
    expect(await readDeclaredOutputContent(root, { path: 'a.txt' })).toEqual({ mode: 'absent' });
    expect(await readDeclaredOutputContent(root, { path: 'b.txt' })).toEqual({ mode: 'absent' });
  });
});

describe('readDeclaredOutputContent (specs/22 M16 P3)', () => {
  it('reads the full bytes of a text-mode output', async () => {
    const root = await scratchRoot();
    await writeFile(path.join(root, 'result.txt'), 'the output\n', 'utf8');
    const content = await readDeclaredOutputContent(root, { path: 'result.txt' });
    expect(content).toEqual({
      mode: 'text',
      bytes: Buffer.from('the output\n', 'utf8'),
      text: 'the output\n',
    });
  });

  it('reads only the sha256 of a bytes-mode output, never its content', async () => {
    const root = await scratchRoot();
    const data = Buffer.from([0, 1, 2, 255, 254]);
    await writeFile(path.join(root, 'result.bin'), data);
    const content = await readDeclaredOutputContent(root, { path: 'result.bin', mode: 'bytes' });
    expect(content.mode).toBe('bytes');
    expect(content).not.toHaveProperty('bytes');
    const { createHash } = await import('node:crypto');
    expect((content as { sha256: string }).sha256).toBe(
      createHash('sha256').update(data).digest('hex'),
    );
  });

  it('reports absent, not an error, for a declared output the case never wrote', async () => {
    const root = await scratchRoot();
    const content = await readDeclaredOutputContent(root, { path: 'never-written.txt' });
    expect(content).toEqual({ mode: 'absent' });
  });
});
