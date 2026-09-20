/**
 * The launcher shim (`PLAN-M13.md` P12, `Q208` finding 3): a throwaway directory holding a `forge`
 * executable that re-launches the running CLI, so `forge ...` in a command step resolves to it.
 *
 * @see specs/03 §3.2.4
 */
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  commandEnvFor,
  createLauncherShim,
  createLauncherShimOrWarn,
  currentLauncher,
  launcherScript,
  removeLiveLauncherShims,
  shellQuote,
  type LauncherSpec,
} from '../../../src/commands/run/launcher-shim.ts';

const exec = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => {
  removeLiveLauncherShims();
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-shim-test-'));
  cleanup.push(dir);
  return dir;
}

/** A script that prints its argv and the flags node started it with as JSON. */
async function echoEntry(dir: string, name = 'entry.mjs'): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(
    file,
    'process.stdout.write(JSON.stringify({ args: process.argv.slice(2), flags: process.execArgv }));\n',
  );
  return file;
}

const spec = (entry: string, execArgv: readonly string[] = []): LauncherSpec => ({
  execPath: process.execPath,
  execArgv,
  entry,
  env: { PATH: '/usr/bin:/bin' },
});

async function shimIn(parent: string, launcher: LauncherSpec) {
  return createLauncherShim(launcher, process.platform, () =>
    path.join(parent, 'forge-launcher-under-test'),
  );
}

describe('the launcher script', () => {
  it('single-quotes every value, so a path is data, never shell syntax', () => {
    const text = launcherScript(
      spec(`/tmp/it's a "dir"/$HOME/\`x\`/bin.ts`, ['--flag=a b']),
      'linux',
    );
    expect(text.startsWith('#!/bin/sh\nexec ')).toBe(true);
    expect(text).toContain(shellQuote(`/tmp/it's a "dir"/$HOME/\`x\`/bin.ts`));
    expect(text).toContain(`'--flag=a b'`);
    expect(text.trimEnd().endsWith('"$@"')).toBe(true);
  });

  it('writes a .cmd form for Windows, doubling % and refusing an embedded double quote', () => {
    const text = launcherScript(spec('C:\\a b\\100%\\bin.ts'), 'win32');
    expect(text).toContain('@echo off');
    expect(text).toContain('"C:\\a b\\100%%\\bin.ts"');
    expect(text.trimEnd().endsWith('%*')).toBe(true);
    expect(() => launcherScript(spec('C:\\bad"name\\bin.ts'), 'win32')).toThrow();
  });
});

describe('createLauncherShim', () => {
  it('produces a `forge` executable that replays node, its flags and the entry, then passes the arguments through', async () => {
    const dir = await scratch();
    const entry = await echoEntry(dir);
    const shim = await shimIn(dir, spec(entry, ['--no-warnings']));

    const { stdout } = await exec(path.join(shim.binDir, 'forge'), [
      'kb',
      'sync',
      "with 'quotes' and $VARS and spaces",
      '--json',
    ]);
    expect(JSON.parse(stdout)).toEqual({
      args: ['kb', 'sync', "with 'quotes' and $VARS and spaces", '--json'],
      flags: ['--no-warnings'],
    });
  });

  it('works when the entry path and the launcher directory contain spaces, quotes and dollar signs', async () => {
    const root = await scratch();
    const weird = path.join(root, `it's "odd" $HOME dir`);
    await mkdir(weird);
    const entry = await echoEntry(weird, 'my entry.mjs');
    const shim = await shimIn(weird, spec(entry));
    const { stdout } = await exec(path.join(shim.binDir, 'forge'), ['--version']);
    expect(JSON.parse(stdout)).toEqual({ args: ['--version'], flags: [] });
  });

  it('is found by `forge` on a PATH that lacks any other forge (via the env overlay it hands back)', async () => {
    const dir = await scratch();
    const entry = await echoEntry(dir);
    const shim = await shimIn(dir, spec(entry));
    const { stdout } = await exec('forge', ['--version'], {
      env: { ...shim.commandEnv, LC_ALL: 'C' },
    });
    expect((JSON.parse(stdout) as { args: string[] }).args).toEqual(['--version']);
    expect(shim.commandEnv['PATH']?.startsWith(`${shim.binDir}:`)).toBe(true);
  });

  it('creates a private (0700) directory under the given parent, never inside the project or the repo', async () => {
    const dir = await scratch();
    const shim = await shimIn(dir, spec(await echoEntry(dir)));
    expect(path.dirname(shim.binDir)).toBe(dir);
    if (process.platform !== 'win32') {
      expect(statSync(shim.binDir).mode & 0o777).toBe(0o700);
      expect(statSync(path.join(shim.binDir, 'forge')).mode & 0o111).not.toBe(0);
    }
  });

  it('by default lives in the OS temp directory, not the working directory', async () => {
    const dir = await scratch();
    const shim = await createLauncherShim(spec(await echoEntry(dir)));
    expect(path.dirname(shim.binDir)).toBe(tmpdir());
    expect(path.basename(shim.binDir)).toMatch(/^forge-launcher-[0-9a-f-]{36}$/u);
    await shim.cleanup();
  });

  it('cleanup removes the directory, and is safe to call twice', async () => {
    const dir = await scratch();
    const shim = await shimIn(dir, spec(await echoEntry(dir)));
    expect(existsSync(shim.binDir)).toBe(true);
    await shim.cleanup();
    expect(existsSync(shim.binDir)).toBe(false);
    await expect(shim.cleanup()).resolves.toBeUndefined();
    expect(await readdir(dir)).not.toContain('forge-launcher-under-test');
  });

  it('removeLiveLauncherShims removes every live shim synchronously (the SIGTERM path)', async () => {
    const dir = await scratch();
    const shim = await shimIn(dir, spec(await echoEntry(dir)));
    removeLiveLauncherShims();
    expect(existsSync(shim.binDir)).toBe(false);
  });

  it("refuses to adopt a path that already exists (a squatter's directory) with RUN-086 and leaves it alone", async () => {
    const dir = await scratch();
    const squatted = path.join(dir, 'squatted');
    await mkdir(squatted);
    await writeFile(path.join(squatted, 'forge'), 'attacker');
    const attempt = createLauncherShim(
      spec(await echoEntry(dir)),
      process.platform,
      () => squatted,
    );
    await expect(attempt).rejects.toMatchObject({ code: 'RUN-086' });
    // Not removed either: it was never ours.
    expect(await readFile(path.join(squatted, 'forge'), 'utf8')).toBe('attacker');
  });

  it('throws RUN-086 with a remedy, leaving nothing, when the directory cannot be created', async () => {
    const dir = await scratch();
    const attempt = createLauncherShim(spec(await echoEntry(dir)), process.platform, () =>
      path.join(dir, 'missing-parent', 'child'),
    );
    await expect(attempt).rejects.toMatchObject({ code: 'RUN-086' });
    await expect(attempt).rejects.toSatisfy((e: { remedy: string }) => e.remedy.includes('TMPDIR'));
    expect(await readdir(dir)).toEqual(['entry.mjs']);
  });

  it('throws RUN-086 and cleans up when the launcher script cannot be written for the platform', async () => {
    const dir = await scratch();
    const target = path.join(dir, 'forge-launcher-x');
    const attempt = createLauncherShim(spec('C:\\bad"name\\bin.ts'), 'win32', () => target);
    await expect(attempt).rejects.toMatchObject({ code: 'RUN-086' });
    expect(existsSync(target)).toBe(false);
    // ... and it was never left registered for a signal handler to chase.
    removeLiveLauncherShims();
  });
});

