/**
 * The output contract check, end to end through `executeStep` and a real git lane (`PLAN-M13.md` P7):
 * a `FakePlatformAdapter` session that writes (or fails to write) an artifact into the lane decides the
 * step's outcome. `outputs.test.ts` proves each rule against a stubbed VCS; this proves they hold against
 * real commits, real claim enforcement, the real event log and the real failure policy (`06` §6.8).
 *
 * Live evidence this exists for (`SPEC-QUESTIONS.md` Q208 finding 4): a real 177 s session by a
 * write-forbidden agent wrote nothing and the step was still reported succeeded.
 *
 * @see specs/05 §5.5
 * @see specs/06 §6.4, §6.7, §6.8
 * @see PLAN-M13.md P7
 */
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { checkDeclaredOutputs, verifyDeclaredOutputs } from '../../src/dispatch/outputs.ts';
import { runLaneLifecycle } from '../../src/dispatch/steps.ts';
import type { ExecuteStepContext, StepOutcome } from '../../src/dispatch/types.ts';
import { classifyFailure, decideRetry } from '../../src/failures/index.ts';
import { toAgentId, type StepNode, type StepNodeRetryPolicy } from '../../src/plan/index.ts';
import { epicMissingGoalText, epicText, sessionRecordText } from './artifact-fixtures.ts';
import { createFixtureAssembly, createTestContext, fixtureAgent, node } from './helpers.ts';

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-outputs-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

const EPIC_PATH = 'docs/forge/specs/epics/EPIC-001.md';

interface Scenario {
  readonly outputs: StepNode['outputs'];
  readonly writes: readonly { readonly relativePath: string; readonly content: string }[];
  readonly produces?: readonly string[];
  readonly claimPolicy?: 'strict' | 'warn';
  readonly agentWrites?: boolean;
  readonly runId?: string;
  readonly docRoots?: NonNullable<ExecuteStepContext['docRoots']>;
}

async function runScenario(scenario: Scenario) {
  const projectRoot = await createTempRepo('scenario');
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, { text: ['done'], writeFiles: [...scenario.writes] });
  const agentWrites = scenario.agentWrites ?? true;
  const runId = scenario.runId ?? 'run-outputs';
  const ctx = createTestContext({
    projectRoot,
    adapter,
    runId,
    ...(scenario.claimPolicy === undefined ? {} : { claimPolicy: scenario.claimPolicy }),
    ...(scenario.docRoots === undefined ? {} : { docRoots: scenario.docRoots }),
    assembly: createFixtureAssembly(projectRoot, {
      loadAgent: (agentId) =>
        Promise.resolve(
          fixtureAgent(agentId, {
            tools: {
              read: true,
              write: agentWrites,
              network: false,
              git_commit: 'lane',
              deploy: false,
            },
          }),
        ),
    }),
  });
  const stepNode = node({
    id: 'wf:step',
    kind: 'agent',
    agent: toAgentId('em'),
    brief: 'do the work',
    outputs: scenario.outputs,
    produces: scenario.produces ?? ['docs/forge/**'],
  });
  const outcome = await executeStep(stepNode, ctx);
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(projectRoot, runId)) events.push(event);
  return { outcome, events, ctx, projectRoot, stepNode };
}

function expectFailed(outcome: StepOutcome): NonNullable<StepOutcome['failure']> {
  expect(outcome.status).toBe('failed');
  if (outcome.failure === undefined) throw new Error('a failed outcome carries a failure');
  return outcome.failure;
}

