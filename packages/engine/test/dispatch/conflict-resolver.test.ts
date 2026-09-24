/**
 * `createAgentConflictResolver` (`PLAN-M14.md` P38, `06` §6.5 step 2's own `agent` bullet) — unit-level
 * tests of the resolver function itself: the three no-session refusals, the one confined session it runs,
 * and the three post-session verifications, called directly with a hand-built `MergeConflictDescription`
 * rather than through a real rebase (`lane-integration.test.ts`'s own end-to-end tests already exercise
 * this through a REAL conflicting rebase; this file is about the resolver's own guardrails in isolation).
 *
 * @see specs/06 §6.5
 * @see specs/20 §20.1, §20.5
 * @see PLAN-M14.md P38
 */
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import type {
  PlatformAdapter,
  SessionHandle,
  SessionRequest,
  SessionResult,
} from '@forge/adapter-kit';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents } from '@forge/telemetry/events';
import { createLaneWorktree, processMergeCandidate, type MergeCandidate } from '@forge/vcs';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { createAgentConflictResolver } from '../../src/dispatch/conflict-resolver.ts';
import type { ExecuteStepContext, MergeConflictDescription } from '../../src/dispatch/types.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createFixtureAssembly, createTestContext, fixtureAgent, node } from './helpers.ts';

/** `ExecuteStepContext.projectRoot` and `description.worktreePath` are ALWAYS two different directories
 * in production (`createLaneWorktree`'s own `git worktree add` output lives at
 * `<projectRoot>/.forge/state/worktrees/<lane>`, never the project root itself) -- kept two different
 * plain temp directories here too, deliberately, rather than reusing the conflict worktree for both:
 * `assembleAgentSession`'s own audit record (`ctx.assembly.paths`, bound to `projectRoot`) writes
 * `.forge/state/...` files, and a `projectRoot` collapsed into the SAME directory as the lane worktree
 * would make that write show up as a spurious out-of-claim change in the lane's own `git status` --
 * confirmed empirically the hard way while first writing this file's own fixtures. `.forge/state/` is
 * gitignored in every real project (`06` §6.4: "Worktrees live there, so they never self-reference"),
 * which is what actually keeps this collision from ever happening for a REAL lane worktree (a `git
 * worktree add` checkout has no `.forge/` of its own at all, gitignored or not).
 */
