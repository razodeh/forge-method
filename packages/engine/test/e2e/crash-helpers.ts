/**
 * Shared real-process crash-simulation helpers for `crash-resume.test.ts` (E3, `PLAN-M5.md` P20) and
 * `packages/engine/test/security/s12-orphan-free-crash.test.ts` (`20` §20.10 S12, `PLAN-M11.md` P12) —
 * extracted rather than duplicated across both, so the one real, previously-fixed group-kill fidelity
 * bug this mechanism depends on (`SPEC-QUESTIONS.md` Q149: a plain `child.kill('SIGKILL')` left a real
 * `git worktree add` subprocess orphaned; fixed by `detached: true` + `process.kill(-pid, 'SIGKILL')`,
 * the POSIX process-*group*-kill convention) has exactly one place to fix if it ever regresses again,
 * not two.
 *
 * Not in `@forge/testkit` or any package's own `src/`: `node:os`'s `tmpdir` is R10-restricted in
 * production code (`packages/engine/test/dispatch/helpers.ts`'s own doc comment has the fuller
 * reasoning), and this whole mechanism (real `spawn`/`SIGKILL`/POSIX process groups) is test-only by
 * nature — there is no production caller that would ever want it.
 *
 * @see specs/06 §6.10
 * @see specs/20 §20.10
 * @see SPEC-QUESTIONS.md Q149
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
// Genuinely test-only, the identical exemption `packages/cli/test/commands/helpers.ts` already
// documents for its own `tmpdir` import (this file is not itself a `*.test.ts`/`test/**/*.ts`-glob
// match, so it does not inherit the blanket test-file `no-restricted-imports` exemption those get).
// eslint-disable-next-line no-restricted-imports -- see comment above
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';

const FIXTURE_CHILD_PATH = fileURLToPath(
  new URL('./fixtures/run-engine-child.ts', import.meta.url),
);

/** A fresh, real, empty-initial-commit git repository under a real temp directory. */
export async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-e2e-crash-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** Spawns the real child-process fixture (`./fixtures/run-engine-child.ts`), `SIGKILL`s it the moment
 * it has durably written `killAfterEventCount` events, and resolves once the OS confirms the process is
 * genuinely gone — never a simulated crash. Rejects if the child exits on its own before ever reaching
 * that many events (a caller bug: `killAfterEventCount` must be chosen below the fixture's own real
 * total).
 *
 * `detached: true` makes the fixture child the leader of its own, brand-new process group (its pgid
 * equal to its own pid) — every further descendant it spawns (concretely: the real `git` subprocess
 * `@forge/vcs`'s own `createLaneWorktree` shells out to via `execa`, e.g. `git worktree add -b ...`)
 * inherits that same group, not the caller's own. Killing the *group* (`process.kill(-pid, 'SIGKILL')`,
 * the POSIX convention for "target every process in this group," not just `pid` itself) is what a real
 * crash actually does: an OOM-killed cgroup, a killed session, or a lost host takes every descendant
 * down together. `SPEC-QUESTIONS.md` Q149 has the full record of the real bug a single-pid kill left
 * behind (an orphaned `git worktree add` subprocess finishing *after* the "crash," with no `LaneCreated`
 * event ever durably recorded for it) and the five real leftover shapes that surfaced once group-killing
 * made the test faithful enough to actually reach them. */
export async function spawnAndKillAfter(
  projectRoot: string,
  runId: string,
  killAfterEventCount: number,
  seed: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      ['--experimental-strip-types', FIXTURE_CHILD_PATH, projectRoot, runId, seed],
      { detached: true },
    );
    const pid = child.pid;
    if (pid === undefined) {
      reject(new Error('child process failed to spawn (no pid)'));
      return;
    }
    let seenEvents = 0;
    let killed = false;
    let stderr = '';
    let stdoutTail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutTail += chunk.toString();
      for (const line of chunk.toString().split('\n')) {
        if (!line.startsWith('EVENT ')) continue;
        seenEvents += 1;
        if (seenEvents >= killAfterEventCount && !killed) {
          killed = true;
          // Negative pid: POSIX's own "signal every process in this group," not just `pid` itself --
          // see this function's own doc comment for why the group, not the one process, is the real
          // crash boundary this needs to simulate.
          process.kill(-pid, 'SIGKILL');
        }
      }
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (!killed) {
        reject(
          new Error(
            `fixture child exited on its own before reaching ${String(killAfterEventCount)} events ` +
              `(code=${String(code)}, signal=${String(signal)}, stdout=${stdoutTail}, stderr=${stderr})`,
          ),
        );
        return;
      }
      resolve(pid);
    });
  });
}

/** Polls until the OS itself confirms `pid` no longer exists (`process.kill(pid, 0)` throwing `ESRCH`) —
 * a direct structural proof a caller's own "the process is genuinely gone" claim can be checked
 * against, not merely trusting the child's own `exit` event fired (which `SIGKILL` guarantees anyway,
 * but this is the independent, second confirmation). */
export async function waitForProcessGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`pid ${String(pid)} still exists after waiting`);
}
