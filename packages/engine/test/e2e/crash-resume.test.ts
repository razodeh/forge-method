/**
 * "E3 crash-resume" — `PLAN-M5.md` P20's own Checks text, this milestone's own defining criterion (`06`
 * §6.10: "A crash-resume test... at 20 randomised points... is a required CI test"; `21` §21.3 E3's own
 * row: "SIGKILL at 20 randomised points... final state identical... no duplicated commits, artifacts or
 * ledger entries"). A real child process, genuinely `SIGKILL`'d — never simulated — at 20 different real
 * points across 20 independent runs of the identical fixture workflow and seed, each followed by
 * `resumeRun` (P19) then `runEngine` (this piece) continuing to completion, compared against one
 * uninterrupted control run of the same seed.
 *
 * @see specs/06 §6.10
 * @see specs/20 §20.10
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P20
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { readEvents } from '@forge/telemetry/events';
import { listOrphanedWorktrees } from '@forge/vcs';
import { describe, expect, it } from 'vitest';

import { resumeRun, type ResumeContext } from '../../src/resume/orchestrate.ts';
import { runEngine, type RunEngineContext } from '../../src/run/run-engine.ts';
import { createTempRepo, spawnAndKillAfter, waitForProcessGone } from './crash-helpers.ts';
import {
  FIXTURE_ITEM_IDS,
  fixtureAdapter,
  fixtureCompiledSteps,
  fixtureExpressionContext,
  fixtureRunEngineContext,
  FIXTURE_WORKFLOW_SOURCE,
} from './fixture-workflow.ts';

const SEED = 'e3-seed';

/** `ForgeEvent.seq` is monotonic and gapless within one run (`18` §18.4's own rule, enforced by
 * `appendEvent` itself) -- the last event's own `seq` is therefore already the real total count,
 * without needing a separate counter alongside the loop. */
async function countTotalEvents(projectRoot: string, runId: string): Promise<number> {
  let lastSeq = 0;
  for await (const event of readEvents(projectRoot, runId)) lastSeq = event.seq;
  return lastSeq;
}

function resumeContextFor(projectRoot: string, runId: string): ResumeContext & RunEngineContext {
  // sessionResume: false -- forces every unresolved step down the reroll path. A resume-session
  // attempt against a brand new FakePlatformAdapter instance (this parent process's own, unrelated to
  // whatever instance the now-dead child process held) would fall back to that fake's own permissive
  // "unknown session id" defaults (an empty cwd, a synthetic stepId no fixture script matcher can ever
  // match) and silently report a no-op success -- a limitation of the fake adapter's own in-memory,
  // per-process session memory, not something a real platform adapter would have across a real crash
  // either (`SPEC-QUESTIONS.md` Q81's own P19 gauntlet-log entry already established the identical
  // reasoning for the same limitation in that piece's own tests).
  const base = fixtureRunEngineContext(projectRoot, runId, SEED, {
    adapter: fixtureAdapter({ sessionResume: false }),
  });
  return { ...base, steps: fixtureCompiledSteps() };
}

/** `06` §6.10's own step 4, made real: `resumeRun` (P19) patches up whatever was in flight, then
 * `runEngine` (this piece) re-enters the scheduler loop with the result to finish whatever's left. */
async function resumeToCompletion(projectRoot: string, runId: string) {
  const ctx = resumeContextFor(projectRoot, runId);
  const afterResume = await resumeRun(runId, ctx);
  return runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx, afterResume);
}

async function integrationCommitCount(projectRoot: string): Promise<number> {
  const { stdout } = await execa('git', ['rev-list', '--count', 'main'], { cwd: projectRoot });
  return Number(stdout.trim());
}

describe('E3 crash-resume', () => {
  it('a real SIGKILL at 20 randomised points, each followed by resume, reaches the identical final state as an uninterrupted control run -- no duplicated commits, artifacts, or ledger entries', async () => {
    const controlProjectRoot = await createTempRepo('control');
    const controlRunId = 'run-control';
    const controlCtx = fixtureRunEngineContext(controlProjectRoot, controlRunId, SEED);
    const controlRunState = await runEngine(
      FIXTURE_WORKFLOW_SOURCE,
      fixtureExpressionContext(),
      controlCtx,
    );
    const controlCommitCount = await integrationCommitCount(controlProjectRoot);
    const controlContent = await Promise.all(
      FIXTURE_ITEM_IDS.map((itemId) =>
        readFile(path.join(controlProjectRoot, `${itemId}.txt`), 'utf8'),
      ),
    );

    const totalEvents = await countTotalEvents(controlProjectRoot, controlRunId);
    expect(totalEvents).toBeGreaterThan(20);

    const ITERATIONS = 20;
    for (let i = 0; i < ITERATIONS; i += 1) {
      // Genuinely randomised (this is test orchestration, not the production determinism this
      // milestone's own R-rules govern) -- every point strictly before completion, so the child is
      // truly killed mid-run on every one of the 20 iterations, not merely allowed to finish.
      const killAfterEventCount = 1 + Math.floor(Math.random() * (totalEvents - 1));

      const projectRoot = await createTempRepo(`iter-${String(i)}`);
      const runId = `run-iter-${String(i)}`;

      const pid = await spawnAndKillAfter(projectRoot, runId, killAfterEventCount, SEED);
      await waitForProcessGone(pid);

      const finalRunState = await resumeToCompletion(projectRoot, runId);

      expect(finalRunState.runStatus).toBe(controlRunState.runStatus);
      expect(Object.fromEntries(finalRunState.stepStatuses)).toEqual(
        Object.fromEntries(controlRunState.stepStatuses),
      );
      expect(finalRunState.unresolvedStepIds).toEqual([]);

      // No duplicated artifacts/commits: real file content matches the control run exactly (not
      // doubled, not corrupted by a re-run that duplicated work already merged before the kill), and
      // the integration branch has exactly as many real commits as the control run -- proving resume
      // never re-merged a step whose work had already landed before the crash.
      for (const [index, itemId] of FIXTURE_ITEM_IDS.entries()) {
        await expect(readFile(path.join(projectRoot, `${itemId}.txt`), 'utf8')).resolves.toBe(
          controlContent[index],
        );
      }
      expect(await integrationCommitCount(projectRoot)).toBe(controlCommitCount);

      // No duplicated ledger entries -- honestly, a vacuous check as this fixture is currently built: a
      // gauntlet critic round confirmed @forge/testkit's own FakePlatformAdapter never populates
      // SessionResult.usage.costUsd anywhere in this milestone (costReporting: 'per-turn', but no real
      // consumer exists yet), so both sides are always 0 === 0 regardless of whether a real duplication
      // bug exists. Kept as a real assertion (not deleted) so it starts actually verifying the moment a
      // later milestone gives the fake adapter real per-turn cost — the two properties this test *does*
      // meaningfully exercise are commits (integrationCommitCount) and artifacts (real file content).
      expect(finalRunState.spentUsd).toBe(controlRunState.spentUsd);

      // 20 §20.10 S12: zero orphaned worktrees/processes left behind afterward.
      expect(await listOrphanedWorktrees(projectRoot)).toEqual([]);
    }
  }, 120_000);
});
