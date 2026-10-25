/**
 * `resolvePosixShell` — the real POSIX shell `shell.ts`/`confined-command.ts` run engine-authored,
 * POSIX-syntax command strings through on Windows instead of cmd.exe, when one is actually on `PATH`.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolvePosixShell } from '../../src/dispatch/posix-shell.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dir(): Promise<string> {
  const target = await mkdtemp(path.join(tmpdir(), 'forge-posix-shell-'));
  dirs.push(target);
  return target;
}

describe('resolvePosixShell', () => {
  it('is always the OS default (`true`) on every non-Windows platform, whatever PATH holds', () => {
    expect(resolvePosixShell({ PATH: '/usr/bin' }, 'darwin')).toBe(true);
    expect(resolvePosixShell({ PATH: '/usr/bin' }, 'linux')).toBe(true);
  });

  it('on win32, finds a real bash.exe on PATH and returns its full path', async () => {
    const binDir = await dir();
    const bash = path.join(binDir, 'bash.exe');
    await writeFile(bash, '');
    await chmod(bash, 0o755);
    expect(resolvePosixShell({ PATH: binDir }, 'win32')).toBe(bash);
  });

  it('on win32, matches the PATH variable name case-insensitively (Windows commonly spells it "Path")', async () => {
    const binDir = await dir();
    const bash = path.join(binDir, 'bash.exe');
    await writeFile(bash, '');
    expect(resolvePosixShell({ Path: binDir }, 'win32')).toBe(bash);
  });

  it('on win32, searches every PATH directory in order and stops at the first real match', async () => {
    const empty = await dir();
    const binDir = await dir();
    const bash = path.join(binDir, 'bash.exe');
    await writeFile(bash, '');
    const env = { PATH: [empty, binDir].join(path.delimiter) };
    expect(resolvePosixShell(env, 'win32')).toBe(bash);
  });

  it('on win32, falls back to `true` (cmd.exe) when no real POSIX shell is anywhere on PATH', async () => {
    const binDir = await dir();
    await mkdir(path.join(binDir, 'not-a-shell'));
    expect(resolvePosixShell({ PATH: binDir }, 'win32')).toBe(true);
  });

  it('on win32, a DIRECTORY literally named bash.exe on PATH is not "resolved" as a real shell', async () => {
    // An unrelated project's own build output (or anything else) can easily put a directory called
    // `bash.exe` on PATH; `execa` would fail confusingly at spawn time if that were handed to it as
    // `shell`, instead of this function correctly treating "not a real file" the same as "not found".
    const binDir = await dir();
    await mkdir(path.join(binDir, 'bash.exe'));
    expect(resolvePosixShell({ PATH: binDir }, 'win32')).toBe(true);
  });

  it('on win32, falls back to `true` when PATH is missing or empty entirely', () => {
    expect(resolvePosixShell({}, 'win32')).toBe(true);
    expect(resolvePosixShell({ PATH: '' }, 'win32')).toBe(true);
  });

  it('on win32, a stray leading/trailing delimiter in PATH does not resolve the current directory as a shell', () => {
    // An empty PATH segment must never be read as ".": this does not accidentally find a real `bash.exe`
    // that happens to sit in the process's own cwd.
    expect(
      resolvePosixShell({ PATH: `${path.delimiter}C:\\nonexistent${path.delimiter}` }, 'win32'),
    ).toBe(true);
  });
});