describe('createLauncherShimOrWarn', () => {
  it('turns the failure into a warning naming the cause and the remedy, and returns no shim', async () => {
    const warnings: string[] = [];
    const bad: LauncherSpec = spec('C:\\bad"name\\bin.ts');
    // Force the failure through the real path: an unwritable TMPDIR is the everyday cause.
    const previous = process.env['TMPDIR'];
    process.env['TMPDIR'] = path.join(await scratch(), 'does', 'not', 'exist');
    try {
      const shim = await createLauncherShimOrWarn(bad, (m) => warnings.push(m));
      expect(shim).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = previous;
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^forge: warning: Could not create the launcher/u);
    expect(warnings[0]).toContain('TMPDIR');
  });

  it('does nothing without a launcher spec', async () => {
    expect(await createLauncherShimOrWarn(undefined, undefined)).toBeUndefined();
  });

  it('returns the shim when creation works', async () => {
    const dir = await scratch();
    const shim = await createLauncherShimOrWarn(spec(await echoEntry(dir)), undefined);
    expect(shim?.binDir).toBeDefined();
    await shim?.cleanup();
  });
});

describe('commandEnvFor', () => {
  it('puts the launcher first and keeps the rest of the parent PATH', () => {
    expect(commandEnvFor('/tmp/x', { PATH: '/usr/bin:/bin' }, 'linux')).toEqual({
      PATH: '/tmp/x:/usr/bin:/bin',
    });
  });

  it('is just the launcher when the parent has no PATH, with no dangling delimiter', () => {
    expect(commandEnvFor('C:\\x', {}, 'win32')).toEqual({ Path: 'C:\\x' });
  });

  it('falls back to the usual system directories rather than to the launcher alone, so sh still finds git and node', () => {
    expect(commandEnvFor('/tmp/x', {}, 'linux')).toEqual({
      PATH: '/tmp/x:/usr/local/bin:/usr/bin:/bin',
    });
  });

  it('reuses the spelling `Path` on Windows, so no competing second entry appears', () => {
    expect(commandEnvFor('C:\\x', { Path: 'C:\\Windows' }, 'win32')).toEqual({
      Path: 'C:\\x;C:\\Windows',
    });
  });
});

describe('currentLauncher', () => {
  it('describes the running process, without debugger flags, and carries the given environment', () => {
    const launcher = currentLauncher({ PATH: '/p' });
    expect(launcher?.execPath).toBe(process.execPath);
    expect(launcher?.entry).toBe(path.resolve(process.argv[1] ?? ''));
    expect(launcher?.execArgv.some((flag) => flag.startsWith('--inspect'))).toBe(false);
    expect(launcher?.env).toEqual({ PATH: '/p' });
  });
});
