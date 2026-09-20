/**
 * A resumed agent step goes through the same output contract check as a fresh one (`PLAN-M13.md` P7), and a
 * `RUN-084` failure (the agent's own grant forbids writing the declared outputs) is final: `resumeRun` must
 * not answer it by rolling the lane back and paying for a second, identical session.
 *
 * @see specs/06 §6.10
 * @see PLAN-M13.md P7
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { createLaneWorktree, slugifyStepId } from '@forge/vcs';
import { appendEvent } from '@forge/telemetry/events';
import { FAKE_MODEL_ID, FakePlatformAdapter, strictFixtureSystemPrompt } from '@forge/testkit';
import { describe, expect, it } from 'vitest';

import { toAgentId } from '../../src/plan/index.ts';
import { resumeRun, type ResumeContext } from '../../src/resume/orchestrate.ts';
import {
  createFixtureAssembly,
  createTestContext,
  fixtureAgent,
  node,
} from '../dispatch/helpers.ts';

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-resume-outputs-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('resumeRun and the output contract', () => {
  it('fails a resumed step that wrote nothing, and does not start a second session when the grant is the cause', async () => {
    const runId = 'run-resume-outputs';
    const stepId = 'wf:write';
    const projectRoot = await createTempRepo();
    const laneId = `${runId}-${slugifyStepId(stepId)}`;
    const lane = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });

    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['answered in chat only'] });
    const handle = await adapter.startSession({
      runId,
      stepId,
      cwd: lane.path,
      systemPrompt: { mode: 'append', text: strictFixtureSystemPrompt() },
      prompt: 'do work',
      model: FAKE_MODEL_ID,
      tools: { read: true, write: false, exec: false, network: 'none' },
      permissionMode: 'accept-edits',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
      env: {},
      abortSignal: new AbortController().signal,
    });
    let tick = 0;
    const log = (
      type: 'StepStarted' | 'LaneCreated' | 'SessionStarted' | 'SessionEvent',
      payload: unknown,
    ) =>
      appendEvent(projectRoot, runId, {
        ts: `2026-01-01T00:00:${String((tick += 1)).padStart(2, '0')}.000Z`,
        runId,
        type,
        stepId,
        ...(type === 'StepStarted' ? {} : { laneId }),
        payload,
      });
    await log('StepStarted', undefined);
    await log('LaneCreated', { baseSha: baseSha.trim() });
    await log('SessionStarted', undefined);
    await log('SessionEvent', { sessionId: handle.sessionId });

    let starts = 0;
    adapter.startSession = () => {
      starts += 1;
      throw new Error('a RUN-084 failure must not trigger a second session');
    };

    const steps = new Map([
      [
        stepId,
        node({
          id: stepId,
          kind: 'agent',
          agent: toAgentId('em'),
          brief: 'do work',
          outputs: [{ type: 'Epic' }],
        }),
      ],
    ]);
    const ctx: ResumeContext = {
      ...createTestContext({
        projectRoot,
        adapter,
        runId,
        assembly: createFixtureAssembly(projectRoot, {
          loadAgent: (agentId) =>
            Promise.resolve(
              fixtureAgent(agentId, {
                tools: {
                  read: true,
                  write: false,
                  network: false,
                  git_commit: 'lane',
                  deploy: false,
                },
              }),
            ),
        }),
      }),
      steps,
    };

    const runState = await resumeRun(runId, ctx);

    expect(runState.stepStatuses.get(stepId)).toBe('failed');
    expect(starts).toBe(0);
  });
});
