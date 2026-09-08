/**
 * `runAgentStep` (via `executeStep`) — `PLAN-M5.md` P15's own Checks text: an `agent` step runs a real
 * `FakePlatformAdapter` session inside a real tmp-dir lane and its `SessionResult` becomes the step's own
 * outcome; claim enforcement runs on every completion, proven by an out-of-claim write being reverted
 * through this entry point; the full event sequence for one successful agent step matches `18` §18.4's own
 * catalogue exactly, in order, with `StepStarted` demonstrably written before the adapter session starts.
 *
 * @see specs/06 §6.4, §6.7
 * @see specs/18 §18.4
 * @see PLAN-M5.md P15
 */
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { runAgentWork } from '../../src/dispatch/steps.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createTestContext, node, readFileInRepo } from './helpers.ts';

// Not in helpers.ts: node:os's tmpdir is R10-restricted in production code, and the test-file
// exemption in eslint.config.js only covers files literally named *.test.ts (matching
// @forge/vcs's own test convention of a small, duplicated per-file helper).
async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-dispatch-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('runAgentStep', () => {
  it('runs a real FakePlatformAdapter session inside a real tmp-dir lane, and its SessionResult becomes the outcome', async () => {
    const projectRoot = await createTempRepo('agent-basic');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['implemented the feature'],
      writeFiles: [{ relativePath: 'src/feature.ts', content: 'export const x = 1;\n' }],
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'implement the feature',
      produces: ['src/feature.ts'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail.kind).toBe('agent');
    if (outcome.detail.kind === 'agent') {
      expect(outcome.detail.session.ok).toBe(true);
      expect(outcome.detail.session.finalText).toBe('implemented the feature');
      expect(outcome.detail.session.changedFiles).toEqual(['src/feature.ts']);
    }
  });

  it('creates a real git worktree lane for the step, distinct from the main project root', async () => {
    const projectRoot = await createTempRepo('agent-lane');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['done'] });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
    });

    await executeStep(stepNode, ctx);

    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    const entries = await readdir(worktreesDir);
    expect(entries).toHaveLength(1);
  });

  it('the session runs with cwd inside the lane worktree, not the main project root -- proven by the written file landing there', async () => {
    const projectRoot = await createTempRepo('agent-cwd');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['done'],
      writeFiles: [{ relativePath: 'marker.txt', content: 'lane-scoped\n' }],
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
      produces: ['marker.txt'],
    });

    await executeStep(stepNode, ctx);

    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    const [laneDir] = await readdir(worktreesDir);
    expect(laneDir).toBeDefined();
    const content = await readFileInRepo(path.join(worktreesDir, laneDir ?? ''), 'marker.txt');
    expect(content).toBe('lane-scoped\n');
  });

  it("commits the agent's own changes in the lane, following 06 §6.4 step 3's own trailer convention", async () => {
    const projectRoot = await createTempRepo('agent-commit');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['done'],
      writeFiles: [{ relativePath: 'a.txt', content: 'x\n' }],
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
      produces: ['a.txt'],
    });

    await executeStep(stepNode, ctx);

    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    const [laneDir] = await readdir(worktreesDir);
    const { stdout } = await execa('git', ['log', '-1', '--format=%B'], {
      cwd: path.join(worktreesDir, laneDir ?? ''),
    });
    expect(stdout).toContain('Forge-Step: wf:implement');
    expect(stdout).toContain('Forge-Run: run-test');
  });

  it("reverts an out-of-claim write through this entry point -- claim enforcement runs on every agent step completion, not just in @forge/vcs's own unit tests", async () => {
    const projectRoot = await createTempRepo('agent-claim');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['done'],
      writeFiles: [
        { relativePath: 'src/allowed.ts', content: 'export const ok = 1;\n' },
        { relativePath: 'src/forbidden.ts', content: 'export const bad = 1;\n' },
      ],
    });
    const ctx = createTestContext({
      projectRoot,
      adapter,
      claimPolicy: 'strict',
      runId: 'run-claim',
    });
    // Only "src/allowed.ts" is declared -- "src/forbidden.ts" is a real, out-of-claim write.
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
      produces: ['src/allowed.ts'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    const [laneDir] = await readdir(worktreesDir);
    const laneRoot = path.join(worktreesDir, laneDir ?? '');
    await expect(readFileInRepo(laneRoot, 'src/allowed.ts')).resolves.toContain('ok = 1');
    // The forbidden file must be gone -- it never existed at baseSha, so strict enforcement deletes it
    // outright rather than restoring some prior content.
    const srcFiles = await readdir(path.join(laneRoot, 'src'));
    expect(srcFiles).not.toContain('forbidden.ts');
    expect(srcFiles).toContain('allowed.ts');
    // The revert is a second, real commit (confirmed above by the file actually being gone) and gets
    // its own LaneCommitted, the same as the original work-commit does -- otherwise this second commit
    // would be invisible to the durable event log entirely.
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-claim')) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      'StepStarted',
      'LaneCreated',
      'SessionStarted',
      'SessionEvent',
      'SessionEnded',
      'LaneCommitted',
      'LaneCommitted',
      'LaneReady',
      'StepSucceeded',
    ]);
  });

  it('emits the full 18 §18.4 event sequence for one successful agent step, in order, with StepStarted written before the adapter session ever starts', async () => {
    const projectRoot = await createTempRepo('agent-events');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['done'],
      writeFiles: [{ relativePath: 'a.txt', content: 'x\n' }],
    });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-events' });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
      produces: ['a.txt'],
    });

    await executeStep(stepNode, ctx);

    const events = [];
    for await (const event of readEvents(projectRoot, 'run-events')) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      'StepStarted',
      'LaneCreated',
      'SessionStarted',
      'SessionEvent',
      'SessionEnded',
      'LaneCommitted',
      'LaneReady',
      'StepSucceeded',
    ]);
    // seq is monotonic and gapless (18 §18.4's own rule) -- readEvents itself already refuses a gap, so
    // reaching this line at all already proves it; asserting it explicitly documents the property this
    // test relies on, not just leaves it implicit in "did not throw".
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("StepStarted survives (fsync'd) even when the adapter session itself fails to even start -- proven by injecting a failure between the event write and the session start", async () => {
    const projectRoot = await createTempRepo('agent-crash');
    // An adapter whose startSession always throws -- simulates a crash between the StepStarted write
    // (already durable) and the session actually beginning.
    const adapter = new FakePlatformAdapter();
    adapter.startSession = () => {
      throw new Error('simulated crash before the adapter session could start');
    };
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-crash' });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-crash')) events.push(event);
    // StepStarted, LaneCreated, and SessionStarted are all already durable on disk -- SessionStarted is
    // itself written BEFORE the adapter is ever called (the write-ahead discipline applied one level
    // deeper than StepStarted alone), so it survives the crash too, even though the session itself never
    // actually ran.
    expect(events.map((event) => event.type)).toEqual([
      'StepStarted',
      'LaneCreated',
      'SessionStarted',
      'AdapterError',
      'LaneReady',
      'StepFailed',
    ]);
  });

  it('commits real file writes that already landed in the lane before a mid-session crash, rather than discarding them', async () => {
    const projectRoot = await createTempRepo('agent-crash-with-changes');
    // Unlike the "fails to even start" case above, this crash happens *after* the session has already
    // done real tool-use work in the lane -- a session dropped mid-stream, not one that never began.
    const adapter = new FakePlatformAdapter();
    adapter.startSession = async (request) => {
      await writeFile(path.join(request.cwd, 'partial.txt'), 'work done before the crash\n');
      throw new Error('simulated crash after real file writes landed');
    };
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
      produces: ['partial.txt'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    const [laneDir] = await readdir(worktreesDir);
    const laneRoot = path.join(worktreesDir, laneDir ?? '');
    // Committed for real, not just left sitting uncommitted in the worktree -- confirmed via git log,
    // since an uncommitted file would be lost the moment this lane is eventually cleaned up.
    const { stdout } = await execa('git', ['log', '--oneline'], { cwd: laneRoot });
    expect(stdout).toContain('forge(wf)');
    await expect(readFileInRepo(laneRoot, 'partial.txt')).resolves.toContain(
      'work done before the crash',
    );
  });

  it('a session ending with ok: false (a scripted error) produces a failed StepOutcome carrying the real error code', async () => {
    const projectRoot = await createTempRepo('agent-failure');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['partial work'],
      endReason: 'error',
      errorInfo: { code: 'TOOL_ERROR', message: 'a tool failed' },
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('adapter');
    expect(outcome.failure?.code).toBe('TOOL_ERROR');
  });

  it('does not attempt a commit at all when the session makes no changes -- avoiding "nothing to commit" from failing the step', async () => {
    const projectRoot = await createTempRepo('agent-no-changes');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['just thinking out loud, no changes'] });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-no-changes' });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-no-changes')) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      'StepStarted',
      'LaneCreated',
      'SessionStarted',
      'SessionEvent',
      'SessionEnded',
      'LaneReady',
      'StepSucceeded',
    ]);
  });

  it('throws RUN-039 for an agent node missing its own agent field', async () => {
    const projectRoot = await createTempRepo('agent-missing-field');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({ id: 'wf:implement', kind: 'agent', brief: 'do work' });

    let caught: unknown;
    try {
      await executeStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-039');
  });

  it('defaults the session prompt to an empty string for a node with no brief of its own', async () => {
    const projectRoot = await createTempRepo('agent-no-brief');
    const adapter = new FakePlatformAdapter();
    let capturedPrompt: string | undefined;
    adapter.script(
      (request) => {
        capturedPrompt = request.prompt;
        return true;
      },
      { text: ['done'] },
    );
    const ctx = createTestContext({ projectRoot, adapter });
    // No `brief` field at all.
    const stepNode = node({ id: 'wf:implement', kind: 'agent', agent: toAgentId('engineer') });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(capturedPrompt).toBe('');
  });

  it('runAgentWork also defaults the resume-path prompt to an empty string for a node with no brief of its own', async () => {
    // The identical default the fresh-session path (buildSessionRequest, exercised above) already
    // proves -- covered separately here because runAgentWork's own resume branch builds its
    // ResumeRequest independently, not by delegating to buildSessionRequest.
    const projectRoot = await createTempRepo('agent-resume-no-brief');
    const adapter = new FakePlatformAdapter();
    let capturedPrompt: string | undefined;
    adapter.resumeSession = (sessionId, request) => {
      capturedPrompt = request.prompt;
      return Promise.resolve({
        sessionId,
        events: (async function* () {
          // No events to yield -- this test only inspects the resumed ResumeRequest's own prompt.
        })(),
        stop: () => Promise.resolve(),
        result: () =>
          Promise.resolve({
            sessionId,
            ok: true,
            finalText: 'resumed',
            usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
            durationMs: 0,
            changedFiles: [],
            controlTokens: [],
          }),
      });
    };
    const ctx = createTestContext({ projectRoot, adapter });
    const lane = { laneId: 'lane-resume-no-brief', path: projectRoot, branch: 'main' };
    // No `brief` field at all.
    const stepNode = node({ id: 'wf:implement', kind: 'agent', agent: toAgentId('engineer') });

    const work = await runAgentWork(stepNode, ctx, lane, 'HEAD', {
      kind: 'resume',
      sessionId: 'session-x',
    });

    expect(work.failure).toBeUndefined();
    expect(capturedPrompt).toBe('');
  });

  it('a session crash that throws a non-Error value still produces a failed outcome, via String(cause)', async () => {
    const projectRoot = await createTempRepo('agent-crash-non-error');
    const adapter = new FakePlatformAdapter();
    adapter.startSession = () => {
      // Deliberately non-Error, proving runAgentStep's own `cause instanceof Error ? ... : String(cause)`
      // fallback really is reachable, not merely defensive dead code.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'a plain string crash';
    };
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('adapter');
    expect(outcome.failure?.message).toBe('a plain string crash');
  });

  it('a failed session with no error object of its own falls back to a generic failure message', async () => {
    const projectRoot = await createTempRepo('agent-failure-no-error');
    const adapter = new FakePlatformAdapter();
    adapter.startSession = () =>
      Promise.resolve({
        sessionId: 'test-session',
        // No events needed: this test only ever inspects the final SessionResult, never the stream.
        events: (async function* () {
          await Promise.resolve();
          yield* [];
        })(),
        stop: () => Promise.resolve(),
        result: () =>
          Promise.resolve({
            sessionId: 'test-session',
            ok: false,
            finalText: '',
            usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
            durationMs: 0,
            changedFiles: [],
            controlTokens: [],
            // No `error` field at all -- a real adapter is permitted to report `ok: false` without one.
          }),
      });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toBe('Session ended without success.');
  });

  it("falls back to the step id for the commit subject when a successful session's own finalText is empty", async () => {
    const projectRoot = await createTempRepo('agent-empty-final-text');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: [''],
      writeFiles: [{ relativePath: 'a.txt', content: 'x\n' }],
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const stepNode = node({
      id: 'wf:implement',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
      produces: ['a.txt'],
    });

    await executeStep(stepNode, ctx);

    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    const [laneDir] = await readdir(worktreesDir);
    const { stdout } = await execa('git', ['log', '-1', '--format=%s'], {
      cwd: path.join(worktreesDir, laneDir ?? ''),
    });
    expect(stdout).toContain('wf:implement');
  });
});
