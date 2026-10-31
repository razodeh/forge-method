/**
 * The launcher shim (`PLAN-M13.md` P12, `Q208` finding 3): a throwaway directory holding a `forge`
 * executable that re-launches the running CLI, so `forge ...` in a command step resolves to it.
 *
 * @see specs/03 §3.2.4
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Clock } from '@forge/core';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  commandEnvFor,
  createLauncherShim,
  createLauncherShimOrWarn,
  currentLauncher,
  definedLauncherEnv,
  launcherScript,
  removeLiveLauncherShims,
  shellQuote,
  sweepOrphanedLauncherShims,
  type LauncherSpec,
} from '../../../src/commands/run/launcher-shim.ts';

/** A real, genuinely-dead pid — spawned then confirmed exited — standing in for a shim whose own
 * owning `forge` process has since died, the identical technique `lock.test.ts`'s own `realDeadPid`
 * already establishes for this exact anomaly-injection shape (see that file's doc comment for why a
 * real, once-live pid, never a fabricated number, keeps this honest). */
async function realDeadPid(): Promise<number> {
  const child = spawn('node', ['-e', 'process.exit(0)']);
  const pid = child.pid;
  if (pid === undefined) throw new Error('child process has no pid');
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
}

/** A fixed `Clock` for deterministic age-threshold tests — real wall-clock time would make "is this
 * directory old enough to sweep" flaky by construction. */
function fixedClock(iso: string): Clock {
  return { now: () => iso };
}

/** Well past `ORPHANED_SHIM_MIN_AGE_MS` (24h) — a critic round found the original 25h-future clock
 * this file used was never actually exercising the "regardless of age" claim on two separate
 * existing tests (a live owner, and a non-directory entry), since neither test's own directory was
 * ever made old *and* the sweep ALSO run with a young clock to contrast against. Named for reuse
 * across every test that needs to prove "this survives even when the sweep believes a lot of time
 * has passed," not just "this survives right now." */
function farFutureClock(): Clock {
  return fixedClock(new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString());
}

/** Redirects wherever `systemTempRoot()`/`os.tmpdir()` resolves to `root`, on every platform node's
 * own `tmpdir()` actually reads from (`TMPDIR` on POSIX; `TEMP` then `TMP` on win32 — a critic round
 * confirmed live, by printing node's own `tmpdir()` source, that setting `TMPDIR` alone leaves a
 * Windows run still scanning the real `%TEMP%`, never reaching anything under `root`). Restores
 * every one of the three to its own prior value (`undefined` deleted, not set to the literal string
 * `"undefined"`) when `run` finishes, success or failure. */
function restoreEnvVar(name: 'TMPDIR' | 'TEMP' | 'TMP', previous: string | undefined): void {
  if (previous === undefined) {
    if (name === 'TMPDIR') delete process.env['TMPDIR'];
    else if (name === 'TEMP') delete process.env['TEMP'];
    else delete process.env['TMP'];
  } else {
    process.env[name] = previous;
  }
}

async function withRedirectedTempRoot<T>(root: string, run: () => Promise<T>): Promise<T> {
  const previousTmpdir = process.env['TMPDIR'];
  const previousTemp = process.env['TEMP'];
  const previousTmp = process.env['TMP'];
  process.env['TMPDIR'] = root;
  process.env['TEMP'] = root;
  process.env['TMP'] = root;
  try {
    return await run();
  } finally {
    restoreEnvVar('TMPDIR', previousTmpdir);
    restoreEnvVar('TEMP', previousTemp);
    restoreEnvVar('TMP', previousTmp);
  }
}

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

  it('sweeps an orphaned shim from a prior, now-dead run before creating its own (Q383, owner-directed)', async () => {
    const root = await scratch();
    const orphan = path.join(root, 'forge-launcher-orphan');
    await mkdir(orphan, { mode: 0o700 });
    await writeFile(path.join(orphan, 'owner.pid'), String(await realDeadPid()), 'utf8');
    await withRedirectedTempRoot(root, async () => {
      const shim = await createLauncherShimOrWarn(spec(await echoEntry(root)), undefined);
      expect(existsSync(orphan), 'the dead-owner shim must be swept').toBe(false);
      await shim?.cleanup();
    });
  });
});

