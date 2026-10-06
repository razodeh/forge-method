/**
 * `runShellCommand` — the shared subprocess runner behind `command`-kind steps, gate checks, and merge
 * pre/post-checks.
 *
 * @see PLAN-M5.md P15
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { runShellCommand } from '../../src/dispatch/shell.ts';

describe('runShellCommand', () => {
  it('captures stdout, stderr, and exit code for a successful command', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const result = await runShellCommand('echo hello', cwd);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('never throws for a nonzero exit code, reporting it as data instead', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const result = await runShellCommand('exit 5', cwd);
    expect(result.exitCode).toBe(5);
  });

  it('never throws even when the command itself cannot be spawned at all', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const result = await runShellCommand('this-command-does-not-exist-anywhere', cwd);
    expect(result.exitCode).not.toBe(0);
  });

  it("runs the command in the declared cwd, not the caller's own process cwd", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const result = await runShellCommand('pwd', cwd);
    // Resolve both sides through realpath-equivalent comparison: macOS tmp dirs are often themselves a
    // symlink (/tmp -> /private/tmp), so a raw string-equality check would be fragile.
    expect(await realpath(result.stdout.trim())).toBe(await realpath(cwd));
  });

  it('supports a caller-supplied environment', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const result = await runShellCommand('echo $FORGE_TEST_VAR', cwd, {
      FORGE_TEST_VAR: 'custom-value',
    });
    expect(result.stdout.trim()).toBe('custom-value');
  });

  it('falls back to exit code 1 for a command killed by a signal, which has no numeric exit code of its own', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    // The shell sends itself SIGKILL: execa's own `reject: false` then reports `exitCode` as
    // `undefined`/`null` (a signal, not a numeric exit, ended the process) rather than throwing.
    const result = await runShellCommand('kill -9 $$', cwd);
    expect(result.exitCode).toBe(1);
  });
});

describe('runShellCommand limits (M13 P25: a caller that must not hang on, or buffer without bound, a project command)', () => {
  it('reports no limit flags at all for an ordinary run, so existing callers see the shape they always did', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const plain = await runShellCommand('echo hi', cwd);
    const limited = await runShellCommand('echo hi', cwd, undefined, {
      timeoutMs: 10_000,
      maxOutputBytes: 1_000,
    });
    expect(plain).toEqual({ stdout: 'hi', stderr: '', exitCode: 0 });
    expect(limited).toEqual({ stdout: 'hi', stderr: '', exitCode: 0 });
  });

  it('kills a command that outlives the timeout and says so', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const started = Date.now();
    const result = await runShellCommand('sleep 30', cwd, undefined, { timeoutMs: 400 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('does not wait for a grandchild that still holds the output pipe open after the timeout', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const started = Date.now();
    const result = await runShellCommand('sleep 30 & sleep 30', cwd, undefined, {
      timeoutMs: 400,
    });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('stops a command that writes more than the output cap, on either stream, and says so', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const out = await runShellCommand('yes | head -c 5000000', cwd, undefined, {
      maxOutputBytes: 1_000,
    });
    expect(out.outputLimitExceeded).toBe(true);
    expect(out.stdout.length).toBeLessThanOrEqual(1_000);
    const err = await runShellCommand('yes 1>&2 | head -c 5000000', cwd, undefined, {
      maxOutputBytes: 1_000,
    });
    expect(err.outputLimitExceeded).toBe(true);
  });

  it('ends the whole group as soon as the output cap is passed, not when a background child lets go of the pipe', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const started = Date.now();
    const result = await runShellCommand('sleep 20 & yes', cwd, undefined, {
      timeoutMs: 15_000,
      maxOutputBytes: 1_000,
    });
    expect(result.outputLimitExceeded).toBe(true);
    expect(Date.now() - started).toBeLessThan(8_000);
    const startedErr = Date.now();
    const onStderr = await runShellCommand('sleep 20 & yes 1>&2', cwd, undefined, {
      timeoutMs: 15_000,
      maxOutputBytes: 1_000,
    });
    expect(onStderr.outputLimitExceeded).toBe(true);
    expect(Date.now() - startedErr).toBeLessThan(8_000);
  });

  it('returns within about the timeout even when a grandchild left the process group and holds the pipe, and that grandchild does not survive the kill (specs/22 M16 P10)', async () => {
    // `POSIX::setsid()` is exactly what Node's `spawn(..., { detached: true })` and Python's
    // `subprocess.Popen(..., start_new_session=True)` both do under the hood: the grandchild becomes
    // the leader of a brand new process group, immediately leaving the one `process.kill(-pid, ...)`
    // signals. A fresh critic round confirmed directly, via `ps`, that this grandchild survived --
    // reparented to PID 1, still alive and burning CPU -- when `killGroup` only sent the group
    // signal; `marker` (unique per run) lets this test confirm, via a real `pgrep`, that it does not
    // survive any more.
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const marker = `5${String(Date.now() % 100_000).padStart(5, '0')}`;
    const started = Date.now();
    const result = await runShellCommand(
      `perl -e 'use POSIX; if (fork() == 0) { POSIX::setsid(); exec "sleep", "${marker}" } sleep 100'`,
      cwd,
      undefined,
      { timeoutMs: 500 },
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(8_000);
    const stillAlive = await execa('pgrep', ['-f', `^sleep ${marker}$`], { reject: false });
    expect(
      stillAlive.exitCode,
      'the setsid-detached grandchild must not survive the kill',
    ).not.toBe(0);
  });

  it('kills a Node grandchild that detaches into its own session before it starts busy-looping (specs/22 M16 P10)', async () => {
    // The exact shape a hung real-world test command can produce: a `detached: true` child (Node's
    // own, direct equivalent of `setsid(2)`) that writes its own real pid to a marker file, then
    // blocks the event loop with a synchronous busy loop -- unreachable by anything that relies on
    // `setTimeout`/signal handling inside it, so only an external SIGKILL by pid can end it. Written
    // to real files on disk, not an inline `-e` string, so nothing here depends on how this shell
    // quotes a multi-line script. The PARENT also busy-loops after spawning (never exits on its own)
    // so `killGroup` only ever fires via the real timeout below, by which point the grandchild --
    // spawned in the parent's very first statement -- has certainly already written its marker; a
    // parent that exited immediately instead would race `killGroup`'s own "process exited" cleanup
    // against the grandchild still booting.
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const markerPath = path.join(cwd, 'grandchild.pid');
    const grandchildPath = path.join(cwd, 'grandchild.cjs');
    const parentPath = path.join(cwd, 'parent.cjs');
    await writeFile(
      grandchildPath,
      "require('node:fs').writeFileSync(process.argv[2], String(process.pid));\nfor (;;) { /* busy */ }\n",
      'utf8',
    );
    await writeFile(
      parentPath,
      "const { spawn } = require('node:child_process');\n" +
        "const child = spawn(process.execPath, [process.argv[2], process.argv[3]], { detached: true, stdio: 'ignore' });\n" +
        'child.unref();\n' +
        'for (;;) { /* the parent hangs too, so the timeout -- not an early exit -- is what triggers killGroup */ }\n',
      'utf8',
    );

    const started = Date.now();
    const result = await runShellCommand(
      `node ${JSON.stringify(parentPath)} ${JSON.stringify(grandchildPath)} ${JSON.stringify(markerPath)}`,
      cwd,
      undefined,
      { timeoutMs: 1_500 },
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    const pid = Number((await readFile(markerPath, 'utf8')).trim());
    expect(Number.isInteger(pid)).toBe(true);
    // `kill -0`: the standard liveness probe, sends no real signal.
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive, `detached grandchild pid ${String(pid)} must not survive the kill`).toBe(false);
  }, 15_000);

  for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
    it(`ends the command it started when this process is sent ${signal} (no orphan survives)`, async () => {
      const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
      const marker = `4${String(Date.now() % 100_000).padStart(5, '0')}`;
      const shellUrl = new URL('../../src/dispatch/shell.ts', import.meta.url).href;
      const script = `import { runShellCommand } from ${JSON.stringify(shellUrl)};
      await runShellCommand('sleep ${marker} & sleep ${marker}1', ${JSON.stringify(cwd)}, undefined, { timeoutMs: 60000 });`;
      const child = spawn(
        process.execPath,
        [
          '--experimental-strip-types',
          '--disable-warning=ExperimentalWarning',
          '--input-type=module',
          '-e',
          script,
        ],
        { stdio: 'ignore' },
      );
      const alive = async (): Promise<boolean> =>
        (await execa('pgrep', ['-f', `^sleep ${marker}$`], { reject: false })).exitCode === 0;
      for (let i = 0; i < 100 && !(await alive()); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await alive()).toBe(true);
      child.kill(signal);
      // Re-raised with the default action restored: the process ends by the signal it was sent, not by exiting 0.
      const ended = await new Promise<string | null>((resolve) => {
        child.once('exit', (_code, by) => {
          resolve(by);
        });
      });
      expect(ended).toBe(signal);
      for (let i = 0; i < 50 && (await alive()); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await alive()).toBe(false);
    }, 30_000);
  }

  it('does not leave a command that reads stdin waiting for the timeout', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const started = Date.now();
    const result = await runShellCommand('cat', cwd, undefined, { timeoutMs: 20_000 });
    expect(result.timedOut).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a command that exits 0 but leaves a child holding the pipe passes, and is not made to wait out the timeout', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const started = Date.now();
    const result = await runShellCommand('(sleep 30 &); echo smoke-ok; exit 0', cwd, undefined, {
      timeoutMs: 20_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBeUndefined();
    expect(result.stdout).toContain('smoke-ok');
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it('caps each stream on its own: 600 bytes on each of stdout and stderr is under a 1000 byte cap', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const result = await runShellCommand(
      'head -c 600 /dev/zero | tr "\\0" a; head -c 600 /dev/zero | tr "\\0" b 1>&2',
      cwd,
      undefined,
      { maxOutputBytes: 1_000 },
    );
    expect(result.outputLimitExceeded).toBeUndefined();
    expect(result.exitCode).toBe(0);
  });

  it('leaves no process exit listener behind, however the run ended', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const before = process.listenerCount('exit');
    const signalsBefore = {
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGHUP: process.listenerCount('SIGHUP'),
    };
    await runShellCommand('true', cwd, undefined, { timeoutMs: 10_000 });
    await runShellCommand('sleep 30', cwd, undefined, { timeoutMs: 200 });
    await runShellCommand('yes | head -c 100000', cwd, undefined, { maxOutputBytes: 100 });
    expect(process.listenerCount('exit')).toBe(before);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      expect(process.listenerCount(signal), signal).toBe(signalsBefore[signal]);
    }
  });

  it('a command that is not killed by a signal still reports its own exit code under limits', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-shell-'));
    const result = await runShellCommand('exit 7', cwd, undefined, { timeoutMs: 10_000 });
    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBeUndefined();
    expect(result.outputLimitExceeded).toBeUndefined();
  });
});
