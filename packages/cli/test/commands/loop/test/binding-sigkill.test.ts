/**
 * `runBindingCheck` — `PLAN-M15.md` P3's own "Tests first" line: "SIGKILL mid-mutation leaves no
 * worktree and no half-reverted tree." A real, detached child process (never a simulated crash) is
 * `SIGKILL`'d, as a process GROUP (`SPEC-QUESTIONS.md` Q149's own real bug: a bare `child.kill()` left
 * a real `git worktree add` subprocess orphaned), at several different real wall-clock points during a
 * genuine run — the identical spawn/group-kill/wait-gone pattern `packages/engine/test/e2e/
 * crash-helpers.ts` already establishes, reproduced here rather than imported (`@forge/engine`'s own
 * test helpers are not a public, cross-package test dependency, and this package has no build step to
 * share one through regardless).
 *
 * What a `SIGKILL` can and cannot guarantee, precisely: `finally` blocks never run once a process is
 * `SIGKILL`'d (no process can intercept it) — `runBindingCheck`'s own lane cleanup is therefore real
 * but NOT itself a guarantee against this one signal; `@forge/vcs`'s own `listOrphanedWorktrees`/
 * `removeLaneWorktree` (`PLAN-M5.md` P2) are the real, already-established second layer
 * `createLaneWorktree`'s own crash-safety model relies on for exactly this — confirmed directly in
 * this package (`loop/debug.ts`'s own RCA lane uses the identical two-layer model). The genuinely
 * absolute guarantee is the MAIN repository: `runBindingCheck` never performs a
 * single git operation against `projectRoot` itself (every revert/reset/checkout is scoped to the lane
 * worktree alone), so a kill at any point leaves it unmutated BY CONSTRUCTION, not by a cleanup step
 * that could itself be interrupted. This file proves both halves.
 *
 * @see specs/06 §6.10
 * @see specs/22 M15 P3
 * @see SPEC-QUESTIONS.md Q149
 * @see PLAN-M15.md P3
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { listOrphanedWorktrees, removeLaneWorktree } from '@forge/vcs';

const FIXTURE_CHILD_PATH = fileURLToPath(
  new URL('./fixtures/binding-check-child.ts', import.meta.url),
);

function resolveRealVitestEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('vitest/package.json');
  const packageJson = require(packageJsonPath) as {
    readonly bin?: Readonly<Record<string, string>>;
  };
  const binRelative = packageJson.bin?.['vitest'];
  if (binRelative === undefined)
    throw new Error('vitest/package.json has no real "vitest" bin entry.');
  return path.join(path.dirname(packageJsonPath), binRelative);
}

const TEST_COMMAND = `${process.execPath} ${resolveRealVitestEntry()} run --root .`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshRepo(): Promise<{ readonly dir: string; readonly baseSha: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-binding-sigkill-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'impl.js'),
    'export function add(a, b) { return a + b; }\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.test.js'),
    "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'the story'], { cwd: dir });
  return { dir, baseSha: baseSha.trim() };
}

/** Spawns the real fixture child, waits for its own `STARTED` line (confirming it genuinely began
 * running, never a guessed startup delay), then `SIGKILL`s the whole process GROUP after `killDelayMs`
 * more. Resolves once the OS confirms the process is genuinely gone, with whether a kill was actually
 * sent (`false` means the real run finished on its own first — a legitimate trial outcome, but one a
 * caller must be able to tell apart from a genuine kill, per a round-1 gauntlet critic finding: a
 * silently-skipped kill must never be indistinguishable from a real one). */
