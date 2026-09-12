/**
 * `20` §20.10 S12 — "a genuine supervisor-level crash leaves no orphaned child processes or worktrees
 * blocking a subsequent resume."
 *
 * `packages/engine/test/e2e/crash-resume.test.ts` (E3, `PLAN-M5.md` P20) already asserts
 * `listOrphanedWorktrees(...) === []` after every one of its own 20 *randomised* kill points, and its
 * own doc comment already documents the real, previously-fixed group-kill fidelity bug this invariant
 * depends on (`SPEC-QUESTIONS.md` Q149: a plain `child.kill('SIGKILL')` left a real `git worktree add`
 * subprocess orphaned and running after the "crash," which then finished the worktree *after* resume
 * had already begun reconciling — fixed by `detached: true` + `process.kill(-pid, 'SIGKILL')`, the
 * POSIX process-*group*-kill convention). That existing coverage is real, but leaves three real gaps
 * this S-labeled adversarial test closes:
 *
 * 1. E3 only ever checks `listOrphanedWorktrees` — never `listOrphanedLaneBranches` or
 *    `listOrphanedWorktreeDirectories`, Q149's own decisions 2 and 3, two of the five real leftover
 *    shapes a crash mid `git worktree add` can produce. This test checks all three.
 * 2. E3 never independently confirms the *process* side of "no orphaned child processes" at all — it
 *    infers "no orphan survived" only from the worktree state being clean afterward, never from the OS
 *    process table directly. This test queries the real OS process table itself, after every kill, to
 *    confirm zero processes anywhere on the host still carry the killed run's own process-group id —
 *    the literal, adversarial proof that a group-kill (not just a single-pid kill) actually reached
 *    every real descendant, independent of whatever git-visible leftovers it did or didn't produce.
 *    POSIX-only (`ps`'s own `-o pid=,pgid=` field selection has no Windows equivalent, and negative-pid
 *    process-group signaling is itself a POSIX-only concept `spawnAndKillAfter`'s own doc comment
 *    already relies on) — skipped on `win32`, the same `it.skipIf(process.platform === 'win32')`
 *    pattern `packages/vcs/test/git.test.ts`/`packages/telemetry/test/events.test.ts` already establish
 *    for the identical class of POSIX-only mechanism.
 * 3. E3's own 20 points are *randomised* across the whole run — reproducibly hitting the one real,
 *    narrow race window that actually produces a leftover (`git worktree add`'s own short window, per
 *    Q149) is left to chance. This test instead kills at a deterministic, *empirically confirmed* set
 *    of event counts (`KILL_POINTS`, chosen from a real recorded event trace of this exact fixture/seed
 *    — see that constant's own doc comment for the concrete seq numbers and why), and additionally
 *    verifies, directly, that the race window was actually hit at least once across all iterations
 *    (`raceWindowHitCount`) — so a future change to the fixture's own scheduling that silently moves the
 *    window out from under these fixed points fails this test loudly, rather than leaving it passing
 *    while testing nothing real.
 *
 * A resume "blocked" by a leftover is not a hang this test could wait out — every leftover Q149
 * documents surfaces as `resumeRun`/a retried `createLaneWorktree` throwing (a `git` refusal: "branch
 * ... already exists," "fatal: '...' already exists," "not a .git file"). `resumeToCompletion` failing
 * to complete without throwing *is* the failure mode this test's own name asserts against.
 *
 * @see specs/20 §20.10
 * @see specs/06 §6.10
 * @see specs/21 §21.3
 * @see PLAN-M11.md P12
 * @see SPEC-QUESTIONS.md Q149
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { readEvents } from '@forge/telemetry/events';
import {
  listOrphanedLaneBranches,
  listOrphanedWorktreeDirectories,
  listOrphanedWorktrees,
} from '@forge/vcs';
import { describe, expect, it } from 'vitest';

import { resumeRun, type ResumeContext } from '../../src/resume/orchestrate.ts';
import { runEngine, type RunEngineContext } from '../../src/run/run-engine.ts';
import { createTempRepo, spawnAndKillAfter, waitForProcessGone } from '../e2e/crash-helpers.ts';
import {
  FIXTURE_ITEM_IDS,
  fixtureAdapter,
  fixtureCompiledSteps,
  fixtureExpressionContext,
  fixtureRunEngineContext,
  FIXTURE_WORKFLOW_SOURCE,
} from '../e2e/fixture-workflow.ts';

const SEED = 's12-seed';

/** Every real, currently-running process's own `(pid, pgid)` pair, straight from the OS's own process
 * table (`ps`, not this process's own bookkeeping) — the one source of truth this test's own S12 claim
 * ("no orphaned child processes") can actually be checked against directly, independent of whatever
 * `@forge/vcs`'s git-level leftover detectors do or don't see. POSIX-only, see this file's own top doc
 * comment (gap 2). */
