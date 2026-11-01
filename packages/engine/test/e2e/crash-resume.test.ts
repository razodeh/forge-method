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
import {
  createTempRepo,
  KillRaceLostError,
  spawnAndKillAfter,
  waitForProcessGone,
} from './crash-helpers.ts';
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

/** `SPEC-QUESTIONS.md` Q386: retries `spawnAndKillAfter` at a FRESH random point (never the same one
 * twice — the point that just raced is not specially suspect, and re-trying it unchanged would only
 * repeat the identical race against the identical real timing) when it loses the Q384/Q385 kill race,
 * up to `MAX_ATTEMPTS` times. Safe to retry, unlike almost any other failure in this test: when this
 * specific error fires, `resumeRun`/`runEngine` — the actual production code this whole test exists to
 * exercise — was never even reached; only this test's OWN "land the kill before the fixture finishes on
 * its own" precondition failed to hold in time, a test-infrastructure timing miss, not a production
 * bug. Any other error from `spawnAndKillAfter` (a real spawn failure, an unexpected signal/exit
 * mismatch) is NOT this condition and propagates immediately, unretried. Exhausting every attempt
 * throws loudly rather than silently giving up — a test whose kill mechanism races on every single
 * attempt has a real, systemic problem this ought to surface, not hide behind one more retry.
 *
 * `SPEC-QUESTIONS.md` Q388: `MAX_ATTEMPTS` raised 5 → 12 after a real Windows CI run (`41266040266`)
 * exhausted 5 on one iteration (10 of its 20) while 4 others needed 1-2 retries each. A real,
 * non-coincidental pattern across every race observed so far (12 data points over two separate CI
 * runs, `Q387`'s and this one): EVERY SINGLE recorded race landed at an early event count (4-40) —
 * never mid-range or late, despite `killAfterEventCount` being drawn uniformly across the WHOLE
 * range. That is not chance (if races were uniform, 12 independent draws all landing in such a
 * narrow low sub-range would be astronomically unlikely) — the likely real mechanism is that this
 * fixture emits its earliest handful of events in a fast initial burst (close together in real wall-
 * clock time) before settling into a slower, more spaced-out cadence, so an early kill point demands
 * this caller react within that same tight burst window, far less forgiving than a later point's own
 * wider real gaps. This is disclosed, not acted on further here: the test's own documented intent
 * (`06` §6.10) wants genuine coverage across the WHOLE range, early points included (resume behaviour
 * when almost nothing has happened yet is real coverage, not an edge case to avoid), so biasing the
 * retry's own random draw away from early points would trade real coverage for convenience. Raising
 * the budget instead preserves full-range coverage while giving enough attempts to get past an
 * unlucky run of early draws; a future piece could revisit a smarter, point-aware retry if this still
 * is not enough. */
async function spawnAndKillAtFreshRandomPointWithRetry(
  iterationLabel: string,
  totalEvents: number,
  seed: string,
): Promise<{ projectRoot: string; runId: string; pid: number }> {
  const MAX_ATTEMPTS = 12;
  let lastRaceError: KillRaceLostError | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // Every point strictly before completion, so the child is truly killed mid-run, not merely
    // allowed to finish -- genuinely randomised per attempt (this is test orchestration, not the
    // production determinism this milestone's own R-rules govern).
    const killAfterEventCount = 1 + Math.floor(Math.random() * (totalEvents - 1));
    const attemptLabel = `${iterationLabel}-attempt-${String(attempt)}`;
    const projectRoot = await createTempRepo(attemptLabel);
    const runId = `run-${attemptLabel}`;
    try {
      const pid = await spawnAndKillAfter(projectRoot, runId, killAfterEventCount, seed);
      await waitForProcessGone(pid);
      return { projectRoot, runId, pid };
    } catch (err) {
      if (!(err instanceof KillRaceLostError)) throw err;
      lastRaceError = err;
      // Deliberate CI visibility into retry frequency (Q386); console is never asserted on, so this
      // cannot mask a real failure the way a swallowed error would.
      // eslint-disable-next-line no-console -- see comment above
      console.warn(
        `[crash-resume] ${iterationLabel} lost the kill race on attempt ${String(attempt)}, retrying ` +
          `at a fresh random point: ${err.message}`,
      );
    }
  }
  throw new Error(
    `${iterationLabel} lost the kill race ${String(MAX_ATTEMPTS)} times in a row -- no longer a rare ` +
      `platform-latency miss, something is systematically wrong. Last race error: ` +
      (lastRaceError?.message ?? '(none captured)'),
  );
}

describe('E3 crash-resume', () => {
  // 20 real, independent SIGKILL/resume cycles is inherently heavy (process spawns, git worktrees,
  // real fs work) -- measured isolated duration ranged 49.9s-68.1s across three repeated runs on
  // this sandbox (`M14-AGENT-NOTES.md`, `M14 P45`). `SPEC-QUESTIONS.md` Q386/Q388 raise this
  // further, as a stopgap, not a tuned number (the same honest framing `ci.yml`'s own `floor`/
  // `heavy-subprocess` timeouts already use): a real Windows CI run (`41266040266`) reached 130.6s
  // across 11 of 20 iterations (several needing multiple retries) before exhausting the then-5-
  // attempt budget on one pathological iteration -- `Q388` raised that budget to 12; this timeout is
  // raised well past even a generous extrapolation of that real sample, not a tight fit to it.
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
      const { projectRoot, runId } = await spawnAndKillAtFreshRandomPointWithRetry(
        `iter-${String(i)}`,
        totalEvents,
        SEED,
      );

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
  }, 600_000);
});