describe('an agent step with declared outputs', () => {
  it('succeeds when the session wrote a valid artifact at its registry path, and registers the lane', async () => {
    const { outcome, events, ctx } = await runScenario({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: EPIC_PATH, content: epicText() }],
    });
    expect(outcome.status).toBe('succeeded');
    expect(ctx.laneRegistry.has('wf:step')).toBe(true);
    expect(events.at(-1)?.type).toBe('StepSucceeded');
  });

  it('FAILS, typed, when the session ended ok but wrote nothing (Q208 finding 4): no StepSucceeded, no lane handed to merge', async () => {
    const { outcome, events, ctx } = await runScenario({
      outputs: [{ type: 'SessionRecord', subtype: 'retrospective' }],
      writes: [],
    });
    const failure = expectFailed(outcome);
    expect(failure).toMatchObject({ source: 'output', code: 'RUN-083' });
    expect(failure.message).toContain('wf:step');
    expect(failure.message).toContain('SessionRecord');
    expect(failure.message).toContain('docs/forge/sessions/SESSION-*.md');
    expect(events.map((event) => event.type)).not.toContain('StepSucceeded');
    expect(events.at(-1)?.type).toBe('StepFailed');
    // The failure travels in the durable event, remedy included.
    expect(JSON.stringify(events.at(-1)?.payload)).toContain('RUN-083');
    expect(ctx.laneRegistry.has('wf:step')).toBe(false);
    // The session itself did end ok: the failure is the contract's, not the adapter's.
    expect(outcome.detail.kind === 'agent' && outcome.detail.session.ok).toBe(true);
  });

  it('fails, naming the schema violation, when the artifact is present but invalid', async () => {
    const { outcome } = await runScenario({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: EPIC_PATH, content: epicMissingGoalText() }],
    });
    const failure = expectFailed(outcome);
    expect(failure.code).toBe('RUN-083');
    expect(failure.message).toContain(EPIC_PATH);
    expect(failure.message).toContain('goal');
  });

  it('cardinality many: two valid files pass; one invalid file among them fails and is named', async () => {
    const two = [
      { relativePath: 'docs/forge/specs/epics/EPIC-001.md', content: epicText('EPIC-001') },
      { relativePath: 'docs/forge/specs/epics/EPIC-002.md', content: epicText('EPIC-002') },
    ];
    const good = await runScenario({
      outputs: [{ type: 'Epic', cardinality: 'many' }],
      writes: two,
    });
    expect(good.outcome.status).toBe('succeeded');
    const bad = await runScenario({
      outputs: [{ type: 'Epic', cardinality: 'many' }],
      writes: [
        ...two,
        {
          relativePath: 'docs/forge/specs/epics/EPIC-003.md',
          content: epicMissingGoalText('EPIC-003'),
        },
      ],
    });
    expect(expectFailed(bad.outcome).message).toContain('EPIC-003.md');
  });

  it('subtype mismatch fails: a brainstorm record does not satisfy a retrospective output', async () => {
    const { outcome } = await runScenario({
      outputs: [{ type: 'SessionRecord', subtype: 'retrospective' }],
      writes: [
        {
          relativePath: 'docs/forge/sessions/SESSION-001.md',
          content: sessionRecordText('brainstorm'),
        },
      ],
    });
    expect(expectFailed(outcome).message).toContain('retrospective');
    const ok = await runScenario({
      outputs: [{ type: 'SessionRecord', subtype: 'retrospective' }],
      writes: [
        { relativePath: 'docs/forge/sessions/SESSION-001.md', content: sessionRecordText('retro') },
      ],
    });
    expect(ok.outcome.status).toBe('succeeded');
  });

  it('a write-forbidden agent (tools.write: false) fails with the grant-specific code and remedy, never silently succeeds', async () => {
    const { outcome } = await runScenario({
      outputs: [{ type: 'Epic' }],
      // The fake adapter (like a real one) refuses to write when the grant forbids it, so this script's
      // write never lands: the agent could not have produced the file.
      writes: [{ relativePath: EPIC_PATH, content: epicText() }],
      agentWrites: false,
    });
    const failure = expectFailed(outcome);
    expect(failure).toMatchObject({ source: 'output', code: 'RUN-084' });
    expect(failure.message).toContain('tools.write: false');
    expect(failure.message).toContain('em');
    expect(failure.message).toMatch(/write access|an agent that can write/);
  });

  it('claim enforcement is the tree that counts, and a declared output is inside the claim: strict with no `produces` keeps it (Q209 finding, P14)', async () => {
    // Before P14 this scenario reverted the step's own output under `strict` and the contract then failed it
    // ("add the path to `produces`"). Outputs are now part of the claim, so both policies keep the file.
    for (const claimPolicy of ['strict', 'warn'] as const) {
      const kept = await runScenario({
        outputs: [{ type: 'Epic' }],
        writes: [{ relativePath: EPIC_PATH, content: epicText() }],
        produces: [],
        claimPolicy,
      });
      expect(kept.outcome.status).toBe('succeeded');
    }
    // What claim enforcement still reverts is what lies outside outputs and `produces` -- and, since
    // `PLAN-M14.md` P3, a real violation under `strict` now fails the step at the claim itself, before
    // the output check (below) ever gets a chance to report the output as missing.
    const stray = await runScenario({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: 'src/not-the-epic.ts', content: 'x\n' }],
      produces: [],
      claimPolicy: 'strict',
    });
    const failure = expectFailed(stray.outcome);
    expect(failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(failure.message).toContain('src/not-the-epic.ts');
  });

  it('a session that failed (adapter error) keeps its adapter failure: the contract is only checked after an ok session', async () => {
    const projectRoot = await createTempRepo('adapter-failure');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['partial'],
      endReason: 'error',
      errorInfo: { code: 'TOOL_ERROR', message: 'a tool failed' },
    });
    const ctx = createTestContext({ projectRoot, adapter });
    const outcome = await executeStep(
      node({
        id: 'wf:step',
        kind: 'agent',
        agent: toAgentId('em'),
        brief: 'do it',
        outputs: [{ type: 'Epic' }],
      }),
      ctx,
    );
    expect(expectFailed(outcome).source).toBe('adapter');
  });

  it('declares no outputs: passes with nothing written (there is nothing to verify)', async () => {
    const { outcome } = await runScenario({ outputs: [], writes: [] });
    expect(outcome.status).toBe('succeeded');
  });

  it('applies to `agent` steps only: a command step that declares outputs is not checked here', async () => {
    const projectRoot = await createTempRepo('command');
    const ctx = createTestContext({ projectRoot, adapter: new FakePlatformAdapter() });
    const outcome = await executeStep(
      node({ id: 'wf:cmd', kind: 'command', run: 'true', outputs: [{ type: 'Epic' }] }),
      ctx,
    );
    expect(outcome.status).toBe('succeeded');
  });
});

