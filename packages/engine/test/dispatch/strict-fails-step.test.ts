/**
 * An out-of-claim write under `strict` fails the step (`PLAN-M14.md` P3, `06` §6.7 as amended,
 * `SPEC-QUESTIONS.md` Q232 decision 1 — Q212's own P31 residual, now resolved). `PLAN-M13.md` P14 already
 * made `strict` revert every out-of-claim write safely (`output-claim.test.ts` proves that, unchanged);
 * this piece is what makes a REAL violation also end the step `failed`, with `StepFailureInfo
 * { source: 'claim', code: 'RUN-104' }`, classified `policy` by `classifyFailure` (never retried). `warn`
 * (`guided`'s own default for a step declaring neither `outputs` nor `produces`) stays byte-for-byte
 * unchanged: a violation there is a `PolicyViolation` event with the step still succeeding.
 *
 * Written from the plan's own "Tests first" text, against a real git lane, the real claim enforcement and
 * the real event log; only the model session is faked.
 *
 * @see specs/06 §6.7, §6.8
 * @see PLAN-M14.md P3
 * @see SPEC-QUESTIONS.md Q212, Q232
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { createVcsFacade } from '../../src/dispatch/facades.ts';
import { runLaneLifecycle } from '../../src/dispatch/steps.ts';
import { classifyFailure } from '../../src/failures/classify.ts';
import { decideRetry } from '../../src/failures/retry.ts';
import type { LaneHandle } from '../../src/dispatch/types.ts';
import { toAgentId, type StepNode } from '../../src/plan/index.ts';
import { epicText } from './artifact-fixtures.ts';
import { createFixtureAssembly, createTestContext, fixtureAgent, node } from './helpers.ts';

const EPIC_PATH = 'docs/forge/specs/epics/EPIC-001.md';
const STRAY = 'src/stray.ts';

const EMPTY_SESSION = {
  sessionId: '',
  ok: true,
  finalText: '',
  usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
  durationMs: 0,
  changedFiles: [],
  controlTokens: [],
} as const;

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-strict-fails-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** The files the lane branch holds at its head (`HEAD` of the lane worktree). */
async function treeAt(lanePath: string | undefined): Promise<string[]> {
  if (lanePath === undefined) throw new Error('the step never created a lane');
  return (await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: lanePath })).stdout
    .split('\n')
    .filter((line) => line !== '');
}

interface Scenario {
  readonly outputs?: StepNode['outputs'];
  readonly produces?: readonly string[];
  readonly writes: readonly { readonly relativePath: string; readonly content: string }[];
  readonly claimPolicy: 'strict' | 'warn';
}

async function run(scenario: Scenario) {
  const projectRoot = await createTempRepo('scenario');
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, { text: ['done'], writeFiles: [...scenario.writes] });
  const runId = 'run-strict-fails';
  // The lane is captured at creation, independent of `ctx.laneRegistry`: a failed step never registers a
  // lane, and its branch is still the record of what survived claim enforcement.
  const real = createVcsFacade(projectRoot, runId);
  let created: LaneHandle | undefined;
  const ctx = createTestContext({
    projectRoot,
    adapter,
    runId,
    vcs: {
      ...real,
      createLane: async (stepId, base) => {
        created = await real.createLane(stepId, base);
        return created;
      },
    },
    claimPolicy: scenario.claimPolicy,
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
    id: 'wf:step',
    kind: 'agent',
    agent: toAgentId('po'),
    brief: 'do the work',
    outputs: scenario.outputs ?? [],
    produces: scenario.produces ?? [],
  });
  const outcome = await executeStep(stepNode, ctx);
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(projectRoot, runId)) events.push(event);
  const committed = await treeAt(created?.path);
  return { outcome, events, ctx, committed, projectRoot };
}

