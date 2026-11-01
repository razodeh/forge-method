/**
 * Shared real-process crash-simulation helpers for `crash-resume.test.ts` (E3, `PLAN-M5.md` P20) and
 * `packages/engine/test/security/s12-orphan-free-crash.test.ts` (`20` §20.10 S12, `PLAN-M11.md` P12) —
 * extracted rather than duplicated across both, so the one real, previously-fixed group-kill fidelity
 * bug this mechanism depends on (`SPEC-QUESTIONS.md` Q149: a plain `child.kill('SIGKILL')` left a real
 * `git worktree add` subprocess orphaned; fixed by `detached: true` + `process.kill(-pid, 'SIGKILL')`,
 * the POSIX process-*group*-kill convention) has exactly one place to fix if it ever regresses again,
 * not two.
 *
 * `SPEC-QUESTIONS.md` Q384: negative-pid group-signalling is POSIX-only — confirmed externally
 * (`nodejs/node#3617`: libuv's Windows `uv_kill` has no group-signalling path at all; a negative pid
 * there just becomes a huge, nonexistent `DWORD` pid that `OpenProcess`/`TerminateProcess` can never
 * find) and already independently known inside this very file's own caller set (`s12-orphan-free-
 * crash.test.ts`'s own doc comment already states this and self-skips its whole test on win32
 * because of it) — but `spawnAndKillAfter` itself had never actually branched on it, so every one of
 * `crash-resume.test.ts`'s own Windows runs, for the entire history of this milestone, has silently
 * never exercised the real crash-resume mechanism on that OS at all: the negative-pid kill call
 * always throws `ESRCH` there regardless of host load (not the genuine, load-dependent POSIX race
 * this file's own `killRaceLost` handling below exists for), previously crashing the whole vitest
 * worker uncaught, and after this entry's own first fix, failing cleanly on EVERY run instead of
 * occasionally — which is what first surfaced this as a 100%-reproducible platform gap rather than a
 * rare flake. Fixed below using the identical `taskkill /PID <pid> /T /F` tree-kill this same
 * session's own `killGroup` (`packages/engine/src/dispatch/shell.ts`/`confined-command.ts`, Q383)
 * already established as the native Windows equivalent.
 *
 * Not in `@forge/testkit` or any package's own `src/`: `node:os`'s `tmpdir` is R10-restricted in
 * production code (`packages/engine/test/dispatch/helpers.ts`'s own doc comment has the fuller
 * reasoning), and this whole mechanism (real `spawn`/`SIGKILL`/process-tree kill) is test-only by
 * nature — there is no production caller that would ever want it.
 *
 * @see specs/06 §6.10
 * @see specs/20 §20.10
 * @see SPEC-QUESTIONS.md Q149
 * @see SPEC-QUESTIONS.md Q384
 * @see SPEC-QUESTIONS.md Q387
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
// Genuinely test-only, the identical exemption `packages/cli/test/commands/helpers.ts` already
// documents for its own `tmpdir` import (this file is not itself a `*.test.ts`/`test/**/*.ts`-glob
// match, so it does not inherit the blanket test-file `no-restricted-imports` exemption those get).
// eslint-disable-next-line no-restricted-imports -- see comment above
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';

import { TS_NODE_FLAG } from '../../../../scripts/lib/node-ts-flag.mjs';

const FIXTURE_CHILD_PATH = fileURLToPath(
  new URL('./fixtures/run-engine-child.ts', import.meta.url),
);

/** Thrown by `spawnAndKillAfter` specifically when the group-kill lost the Q384/Q385 race (the
 * fixture's whole process group had already exited on its own by the time the kill ran) — a
 * distinct, `instanceof`-checkable type rather than a plain `Error`, so a caller can retry this
 * specific, recoverable test-infrastructure condition without risking catching (and silently
 * retrying away) a genuinely different failure. Retrying this condition never masks a production
 * bug: when it fires, `resumeRun`/`runEngine` — the actual code under test — was never even reached,
 * only this test's own "kill the fixture mid-flight" precondition failed to land in time. */
export class KillRaceLostError extends Error {}

/** A fresh, real, empty-initial-commit git repository under a real temp directory. */
export async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-e2e-crash-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** Kills the whole process group `pid` leads, exactly once, and reports whether that kill genuinely
 * raced against the group's own natural exit rather than reaching a still-live process — the single
 * shared decision point `spawnAndKillAfter`'s `'data'` handler below needs, factored out so the
 * platform branch (POSIX negative-pid kill vs. win32 `taskkill /T /F`, Q384 above) lives in one place.
 *
 * `SPEC-QUESTIONS.md` Q387: a real CI run (`41263303919`) showed this throwing uncaught from a real
 * `taskkill` failure with exit code 255 — neither the "success" (0) nor the already-handled "not
 * found" (128) case this function's own first version only checked for. Rather than chase every real
 * `taskkill` exit code (the 128 convention itself is only community-verified, not an official
 * Microsoft guarantee — this function's own prior doc comment already said so), this now checks
 * liveness FIRST with the same portable, pure-existence probe `waitForProcessGone` below already
 * uses (`process.kill(pid, 0)`, sends no real signal, identical behaviour on POSIX and win32) —
 * mirroring the exact "never touch `taskkill`/a signal call for a pid already confirmed dead"
 * discipline this same session's own `killGroup` fix (`packages/engine/src/dispatch/shell.ts`/
 * `confined-command.ts`, `Q383`) already established for PRODUCTION code, closing the identical
 * win32 pid-reuse hazard that fix exists to prevent (`Q383`'s own doc comment: once a pid is dead,
 * Windows can and does reuse it fast, and an unconditional `taskkill /T /F` then risks a stranger's
 * entire process tree) — a gap this file's own Q384/Q385 versions had not yet closed. The pre-check
 * narrows, but cannot fully close, the TOCTOU window (the real target could still die in the
 * narrow gap between the probe and the actual kill call) — so the kill call itself is ALSO wrapped:
 * any failure there, having JUST confirmed liveness a moment earlier, is overwhelmingly more likely
 * to mean "it finished in that narrow remaining window" than a genuinely different problem, so it is
 * treated the same way rather than re-litigating every platform's own exact failure-code vocabulary
 * a second time. This function now never throws — `spawnAndKillAfter`'s own `'data'` handler can
 * call it directly with no `try`/`catch` of its own. */
function killGroupReportingRace(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      // Negative pid: POSIX's own "signal every process in this group," not just `pid` itself --
      // see this function's own doc comment for why the group, not the one process, is the real
      // crash boundary this needs to simulate.
      process.kill(-pid, 'SIGKILL');
    }
    return false;
  } catch {
    return true;
  }
}

/** Spawns the real child-process fixture (`./fixtures/run-engine-child.ts`), `SIGKILL`s it the moment
 * it has durably written `killAfterEventCount` events, and resolves once the OS confirms the process is
 * genuinely gone — never a simulated crash. Rejects if the child exits on its own before ever reaching
 * that many events (a caller bug: `killAfterEventCount` must be chosen below the fixture's own real
 * total), and also rejects — with a distinctly labelled error, not a crash of the whole test worker —
 * if the group-kill itself loses a real race against a severely CPU-starved host (see
 * `killGroupReportingRace` above).
 *
 * `detached: true` makes the fixture child the leader of its own, brand-new process group (its pgid
 * equal to its own pid on POSIX; the win32 equivalent `CREATE_NEW_PROCESS_GROUP` flag) — every further
 * descendant it spawns (concretely: the real `git` subprocess `@forge/vcs`'s own `createLaneWorktree`
 * shells out to via `execa`, e.g. `git worktree add -b ...`) inherits that same group, not the
 * caller's own. */
export async function spawnAndKillAfter(
  projectRoot: string,
  runId: string,
  killAfterEventCount: number,
  seed: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [TS_NODE_FLAG, FIXTURE_CHILD_PATH, projectRoot, runId, seed], {
      detached: true,
    });
    const pid = child.pid;
    if (pid === undefined) {
      reject(new Error('child process failed to spawn (no pid)'));
      return;
    }
    let seenEvents = 0;
    let killed = false;
    // Set only when the group-kill raced against the fixture's own natural exit (Q384 above) -- kept
    // distinct from `killed` so the `exit` handler below can tell "a real crash was induced" apart from
    // "the attempt to induce one lost the race," instead of the latter being silently treated as the
    // former just because `killed` was already set true before the throw.
    let killRaceLost = false;
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
          killRaceLost = killGroupReportingRace(pid);
        }
      }
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (killRaceLost) {
        reject(
          new KillRaceLostError(
            `the fixture child's whole process group (pid ${String(pid)}) had already exited on its ` +
              `own by the time the group-kill ran (code=${String(code)}, signal=${String(signal)}) -- ` +
              `a real CI host/platform-latency race (SPEC-QUESTIONS.md Q384/Q386/Q387), not a logic bug: ` +
              `this caller was starved long enough after seeing the ${String(killAfterEventCount)}th ` +
              `EVENT line that the fixture finished the whole run before the kill signal could be ` +
              `delivered`,
          ),
        );
        return;
      }
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