describe('configured docs roots', () => {
  const RELOCATED = {
    kb: 'documentation/kb',
    specs: 'documentation/specs',
    sessions: 'documentation/sessions',
    reports: 'documentation/reports',
  };

  it('looks for the output under the roots the context carries, not the default layout', async () => {
    const moved = await runScenario({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: 'documentation/specs/epics/EPIC-001.md', content: epicText() }],
      produces: ['documentation/**'],
      docRoots: RELOCATED,
    });
    expect(moved.outcome.status).toBe('succeeded');
    // Same file, default roots: the check does not find it (it is not silently satisfied elsewhere).
    const defaults = await runScenario({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: 'documentation/specs/epics/EPIC-001.md', content: epicText() }],
      produces: ['documentation/**'],
    });
    expect(expectFailed(defaults.outcome).message).toContain('docs/forge/specs/epics/EPIC-*.md');
  });
});

describe('what the lane branch actually carries', () => {
  it('a committed symlink is not an artifact even when its target text is a valid document', async () => {
    const projectRoot = await createTempRepo('symlink');
    const ctx = createTestContext({ projectRoot, adapter: new FakePlatformAdapter() });
    const baseSha = await ctx.vcs.resolveRevision('main');
    const lane = await ctx.vcs.createLane('wf:link', 'main');
    await mkdir(path.join(lane.path, 'docs/forge/specs/epics'), { recursive: true });
    await symlink(epicText(), path.join(lane.path, 'docs/forge/specs/epics/EPIC-001.md'));
    await ctx.vcs.commit(lane, 'link', false);
    const failure = await checkDeclaredOutputs({
      node: node({
        id: 'wf:link',
        kind: 'agent',
        agent: toAgentId('po'),
        outputs: [{ type: 'Epic' }],
      }),
      vcs: ctx.vcs,
      lane,
      baseSha,
      docRoots: {
        kb: 'docs/forge/kb',
        specs: 'docs/forge/specs',
        sessions: 'docs/forge/sessions',
        reports: 'docs/forge/reports',
      },
      claimReverted: [],
      writeForbidden: false,
    });
    expect(failure?.code).toBe('RUN-083');
  });

  it('an agent that cannot be loaded is not reported as write-forbidden (the generic code applies)', async () => {
    const projectRoot = await createTempRepo('unloadable');
    const ctx = createTestContext({
      projectRoot,
      adapter: new FakePlatformAdapter(),
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: () => Promise.reject(new Error('cannot load')),
      }),
    });
    const baseSha = await ctx.vcs.resolveRevision('main');
    const lane = await ctx.vcs.createLane('wf:noload', 'main');
    const failure = await verifyDeclaredOutputs(
      node({ id: 'wf:noload', kind: 'agent', agent: toAgentId('em'), outputs: [{ type: 'Epic' }] }),
      ctx,
      lane,
      baseSha,
      [],
    );
    expect(failure?.code).toBe('RUN-083');
  });

  it('a step that failed the contract does not announce LaneReady, so a resume cannot hand its lane to a merge', async () => {
    const { events } = await runScenario({ outputs: [{ type: 'Epic' }], writes: [] });
    expect(events.map((event) => event.type)).not.toContain('LaneReady');
    const ok = await runScenario({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: EPIC_PATH, content: epicText() }],
    });
    expect(ok.events.map((event) => event.type)).toContain('LaneReady');
  });
});

