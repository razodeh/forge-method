/**
 * `resumeRun` — `PLAN-M5.md` P19's own Checks text: a resumed step whose adapter reports session-resume
 * support and a still-valid session id resumes without re-running any prior work, proven via the fake
 * adapter's own remembered-state; one whose session is invalid rolls the lane back and re-runs from the
 * idempotency key, proven by real file content in the lane before/after; an orphaned worktree left by a
 * killed process is reclaimed on resume rather than left to accumulate.
 *
 * @see specs/06 §6.10
 * @see PLAN-M5.md P19
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { createLaneWorktree, listOrphanedWorktrees, slugifyStepId } from '@forge/vcs';
import { appendEvent } from '@forge/telemetry/events';
import { FAKE_MODEL_ID, FakePlatformAdapter, withCapabilities } from '@forge/testkit';
import { describe, expect, it } from 'vitest';

import { toAgentId, type StepNode } from '../../src/plan/index.ts';
import { resumeRun, type ResumeContext } from '../../src/resume/orchestrate.ts';
import { createTestClock, createTestContext, node } from '../dispatch/helpers.ts';

// Not in a shared helper: node:os's tmpdir is R10-restricted in production code
// (packages/engine/test/dispatch/helpers.ts's own doc comment has the fuller reasoning).
async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-resume-orchestrate-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

let tickCounter = 0;
function nextTs(): string {
  tickCounter += 1;
  return `2026-01-01T00:00:${String(tickCounter).padStart(2, '0')}.000Z`;
}

/** Hand-builds the durable log a real crash mid-`runAgentWork` would have left behind: `StepStarted`,
 * `LaneCreated` (with the real `baseSha`), `SessionStarted`, `SessionEvent` (with `sessionId`) -- and
 * nothing terminal, exactly `RunState.unresolvedStepIds`' own contract. Mirrors real production
 * behaviour rather than reusing `executeStep` itself: there is no way to make a real end-to-end call
 * stop exactly mid-flight without an actual process kill (`PLAN-M5.md` P20's own job), so this test
 * suite constructs the identical *durable state* a real crash there would leave, the same as
 * `reconstruct.test.ts` already does for `reconstructRunState` alone, one layer up. */
async function writeUnresolvedStepLog(
  projectRoot: string,
  runId: string,
  stepId: string,
  laneId: string,
  baseSha: string,
  sessionId: string,
): Promise<void> {
  await appendEvent(projectRoot, runId, {
    ts: nextTs(),
    runId,
    type: 'StepStarted',
    stepId,
    payload: undefined,
  });
  await appendEvent(projectRoot, runId, {
    ts: nextTs(),
    runId,
    type: 'LaneCreated',
    stepId,
    laneId,
    payload: { baseSha },
  });
  await appendEvent(projectRoot, runId, {
    ts: nextTs(),
    runId,
    type: 'SessionStarted',
    stepId,
    laneId,
    payload: undefined,
  });
  await appendEvent(projectRoot, runId, {
    ts: nextTs(),
    runId,
    type: 'SessionEvent',
    stepId,
    laneId,
    payload: { sessionId },
  });
}

function agentNode(stepId: string, produces: readonly string[] = []): StepNode {
  return node({
    id: stepId,
    kind: 'agent',
    agent: toAgentId('engineer'),
    brief: 'do work',
    produces,
  });
}