async function freshProjectRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `forge-conflict-resolver-root-${prefix}-`));
}

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-conflict-resolver-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await writeFile(path.join(dir, 'README.md'), 'init\n');
  await execa('git', ['add', 'README.md'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

const CONFLICT_MARKERS = [
  '<<<<<<< HEAD',
  'from integration',
  '=======',
  'from lane',
  '>>>>>>> lane-commit',
  '',
].join('\n');

/** A conflict-shaped worktree: `same.txt` present with real git conflict markers, matching what a real
 * rebase leaves behind, but with no actual rebase in progress -- this module's own checks never inspect
 * git's own rebase/index state, only the worktree's real files and `git status`/`HEAD` (this file's own
 * header comment). */
async function conflictWorktree(prefix: string): Promise<string> {
  const dir = await createTempRepo(prefix);
  await writeFile(path.join(dir, 'same.txt'), CONFLICT_MARKERS);
  return dir;
}

function describeConflict(
  worktreePath: string,
  stepId: string | undefined,
): MergeConflictDescription {
  return {
    laneId: 'lane-1',
    stepId,
    runId: 'run-1',
    declaredClaim: [],
    conflictedFiles: [{ path: 'same.txt', status: 'UU' }],
    diff: '--- a/same.txt\n+++ b/same.txt\n@@ fake diff @@\n',
    worktreePath,
  };
}

function emptyHandle(sessionId: string, result: SessionResult): SessionHandle {
  return {
    sessionId,
    events: (async function* () {
      // No events to yield -- these hostile-adapter tests only inspect the resolver's own reaction.
    })(),
    stop: () => Promise.resolve(),
    result: () => Promise.resolve(result),
  };
}

const OK_RESULT: SessionResult = {
  sessionId: 'hostile',
  ok: true,
  finalText: 'done',
  usage: { inputTokens: 1, outputTokens: 1, turns: 1 },
  durationMs: 1,
  changedFiles: [],
  controlTokens: [],
};

/** A `PlatformAdapter` whose `startSession` is fully caller-controlled, everything else delegated to a
 * real `FakePlatformAdapter` (`capabilities()` in particular: `assembleAgentSession` calls it). */
function adapterWithStartSession(startSession: PlatformAdapter['startSession']): PlatformAdapter {
  const inner = new FakePlatformAdapter();
  return {
    id: inner.id,
    displayName: inner.displayName,
    capabilities: () => inner.capabilities(),
    preflight: () => inner.preflight(),
    listModels: () => inner.listModels(),
    resumeSession: (id, req) => inner.resumeSession(id, req),
    startSession,
  };
}

function baseNode(overrides: Parameters<typeof node>[0]) {
  return node({
    agent: toAgentId('engineer'),
    brief: 'do the conflicting work',
    ...overrides,
  });
}

async function contextWithStep(
  adapter: PlatformAdapter,
  stepOverrides: Partial<Parameters<typeof node>[0]> = {},
): Promise<ExecuteStepContext> {
  const stepNode = baseNode({ id: 'wf:step', kind: 'agent', ...stepOverrides });
  const projectRoot = await freshProjectRoot('ctx');
  const base = createTestContext({ projectRoot, adapter, runId: 'run-resolver' });
  return { ...base, stepGraph: new Map([[stepNode.id, stepNode]]) };
}

describe('createAgentConflictResolver -- (a) refusals, no session run', () => {
  it("no stepId at all (an in-lane join's own JoinConflictDescription, or a DECIDE lane not in the compiled plan): MERGE-RESOLVER-NO-STEP", async () => {
    const worktreePath = await conflictWorktree('no-step');
    let calls = 0;
    const adapter = adapterWithStartSession((req) => {
      calls += 1;
      return new FakePlatformAdapter().startSession(req);
    });
    const ctx = createTestContext({ projectRoot: await freshProjectRoot('x'), adapter });
    const resolver = createAgentConflictResolver(ctx);

    await expect(resolver(describeConflict(worktreePath, undefined))).rejects.toMatchObject({
      code: 'MERGE-RESOLVER-NO-STEP',
    });
    expect(calls).toBe(0);
  });

  it('a stepId not present in ctx.stepGraph: MERGE-RESOLVER-NO-STEP', async () => {
    const worktreePath = await conflictWorktree('unknown-step');
    const ctx = createTestContext({
      projectRoot: await freshProjectRoot('x'),
      adapter: new FakePlatformAdapter(),
    });
    const resolver = createAgentConflictResolver(ctx);

    await expect(resolver(describeConflict(worktreePath, 'wf:decide'))).rejects.toMatchObject({
      code: 'MERGE-RESOLVER-NO-STEP',
    });
  });

  it('a read-only agent (tools.write: false): MERGE-RESOLVER-READ-ONLY, and startSession is never called', async () => {
    const worktreePath = await conflictWorktree('read-only');
    const inner = new FakePlatformAdapter();
    inner.script(() => true, { text: ['should never run'] });
    let calls = 0;
    const adapter = adapterWithStartSession((req) => {
      calls += 1;
      return inner.startSession(req);
    });
    const stepNode = baseNode({ id: 'wf:step', kind: 'agent' });
    const assembly = createFixtureAssembly(worktreePath, {
      loadAgent: () =>
        Promise.resolve(
          fixtureAgent('engineer', {
            tools: { read: true, write: false, network: false, git_commit: 'lane', deploy: false },
          }),
        ),
    });
    const base = createTestContext({ projectRoot: await freshProjectRoot('x'), adapter, assembly });
    const ctx: ExecuteStepContext = { ...base, stepGraph: new Map([[stepNode.id, stepNode]]) };
    const resolver = createAgentConflictResolver(ctx);

    await expect(resolver(describeConflict(worktreePath, 'wf:step'))).rejects.toMatchObject({
      code: 'MERGE-RESOLVER-READ-ONLY',
    });
    expect(calls).toBe(0);
  });

  it('no cost budget left on the step: MERGE-RESOLVER-BUDGET, and startSession is never called', async () => {
    const worktreePath = await conflictWorktree('budget');
    const inner = new FakePlatformAdapter();
    inner.script(() => true, { text: ['should never run'] });
    let calls = 0;
    const adapter = adapterWithStartSession((req) => {
      calls += 1;
      return inner.startSession(req);
    });
    const stepNode = baseNode({
      id: 'wf:step',
      kind: 'agent',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 0 },
    });
    const base = createTestContext({
      projectRoot: await freshProjectRoot('x'),
      adapter,
      runId: 'run-budget',
    });
    const ctx: ExecuteStepContext = { ...base, stepGraph: new Map([[stepNode.id, stepNode]]) };
    const resolver = createAgentConflictResolver(ctx);

    await expect(resolver(describeConflict(worktreePath, 'wf:step'))).rejects.toMatchObject({
      code: 'MERGE-RESOLVER-BUDGET',
    });
    expect(calls).toBe(0);
  });
});

describe('createAgentConflictResolver -- (b)+(c) session and verification', () => {
  it('a session that fixes the content is reported resolved', async () => {
    const worktreePath = await conflictWorktree('resolved');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), {
      text: ['fixed it'],
      writeFiles: [{ relativePath: 'same.txt', content: 'merged content\n' }],
    });
    const ctx = await contextWithStep(adapter);
    const resolver = createAgentConflictResolver(ctx);

    await expect(resolver(describeConflict(worktreePath, 'wf:step'))).resolves.toBe('resolved');
    await expect(readFile(path.join(worktreePath, 'same.txt'), 'utf8')).resolves.toBe(
      'merged content\n',
    );
  });

  it('the session runs read/write, no exec, no network -- a taint clamp, not merely a prompt instruction', async () => {
    const worktreePath = await conflictWorktree('grant');
    const adapter = new FakePlatformAdapter();
    let seen: SessionRequest | undefined;
    adapter.script((request) => {
      if (request.stepId.endsWith(':resolve-conflict')) seen = request;
      return false;
    }, {});
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), {
      writeFiles: [{ relativePath: 'same.txt', content: 'merged\n' }],
    });
    const ctx = await contextWithStep(adapter);
    await createAgentConflictResolver(ctx)(describeConflict(worktreePath, 'wf:step'));

    expect(seen?.tools.write).toBe(true);
    expect(seen?.tools.exec).toBe(false);
    expect(seen?.tools.network).toBe('none');
    expect(seen?.cwd).toBe(worktreePath);
    expect(seen?.stepId).toBe('wf:step:resolve-conflict');
    // Block [4] (the conflicted path, its porcelain status, the step and brief) is compiled into the
    // SYSTEM prompt (`05` §5.3), never the bare user-turn `prompt` -- the diff is what travels there,
    // fenced as untrusted content.
    expect(seen?.systemPrompt.text).toContain('same.txt');
    expect(seen?.systemPrompt.text).toContain('UU');
    expect(seen?.prompt).toContain('FORGE_UNTRUSTED_CONTENT');
    expect(seen?.systemPrompt.text).not.toContain('FORGE_UNTRUSTED_CONTENT');
  });

  it('markers left in the file: unresolved, not thrown', async () => {
    const worktreePath = await conflictWorktree('markers-left');
    const adapter = new FakePlatformAdapter();
    // No writeFiles at all: the session "ran" but the file still has its real conflict markers.
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), { text: ['tried'] });
    const ctx = await contextWithStep(adapter);

    await expect(
      createAgentConflictResolver(ctx)(describeConflict(worktreePath, 'wf:step')),
    ).resolves.toBe('unresolved');
  });

  it('a session ended not-ok (a scripted error) is unresolved, not thrown', async () => {
    const worktreePath = await conflictWorktree('session-error');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), {
      text: ['broken'],
      endReason: 'error',
      errorInfo: { code: 'X', message: 'boom' },
    });
    const ctx = await contextWithStep(adapter);

    await expect(
      createAgentConflictResolver(ctx)(describeConflict(worktreePath, 'wf:step')),
    ).resolves.toBe('unresolved');
  });

  it('the adapter itself throws starting the session: unresolved, not thrown -- the caller aborts the rebase either way', async () => {
    const worktreePath = await conflictWorktree('adapter-throws');
    const adapter = adapterWithStartSession(() => Promise.reject(new Error('adapter exploded')));
    const ctx = await contextWithStep(adapter);

    await expect(
      createAgentConflictResolver(ctx)(describeConflict(worktreePath, 'wf:step')),
    ).resolves.toBe('unresolved');
  });

  it('a session that writes outside the declared conflicted set is refused MERGE-RESOLVER-OUT-OF-CLAIM, and the stray file is restored (deleted, since it never existed at HEAD)', async () => {
    const worktreePath = await conflictWorktree('out-of-claim');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), {
      text: ['fixed it, and also...'],
      writeFiles: [
        { relativePath: 'same.txt', content: 'merged\n' },
        { relativePath: 'other.txt', content: 'sneaky out-of-claim write\n' },
      ],
    });
    const ctx = await contextWithStep(adapter);

    await expect(
      createAgentConflictResolver(ctx)(describeConflict(worktreePath, 'wf:step')),
    ).rejects.toMatchObject({ code: 'MERGE-RESOLVER-OUT-OF-CLAIM' });
    await expect(readFile(path.join(worktreePath, 'other.txt'), 'utf8')).rejects.toThrow();
  });

  it('a rogue git commit inside the session moves HEAD: refused MERGE-RESOLVER-TREE-MOVED', async () => {
    const worktreePath = await conflictWorktree('tree-moved');
    const headBefore = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })
    ).stdout.trim();
    const adapter = adapterWithStartSession(async (req) => {
      // A hostile/buggy session that manages to run git despite the confined grant (the scenario the
      // grant clamp alone cannot prove it always prevents against every future capability) -- the real
      // guardrail this test proves.
      await execa('git', ['commit', '--allow-empty', '--quiet', '-m', 'rogue commit'], {
        cwd: req.cwd,
      });
      return emptyHandle('rogue', { ...OK_RESULT, sessionId: 'rogue' });
    });
    const ctx = await contextWithStep(adapter);

    await expect(
      createAgentConflictResolver(ctx)(describeConflict(worktreePath, 'wf:step')),
    ).rejects.toMatchObject({ code: 'MERGE-RESOLVER-TREE-MOVED' });
    const headAfter = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })
    ).stdout.trim();
    // The resolver itself never undoes the rogue commit (that is the caller's job, aborting the whole
    // rebase/merge) -- only reports it, faithfully, as moved.
    expect(headAfter).not.toBe(headBefore);
  });

  it('usage is recorded against the LANE step id, and a second resolution on the same lane sees the first spent -- a budget genuinely shrinks across resolutions', async () => {
    const worktreePath = await conflictWorktree('budget-shrinks');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), {
      text: ['fixed'],
      writeFiles: [{ relativePath: 'same.txt', content: 'merged\n' }],
      costUsd: 0.6,
    });
    const stepNode = baseNode({
      id: 'wf:step',
      kind: 'agent',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    const projectRoot = await freshProjectRoot('x');
    const base = createTestContext({ projectRoot, adapter, runId: 'run-shrink' });
    const ctx: ExecuteStepContext = { ...base, stepGraph: new Map([[stepNode.id, stepNode]]) };
    const resolver = createAgentConflictResolver(ctx);

    expect(await resolver(describeConflict(worktreePath, 'wf:step'))).toBe('resolved');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-shrink')) events.push(event);
    expect(
      events.some((event) => event.type === 'UsageRecorded' && event.stepId === 'wf:step'),
    ).toBe(true);

    // A second conflict on the SAME lane: 0.6 already spent, 0.4 left of the $1 ceiling -- still enough,
    // so it runs. Re-dirty the file with fresh markers first (the first resolution already cleaned it).
    await writeFile(path.join(worktreePath, 'same.txt'), CONFLICT_MARKERS);
    expect(await resolver(describeConflict(worktreePath, 'wf:step'))).toBe('resolved');

    // A THIRD conflict: 1.2 already spent against a $1 ceiling -- no budget left, refused with no session.
    await writeFile(path.join(worktreePath, 'same.txt'), CONFLICT_MARKERS);
    await expect(resolver(describeConflict(worktreePath, 'wf:step'))).rejects.toMatchObject({
      code: 'MERGE-RESOLVER-BUDGET',
    });
  });
});

