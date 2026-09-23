/**
 * A resumed agent step goes through the same output contract check as a fresh one (`PLAN-M13.md` P7), and a
 * `RUN-084` failure (the agent's own grant forbids writing the declared outputs) is final: `resumeRun` must
 * not answer it by rolling the lane back and paying for a second, identical session.
 *
 * @see specs/06 §6.10
 * @see PLAN-M13.md P7
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { createLaneWorktree, slugifyStepId } from '@forge/vcs';
import { appendEvent } from '@forge/telemetry/events';
import { FAKE_MODEL_ID, FakePlatformAdapter, strictFixtureSystemPrompt } from '@forge/testkit';
import { describe, expect, it } from 'vitest';

import { toAgentId } from '../../src/plan/index.ts';
import { resumeRun, type ResumeContext } from '../../src/resume/orchestrate.ts';
import { adrText } from '../dispatch/artifact-fixtures.ts';
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

  /**
   * `PLAN-M14.md` P10, `SPEC-QUESTIONS.md` Q232 decision 2: a crash before the step's session ever
   * acquired a durable session id (`decideResumeStrategy`'s own only "nothing to resume" case, `strategy.ts`)
   * leaves the run's log with `StepStarted`/`LaneCreated` but nothing past it -- `resumeRun` REROLLS the
   * step: a brand-new `reserveDeclaredKbOutputIds` call, in a brand-new process with an empty in-memory
   * reservation table, scans the SAME lane and project state the crashed attempt saw (nothing of this
   * step's own committed to either, since it crashed before writing anything) and lands on the identical
   * base a first, uninterrupted attempt would have -- and this piece's own new range check (`outputs.ts`)
   * holds the rerolled session's real produced id to that SAME reservation, not a freshly-rescanned one.
   */
  it('a step whose session crashed before any commit rerolls into the identical reserved id, and the output check accepts it', async () => {
    const runId = 'run-resume-kb-reroll';
    const stepId = 'wf:write-adr';
    const projectRoot = await createTempRepo();
    // Seeds a non-trivial base: with ADR-0003 already on `main`, the one id this run's own reservation can
    // ever compute (there is nothing else in this test's whole project/integration/lane trees to collide
    // with) is ADR-0004 -- proven below by checking the produced file, not merely trusting the run to have
    // used "some" id.
    const decisions = path.join(projectRoot, 'docs/forge/kb/decisions');
    await mkdir(decisions, { recursive: true });
    await writeFile(path.join(decisions, 'ADR-0003-seed.md'), adrText('ADR-0003', 'Seed'));
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '--quiet', '-m', 'seed'], { cwd: projectRoot });

    const laneId = `${runId}-${slugifyStepId(stepId)}`;
    const lane = await createLaneWorktree(projectRoot, { runId, stepId, integrationBase: 'main' });
    const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });

    // No `SessionStarted`/`SessionEvent` at all: the crash landed before the adapter ever produced a
    // durable session id, so `decideResumeStrategy` has no `sessionId` to try resuming and picks
    // `'reroll'` unconditionally -- the identical case a real engine process dying mid-`startSession` (or
    // before its own `SessionEvent` telemetry write ever lands) would leave behind.
    let tick = 0;
    const log = (type: 'StepStarted' | 'LaneCreated', payload: unknown) =>
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

    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['wrote the adr'],
      writeFiles: [
        { relativePath: 'docs/forge/kb/decisions/ADR-0004-x.md', content: adrText('ADR-0004') },
      ],
    });

    const steps = new Map([
      [
        stepId,
        node({
          id: stepId,
          kind: 'agent',
          agent: toAgentId('architect'),
          brief: 'write the adr',
          produces: ['docs/forge/**'],
          outputs: [{ type: 'ADR' }],
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
                  write: true,
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

    expect(runState.stepStatuses.get(stepId)).toBe('succeeded');
    // Proves the reroll's own reservation and the check that accepted it, not just that SOME run
    // succeeded: the produced file really is at ADR-0004, the identical id a first attempt would have
    // reserved, read straight off the lane branch the reroll actually committed to.
    const { stdout: produced } = await execa(
      'git',
      ['show', 'HEAD:docs/forge/kb/decisions/ADR-0004-x.md'],
      { cwd: lane.path },
    );
    expect(produced).toContain('id: ADR-0004');
  });
});
