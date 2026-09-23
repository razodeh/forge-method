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
import type { ExecuteStepContext, LaneHandle, StepOutcome } from '../../src/dispatch/types.ts';
import { classifyFailure, decideRetry } from '../../src/failures/index.ts';
import { toAgentId, type StepNode, type StepNodeRetryPolicy } from '../../src/plan/index.ts';
import {
  adrText,
  epicMissingGoalText,
  epicText,
  risksFileText,
  sessionRecordText,
} from './artifact-fixtures.ts';
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
    plans: 'documentation/plans',
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
        plans: 'docs/forge/plans',
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

/**
 * The output check holds a produced KB output to its reserved id range (`PLAN-M14.md` P10,
 * `SPEC-QUESTIONS.md` Q232 decision 2): `runAgentStep` always reserves a KB-located declared output's id
 * before assembly (`PLAN-M14.md` P8), so a real `executeStep` run through a real lane exercises the whole
 * reserve -> assemble -> write -> check path exactly as a real run would, no different from any other
 * `runScenario` case above beyond seeding the project with existing ADR content so the reservation lands
 * on a known, non-trivial base.
 *
 * @see specs/18 §18.8
 * @see specs/08 §8.6
 * @see PLAN-M14.md P10
 * @see SPEC-QUESTIONS.md Q232 decision 2
 */
