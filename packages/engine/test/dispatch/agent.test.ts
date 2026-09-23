/**
 * `runAgentStep` (via `executeStep`) — `PLAN-M5.md` P15's own Checks text: an `agent` step runs a real
 * `FakePlatformAdapter` session inside a real tmp-dir lane and its `SessionResult` becomes the step's own
 * outcome; claim enforcement runs on every completion, proven by an out-of-claim write being reverted
 * through this entry point AND, under `strict`, failing the step (`PLAN-M14.md` P3, `06` §6.7 as amended);
 * the full event sequence for one successful agent step matches `18` §18.4's own catalogue exactly, in
 * order, with `StepStarted` demonstrably written before the adapter session starts.
 *
 * @see specs/06 §6.4, §6.7
 * @see specs/18 §18.4
 * @see PLAN-M5.md P15
 * @see PLAN-M14.md P3
 */
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import type { SessionRequest } from '@forge/adapter-kit';
import { ForgeError } from '@forge/core/errors';
import { slugifyStepId } from '@forge/vcs';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents } from '@forge/telemetry/events';
import { TelemetryError } from '@forge/telemetry/errors';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { runAgentStep, runAgentWork } from '../../src/dispatch/steps.ts';
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

  it("reverts an out-of-claim write through this entry point and fails the step under strict -- claim enforcement runs on every agent step completion, not just in @forge/vcs's own unit tests", async () => {
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

    // `PLAN-M14.md` P3, `06` §6.7 as amended (`SPEC-QUESTIONS.md` Q232 decision 1): `strict` still reverts
    // the out-of-claim file exactly as before, but the step itself now fails too.
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
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
      // 20 §20.10 S9 (PLAN-M11.md P11): a real UsageRecorded event, now emitted once per completed
      // session -- the ledger's own sole input, previously never produced by any real dispatch code.
      'UsageRecorded',
      'LaneCommitted',
      // `06` §6.7: an out-of-claim write is recorded as a policy violation naming the files, before the
      // revert commit; the revert and the trace both land before the step's own failure is returned.
      'PolicyViolation',
      'LaneCommitted',
      // No `LaneReady`: a claim violation under `strict` is never announced ready (`PLAN-M14.md` P3).
      'StepFailed',
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
      // 20 §20.10 S9 (PLAN-M11.md P11): see the identical addition's own comment above.
      'UsageRecorded',
      'LaneCommitted',
      'LaneReady',
      'StepSucceeded',
    ]);
    // seq is monotonic and gapless (18 §18.4's own rule) -- readEvents itself already refuses a gap, so
    // reaching this line at all already proves it; asserting it explicitly documents the property this
    // test relies on, not just leaves it implicit in "did not throw".
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
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
      // 20 §20.10 S9 (PLAN-M11.md P11): see agent-events's own identical addition above.
      'UsageRecorded',
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

  it('a node with no brief of its own gets an explicit no-authored-brief block [4] built only from its declared fields, and the fixed kickoff as its user prompt', async () => {
    const projectRoot = await createTempRepo('agent-no-brief');
    const adapter = new FakePlatformAdapter();
    let capturedPrompt: string | undefined;
    let capturedSystem: string | undefined;
    adapter.script(
      (request) => {
        capturedPrompt = request.prompt;
        capturedSystem = request.systemPrompt.text;
        return true;
      },
      { text: ['done'] },
    );
    const ctx = createTestContext({ projectRoot, adapter });
    // No `brief` field at all.
    const stepNode = node({ id: 'wf:implement', kind: 'agent', agent: toAgentId('engineer') });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(capturedPrompt).toContain('wf:implement');
    expect(capturedSystem).toContain('has no authored workflow brief');
  });

  it('runAgentWork resumes with the fixed continuation prompt, never a brief, for a node with no brief of its own', async () => {
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
    expect(capturedPrompt).toBe(
      'Continue step "wf:implement" from where the previous session stopped. Your system prompt is unchanged.',
    );
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

describe('the FORGE run/step/agent marker (@forge/core/session-marker, PLAN-M14.md P4)', () => {
  it("every SessionRequest buildSessionRequest builds carries FORGE_RUN_ID === ctx.runId, FORGE_STEP_ID === node.id, FORGE_AGENT_ID === the assembled agent's own id", async () => {
    const projectRoot = await createTempRepo('agent-marker');
    const adapter = new FakePlatformAdapter();
    const requests: SessionRequest[] = [];
    adapter.script(
      (request) => {
        requests.push(request);
        return true;
      },
      { text: ['done'] },
    );
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-marker-agent' });
    const stepNode = node({
      id: 'wf:marked',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'do work',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.env).toEqual({
      FORGE_RUN_ID: 'run-marker-agent',
      FORGE_STEP_ID: 'wf:marked',
      FORGE_AGENT_ID: 'engineer',
    });
  });

  it('the marker is composed only from ctx/node/the assembled agent, never from an ambient FORGE_RUN_ID already in the test process env', async () => {
    const previous = process.env['FORGE_RUN_ID'];
    process.env['FORGE_RUN_ID'] = 'ambient-poison-run-id';
    try {
      const projectRoot = await createTempRepo('agent-marker-r10');
      const adapter = new FakePlatformAdapter();
      const requests: SessionRequest[] = [];
      adapter.script(
        (request) => {
          requests.push(request);
          return true;
        },
        { text: ['done'] },
      );
      const ctx = createTestContext({ projectRoot, adapter, runId: 'run-marker-real' });
      const stepNode = node({
        id: 'wf:marked',
        kind: 'agent',
        agent: toAgentId('engineer'),
        brief: 'do work',
      });

      await executeStep(stepNode, ctx);

      expect(requests[0]?.env['FORGE_RUN_ID']).toBe('run-marker-real');
    } finally {
      if (previous === undefined) delete process.env['FORGE_RUN_ID'];
      else process.env['FORGE_RUN_ID'] = previous;
    }
  });
});

/** A minimal but schema-VALID ADR document (`08` §8.4) at `id` -- `sources` included (`PLAN-M14.md`
 * P11: the output check now requires at least one on every produced KB document). */
function validAdrDocument(id: string): string {
  return [
    '---',
    `id: ${id}`,
    'type: ADR',
    'schemaVersion: 1',
    'title: Use the reserved id',
    'status: accepted',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: architect',
    'changelog: []',
    'category: architecture',
    'deciders: [architect]',
    'date: 2026-01-15',
    'reversibility: medium',
    'blast_radius: []',
    "revisit_trigger: 'n/a'",
    'supersedes: []',
    'superseded_by: null',
    'related: []',
    'diagrams: []',
    "framework: 'n/a'",
    'sources:',
    '  - kind: decision',
    "    ref: 'ADR-0001'",
    '---',
    '',
    '## Context',
    '',
    'x',
    '',
    '## Options considered',
    '',
    'x',
    '',
    '## Decision',
    '',
    'x',
    '',
    '## Diagram',
    '',
    'x',
    '',
    '## Consequences',
    '',
    'x',
    '',
    '## Reversal plan',
    '',
    'x',
    '',
  ].join('\n');
}

/** A minimal, schema-valid `kb/risks.md` register file whose `risks:` array holds `count` entries
 * (`RISK-001`..`RISK-<count>`). */
function risksFile(count: number): string {
  const entries = Array.from(
    { length: count },
    (_, index) =>
      `  - id: RISK-${String(index + 1).padStart(3, '0')}\n` +
      '    statement: a\n    likelihood: low\n    impact: low\n    mitigation: m\n    owner: architect',
  ).join('\n');
  return [
    '---',
    'type: Risk',
    'schemaVersion: 1',
    'title: Risk register',
    'status: active',
    'created: 2026-01-01',
    'updated: 2026-01-01',
    'revision: 1',
    'author: architect',
    'changelog: []',
    'risks:',
    entries,
    '---',
    '',
    'Risk register.',
    '',
  ].join('\n');
}

function promptPathFor(projectRoot: string, runId: string, stepId: string): string {
  return path.join(
    projectRoot,
    '.forge',
    'state',
    'runs',
    runId,
    'steps',
    slugifyStepId(stepId),
    'prompt.md',
  );
}

describe('a declared KB output reserves a collision-free id before assembly (PLAN-M14.md P8)', () => {
  function adrStep(id = 'wf:write-adr', overrides: Partial<Parameters<typeof node>[0]> = {}) {
    return node({
      id,
      kind: 'agent',
      agent: toAgentId('architect'),
      outputs: [{ type: 'ADR' }],
      ...overrides,
    });
  }

  it("the audit prompt record (prompt.md) carries the reserved id, above what's already on disk", async () => {
    const projectRoot = await createTempRepo('kb-reserve-prompt');
    const decisions = path.join(projectRoot, 'docs/forge/kb/decisions');
    await mkdir(decisions, { recursive: true });
    await writeFile(path.join(decisions, 'ADR-0002-x.md'), validAdrDocument('ADR-0002'));
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['wrote it'],
      writeFiles: [
        {
          relativePath: 'docs/forge/kb/decisions/ADR-0003-x.md',
          content: validAdrDocument('ADR-0003'),
        },
      ],
    });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-prompt' });

    const outcome = await executeStep(adrStep(), ctx);

    expect(outcome.status).toBe('succeeded');
    const prompt = await readFile(promptPathFor(projectRoot, 'run-prompt', 'wf:write-adr'), 'utf8');
    expect(prompt).toContain(
      '- ADR: path `docs/forge/kb/decisions/ADR-*.md` -- reserved id `ADR-0003`: use exactly this id, do not choose another',
    );
  });

  it('exhaustion is refused as a typed prompt refusal (RUN-109) before any lane exists', async () => {
    const projectRoot = await createTempRepo('kb-reserve-exhausted');
    await mkdir(path.join(projectRoot, 'docs/forge/kb'), { recursive: true });
    await writeFile(path.join(projectRoot, 'docs/forge/kb/risks.md'), risksFile(999));
    const adapter = new FakePlatformAdapter();
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-exhausted' });
    const stepNode = node({
      id: 'wf:write-risk',
      kind: 'agent',
      agent: toAgentId('architect'),
      outputs: [{ type: 'Risk' }],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'prompt', code: 'RUN-109' });
    expect(ctx.laneRegistry.has('wf:write-risk')).toBe(false);
    await expect(
      readdir(path.join(projectRoot, '.forge', 'state', 'worktrees')).catch(() => []),
    ).resolves.toEqual([]);
  });

  it('releases its reservation when prompt assembly itself refuses, so the next attempt for the same step gets the same id back', async () => {
    const projectRoot = await createTempRepo('kb-reserve-release');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['wrote it'],
      writeFiles: [
        {
          relativePath: 'docs/forge/kb/decisions/ADR-0001-x.md',
          content: validAdrDocument('ADR-0001'),
        },
      ],
    });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-release' });
    const stepNode = adrStep();

    // A blank task text refuses prompt assembly (RUN-081) before any lane exists -- the identical
    // "config-shaped refusal, nothing dispatched" class a missing agent/brief/model would also raise.
    const refused = await runAgentStep(stepNode, ctx, { taskText: '' });
    expect(refused.failure).toMatchObject({ source: 'prompt', code: 'RUN-081' });
    expect(ctx.laneRegistry.has('wf:write-adr')).toBe(false);

    const succeeded = await runAgentStep(stepNode, ctx);
    expect(succeeded.status).toBe('succeeded');
    // If the refused attempt's reservation had leaked instead of being released, this one would have
    // been told ADR-0002, not ADR-0001.
    const prompt = await readFile(
      promptPathFor(projectRoot, 'run-release', 'wf:write-adr'),
      'utf8',
    );
    expect(prompt).toContain('reserved id `ADR-0001`');
    expect(prompt).not.toContain('ADR-0002');
  });

  it('three concurrent steps declaring an ADR get disjoint ids, computed before any of their lanes exist', async () => {
    const projectRoot = await createTempRepo('kb-reserve-concurrent');
    const adapter = new FakePlatformAdapter();
    for (const id of ['wf:a', 'wf:b', 'wf:c']) {
      adapter.script((request) => request.stepId === id, { text: ['wrote it'], writeFiles: [] });
    }
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-concurrent' });
    const steps = ['wf:a', 'wf:b', 'wf:c'].map((id) => adrStep(id));

    const outcomes = await Promise.all(steps.map((stepNode) => executeStep(stepNode, ctx)));
    // None wrote a real ADR file, so the output check fails each -- irrelevant here: what matters is
    // the id each one's OWN prompt was told to use, decided before any of the three ever got a lane.
    for (const outcome of outcomes) expect(outcome.status).toBe('failed');

    const prompts = await Promise.all(
      steps.map((stepNode) =>
        readFile(promptPathFor(projectRoot, 'run-concurrent', stepNode.id), 'utf8'),
      ),
    );
    const reservedIds = prompts.map((prompt) => /reserved id `(ADR-\d{4})`/.exec(prompt)?.[1]);
    expect(new Set(reservedIds).size).toBe(3);
    expect([...reservedIds].sort()).toEqual(['ADR-0001', 'ADR-0002', 'ADR-0003']);
  });

  it('does not leak the reservation when createLaneForStep itself throws (its own LaneCreated emit failing) after a real worktree already exists', async () => {
    const projectRoot = await createTempRepo('kb-reserve-telemetry-leak');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['wrote it'],
      writeFiles: [
        {
          relativePath: 'docs/forge/kb/decisions/ADR-0001-x.md',
          content: validAdrDocument('ADR-0001'),
        },
      ],
    });
    const ctx = createTestContext({ projectRoot, adapter, runId: 'run-leak' });
    const realEmit = ctx.telemetry.emit.bind(ctx.telemetry);
    // `createLaneForStep` calls `ctx.vcs.createLane` (a real worktree) THEN
    // `ctx.telemetry.emit({type:'LaneCreated'})`, unwrapped -- this fails only that one emit, after the
    // worktree genuinely exists, so `runAgentStep`'s own reservation was never bound (`created.ok` is
    // never reached) and must be released by its `finally`, not merely by the two `{ok:false}` branches.
    const failingCtx = {
      ...ctx,
      telemetry: {
        emit: (event: Parameters<typeof realEmit>[0]) => {
          if (event.type === 'LaneCreated') {
            throw new TelemetryError({
              code: 'TELEMETRY-EVENT-LOG-WRITE-FAILED',
              message: 'ENOSPC: no space left on device',
              remedy: 'Free disk space and retry.',
            });
          }
          return realEmit(event);
        },
      },
    };

    await expect(runAgentStep(adrStep('wf:leaky'), failingCtx)).rejects.toBeInstanceOf(
      TelemetryError,
    );
    // The worktree really was created before the throw.
    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    await expect(readdir(worktreesDir)).resolves.toHaveLength(1);

    // If the reservation had leaked, this unrelated, later step would be told ADR-0002, not ADR-0001.
    const succeeded = await runAgentStep(adrStep('wf:after'), ctx);
    expect(succeeded.status).toBe('succeeded');
    const prompt = await readFile(promptPathFor(projectRoot, 'run-leak', 'wf:after'), 'utf8');
    expect(prompt).toContain('reserved id `ADR-0001`');
  });
});