describe('strict + a real out-of-claim write: the step fails (06 §6.7 as amended)', () => {
  it('fails with source claim, code RUN-104; the message lists the path and the true total', async () => {
    const { outcome, events, ctx, committed } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [
        { relativePath: EPIC_PATH, content: epicText() },
        { relativePath: STRAY, content: 'export const leak = 1;\n' },
      ],
      claimPolicy: 'strict',
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(outcome.failure?.message).toContain(STRAY);
    expect(outcome.failure?.message).toContain('1 path(s)');
    expect(outcome.failure?.message).toContain('-- Remedy:');

    // No LaneReady, lane not registered (the whole point: a claim violation is never announced ready).
    expect(events.map((event) => event.type)).not.toContain('LaneReady');
    expect(ctx.laneRegistry.has('wf:step')).toBe(false);

    // Order: work commit -> PolicyViolation -> claim-revert commit and its own LaneCommitted.
    const laneCommitted = events.filter((event) => event.type === 'LaneCommitted');
    expect(laneCommitted).toHaveLength(2);
    const violationIndex = events.findIndex((event) => event.type === 'PolicyViolation');
    const revertIndex = events.findIndex(
      (event) =>
        event.type === 'LaneCommitted' &&
        (event.payload as { reason?: string } | undefined)?.reason === 'claim-revert',
    );
    expect(violationIndex).toBeGreaterThanOrEqual(0);
    expect(revertIndex).toBeGreaterThan(violationIndex);

    // Lane HEAD: the stray is reverted, the declared output is still committed.
    expect(committed).toContain(EPIC_PATH);
    expect(committed).not.toContain(STRAY);

    // The PolicyViolation payload's own exact shape (stepFailed is the only new field).
    const violation = events.find((event) => event.type === 'PolicyViolation');
    expect(violation?.payload).toEqual({
      kind: 'out-of-claim-write',
      policy: 'strict',
      stepFailed: true,
      paths: [STRAY],
      totalOutOfClaim: 1,
      totalReverted: 1,
    });
  });

  it('lists at most 5 paths in the failure message but always states the true total', async () => {
    const strays = Array.from({ length: 7 }, (_unused, index) => ({
      relativePath: `src/stray-${String(index)}.ts`,
      content: 'x\n',
    }));
    const { outcome } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: EPIC_PATH, content: epicText() }, ...strays],
      claimPolicy: 'strict',
    });
    const message = outcome.failure?.message ?? '';
    expect(message).toContain('7 path(s)');
    for (const stray of strays.slice(0, 5)) expect(message).toContain(stray.relativePath);
    expect(message).not.toContain('stray-5.ts');
    expect(message).not.toContain('stray-6.ts');
    expect(message).toMatch(/and 2 more/);
  });
});

describe('classification and retry (06 §6.8): a claim failure is policy, and is never retried', () => {
  it('classifyFailure returns policy; decideRetry escalates on the very first attempt', async () => {
    const { outcome } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [
        { relativePath: EPIC_PATH, content: epicText() },
        { relativePath: STRAY, content: 'x\n' },
      ],
      claimPolicy: 'strict',
    });
    expect(outcome.status).toBe('failed');
    expect(classifyFailure(outcome)).toBe('policy');
    // `policy` can never appear in a `StepNodeRetryPolicy.retryOn` list (`RetryableFailureClass` excludes
    // it at the type level) -- decideRetry escalates immediately, even with attempts remaining.
    expect(decideRetry({ maxAttempts: 5, backoffMs: [1000, 30_000], retryOn: [] }, [outcome])).toBe(
      'escalate',
    );
  });
});

describe('an empty-claim agent step is strict at every autonomy (resolveStepClaim, P36)', () => {
  for (const claimPolicy of ['strict', 'warn'] as const) {
    it(`fails RUN-104 under a project default of ${claimPolicy}: an empty claim is enforced strict regardless`, async () => {
      const projectRoot = await createTempRepo(`empty-${claimPolicy}`);
      const runId = `run-empty-claim-${claimPolicy}`;
      const ctx = createTestContext({
        projectRoot,
        adapter: new FakePlatformAdapter(),
        runId,
        claimPolicy,
        assembly: createFixtureAssembly(projectRoot, {
          loadAgent: (agentId) => Promise.resolve(fixtureAgent(agentId)),
        }),
      });
      let lanePath = '';
      const outcome = await runLaneLifecycle(
        node({ id: 'wf:empty', kind: 'agent', agent: toAgentId('backend'), brief: 'work' }),
        ctx,
        0,
        { kind: 'agent', session: EMPTY_SESSION },
        async (lane) => {
          lanePath = lane.path;
          await mkdir(path.join(lane.path, 'src'), { recursive: true });
          await writeFile(path.join(lane.path, 'src', 'sneaky.ts'), 'export const s = 1;\n');
          return { changed: true, commitSubject: 'sneaky', detail: { kind: 'checkpoint' } };
        },
      );
      expect(outcome.status).toBe('failed');
      expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
      const tree = await treeAt(lanePath);
      expect(tree).not.toContain('src/sneaky.ts');
      expect(ctx.laneRegistry.has('wf:empty')).toBe(false);
    });
  }
});