describe('the real VCS facade separates what reached the lane branch from what did not', () => {
  it('reports a worktree-only file as uncommitted, never as committed, and reads content from the object database', async () => {
    const projectRoot = await createTempRepo('facade');
    const ctx = createTestContext({ projectRoot, adapter: new FakePlatformAdapter() });
    const baseSha = await ctx.vcs.resolveRevision('main');
    const lane = await ctx.vcs.createLane('wf:facade', 'main');
    await mkdir(path.join(lane.path, 'docs'), { recursive: true });
    await writeFile(path.join(lane.path, 'docs', 'stranded.md'), 'only in the worktree\n');
    const before = await ctx.vcs.changedFiles(lane, baseSha);
    expect(before.committed).toEqual([]);
    expect(before.uncommitted).toEqual(['docs/stranded.md']);
    expect(await ctx.vcs.readAtRevision(lane, 'HEAD', 'docs/stranded.md')).toBeUndefined();
    await ctx.vcs.commit(lane, 'add', false);
    const after = await ctx.vcs.changedFiles(lane, baseSha);
    expect(after.committed).toEqual(['docs/stranded.md']);
    expect(after.uncommitted).toEqual([]);
    expect(await ctx.vcs.readAtRevision(lane, 'HEAD', 'docs/stranded.md')).toBe(
      'only in the worktree\n',
    );
    expect(await ctx.vcs.readAtRevision(lane, baseSha, 'docs/stranded.md')).toBeUndefined();
    // A flag-shaped revision never reaches git.
    expect(await ctx.vcs.readAtRevision(lane, '--output=x', 'docs/stranded.md')).toBeUndefined();
  });
});

describe('the shared lane lifecycle (a resumed step goes through the same check)', () => {
  it('fails a resumed lane whose re-run produced nothing, exactly like a fresh one', async () => {
    const projectRoot = await createTempRepo('resume');
    const ctx = createTestContext({ projectRoot, adapter: new FakePlatformAdapter() });
    const baseSha = await ctx.vcs.resolveRevision('main');
    const lane = await ctx.vcs.createLane('wf:step', 'main');
    const stepNode = node({
      id: 'wf:step',
      kind: 'agent',
      agent: toAgentId('em'),
      outputs: [{ type: 'Epic' }],
    });
    const outcome = await runLaneLifecycle(
      stepNode,
      ctx,
      0,
      {
        kind: 'agent',
        session: {
          sessionId: '',
          ok: false,
          finalText: '',
          usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
          durationMs: 0,
          changedFiles: [],
          controlTokens: [],
        },
      },
      () =>
        Promise.resolve({
          changed: false,
          commitSubject: 'resumed',
          detail: { kind: 'checkpoint' },
        }),
      { lane, baseSha },
    );
    expect(expectFailed(outcome)).toMatchObject({ source: 'output', code: 'RUN-083' });
  });
});

describe('the failure policy applies (06 §6.8)', () => {
  it('is classified `validation`, and retry follows the step retryOn list: retried when listed, escalated when not', async () => {
    const { outcome } = await runScenario({ outputs: [{ type: 'Epic' }], writes: [] });
    expect(classifyFailure(outcome)).toBe('validation');
    const policy: StepNodeRetryPolicy = {
      maxAttempts: 3,
      backoffMs: [1000, 30_000],
      retryOn: ['validation'],
    };
    expect(decideRetry(policy, [outcome])).toBe('retry');
    expect(decideRetry({ ...policy, retryOn: ['transient'] }, [outcome])).toBe('escalate');
  });

  it('two identical output failures escalate under the never-retry rule, even with attempts remaining', async () => {
    const first = await runScenario({ outputs: [{ type: 'Epic' }], writes: [], runId: 'run-a' });
    const second = await runScenario({ outputs: [{ type: 'Epic' }], writes: [], runId: 'run-b' });
    const policy: StepNodeRetryPolicy = {
      maxAttempts: 5,
      backoffMs: [1000, 30_000],
      retryOn: ['validation'],
    };
    expect(decideRetry(policy, [first.outcome, second.outcome])).toBe('escalate');
  });
});