async function spawnKillAndWait(
  projectRoot: string,
  runId: string,
  storyId: string,
  baseRevision: string,
  killDelayMs: number,
): Promise<{ readonly killed: boolean }> {
  const child = spawn(
    'node',
    [
      '--experimental-strip-types',
      FIXTURE_CHILD_PATH,
      projectRoot,
      runId,
      storyId,
      baseRevision,
      TEST_COMMAND,
    ],
    { detached: true },
  );
  const pid = child.pid;
  if (pid === undefined) throw new Error('fixture child failed to spawn (no pid)');

  // An object property, not a bare `let`: a bare boolean local gets narrowed to the literal `false` it
  // was declared with (TS's control-flow analysis does not model "this closure runs asynchronously,
  // later"), which then makes the real, later `if (!exitedAlready.value)` check below look "always
  // truthy" to the linter even though the event handler genuinely can flip it first.
  const exitedAlready = { value: false };
  child.on('exit', () => {
    exitedAlready.value = true;
  });

  await new Promise<void>((resolve, reject) => {
    let started = false;
    child.stdout.on('data', (chunk: Buffer) => {
      if (!started && chunk.toString().includes('STARTED')) {
        started = true;
        resolve();
      }
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (!started) {
        reject(
          new Error(
            `fixture child exited before STARTED (code=${String(code)}, signal=${String(signal)})`,
          ),
        );
      }
    });
  });

  await new Promise((resolve) => setTimeout(resolve, killDelayMs));
  // A real run can finish faster than `killDelayMs` on a fast machine -- that is a legitimate trial
  // outcome (nothing left to kill), never a test failure: skip the signal rather than racing a process
  // that may already be gone (`ESRCH`). `killed` (returned below) is what lets the caller tell this
  // apart from a genuine kill, rather than the trial silently passing either way.
  let killed = false;
  if (!exitedAlready.value) {
    // Negative pid: POSIX's own "signal every process in this group" -- see this file's own
    // top-of-file doc comment (`SPEC-QUESTIONS.md` Q149) for the real bug a single-pid kill left
    // behind. Still racy against the process exiting in the gap between the check above and this
    // call -- ESRCH here specifically (not EPERM or anything else) is the identical "already gone"
    // case, swallowed for the same reason (and leaves `killed` false, correctly).
    try {
      process.kill(-pid, 'SIGKILL');
      killed = true;
    } catch (error) {
      if ((error as { code?: string }).code !== 'ESRCH') throw error;
    }
  }

  await new Promise<void>((resolve) => {
    const check = (): void => {
      try {
        process.kill(pid, 0);
        setTimeout(check, 10);
      } catch {
        resolve();
      }
    };
    check();
  });

  return { killed };
}

/** Reclaims every orphaned worktree `cwd` currently has -- the real, already-established second layer
 * of `createLaneWorktree`'s own crash-safety model (see this file's own top-of-file doc comment),
 * exercised here to prove it genuinely can clean up what a SIGKILL left behind. Each orphan's own
 * `LaneHandle` (laneId/path/branch), already exactly what `removeLaneWorktree` needs, comes straight
 * from `listOrphanedWorktrees` itself -- a TEST's own cleanup, unlike `forge doctor --fix`'s own
 * deliberately worktree-only `removeOrphanedWorktreeOnly` (`doctor/fix.ts`'s own doc comment: a real
 * orphaned branch may carry unmerged commits a human has not yet reviewed), has no such human-review
 * concern to preserve, so the full, already-proven `removeLaneWorktree` (worktree AND branch together)
 * is the right, simpler tool here. */
async function sweepOrphans(cwd: string): Promise<void> {
  for (const handle of await listOrphanedWorktrees(cwd)) {
    await removeLaneWorktree(cwd, handle, { retain: false });
  }
}

/** How long one real, uninterrupted run takes on THIS environment, right now — measured directly
 * rather than assumed, per a round-1 gauntlet critic finding against this file's own prior, hardcoded
 * delay list: real per-phase timing (vitest startup/collection, git operations) varies meaningfully by
 * machine and load, and a fixed millisecond guess silently stops covering the scenario it claims to
 * (a kill during restore/verification) the moment the real environment is slower than whatever the
 * guess assumed. Spawns the identical fixture child with a `killDelayMs` far longer than any real run
 * could take, so `spawnKillAndWait`'s own "already exited" branch fires and no kill is ever sent. */