describe("warn stays byte-for-byte unchanged (06 §6.7's own guided default)", () => {
  it('produces-only, out-of-claim write: kept and flagged, the step still succeeds -- stepFailed:false pinned', async () => {
    const { outcome, events, committed } = await run({
      produces: ['docs/**'],
      writes: [{ relativePath: STRAY, content: 'x\n' }],
      claimPolicy: 'warn',
    });
    expect(outcome.status).toBe('succeeded');
    expect(committed).toContain(STRAY);
    const violation = events.find((event) => event.type === 'PolicyViolation');
    expect(violation?.payload).toEqual({
      kind: 'out-of-claim-write',
      policy: 'warn',
      stepFailed: false,
      paths: [STRAY],
      totalOutOfClaim: 1,
      totalReverted: 0,
    });
  });

  it('a floor path (.forge/x) is reverted as a denial even under warn, but the step still succeeds -- pinned unchanged', async () => {
    const { outcome, committed, events } = await run({
      produces: ['**'],
      writes: [
        { relativePath: 'src/ok.ts', content: 'export {};\n' },
        { relativePath: '.forge/x', content: 'x\n' },
      ],
      claimPolicy: 'warn',
    });
    expect(outcome.status).toBe('succeeded');
    expect(committed).toContain('src/ok.ts');
    expect(committed).not.toContain('.forge/x');
    const violation = events.find((event) => event.type === 'PolicyViolation');
    expect(violation?.payload).toMatchObject({
      policy: 'warn',
      stepFailed: false,
      totalReverted: 1,
    });
  });
});

describe('an adapter failure from the same attempt wins over the claim failure', () => {
  it("the step fails with the adapter's own source and code, not RUN-104 -- the violation stays only in the event", async () => {
    const projectRoot = await createTempRepo('adapter-wins');
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['crashed'],
      writeFiles: [{ relativePath: STRAY, content: 'x\n' }],
      endReason: 'error',
      errorInfo: { code: 'TOOL_ERROR', message: 'the tool blew up' },
    });
    const runId = 'run-adapter-wins';
    const ctx = createTestContext({
      projectRoot,
      adapter,
      runId,
      claimPolicy: 'strict',
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) =>
          Promise.resolve(
            fixtureAgent(agentId, {
              tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
            }),
          ),
      }),
    });
    // `produces: ['docs/**']` keeps the write grant (a non-empty claim); `STRAY` falls outside it, so
    // enforcement still finds a real violation alongside the adapter's own failure.
    const stepNode = node({
      id: 'wf:crash',
      kind: 'agent',
      agent: toAgentId('po'),
      brief: 'do the work',
      produces: ['docs/**'],
    });
    const outcome = await executeStep(stepNode, ctx);
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'adapter', code: 'TOOL_ERROR' });
    expect(outcome.failure?.message).not.toContain('RUN-104');
    expect(ctx.laneRegistry.has('wf:crash')).toBe(false);
    const events: ForgeEvent[] = [];
    for await (const event of readEvents(projectRoot, runId)) events.push(event);
    expect(events.map((event) => event.type)).not.toContain('LaneReady');
    const violation = events.find((event) => event.type === 'PolicyViolation');
    expect(violation?.payload).toMatchObject({ stepFailed: true, paths: [STRAY] });
  });
});

describe('RUN-104 keeps the P7 docs-roots hint when a declared output’s own path is reverted', () => {
  it('a `produces` exclusion that carves the declared output back out of its own claim triggers the hint', async () => {
    const { outcome } = await run({
      outputs: [{ type: 'Epic' }],
      produces: [`!${EPIC_PATH}`],
      writes: [{ relativePath: EPIC_PATH, content: epicText() }],
      claimPolicy: 'strict',
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toContain('configured docs roots');
  });

  it('an ordinary stray unrelated to any declared output does not carry the hint', async () => {
    const { outcome } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [
        { relativePath: EPIC_PATH, content: epicText() },
        { relativePath: STRAY, content: 'x\n' },
      ],
      claimPolicy: 'strict',
    });
    expect(outcome.failure?.message).not.toContain('configured docs roots');
  });
});

describe('the failure message is safe to print and log (06 §6.8)', () => {
  it('replaces control characters from an agent-controlled out-of-claim path', async () => {
    const hostile = 'src/stray\u001b[31m.ts';
    const { outcome } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [
        { relativePath: EPIC_PATH, content: epicText() },
        { relativePath: hostile, content: 'x\n' },
      ],
      claimPolicy: 'strict',
    });
    const message = outcome.failure?.message ?? '';
    expect(Array.from(message, (char) => char.charCodeAt(0)).every((code) => code >= 32)).toBe(
      true,
    );
  });
});