async function listProcessGroups(): Promise<ReadonlyMap<number, number>> {
  const { stdout } = await execa('ps', ['-e', '-o', 'pid=,pgid=']);
  const groups = new Map<number, number>();
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const [pidStr, pgidStr] = trimmed.split(/\s+/);
    if (pidStr === undefined || pgidStr === undefined) continue;
    groups.set(Number(pidStr), Number(pgidStr));
  }
  return groups;
}

/** Polls the real OS process table (not just the one pid `waitForProcessGone` already confirmed dead)
 * until genuinely zero processes anywhere on the host still carry `pgid` — the detached fixture child's
 * own pgid always equals its own pid (`spawn(..., { detached: true })`'s own contract), so this is
 * checking for *any* survivor from that whole group: the fixture process itself, and every real
 * descendant it spawned (concretely: `@forge/vcs`'s own `execa('git', ['worktree', 'add', ...])` calls),
 * which is exactly what a plain single-pid kill (the real bug Q149 found and fixed) would have left
 * behind. */
async function waitForGroupGone(pgid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const groups = await listProcessGroups();
    if (![...groups.values()].includes(pgid)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`process group ${String(pgid)} still has a live member after waiting`);
}

async function countTotalEvents(projectRoot: string, runId: string): Promise<number> {
  let lastSeq = 0;
  for await (const event of readEvents(projectRoot, runId)) lastSeq = event.seq;
  return lastSeq;
}

function resumeContextFor(projectRoot: string, runId: string): ResumeContext & RunEngineContext {
  const base = fixtureRunEngineContext(projectRoot, runId, SEED, {
    adapter: fixtureAdapter({ sessionResume: false }),
  });
  return { ...base, steps: fixtureCompiledSteps() };
}

async function resumeToCompletion(projectRoot: string, runId: string) {
  const ctx = resumeContextFor(projectRoot, runId);
  const afterResume = await resumeRun(runId, ctx);
  return runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx, afterResume);
}

/** Real event counts to kill at, chosen from a real recorded event trace of this exact fixture workflow
 * and seed (captured by hand, not guessed): `StepStarted` for both `implement` fanout lanes durably
 * lands at seq 8 and 9, immediately followed by their own `LaneCreated` events at seq 10 and 11 —
 * `LaneCreated` is only ever emitted *after* `createLaneWorktree`'s real `git worktree add` subprocess
 * has already completed, so the real window in which that subprocess is genuinely still running is
 * between a lane's own `StepStarted` and its own `LaneCreated`. Killing at 8 through 12 straddles both
 * lanes' own version of that window (a kill at 8 lands before either lane's worktree creation has even
 * started -- a legitimate "before anything durable exists" case Q149's own decision 1 also covers --
 * while 9 through 12 land increasingly deep into or just past it, covering the real timing jitter
 * between this synthetic, tick-ordered control trace and a real child process's actual wall-clock
 * scheduling of two concurrent `execa` calls). `raceWindowHitCount` below is the actual, empirical proof
 * this range still hits the window on this run -- not merely trusted from the one trace that produced
 * these numbers. */
const KILL_POINTS = [8, 9, 10, 11, 12] as const;