describe('resumeRun', () => {
  it('resumes an in-flight session without re-running any prior work, when the adapter supports resume', async () => {
    const runId = 'run-resume';
    const stepId = 'wf:implement';
    const projectRoot = await createTempRepo('resume');
    const laneId = `${runId}-${slugifyStepId(stepId)}`;
    const lane = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    expect(lane.laneId).toBe(laneId);
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });

    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['picking up where the crashed session left off'],
      writeFiles: [{ relativePath: 'resumed.txt', content: 'finished after resume\n' }],
    });
    // A real startSession call, exactly what runAgentWork itself would issue -- registers this session
    // id's own real remembered context (crucially, the real lane.path as cwd) inside the fake adapter,
    // the same way a genuine adapter would remember a live session's own working directory. Never
    // awaiting handle.result() simulates a crash between the handle being acquired (this whole build's
    // own SessionEvent, emitted at exactly this point) and the session actually finishing.
    const handle = await adapter.startSession({
      runId,
      stepId,
      cwd: lane.path,
      systemPrompt: { mode: 'append', text: '' },
      prompt: 'do work',
      model: FAKE_MODEL_ID,
      tools: { read: true, write: true, exec: false, network: 'none' },
      permissionMode: 'accept-edits',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
      env: {},
      abortSignal: new AbortController().signal,
    });
    await writeUnresolvedStepLog(
      projectRoot,
      runId,
      stepId,
      laneId,
      baseSha.trim(),
      handle.sessionId,
    );
    adapter.startSession = () => {
      throw new Error(
        'should never call startSession -- a valid session must be resumed, not restarted',
      );
    };

    const steps = new Map([[stepId, agentNode(stepId, ['resumed.txt'])]]);
    const ctx: ResumeContext = { ...createTestContext({ projectRoot, adapter, runId }), steps };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.get(stepId)).toBe('succeeded');
    expect(runState.unresolvedStepIds).toEqual([]);
    await expect(readFile(path.join(lane.path, 'resumed.txt'), 'utf8')).resolves.toBe(
      'finished after resume\n',
    );
  });

  it('rolls the lane back and re-runs from scratch when the adapter does not support session resume, discarding pre-crash content', async () => {
    const runId = 'run-reroll';
    const stepId = 'wf:implement';
    const projectRoot = await createTempRepo('reroll');
    const laneId = `${runId}-${slugifyStepId(stepId)}`;
    const lane = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });
    // Real tool-use writes a crashed session left behind, never committed -- must not survive a reroll.
    await writeFile(path.join(lane.path, 'stale.txt'), 'leftover from the crashed session\n');
    await writeUnresolvedStepLog(
      projectRoot,
      runId,
      stepId,
      laneId,
      baseSha.trim(),
      'session-invalid',
    );

    const adapter = withCapabilities({ sessionResume: false });
    adapter.script(() => true, {
      text: ['starting fresh'],
      writeFiles: [{ relativePath: 'fresh.txt', content: 'new work after reroll\n' }],
    });

    const steps = new Map([[stepId, agentNode(stepId, ['fresh.txt'])]]);
    const ctx: ResumeContext = { ...createTestContext({ projectRoot, adapter, runId }), steps };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.get(stepId)).toBe('succeeded');
    expect(existsSync(path.join(lane.path, 'stale.txt'))).toBe(false);
    await expect(readFile(path.join(lane.path, 'fresh.txt'), 'utf8')).resolves.toBe(
      'new work after reroll\n',
    );
  });

  it('reports the step as "failed" (not "succeeded" or left "running") when the re-run itself fails', async () => {
    const runId = 'run-reroll-fails';
    const stepId = 'wf:implement';
    const projectRoot = await createTempRepo('reroll-fails');
    const laneId = `${runId}-${slugifyStepId(stepId)}`;
    const lane = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });
    await writeUnresolvedStepLog(
      projectRoot,
      runId,
      stepId,
      laneId,
      baseSha.trim(),
      'session-invalid',
    );

    const adapter = withCapabilities({ sessionResume: false });
    adapter.script(() => true, { text: ['tried again'], endReason: 'error' });

    const steps = new Map([[stepId, agentNode(stepId)]]);
    const ctx: ResumeContext = { ...createTestContext({ projectRoot, adapter, runId }), steps };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.get(stepId)).toBe('failed');
    expect(runState.unresolvedStepIds).toEqual([]);
  });

  it('falls back to a fresh reroll when a resume-session attempt itself fails, rather than permanently failing the step', async () => {
    const runId = 'run-resume-then-fallback';
    const stepId = 'wf:implement';
    const projectRoot = await createTempRepo('resume-then-fallback');
    const laneId = `${runId}-${slugifyStepId(stepId)}`;
    const lane = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });
    await writeUnresolvedStepLog(
      projectRoot,
      runId,
      stepId,
      laneId,
      baseSha.trim(),
      'session-that-fails-to-resume',
    );

    const adapter = new FakePlatformAdapter();
    // sessionResume stays true (the default), so decideResumeStrategy picks 'resume-session' first --
    // but the resume itself fails, proving resumeAgentStep really does fall back to a fresh reroll
    // rather than reporting the step permanently failed the moment a resume attempt goes wrong.
    adapter.resumeSession = (sessionId) =>
      Promise.resolve({
        sessionId,
        events: (async function* () {
          // No events -- this attempt is scripted to fail outright.
        })(),
        stop: () => Promise.resolve(),
        result: () =>
          Promise.resolve({
            sessionId,
            ok: false,
            finalText: '',
            usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
            durationMs: 0,
            changedFiles: [],
            controlTokens: [],
            error: { code: 'SESSION_EXPIRED', message: 'this session id is no longer resumable' },
          }),
      });
    adapter.script(() => true, {
      text: ['starting over after the failed resume'],
      writeFiles: [{ relativePath: 'recovered.txt', content: 'recovered via fallback reroll\n' }],
    });

    const steps = new Map([[stepId, agentNode(stepId, ['recovered.txt'])]]);
    const ctx: ResumeContext = { ...createTestContext({ projectRoot, adapter, runId }), steps };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.get(stepId)).toBe('succeeded');
    await expect(readFile(path.join(lane.path, 'recovered.txt'), 'utf8')).resolves.toBe(
      'recovered via fallback reroll\n',
    );
  });

  it('discards partial writes a failed resume attempt already committed, not just ones it left uncommitted', async () => {
    // The exact bug a gauntlet verify round found in the first version of the resume-then-fallback
    // path: rolling back to a freshly re-resolved 'HEAD' *after* the failed resume attempt had already
    // run is a no-op if that attempt itself committed real partial work before failing (runAgentWork's
    // own documented behaviour -- a crash after real tool-use writes still gets them committed). The
    // rollback target must be captured *before* the resume attempt runs, or the "fresh" reroll silently
    // inherits the failed attempt's own stale content instead of actually discarding it.
    const runId = 'run-resume-commits-then-fails';
    const stepId = 'wf:implement';
    const projectRoot = await createTempRepo('resume-commits-then-fails');
    const laneId = `${runId}-${slugifyStepId(stepId)}`;
    const lane = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });
    await writeUnresolvedStepLog(
      projectRoot,
      runId,
      stepId,
      laneId,
      baseSha.trim(),
      'session-that-commits-then-fails',
    );

    const adapter = new FakePlatformAdapter();
    adapter.resumeSession = (sessionId) =>
      Promise.resolve({
        sessionId,
        events: (async function* () {
          // No events -- this attempt writes a real file, then reports failure.
        })(),
        stop: () => Promise.resolve(),
        result: async () => {
          // Real tool-use work the resumed session did before failing -- this is what runLaneLifecycle
          // commits despite the attempt's own overall failure (steps.ts's own documented behaviour).
          await writeFile(path.join(lane.path, 'partial-resume-work.txt'), 'should not survive\n');
          return {
            sessionId,
            ok: false,
            finalText: '',
            usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
            durationMs: 0,
            changedFiles: ['partial-resume-work.txt'],
            controlTokens: [],
            error: { code: 'SESSION_EXPIRED', message: 'this session id is no longer resumable' },
          };
        },
      });
    adapter.script(() => true, {
      text: ['starting over after the failed resume'],
      writeFiles: [{ relativePath: 'fresh-after-fallback.txt', content: 'genuinely fresh work\n' }],
    });

    // Both paths declared in-claim: `partial-resume-work.txt` must NOT survive because the rollback
    // actually discards it -- not merely because claim enforcement would have reverted an undeclared
    // out-of-claim write regardless, which would mask this exact bug (a gauntlet verify round confirmed
    // this test needed the fix to reproduce with claim enforcement alone stripping the file either way).
    const steps = new Map([
      [stepId, agentNode(stepId, ['partial-resume-work.txt', 'fresh-after-fallback.txt'])],
    ]);
    const ctx: ResumeContext = { ...createTestContext({ projectRoot, adapter, runId }), steps };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.get(stepId)).toBe('succeeded');
    expect(existsSync(path.join(lane.path, 'partial-resume-work.txt'))).toBe(false);
    await expect(readFile(path.join(lane.path, 'fresh-after-fallback.txt'), 'utf8')).resolves.toBe(
      'genuinely fresh work\n',
    );
  });

  it('reclaims a worktree orphaned by a killed process for this run, not left to accumulate', async () => {
    const runId = 'run-orphan';
    const projectRoot = await createTempRepo('orphan');
    // Bypasses this run's own real lane-lifecycle entirely -- an even earlier crash than a recorded
    // LaneCreated could survive, the identical "discoverable via git's own bookkeeping alone" scenario
    // packages/vcs/test/lanes.test.ts already proves listOrphanedWorktrees itself handles.
    const orphan = await createLaneWorktree(projectRoot, {
      runId,
      stepId: 'wf:never-logged',
      integrationBase: 'main',
    });

    const ctx: ResumeContext = {
      ...createTestContext({ projectRoot, runId, now: createTestClock() }),
      steps: new Map(),
    };

    await resumeRun(runId, ctx);

    const remaining = await listOrphanedWorktrees(projectRoot);
    expect(remaining.map((handle) => handle.laneId)).not.toContain(orphan.laneId);
  });

  it('never reclaims a worktree belonging to a different run', async () => {
    const runId = 'run-a';
    const otherRunId = 'run-b';
    const projectRoot = await createTempRepo('cross-run');
    const otherRunLane = await createLaneWorktree(projectRoot, {
      runId: otherRunId,
      stepId: 'wf:other',
      integrationBase: 'main',
    });

    const ctx: ResumeContext = {
      ...createTestContext({ projectRoot, runId, now: createTestClock() }),
      steps: new Map(),
    };

    await resumeRun(runId, ctx);

    const remaining = await listOrphanedWorktrees(projectRoot);
    expect(remaining.map((handle) => handle.laneId)).toContain(otherRunLane.laneId);
  });

  it('falls back to "scheduled" (the ordinary fresh-lane path) for an unresolved step with no compiled StepNode at all', async () => {
    const runId = 'run-no-node';
    const stepId = 'wf:unknown';
    const projectRoot = await createTempRepo('no-node');
    const laneId = `${runId}-${slugifyStepId(stepId)}`;
    const lane = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });
    await writeUnresolvedStepLog(projectRoot, runId, stepId, laneId, baseSha.trim(), 'session-x');

    const ctx: ResumeContext = {
      ...createTestContext({ projectRoot, runId, now: createTestClock() }),
      steps: new Map(), // the compiled plan has nothing for this step id
    };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.get(stepId)).toBe('scheduled');
    expect(runState.unresolvedStepIds).toEqual([]);
    // The stale lane a crash before this step's own real re-run left behind must actually be gone --
    // not merely marked scheduled while the same worktree/branch is still sitting on disk. Proven by
    // the ordinary scheduler path's own createLaneWorktree succeeding for the identical (runId, stepId)
    // afterward: git's own "branch/worktree already exists" refusal would fire otherwise (a gauntlet
    // critic round found the original version of this fallback left exactly this collision behind).
    const fresh = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    expect(fresh.laneId).toBe(laneId);
  });

  it('falls back to "scheduled" for an unresolved agent step with no recorded lane origin (an even earlier crash than LaneCreated)', async () => {
    const runId = 'run-no-origin';
    const stepId = 'wf:implement';
    const projectRoot = await createTempRepo('no-origin');
    // Only StepStarted -- no LaneCreated, so RunState.laneOrigins has nothing for this step at all.
    await appendEvent(projectRoot, runId, {
      ts: nextTs(),
      runId,
      type: 'StepStarted',
      stepId,
      payload: undefined,
    });

    const steps = new Map([[stepId, agentNode(stepId)]]);
    const ctx: ResumeContext = {
      ...createTestContext({ projectRoot, runId, now: createTestClock() }),
      steps,
    };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.get(stepId)).toBe('scheduled');
  });

  it('does nothing (an empty but well-defined RunState) for a run with no event log at all', async () => {
    const runId = 'run-empty';
    const projectRoot = await createTempRepo('empty');
    const ctx: ResumeContext = {
      ...createTestContext({ projectRoot, runId, now: createTestClock() }),
      steps: new Map(),
    };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.size).toBe(0);
    expect(runState.unresolvedStepIds).toEqual([]);
  });
});