describe('createAgentConflictResolver -- end to end through the real merge queue (executeStep)', () => {
  it('a real conflict resolved by the default resolver still goes through the ordinary post-check revert -- a failing post-check undoes the resolved merge', async () => {
    const projectRoot = await createTempRepo('resolver-postcheck-revert');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId === 'wf:produce', {
      text: ['produced'],
      writeFiles: [{ relativePath: 'f1.txt', content: 'from lane\n' }],
    });
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), {
      text: ['resolved'],
      writeFiles: [{ relativePath: 'f1.txt', content: 'resolved content\n' }],
    });
    const base = createTestContext({ projectRoot, adapter, runId: 'run-resolver-postcheck' });
    const producer = node({
      id: 'wf:produce',
      kind: 'agent',
      agent: toAgentId('engineer'),
      brief: 'produce f1',
      produces: ['f1.txt'],
    });
    expect((await executeStep(producer, base)).status).toBe('succeeded');

    // Integration independently changes the same file, so the merge's own rebase genuinely conflicts.
    await writeFile(path.join(projectRoot, 'f1.txt'), 'from integration\n');
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '-m', 'integration change'], { cwd: projectRoot });

    const mergeNode = node({
      id: 'wf:merge',
      kind: 'merge',
      dependsOn: ['wf:produce'],
      mergePolicy: { conflict: 'agent', postChecks: 'exit 1' },
    });
    const stepGraph = new Map([
      [producer.id, producer],
      [mergeNode.id, mergeNode],
    ]);
    const graphCtx: ExecuteStepContext = { ...base, stepGraph };
    const finalCtx: ExecuteStepContext = {
      ...graphCtx,
      conflictResolver: createAgentConflictResolver(graphCtx),
    };

    const mergeOutcome = await executeStep(mergeNode, finalCtx);

    expect(mergeOutcome.status).toBe('failed');
    expect(mergeOutcome.failure?.code).toBe('MERGE-POST-CHECK-FAILED');
    // The revert restores exactly what integration held before the (resolved, then reverted) merge.
    await expect(readFile(path.join(projectRoot, 'f1.txt'), 'utf8')).resolves.toBe(
      'from integration\n',
    );
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-resolver-postcheck')) events.push(event);
    expect(events.map((event) => event.type)).toContain('MergeReverted');
    // `landLane` (`integrate.ts`) only ever emits `MergeConflict{reason:'resolved'}` on the `kind:
    // 'conflict-resolved'` branch -- pre-existing, unchanged-by-this-piece behaviour: when post-checks
    // fail, `processMergeCandidate` returns `'post-check-failed-reverted'` instead, whose own
    // `resolutions` (what actually happened during the rebase) are not carried onto that outcome at all,
    // so no `MergeConflict` event is emitted even though a real conflict really was resolved along the
    // way. The resolver's own real session IS visible instead, in its own events, against the LANE's own
    // step id (`wf:produce`, never `wf:merge`).
    expect(
      events.some(
        (event) =>
          event.type === 'SessionStarted' &&
          event.stepId === 'wf:produce' &&
          (event.payload as { role?: string } | undefined)?.role === 'resolve-conflict',
      ),
    ).toBe(true);
    expect(
      events.some((event) => event.type === 'UsageRecorded' && event.stepId === 'wf:produce'),
    ).toBe(true);
  });
});

