/**
 * A resumed adapter session records its own answer in `result.md` (`PLAN-M13.md` P12, `Q208` finding 5),
 * overwriting what a crashed earlier attempt left, while `prompt.md` stays exactly what the original session
 * received (`Q203` D7: a resume never rewrites it).
 *
 * @see specs/06 §6.10
 * @see specs/05 §5.3
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { appendEvent } from '@forge/telemetry/events';
import { FAKE_MODEL_ID, FakePlatformAdapter, strictFixtureSystemPrompt } from '@forge/testkit';
import { createLaneWorktree, slugifyStepId } from '@forge/vcs';
import { afterEach, describe, expect, it } from 'vitest';

import { toAgentId } from '../../src/plan/index.ts';
import { resumeRun, type ResumeContext } from '../../src/resume/orchestrate.ts';
import { createTestContext, node } from '../dispatch/helpers.ts';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resume and result.md', () => {
  it("overwrites the crashed attempt's result.md with the resumed session's answer and leaves prompt.md alone", async () => {
    const runId = 'run-resume-result';
    const stepId = 'wf:implement';
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'forge-resume-result-'));
    cleanup.push(projectRoot);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: projectRoot });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: projectRoot });
    const lane = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });

    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['the resumed answer'] });
    const handle = await adapter.startSession({
      runId,
      stepId,
      cwd: lane.path,
      systemPrompt: { mode: 'append', text: strictFixtureSystemPrompt() },
      prompt: 'do work',
      model: FAKE_MODEL_ID,
      tools: { read: true, write: true, exec: false, network: 'none' },
      permissionMode: 'accept-edits',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
      env: {},
      abortSignal: new AbortController().signal,
    });

    let tick = 0;
    const ts = (): string => `2026-01-01T00:00:${String((tick += 1)).padStart(2, '0')}.000Z`;
    const laneId = lane.laneId;
    await appendEvent(projectRoot, runId, {
      ts: ts(),
      runId,
      type: 'StepStarted',
      stepId,
      payload: undefined,
    });
    await appendEvent(projectRoot, runId, {
      ts: ts(),
      runId,
      type: 'LaneCreated',
      stepId,
      laneId,
      payload: { baseSha: baseSha.trim() },
    });
    await appendEvent(projectRoot, runId, {
      ts: ts(),
      runId,
      type: 'SessionEvent',
      stepId,
      laneId,
      payload: { sessionId: handle.sessionId },
    });

    // What the crashed first attempt left in the step's record directory.
    const dir = path.join(projectRoot, '.forge/state/runs', runId, 'steps', slugifyStepId(stepId));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'prompt.md'), 'the prompt the first session received\n');
    await writeFile(path.join(dir, 'result.md'), 'stale answer from the crashed attempt\n');

    adapter.startSession = () => {
      throw new Error('a valid session must be resumed, not restarted');
    };
    const ctx: ResumeContext = {
      ...createTestContext({ projectRoot, adapter, runId }),
      steps: new Map([
        [
          stepId,
          node({ id: stepId, kind: 'agent', agent: toAgentId('engineer'), brief: 'do work' }),
        ],
      ]),
    };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.get(stepId)).toBe('succeeded');
    expect(await readFile(path.join(dir, 'result.md'), 'utf8')).toBe('the resumed answer\n');
    expect(await readFile(path.join(dir, 'prompt.md'), 'utf8')).toBe(
      'the prompt the first session received\n',
    );
  });
});
