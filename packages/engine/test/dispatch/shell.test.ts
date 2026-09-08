/**
 * `runShellCommand` — the shared subprocess runner behind `command`-kind steps, gate checks, and merge
 * pre/post-checks.
 *
 * @see PLAN-M5.md P15
 */
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