describe('S12 — orphan-free crash recovery (adversarial)', () => {
  // POSIX-only: `ps`'s own `-o pid=,pgid=` field selection and negative-pid process-group signaling
  // (`spawnAndKillAfter`'s own doc comment) have no Windows equivalent -- see this file's own top doc
  // comment, gap 2, and `packages/vcs/test/git.test.ts`/`packages/telemetry/test/events.test.ts` for the
  // identical, already-established `skipIf` pattern for this exact class of mechanism.
  it.skipIf(process.platform === 'win32')(
    "a real supervisor-level group-kill, at every empirically-confirmed point across implement's own worktree-creation race window, leaves zero orphaned processes, worktrees, branches, or directories, and never blocks the subsequent resume",
    async () => {
      const controlProjectRoot = await createTempRepo('control');
      const controlRunId = 'run-control';
      const controlRunState = await runEngine(
        FIXTURE_WORKFLOW_SOURCE,
        fixtureExpressionContext(),
        fixtureRunEngineContext(controlProjectRoot, controlRunId, SEED),
      );
      const controlContent = await Promise.all(
        FIXTURE_ITEM_IDS.map((itemId) =>
          readFile(path.join(controlProjectRoot, `${itemId}.txt`), 'utf8'),
        ),
      );
      const totalEvents = await countTotalEvents(controlProjectRoot, controlRunId);
      expect(totalEvents).toBeGreaterThan(Math.max(...KILL_POINTS));

      let raceWindowHitCount = 0;

      for (const [index, killAfterEventCount] of KILL_POINTS.entries()) {
        const projectRoot = await createTempRepo(`iter-${String(index)}`);
        const runId = `run-iter-${String(index)}`;

        const pid = await spawnAndKillAfter(projectRoot, runId, killAfterEventCount, SEED);
        await waitForProcessGone(pid);
        // `detached: true`'s own contract: the fixture child is the leader of its own process group, so
        // its own pgid equals its own pid.
        await waitForGroupGone(pid);

        // Gap 2: the direct, adversarial proof — genuinely zero live processes anywhere on the host
        // still carry this run's own process-group id, not merely "the one pid we happened to spawn is
        // gone."
        const groupsAfterKill = await listProcessGroups();
        expect([...groupsAfterKill.values()].includes(pid)).toBe(false);

        // The empirical proof for gap 3: did this kill point actually land while a real git-visible
        // leftover existed, *before* resume ever touches it? Checked before reclaiming anything, so a
        // false "always zero" from killing too early/too late is caught rather than silently assumed
        // away.
        const preResumeLeftovers = [
          ...(await listOrphanedWorktrees(projectRoot)),
          ...(await listOrphanedLaneBranches(projectRoot, runId)),
          ...(await listOrphanedWorktreeDirectories(projectRoot, runId)),
        ];
        if (preResumeLeftovers.length > 0) raceWindowHitCount += 1;

        // The actual "blocked" failure mode: a real leftover surfaces here as a thrown git refusal, not
        // a hang — see this file's own top doc comment.
        const finalRunState = await resumeToCompletion(projectRoot, runId);

        expect(finalRunState.runStatus).toBe(controlRunState.runStatus);
        expect(finalRunState.unresolvedStepIds).toEqual([]);
        for (const [itemIndex, itemId] of FIXTURE_ITEM_IDS.entries()) {
          await expect(readFile(path.join(projectRoot, `${itemId}.txt`), 'utf8')).resolves.toBe(
            controlContent[itemIndex],
          );
        }

        // Gap 1: all three of Q149's own real leftover shapes, not merely the one E3 already checks.
        expect(await listOrphanedWorktrees(projectRoot)).toEqual([]);
        expect(await listOrphanedLaneBranches(projectRoot, runId)).toEqual([]);
        expect(await listOrphanedWorktreeDirectories(projectRoot, runId)).toEqual([]);
      }

      // The test that would catch gap 3 regressing: if every one of `KILL_POINTS` now lands entirely
      // outside the real race window (e.g. a future change to `implement`'s own scheduling shifts it),
      // every iteration above would still pass vacuously — this is the one assertion that actually rules
      // that out, for this run.
      expect(raceWindowHitCount).toBeGreaterThan(0);
    },
    120_000,
  );
});