describe('the output check holds a produced KB output to its reserved id range (PLAN-M14.md P10)', () => {
  const DECISIONS = 'docs/forge/kb/decisions';
  const RISKS_PATH = 'docs/forge/kb/risks.md';

  async function seedAdr(projectRoot: string, id: string): Promise<void> {
    const dir = path.join(projectRoot, DECISIONS);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${id}-seed.md`), adrText(id, 'Seed'));
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '--quiet', '-m', 'seed'], { cwd: projectRoot });
  }

  async function runAdrScenario(options: {
    readonly seedId?: string;
    readonly cardinality?: 'many';
    readonly writes: readonly { readonly relativePath: string; readonly content: string }[];
    readonly runId?: string;
  }) {
    const projectRoot = await createTempRepo('kb-range');
    if (options.seedId !== undefined) await seedAdr(projectRoot, options.seedId);
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['wrote the adr'], writeFiles: [...options.writes] });
    const runId = options.runId ?? 'run-kb-range';
    const ctx = createTestContext({
      projectRoot,
      adapter,
      runId,
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) =>
          Promise.resolve(
            fixtureAgent(agentId, {
              tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
            }),
          ),
      }),
    });
    const stepNode = node({
      id: 'wf:write-adr',
      kind: 'agent',
      agent: toAgentId('architect'),
      brief: 'write the adr',
      produces: ['docs/forge/**'],
      outputs: [
        {
          type: 'ADR',
          ...(options.cardinality === undefined ? {} : { cardinality: options.cardinality }),
        },
      ],
    });
    const outcome = await executeStep(stepNode, ctx);
    return { outcome, projectRoot };
  }

  it('a produced ADR at exactly its reserved id passes', async () => {
    const { outcome } = await runAdrScenario({
      seedId: 'ADR-0006',
      writes: [{ relativePath: `${DECISIONS}/ADR-0007-x.md`, content: adrText('ADR-0007') }],
    });
    expect(outcome.status).toBe('succeeded');
  });

  it('a produced ADR at a different id than the one reserved fails, naming the reserved id', async () => {
    const { outcome } = await runAdrScenario({
      seedId: 'ADR-0006',
      writes: [{ relativePath: `${DECISIONS}/ADR-0009-x.md`, content: adrText('ADR-0009') }],
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-083');
    expect(outcome.failure?.message).toContain('ADR-0007');
    expect(outcome.failure?.message).toContain('ADR-0009');
  });

  it('cardinality many: the reserved block used in order from its own base passes', async () => {
    const { outcome } = await runAdrScenario({
      seedId: 'ADR-0006',
      cardinality: 'many',
      writes: [
        { relativePath: `${DECISIONS}/ADR-0007-a.md`, content: adrText('ADR-0007') },
        { relativePath: `${DECISIONS}/ADR-0008-b.md`, content: adrText('ADR-0008') },
      ],
    });
    expect(outcome.status).toBe('succeeded');
  });

  it('cardinality many: skipping an id in the reserved block (using 0007+0009, never 0008) fails', async () => {
    const { outcome } = await runAdrScenario({
      seedId: 'ADR-0006',
      cardinality: 'many',
      writes: [
        { relativePath: `${DECISIONS}/ADR-0007-a.md`, content: adrText('ADR-0007') },
        { relativePath: `${DECISIONS}/ADR-0009-b.md`, content: adrText('ADR-0009') },
      ],
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-083');
    expect(outcome.failure?.message).toContain('ADR-0009');
  });

  it('cardinality many: two DIFFERENT files in the SAME commit both claiming the one reserved id fail as a duplicate, over a real lane', async () => {
    const { outcome } = await runAdrScenario({
      seedId: 'ADR-0006',
      cardinality: 'many',
      writes: [
        { relativePath: `${DECISIONS}/ADR-0007-a.md`, content: adrText('ADR-0007', 'First') },
        { relativePath: `${DECISIONS}/ADR-0007-b.md`, content: adrText('ADR-0007', 'Second') },
      ],
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-083');
    expect(outcome.failure?.message).toContain('ADR-0007');
    expect(outcome.failure?.message).toContain('more than once');
  });

  it('an id already present at the base revision is an update, exempt from the range rule', async () => {
    const projectRoot = await createTempRepo('kb-range-update');
    await seedAdr(projectRoot, 'ADR-0007');
    const adapter = new FakePlatformAdapter();
    // Edits the SAME file, same id, different title -- an update to an existing artifact, not a new one.
    // The reservation this step gets (ADR-0008, above the seeded ADR-0007) is irrelevant to it.
    adapter.script(() => true, {
      text: ['updated the adr'],
      writeFiles: [
        { relativePath: `${DECISIONS}/ADR-0007-seed.md`, content: adrText('ADR-0007', 'Updated') },
      ],
    });
    const ctx = createTestContext({
      projectRoot,
      adapter,
      runId: 'run-kb-range-update',
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) =>
          Promise.resolve(
            fixtureAgent(agentId, {
              tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
            }),
          ),
      }),
    });
    const outcome = await executeStep(
      node({
        id: 'wf:update-adr',
        kind: 'agent',
        agent: toAgentId('architect'),
        brief: 'update the adr',
        produces: ['docs/forge/**'],
        outputs: [{ type: 'ADR' }],
      }),
      ctx,
    );
    expect(outcome.status).toBe('succeeded');
  });

  it("an id swapped at an already-existing path is NOT exempt as an update: the file's own new id must still lie in the reservation", async () => {
    // The exemption is keyed on the artifact's own declared `id`, not on the PATH already existing: a
    // session that rewrites an existing artifact's file, unchanged path, but with a DIFFERENT id in its own
    // front matter, is producing a new, unreserved id under cover of what looks like an ordinary edit.
    const projectRoot = await createTempRepo('kb-range-id-swap');
    await seedAdr(projectRoot, 'ADR-0007');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['swapped the id'],
      // Same path as the seeded ADR, but its own `id:` field now says ADR-0009 -- never reserved (this
      // step's own reservation, above the seeded ADR-0007, is ADR-0008) and never seen anywhere else.
      writeFiles: [
        { relativePath: `${DECISIONS}/ADR-0007-seed.md`, content: adrText('ADR-0009', 'Swapped') },
      ],
    });
    const ctx = createTestContext({
      projectRoot,
      adapter,
      runId: 'run-kb-range-id-swap',
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) =>
          Promise.resolve(
            fixtureAgent(agentId, {
              tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
            }),
          ),
      }),
    });
    const outcome = await executeStep(
      node({
        id: 'wf:swap-adr-id',
        kind: 'agent',
        agent: toAgentId('architect'),
        brief: 'swap the id',
        produces: ['docs/forge/**'],
        outputs: [{ type: 'ADR' }],
      }),
      ctx,
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-083');
    expect(outcome.failure?.message).toContain('ADR-0009');
    expect(outcome.failure?.message).toContain('ADR-0008');
  });

  it("register entries: a new entry inside the reserved range passes; one colliding with a ready sibling lane's own new entry fails", async () => {
    const projectRoot = await createTempRepo('kb-range-register');
    await mkdir(path.join(projectRoot, 'docs/forge/kb'), { recursive: true });
    await writeFile(
      path.join(projectRoot, RISKS_PATH),
      risksFileText('RISK-001', 'RISK-002', 'RISK-003'),
    );
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '--quiet', '-m', 'seed risks'], { cwd: projectRoot });

    // A ready sibling lane (`ctx.laneRegistry`) that has already produced its OWN new entry, RISK-004 --
    // this step's own reservation must scan past it (`output-ids.ts`), landing on RISK-005.
    const siblingLane = await mkdtemp(path.join(tmpdir(), 'forge-outputs-kb-range-sibling-'));
    await mkdir(path.join(siblingLane, 'docs/forge/kb'), { recursive: true });
    await writeFile(
      path.join(siblingLane, RISKS_PATH),
      risksFileText('RISK-001', 'RISK-002', 'RISK-003', 'RISK-004'),
    );
    const siblingHandle: LaneHandle = {
      laneId: 'lane-sibling',
      path: siblingLane,
      branch: 'forge/run-kb-range-register/other',
    };

    async function attempt(newEntryId: string, runId: string) {
      const adapter = new FakePlatformAdapter();
      adapter.script(() => true, {
        text: ['updated the risk register'],
        writeFiles: [
          {
            relativePath: RISKS_PATH,
            content: risksFileText('RISK-001', 'RISK-002', 'RISK-003', newEntryId),
          },
        ],
      });
      const laneRegistry = new Map<string, LaneHandle>([['wf:other-step', siblingHandle]]);
      const ctx = createTestContext({
        projectRoot,
        adapter,
        // A distinct runId per attempt: each drives its OWN fresh lane for the SAME stepId, and a lane's
        // branch/worktree name is keyed by (runId, stepId) -- reusing one would collide with the other
        // attempt's still-real worktree/branch from earlier in this same test.
        runId,
        laneRegistry,
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
      });
      return executeStep(
        node({
          id: 'wf:write-risk',
          kind: 'agent',
          agent: toAgentId('architect'),
          brief: 'add a risk',
          produces: ['docs/forge/**'],
          outputs: [{ type: 'Risk' }],
        }),
        ctx,
      );
    }

    const inRange = await attempt('RISK-005', 'run-kb-range-register-a');
    expect(inRange.status).toBe('succeeded');
    const colliding = await attempt('RISK-004', 'run-kb-range-register-b');
    expect(colliding.status).toBe('failed');
    expect(colliding.failure?.code).toBe('RUN-083');
    expect(colliding.failure?.message).toContain('RISK-004');
    expect(colliding.failure?.message).toContain('RISK-005');
  });

  it('register entries: two NEW entries in the same commit sharing one id fail as a duplicate, over a real lane', async () => {
    const projectRoot = await createTempRepo('kb-range-register-dup');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['wrote the risk register'],
      // Both entries are new (nothing existed at base) and both claim RISK-001 -- a genuine same-commit
      // id collision, not merely two entries in range.
      writeFiles: [{ relativePath: RISKS_PATH, content: risksFileText('RISK-001', 'RISK-001') }],
    });
    const ctx = createTestContext({
      projectRoot,
      adapter,
      runId: 'run-kb-range-register-dup',
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) =>
          Promise.resolve(
            fixtureAgent(agentId, {
              tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
            }),
          ),
      }),
    });
    const outcome = await executeStep(
      node({
        id: 'wf:write-risk-dup',
        kind: 'agent',
        agent: toAgentId('architect'),
        brief: 'add risks',
        produces: ['docs/forge/**'],
        outputs: [{ type: 'Risk', cardinality: 'many' }],
      }),
      ctx,
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('RUN-083');
    expect(outcome.failure?.message).toContain('RISK-001');
    expect(outcome.failure?.message).toContain('more than once');
  });

  it('the range rule is not held against a non-KB type: a fabricated reservation for Epic is simply ignored', async () => {
    const projectRoot = await createTempRepo('kb-range-epic');
    const ctx = createTestContext({ projectRoot, adapter: new FakePlatformAdapter() });
    const baseSha = await ctx.vcs.resolveRevision('main');
    const lane = await ctx.vcs.createLane('wf:epic-not-held', 'main');
    await mkdir(path.join(lane.path, 'docs/forge/specs/epics'), { recursive: true });
    await writeFile(path.join(lane.path, EPIC_PATH), epicText('EPIC-001'));
    await ctx.vcs.commit(lane, 'write epic', false);
    // If the range rule ran on every type instead of only KB-located ones, this fabricated, deliberately
    // mismatched "reservation" for Epic would fail EPIC-001 for not being "ADR-9999" -- it does not, since
    // Epic's own registry `pathTemplate` ("specs/epics/{id}.md") does not start `kb/`.
    const failure = await checkDeclaredOutputs({
      node: node({
        id: 'wf:epic-not-held',
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
        plans: 'docs/forge/plans',
        sessions: 'docs/forge/sessions',
        reports: 'docs/forge/reports',
      },
      claimReverted: [],
      writeForbidden: false,
      reservedIds: new Map([['Epic', ['EPIC-9999']]]),
    });
    expect(failure).toBeUndefined();
  });
});