describe('sweepOrphanedLauncherShims', () => {
  async function orphanCandidate(
    root: string,
    name = 'forge-launcher-under-test',
  ): Promise<string> {
    const dir = path.join(root, name);
    await mkdir(dir, { mode: 0o700 });
    return dir;
  }

  it('removes a forge-launcher-* directory whose owner.pid names a real, now-dead pid', async () => {
    const root = await scratch();
    const dir = await orphanCandidate(root);
    await writeFile(path.join(dir, 'owner.pid'), String(await realDeadPid()), 'utf8');
    await sweepOrphanedLauncherShims(root);
    expect(existsSync(dir)).toBe(false);
  });

  it('leaves a forge-launcher-* directory alone when owner.pid names a real, still-alive pid, EVEN once it is well past the age threshold', async () => {
    const root = await scratch();
    const dir = await orphanCandidate(root);
    await writeFile(path.join(dir, 'owner.pid'), String(process.pid), 'utf8');
    // A mutation-testing round found the original version of this test proved nothing: it never
    // actually made the directory old, so a regression that dropped the "a live owner wins
    // regardless of age" rule entirely (falling through to the age check unconditionally) still
    // passed every test here. The far-future clock is what actually exercises that rule.
    await sweepOrphanedLauncherShims(root, farFutureClock());
    expect(
      existsSync(dir),
      'a live owner must survive the sweep, however old the directory is',
    ).toBe(true);
  });

  it('leaves a forge-launcher-* directory with no owner.pid alone while it is still young (a sibling may be mid-creation)', async () => {
    const root = await scratch();
    const dir = await orphanCandidate(root);
    const justCreated = fixedClock(new Date().toISOString());
    await sweepOrphanedLauncherShims(root, justCreated);
    expect(existsSync(dir)).toBe(true);
  });

  it('removes a forge-launcher-* directory with no owner.pid once it is old enough', async () => {
    const root = await scratch();
    const dir = await orphanCandidate(root);
    await sweepOrphanedLauncherShims(root, farFutureClock());
    expect(existsSync(dir)).toBe(false);
  });

  it('treats a malformed owner.pid ("", "-1", out-of-range, non-numeric) as no marker at all, never as "alive forever"', async () => {
    const root = await scratch();
    for (const [index, garbage] of [
      '',
      '   ',
      '-1',
      '0',
      '99999999999',
      '1e21',
      'nope',
    ].entries()) {
      const dir = await orphanCandidate(root, `forge-launcher-garbage-${String(index)}`);
      await writeFile(path.join(dir, 'owner.pid'), garbage, 'utf8');
      // Young clock: survives, exactly like a genuinely missing marker would (never deleted on sight).
      await sweepOrphanedLauncherShims(root, fixedClock(new Date().toISOString()));
      expect(existsSync(dir), `"${garbage}" must not be read as a live pid`).toBe(true);
      // Far-future clock: swept, exactly like a genuinely missing-and-old marker would (never kept
      // "alive forever" the way a critic round found `Number('') === 0` -> `isProcessAlive(0)` ->
      // `true` made an earlier draft of this sweep behave).
      await sweepOrphanedLauncherShims(root, farFutureClock());
      expect(existsSync(dir), `"${garbage}" must still be swept once old enough`).toBe(false);
    }
  });

  it('ignores entries that do not match the forge-launcher- prefix, even one with a dead-pid marker inside', async () => {
    const root = await scratch();
    const unrelated = path.join(root, 'forge-shell-unrelated');
    await mkdir(unrelated, { mode: 0o700 });
    await writeFile(path.join(unrelated, 'owner.pid'), String(await realDeadPid()), 'utf8');
    await sweepOrphanedLauncherShims(root);
    expect(
      existsSync(unrelated),
      'a non-launcher-shim directory is never this sweep’s concern',
    ).toBe(true);
  });

  it('ignores a plain file that happens to match the forge-launcher- prefix', async () => {
    const root = await scratch();
    const file = path.join(root, 'forge-launcher-not-a-directory');
    await writeFile(file, 'not a directory', 'utf8');
    // A critic round, verifying this test, correctly found its own prior comment overclaimed: the
    // clock plays no part here at all -- the main loop's own `entry.isDirectory` check (from
    // `readdir`'s own listing) filters this out before age is ever consulted, so a plain file
    // structurally cannot reach any marker read or `unlink`/`rmdir` call in the first place (those
    // would hit `ENOTDIR` against a non-directory path, not succeed). Any clock proves this
    // identically; the default is used rather than implying age is relevant when it is not.
    await sweepOrphanedLauncherShims(root);
    expect(existsSync(file)).toBe(true);
  });

  it('does nothing, and does not throw, when tmpRoot itself does not exist', async () => {
    const root = path.join(await scratch(), 'does', 'not', 'exist');
    await expect(sweepOrphanedLauncherShims(root)).resolves.toBeUndefined();
  });

  describe('closing the cross-user and adversarial-filesystem findings two independent critic rounds demonstrated live against an earlier draft', () => {
    it('leaves a forge-launcher-* directory alone when its mode is not restricted to this user alone, even with a dead-pid marker and well past the age threshold', async () => {
      if (process.platform === 'win32') return; // No POSIX mode bits to loosen on win32.
      const root = await scratch();
      const dir = await orphanCandidate(root);
      await writeFile(path.join(dir, 'owner.pid'), String(await realDeadPid()), 'utf8');
      // Group- and other-readable: `createLauncherShim` never creates a real shim this way, but a
      // planted one (the live, demonstrated cross-user exploit: an attacker who does not own this
      // directory at all could not pass the uid check regardless, but this also narrows the case
      // where SOMETHING unexpected loosened a shim's own permissions) must still not be acted on.
      await chmod(dir, 0o777);
      await sweepOrphanedLauncherShims(root, farFutureClock());
      expect(existsSync(dir), 'a group/other-accessible directory must never be swept').toBe(true);
    });

    it('leaves a forge-launcher-* directory alone when it is not owned by this process’s own uid, even with a dead-pid marker and well past the age threshold', async () => {
      if (process.platform === 'win32') return; // No POSIX uid model on win32.
      // A critic round verifying the mode check above found the uid half of `isExclusivelyOurs` --
      // the actual control that rules out a cross-user attacker outright, not merely the mode
      // defense-in-depth -- had no test of its own: removing it left every existing test passing.
      // A real different uid cannot be created without elevated privileges this test must not
      // require, so the OS fact itself is stubbed, not the check's own logic.
      const root = await scratch();
      const dir = await orphanCandidate(root);
      await writeFile(path.join(dir, 'owner.pid'), String(await realDeadPid()), 'utf8');
      vi.spyOn(process, 'getuid').mockReturnValue((process.getuid?.() ?? 0) + 1);
      await sweepOrphanedLauncherShims(root, farFutureClock());
      expect(existsSync(dir), 'a directory owned by a different uid must never be swept').toBe(
        true,
      );
    });

    it('declines to sweep at all inside a world-writable tmpRoot that has no sticky bit set, leaving even a dead-owner directory alone', async () => {
      if (process.platform === 'win32') return; // No sticky-bit concept on win32.
      // A critic round verifying `isExclusivelyOurs` correctly found it does not, by itself, stop a
      // race against `dir`'s own TOP-LEVEL entry (as opposed to anything inside it, which it does
      // close) -- the standard OS-level protection against exactly that (a shared directory's own
      // sticky bit) is what `isSafeToSweepInside` requires instead of re-implementing.
      const root = await scratch();
      const dir = await orphanCandidate(root);
      await writeFile(path.join(dir, 'owner.pid'), String(await realDeadPid()), 'utf8');
      await chmod(root, 0o777); // World-writable, sticky bit NOT set.
      await sweepOrphanedLauncherShims(root, farFutureClock());
      expect(
        existsSync(dir),
        'a non-sticky, world-writable tmpRoot must refuse the whole sweep, not merely this directory',
      ).toBe(true);
    });

    it('sweeps normally inside a world-writable tmpRoot that DOES have its sticky bit set (the real, standard shape of a shared /tmp)', async () => {
      if (process.platform === 'win32') return;
      const root = await scratch();
      const dir = await orphanCandidate(root);
      await writeFile(path.join(dir, 'owner.pid'), String(await realDeadPid()), 'utf8');
      await chmod(root, 0o1777); // World-writable WITH the sticky bit -- /tmp's own real default.
      await sweepOrphanedLauncherShims(root);
      expect(
        existsSync(dir),
        'the sticky bit is exactly what makes a shared, world-writable root safe to sweep inside',
      ).toBe(false);
    });

    it('does not hang, and does not delete anything, when owner.pid is a real FIFO with no writer (the live-demonstrated DoS)', async () => {
      if (process.platform === 'win32') return; // No FIFOs on win32; independently not exposed.
      const root = await scratch();
      const dir = await orphanCandidate(root);
      execFileSync('mkfifo', [path.join(dir, 'owner.pid')]);
      // Bounded by a short race, not vitest's own global test timeout: a regression that reintroduces
      // the blocking `open()` this exists to catch should fail fast and legibly, not hang the whole
      // suite for 60s before timing out with a much less informative message.
      const result = await Promise.race([
        sweepOrphanedLauncherShims(root).then(() => 'completed' as const),
        new Promise<'hung'>((resolve) => {
          setTimeout(() => {
            resolve('hung');
          }, 2_000);
        }),
      ]);
      expect(result, 'the sweep must not block on a FIFO with no writer').toBe('completed');
      expect(existsSync(dir), 'an unreadable marker must never be treated as safe to delete').toBe(
        true,
      );
    });

    it('does not follow a symlinked owner.pid (an earlier draft would have read, or leaked the contents of, whatever it points at)', async () => {
      if (process.platform === 'win32') return; // No POSIX O_NOFOLLOW semantics on win32.
      const root = await scratch();
      const dir = await orphanCandidate(root);
      const secret = path.join(root, 'not-a-shim-secret.txt');
      await writeFile(secret, String(await realDeadPid()), 'utf8');
      await symlink(secret, path.join(dir, 'owner.pid'));
      await sweepOrphanedLauncherShims(root, farFutureClock());
      expect(existsSync(secret), 'the symlink target must survive untouched').toBe(true);
      expect(
        existsSync(dir),
        'a symlinked marker is "unusable", never "missing" -- it must not fall through to the age check and get swept',
      ).toBe(true);
    });

    it('removes only the files this module itself could have created, leaving an unrecognised extra file (and the directory) alone', async () => {
      const root = await scratch();
      const dir = await orphanCandidate(root);
      await writeFile(path.join(dir, 'owner.pid'), String(await realDeadPid()), 'utf8');
      const planted = path.join(dir, 'something-unexpected.txt');
      await writeFile(planted, 'not a file this module ever writes', 'utf8');
      await sweepOrphanedLauncherShims(root);
      expect(existsSync(path.join(dir, 'owner.pid')), 'the known marker is still unlinked').toBe(
        false,
      );
      expect(
        existsSync(planted),
        'unrecognised content must never be deleted by a recursive walk this sweep no longer does',
      ).toBe(true);
      expect(
        existsSync(dir),
        'rmdir on a non-empty directory fails harmlessly; the directory is left in place',
      ).toBe(true);
    });
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

  it('carries no FORGE_RUN_ID marker when no run id is given (PATH only) -- the ad-hoc gate shim (bin.ts) case', () => {
    expect(commandEnvFor('/tmp/x', { PATH: '/usr/bin:/bin' }, 'linux')).toEqual({
      PATH: '/tmp/x:/usr/bin:/bin',
    });
  });

  it('adds the FORGE run marker (@forge/core/session-marker, PLAN-M14.md P4) when a run id is given, alongside PATH, unchanged', () => {
    expect(commandEnvFor('/tmp/x', { PATH: '/usr/bin:/bin' }, 'linux', 'run-shim-marker')).toEqual({
      PATH: '/tmp/x:/usr/bin:/bin',
      FORGE_RUN_ID: 'run-shim-marker',
    });
  });

  // Round-2 gauntlet fix (specs/22 M16 P15): two independent critics found that the plain-object
  // assertions above (`toEqual`) cannot catch the real bug, because `toEqual` treats a key that is
  // absent the same as one present with value `undefined` -- and that is exactly the distinction that
  // matters once this object reaches a real `execa` subprocess with its own default `extendEnv: true`
  // (`runShellCommand`, `@forge/engine/dispatch/shell.ts`, the ad hoc `forge gate check` path's real
  // call shape). These two tests spawn a REAL child process, never a mock, to prove the actual,
  // merged environment the child sees -- the only way to actually observe the difference.
  it('strips an already-ambient FORGE_RUN_ID from a real execa subprocess when no runId is given -- closes the ad hoc gate-check misattribution a critic reproduced end to end', async () => {
    const previous = process.env['FORGE_RUN_ID'];
    process.env['FORGE_RUN_ID'] = 'ambient-leak-from-the-calling-shell';
    try {
      const env = commandEnvFor('/tmp/x', { PATH: '/usr/bin:/bin' }, 'linux');
      const { stdout } = await execa(
        process.execPath,
        ['-e', 'process.stdout.write(process.env.FORGE_RUN_ID ?? "<absent>")'],
        { env },
      );
      expect(stdout).toBe('<absent>');
    } finally {
      if (previous === undefined) delete process.env['FORGE_RUN_ID'];
      else process.env['FORGE_RUN_ID'] = previous;
    }
  });

  it('still carries a real, given runId through to a real execa subprocess, overriding any stale ambient value -- the legitimate in-run case is unaffected by the fix above', async () => {
    const previous = process.env['FORGE_RUN_ID'];
    process.env['FORGE_RUN_ID'] = 'stale-value-that-must-not-survive';
    try {
      const env = commandEnvFor('/tmp/x', { PATH: '/usr/bin:/bin' }, 'linux', 'run-legit-marker');
      const { stdout } = await execa(
        process.execPath,
        ['-e', 'process.stdout.write(process.env.FORGE_RUN_ID ?? "<absent>")'],
        { env },
      );
      expect(stdout).toBe('run-legit-marker');
    } finally {
      if (previous === undefined) delete process.env['FORGE_RUN_ID'];
      else process.env['FORGE_RUN_ID'] = previous;
    }
  });
});

describe('createLauncherShim / createLauncherShimOrWarn -- threading the run id into commandEnv', () => {
  it('createLauncherShim with no run id produces a commandEnv with no FORGE_RUN_ID', async () => {
    const dir = await scratch();
    const shim = await createLauncherShim(spec(await echoEntry(dir)));
    expect(shim.commandEnv['FORGE_RUN_ID']).toBeUndefined();
    await shim.cleanup();
  });

  it('createLauncherShim given a run id stamps FORGE_RUN_ID onto commandEnv', async () => {
    const dir = await scratch();
    const shim = await createLauncherShim(
      spec(await echoEntry(dir)),
      process.platform,
      undefined,
      'run-create-shim',
    );
    expect(shim.commandEnv['FORGE_RUN_ID']).toBe('run-create-shim');
    await shim.cleanup();
  });

  it('createLauncherShimOrWarn threads the run id through to commandEnv', async () => {
    const dir = await scratch();
    const shim = await createLauncherShimOrWarn(
      spec(await echoEntry(dir)),
      undefined,
      'run-warn-shim',
    );
    expect(shim?.commandEnv['FORGE_RUN_ID']).toBe('run-warn-shim');
    await shim?.cleanup();
  });

  it('createLauncherShimOrWarn with no run id (the bin.ts gate-shim call shape) carries none', async () => {
    const dir = await scratch();
    const shim = await createLauncherShimOrWarn(spec(await echoEntry(dir)), undefined);
    expect(shim?.commandEnv['FORGE_RUN_ID']).toBeUndefined();
    await shim?.cleanup();
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

describe('definedLauncherEnv', () => {
  it('is undefined for an undefined spec (no real launcher, nothing to fall back to)', () => {
    expect(definedLauncherEnv(undefined)).toBeUndefined();
  });

  it('drops every undefined value from a real spec’s own env, keeping the rest', () => {
    const spec: LauncherSpec = {
      execPath: process.execPath,
      execArgv: [],
      entry: 'entry.mjs',
      env: { PATH: '/p', HOME: undefined, LANG: 'C' },
    };
    expect(definedLauncherEnv(spec)).toEqual({ PATH: '/p', LANG: 'C' });
  });

  it('is the real, usable fallback run.ts/resume.ts need when createLauncherShimOrWarn could not build a real shim: a concrete env with a real PATH, not undefined', () => {
    const spec = currentLauncher({ PATH: '/usr/bin', HOME: undefined });
    expect(definedLauncherEnv(spec)).toEqual({ PATH: '/usr/bin' });
  });
});
