/**
 * `runHunkMutationCheck` — `specs/22` M16 P12's own "Tests first" line, extending `binding-
 * sigkill.test.ts`'s own M15 P3 proof to the per-hunk mutation loop: "SIGKILL mid-mutation leaves no
 * worktree and no half-reverted tree" has to hold not only during the three change-level runs, but
 * across the WHOLE N+3 sequence, including while a per-hunk mutant is applying its own reversal or
 * running the story's tests. A real, detached child process (never a simulated crash) is `SIGKILL`'d,
 * as a process GROUP (the identical real bug `binding-sigkill.test.ts`'s own doc comment names,
 * `SPEC-QUESTIONS.md` Q149), at several real wall-clock points spanning the genuine, full run —
 * reusing the identical spawn/group-kill/wait-gone pattern that file already establishes, duplicated
 * here rather than imported (test files in this package do not share fixture helpers across files,
 * the convention `hunks.test.ts`'s own doc comment already states).
 *
 * What a `SIGKILL` can and cannot guarantee, precisely, is unchanged from `binding-sigkill.test.ts`'s
 * own doc comment: `finally` blocks never run once a process is `SIGKILL`'d, so `runHunkMutationCheck`'s
 * own lane cleanup (`@forge/vcs`'s `removeLaneWorktree`, called from `createBindingLane`'s caller) is
 * real but not itself a guarantee against this one signal; `listOrphanedWorktrees`/`removeLaneWorktree`
 * are the real, already-established second layer this test proves can still reclaim what a kill left
 * behind. The genuinely absolute guarantee is the MAIN repository: this engine never performs a
 * single git operation against `projectRoot` itself (every apply/revert/reset is scoped to the lane
 * worktree alone), so a kill at any point leaves it unmutated BY CONSTRUCTION.
 *
 * @see specs/06 §6.10
 * @see specs/13 F-TEST-10
 * @see specs/22 M15 P3
 * @see specs/22 M16 P12
 * @see SPEC-QUESTIONS.md Q149
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
  new URL('./fixtures/hunk-mutation-check-child.ts', import.meta.url),
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

/** Two real, independent hunks (not one) -- so the kill's own proportional points genuinely span
 * BOTH the three change-level runs and at least two separate per-hunk mutant runs, never just the
 * first of either. */
async function freshRepo(): Promise<{ readonly dir: string; readonly baseSha: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-hunk-mutation-sigkill-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  await writeFile(
    path.join(dir, 'impl.js'),
    'export function a_value() { return 0; }\n\nexport function b_value() { return 0; }\n',
    'utf8',
  );
  const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'impl.js'),
    'export function a_value() { return 1; }\n\nexport function b_value() { return 1; }\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.test.js'),
    "import { test, expect } from 'vitest';\n" +
      "import { a_value, b_value } from './impl.js';\n" +
      "test('combo', () => { expect(a_value() + b_value()).toBe(2); });\n",
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'the story: two hunks'], { cwd: dir });
  return { dir, baseSha: baseSha.trim() };
}

/** Spawns the real fixture child, waits for its own `STARTED` line, then `SIGKILL`s the whole process
 * GROUP after `killDelayMs` more. Resolves once the OS confirms the process is genuinely gone, with
 * whether a kill was actually sent (`false` means the real run finished on its own first). Identical
 * to `binding-sigkill.test.ts`'s own `spawnKillAndWait`, duplicated for this file's own child path and
 * argument shape. */
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
  let killed = false;
  if (!exitedAlready.value) {
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

async function sweepOrphans(cwd: string): Promise<void> {
  for (const handle of await listOrphanedWorktrees(cwd)) {
    await removeLaneWorktree(cwd, handle, { retain: false });
  }
}

/** How long one real, uninterrupted run (three change-level runs plus two real per-hunk mutant runs)
 * takes on THIS environment, right now — measured directly, the identical reasoning
 * `binding-sigkill.test.ts`'s own `measureUninterruptedDurationMs` already gives for why a fixed
 * millisecond guess is wrong here. */
async function measureUninterruptedDurationMs(
  dir: string,
  baseSha: string,
  runId: string,
): Promise<number> {
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

describe('runHunkMutationCheck — a real SIGKILL at several real points across the whole N+3 sequence', () => {
  it('a kill at each of several proportional points leaves the main repository completely unmutated, and any orphaned lane is discoverable and reclaimable', async () => {
    const probe = await freshRepo();
    const durationMs = await measureUninterruptedDurationMs(
      probe.dir,
      probe.baseSha,
      'run-hm-sigkill-probe',
    );

    // Proportions of the REAL, just-measured duration -- spanning lane creation, the three
    // change-level runs, AND (the scenario `binding-sigkill.test.ts` cannot reach at all, since
    // `runBindingCheck` has no hunk loop) both per-hunk mutant runs.
    const proportions = [0.02, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.97];
    let killsLanded = 0;

    for (const proportion of proportions) {
      const killDelayMs = Math.max(1, Math.round(durationMs * proportion));
      const { dir, baseSha } = await freshRepo();
      const runId = `run-hm-sigkill-${String(Math.round(proportion * 100))}pct`;
      const { stdout: headBefore } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
      const implBefore = await readFile(path.join(dir, 'impl.js'), 'utf8');

      const { killed } = await spawnKillAndWait(
        dir,
        runId,
        'STORY-HM-SIGKILL',
        baseSha,
        killDelayMs,
      );
      if (killed) killsLanded += 1;

      const { stdout: headAfter } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
      expect(headAfter.trim()).toBe(headBefore.trim());
      const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: dir });
      const trackedChanges = status
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.endsWith('.forge/'));
      expect(trackedChanges).toEqual([]);
      await expect(readFile(path.join(dir, 'impl.js'), 'utf8')).resolves.toBe(implBefore);

      const orphans = await listOrphanedWorktrees(dir);
      expect(orphans.length).toBeLessThanOrEqual(1);
      await sweepOrphans(dir);
      expect(await listOrphanedWorktrees(dir)).toEqual([]);
    }

    expect(killsLanded).toBeGreaterThanOrEqual(Math.ceil(proportions.length * 0.6));
  }, 90_000);
});