async function measureUninterruptedDurationMs(
  dir: string,
  baseSha: string,
  runId: string,
): Promise<number> {
  // Deliberately NOT `spawnKillAndWait`: its own `setTimeout(resolve, killDelayMs)` blocks for the
  // FULL delay regardless of whether the child already exited (it only checks `exitedAlready` AFTER
  // that wait, to decide whether to still send a signal) -- correct for a real kill trial, which must
  // wait out its own delay, but wrong here, where the point is to measure how long a run genuinely
  // takes, as fast as that real answer arrives. This spawns the identical fixture child and just waits
  // for it to finish on its own.
  const child = spawn(
    'node',
    [
      '--experimental-strip-types',
      FIXTURE_CHILD_PATH,
      dir,
      runId,
      'STORY-TIMING-PROBE',
      baseSha,
      TEST_COMMAND,
    ],
    { detached: true },
  );
  // From "STARTED," not from spawn: `spawnKillAndWait`'s own kill-delay countdown starts there too
  // (after waiting out real Node/type-stripping startup), so this measurement must use the identical
  // starting point to give the proportional delays below a real, comparable basis.
  let t0: number | undefined;
  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (t0 === undefined && chunk.toString().includes('STARTED')) t0 = Date.now();
    });
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`timing-probe run exited ${String(code)}`));
      else resolve();
    });
    child.on('error', reject);
  });
  if (t0 === undefined) throw new Error('timing-probe run exited before printing STARTED');
  return Date.now() - t0;
}

describe('runBindingCheck — a real SIGKILL at several real points during a genuine run', () => {
  it('a kill at each of several proportional points leaves the main repository completely unmutated, and any orphaned lane is discoverable and reclaimable', async () => {
    const probe = await freshRepo();
    const durationMs = await measureUninterruptedDurationMs(
      probe.dir,
      probe.baseSha,
      'run-sigkill-probe',
    );

    // Proportions of the REAL, just-measured duration, not fixed millisecond guesses: early (lane
    // creation), through the three real vitest invocations, and -- the scenario the prior, now-fixed
    // version of this file incorrectly claimed to cover without actually reaching it -- late enough
    // to land inside restore/verification on any real machine, not just a fast one.
    const proportions = [0.02, 0.2, 0.4, 0.6, 0.8, 0.95];
    let killsLanded = 0;

    for (const proportion of proportions) {
      const killDelayMs = Math.max(1, Math.round(durationMs * proportion));
      const { dir, baseSha } = await freshRepo();
      const runId = `run-sigkill-${String(Math.round(proportion * 100))}pct`;
      const { stdout: headBefore } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
      const implBefore = await readFile(path.join(dir, 'impl.js'), 'utf8');

      const { killed } = await spawnKillAndWait(dir, runId, 'STORY-SIGKILL', baseSha, killDelayMs);
      if (killed) killsLanded += 1;

      // The genuinely absolute guarantee: the main repository's own TRACKED content, by construction,
      // never touched. `.forge/state/worktrees/<laneId>/` living inside the main repo's own working
      // directory (`@forge/vcs`'s own `worktreePath`) is real, benign, untracked noise on every lane
      // creation, successful or killed alike -- confirmed directly, not assumed, against a clean,
      // uninterrupted run before asserting this; a left-behind `.forge/` entry is exactly what the
      // second-layer orphan sweep below exists to reclaim, not a tracked-content mutation.
      const { stdout: headAfter } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
      expect(headAfter.trim()).toBe(headBefore.trim());
      const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: dir });
      const trackedChanges = status
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.endsWith('.forge/'));
      expect(trackedChanges).toEqual([]);
      await expect(readFile(path.join(dir, 'impl.js'), 'utf8')).resolves.toBe(implBefore);

      // The second-layer guarantee: whatever lane the kill left behind (zero or one -- never more,
      // never silently invisible) is exactly what the pre-existing orphan sweep already knows how to
      // find and remove.
      const orphans = await listOrphanedWorktrees(dir);
      expect(orphans.length).toBeLessThanOrEqual(1);
      await sweepOrphans(dir);
      expect(await listOrphanedWorktrees(dir)).toEqual([]);
    }

    // The real coverage claim this suite makes: most proportional trials must have landed a genuine
    // kill (not silently all finished first) -- a round-1 critic's own "exitedAlready skip branch
    // could silently degrade coverage with no warning" finding, closed with a real assertion rather
    // than another unchecked comment.
    expect(killsLanded).toBeGreaterThanOrEqual(Math.ceil(proportions.length * 0.6));
  }, 60_000);
});