// --- Critic round 1 findings (gauntlet loop) -------------------------------------------------------
//
// A fresh, context-free critic reproduced six real gaps against the round-1 version of this module, all
// fixed (`fingerprint`/`fingerprintCandidates` replacing a bare git-status-code comparison, an ordinary-
// file check on every conflicted path, a `node.kind` check, and an empty-`conflictedFiles` short circuit
// -- `conflict-resolver.ts`'s own module doc comment has the fuller "what and why" for each) plus one
// genuine, disclosed-not-fixed limitation (worktreePath/stepId pairing is trusted, not cross-checked).
// These pin the fixed behaviour so none of the six can regress silently.

describe('createAgentConflictResolver -- critic round 1: content tampering the git-status-code comparison alone would miss', () => {
  it('an already-UNTRACKED file (present before the session, status "??" both before and after) whose CONTENT the session overwrites is refused MERGE-RESOLVER-OUT-OF-CLAIM, and the tampered content does not survive (deleted -- an untracked path has no HEAD version to restore, `revertOutOfClaimPath`\'s own two-case shape)', async () => {
    const worktreePath = await conflictWorktree('untracked-tamper');
    await writeFile(path.join(worktreePath, 'secret.env'), 'SAFE=1\n');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), {
      text: ['fixed it, and quietly rewrote an unrelated untracked file too'],
      writeFiles: [
        { relativePath: 'same.txt', content: 'merged content\n' },
        { relativePath: 'secret.env', content: 'PWNED=1\n' },
      ],
    });
    const ctx = await contextWithStep(adapter);
    const resolver = createAgentConflictResolver(ctx);

    await expect(resolver(describeConflict(worktreePath, 'wf:step'))).rejects.toMatchObject({
      code: 'MERGE-RESOLVER-OUT-OF-CLAIM',
    });
    await expect(readFile(path.join(worktreePath, 'secret.env'), 'utf8')).rejects.toThrow();
  });

  it('the same untracked-content tamper is refused BEFORE the real merge queue would ever stage/commit it (git add -A never runs, since the resolver itself throws first)', async () => {
    const projectRoot = await createTempRepo('untracked-tamper-escalation');
    await writeFile(path.join(projectRoot, 'fileA.txt'), 'orig A\n');
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '-q', '-m', 'seed fileA'], { cwd: projectRoot });
    const baseSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim();
    const integrationPath = path.join(projectRoot, '.forge', 'state', 'integration');
    await execa(
      'git',
      ['worktree', 'add', '--quiet', '-b', 'forge/integration/build', integrationPath, baseSha],
      { cwd: projectRoot },
    );
    const handle = await createLaneWorktree(projectRoot, {
      runId: 'run-escalation',
      stepId: 'wf:step',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'fileA.txt'), 'lane A\n');
    await execa('git', ['add', '-A'], { cwd: handle.path });
    await execa('git', ['commit', '-q', '-m', 'lane commit'], { cwd: handle.path });
    await writeFile(path.join(integrationPath, 'fileA.txt'), 'integration A\n');
    await execa('git', ['add', '-A'], { cwd: integrationPath });
    await execa('git', ['commit', '-q', '-m', 'integration change'], { cwd: integrationPath });
    // Pre-exists in the lane worktree, untracked -- e.g. a real secret gitignored in the project root but
    // never gitignored inside a freshly created worktree.
    await writeFile(path.join(handle.path, 'secret.env'), 'SAFE=1\n');

    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), {
      text: ['fixed the conflict, and rewrote the untracked secret.env too'],
      writeFiles: [
        { relativePath: 'fileA.txt', content: 'merged content\n' },
        { relativePath: 'secret.env', content: 'PWNED=1\n' },
      ],
    });
    const stepNode = baseNode({
      id: 'wf:step',
      kind: 'agent',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 5 },
    });
    const base = createTestContext({ projectRoot, adapter, runId: 'run-escalation' });
    const ctx: ExecuteStepContext = { ...base, stepGraph: new Map([[stepNode.id, stepNode]]) };
    const resolver = createAgentConflictResolver(ctx);
    const candidate: MergeCandidate = {
      handle,
      stepId: 'wf:step',
      runId: 'run-escalation',
      declaredClaim: [],
      conflictPolicy: 'agent',
    };

    // `processMergeCandidate` preserves the resolver's own thrown value and aborts the rebase -- the
    // whole landing never completes, so `secret.env` never reaches the integration branch at all.
    await expect(
      processMergeCandidate(candidate, {
        integrationPath,
        conflictResolver: resolver,
        preChecks: [],
        postChecks: [],
      }),
    ).rejects.toMatchObject({ code: 'MERGE-RESOLVER-OUT-OF-CLAIM' });
    await expect(
      execa('git', ['cat-file', '-e', 'HEAD:secret.env'], { cwd: integrationPath }),
    ).rejects.toThrow();
  });

  it('an already-staged, non-conflicting TRACKED file (status "M " before and after) whose content the session further tampers with -- re-staged to keep the identical code -- is still caught by a real content comparison, not the status code', async () => {
    const dir = await createTempRepo('staged-clean-tamper');
    await writeFile(path.join(dir, 'other.txt'), 'original other\n');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '-q', '-m', 'seed other.txt'], { cwd: dir });
    await writeFile(path.join(dir, 'other.txt'), 'already staged, non-conflicting change\n');
    await execa('git', ['add', 'other.txt'], { cwd: dir });
    await writeFile(path.join(dir, 'same.txt'), CONFLICT_MARKERS);

    const adapter = adapterWithStartSession(async (req) => {
      await writeFile(path.join(req.cwd, 'same.txt'), 'merged\n');
      await writeFile(
        path.join(req.cwd, 'other.txt'),
        'a DIFFERENT tampered value, but re-staged\n',
      );
      await execa('git', ['add', 'other.txt'], { cwd: req.cwd }); // keeps its status at "M ", not "MM"
      return emptyHandle('s', OK_RESULT);
    });
    const stepNode = baseNode({ id: 'wf:step', kind: 'agent' });
    const base = createTestContext({
      projectRoot: await freshProjectRoot('x'),
      adapter,
      runId: 'run-x',
    });
    const ctx: ExecuteStepContext = { ...base, stepGraph: new Map([[stepNode.id, stepNode]]) };
    const resolver = createAgentConflictResolver(ctx);

    await expect(resolver(describeConflict(dir, 'wf:step'))).rejects.toMatchObject({
      code: 'MERGE-RESOLVER-OUT-OF-CLAIM',
    });
    // Restored from HEAD (`revertOutOfClaimPath`'s own doc comment: what the lane worktree looked like
    // right before this conflicting change was even attempted) -- not the intermediate, already-staged
    // value that existed just before the session ran.
    await expect(readFile(path.join(dir, 'other.txt'), 'utf8')).resolves.toBe('original other\n');
  });

  it('a conflicted (in-claim) path replaced by a symlink escaping the worktree is refused MERGE-RESOLVER-INVALID-CONTENT, not accepted as resolved', async () => {
    const worktreePath = await conflictWorktree('symlink-escape');
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'conflict-resolver-outside-'));
    const outsideFile = path.join(outsideDir, 'external-target.txt');
    await writeFile(
      outsideFile,
      'clean content, no markers, lives outside the worktree entirely\n',
    );

    const adapter = adapterWithStartSession(async (req) => {
      const target = path.join(req.cwd, 'same.txt');
      await execa('rm', ['-f', target]);
      await symlink(outsideFile, target);
      return emptyHandle('s', OK_RESULT);
    });
    const ctx = await contextWithStep(adapter);
    const resolver = createAgentConflictResolver(ctx);

    await expect(resolver(describeConflict(worktreePath, 'wf:step'))).rejects.toMatchObject({
      code: 'MERGE-RESOLVER-INVALID-CONTENT',
    });
  });

  it('a hand-built stepGraph node whose kind is not "agent" (but which carries an agent field anyway -- a malformed/adversarial shape no real compiler output produces) is refused MERGE-RESOLVER-NO-STEP, no session dispatched', async () => {
    const worktreePath = await conflictWorktree('kind-mismatch');
    let sawSession = false;
    const adapter = adapterWithStartSession((req) => {
      if (req.stepId.endsWith(':resolve-conflict')) sawSession = true;
      return new FakePlatformAdapter().startSession(req);
    });
    const malformedNode = node({
      id: 'wf:gate',
      kind: 'gate',
      gate: 'some-gate',
      agent: toAgentId('engineer'),
      brief: 'not actually an agent step',
    });
    const base = createTestContext({
      projectRoot: await freshProjectRoot('x'),
      adapter,
      runId: 'run-kind',
    });
    const ctx: ExecuteStepContext = {
      ...base,
      stepGraph: new Map([[malformedNode.id, malformedNode]]),
    };
    const resolver = createAgentConflictResolver(ctx);

    await expect(resolver(describeConflict(worktreePath, 'wf:gate'))).rejects.toMatchObject({
      code: 'MERGE-RESOLVER-NO-STEP',
    });
    expect(sawSession).toBe(false);
  });

  it('an empty conflictedFiles list (a malformed/empty MergeConflictDescription) is reported unresolved, with no session dispatched -- never vacuously "resolved"', async () => {
    const worktreePath = await conflictWorktree('empty-conflicted-set');
    let sawSession = false;
    const adapter = adapterWithStartSession((req) => {
      if (req.stepId.endsWith(':resolve-conflict')) sawSession = true;
      return new FakePlatformAdapter().startSession(req);
    });
    const ctx = await contextWithStep(adapter);
    const resolver = createAgentConflictResolver(ctx);

    const description: MergeConflictDescription = {
      laneId: 'lane-1',
      stepId: 'wf:step',
      runId: 'run-1',
      declaredClaim: [],
      conflictedFiles: [],
      diff: '',
      worktreePath,
    };
    await expect(resolver(description)).resolves.toBe('unresolved');
    expect(sawSession).toBe(false);
    await expect(readFile(path.join(worktreePath, 'same.txt'), 'utf8')).resolves.toContain(
      '<<<<<<<',
    );
  });

  it('DISCLOSED, not fixed: worktreePath/stepId are trusted as a paired fact with no cross-check against ctx.laneRegistry -- a mismatched pair still runs a real session and spends real budget (true of every real caller in this codebase today, which always builds the pair correctly; recorded so this is a documented limitation, not a silent gap)', async () => {
    const wrongWorktree = await conflictWorktree('mismatched-worktree');
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.endsWith(':resolve-conflict'), {
      text: ['resolved the wrong lane entirely'],
      writeFiles: [{ relativePath: 'same.txt', content: 'merged\n' }],
      costUsd: 0.42,
    });
    const stepNode = baseNode({
      id: 'wf:real-step',
      kind: 'agent',
      limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    });
    const projectRoot = await freshProjectRoot('mismatch');
    const base = createTestContext({ projectRoot, adapter, runId: 'run-mismatch' });
    const ctx: ExecuteStepContext = { ...base, stepGraph: new Map([[stepNode.id, stepNode]]) };
    const resolver = createAgentConflictResolver(ctx);

    const outcome = await resolver(describeConflict(wrongWorktree, 'wf:real-step'));
    expect(outcome).toBe('resolved');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-mismatch')) events.push(event);
    expect(
      events.some(
        (event) =>
          event.type === 'UsageRecorded' &&
          event.stepId === 'wf:real-step' &&
          (event.payload as { costUsd?: number }).costUsd === 0.42,
      ),
    ).toBe(true);
  });
});
