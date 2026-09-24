/**
 * `runMergeStep` (via `executeStep`) — `06` §6.5's own merge queue (`@forge/vcs`, P5), driven from a
 * dedicated `merge`-kind step processing its own `dependsOn` predecessors' lanes
 * (`ExecuteStepContext.laneRegistry`, populated by `runAgentStep`/`runCommandStep` on their own successful
 * completion — `types.ts`'s own doc comment has the fuller reasoning for why this is a separate step,
 * not something the predecessor step does for itself).
 *
 * @see specs/06 §6.4, §6.5
 * @see PLAN-M5.md P15
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { readEvents } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { integrateLane } from '../../src/dispatch/integrate.ts';
import type { ExecuteStepContext, LaneHandle } from '../../src/dispatch/types.ts';
import type { StepNode } from '../../src/plan/index.ts';
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

describe('runMergeStep — check sets (PLAN-M13.md P38)', () => {
  it("names the layers of a set that had no configured command on the step's own outcome, not only in the event log", async () => {
    const projectRoot = await createTempRepo('merge-skipped-layers');
    const base = createTestContext({ projectRoot, runId: 'run-skipped' });
    const ctx = { ...base, testCommands: { unit: 'true' } };
    const producer = node({
      id: 'wf:produce',
      kind: 'command',
      run: 'echo hi > out.txt',
      produces: ['out.txt'],
    });
    expect((await executeStep(producer, ctx)).status).toBe('succeeded');

    const outcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        mergePolicy: { conflict: 'abort', preChecks: 'fast', postChecks: 'unit' },
      }),
      ctx,
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail.kind === 'merge' ? outcome.detail.skippedLayers : undefined).toEqual({
      pre: ['typecheck', 'lint'],
      post: [],
    });
  });
});

describe('runMergeStep — a set that cannot be resolved (PLAN-M13.md P38)', () => {
  it('a merge driven on its own (no run-start preflight) fails typed before touching any lane, and an auto-integration does the same', async () => {
    const projectRoot = await createTempRepo('merge-unconfigured');
    const ctx = createTestContext({ projectRoot, runId: 'run-unconfigured' });
    const producer = node({
      id: 'wf:produce',
      kind: 'command',
      run: 'echo hi > out.txt',
      produces: ['out.txt'],
    });
    expect((await executeStep(producer, ctx)).status).toBe('succeeded');

    const outcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        mergePolicy: { conflict: 'abort', preChecks: 'fast' },
      }),
      ctx,
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'merge', code: 'MERGE-CHECKS-UNCONFIGURED' });
    expect(outcome.failure?.message).toContain('execution.testCommands.unit');
    expect(ctx.laneRegistry.has('wf:produce')).toBe(true);

    const lane = ctx.laneRegistry.get('wf:produce');
    if (lane === undefined) throw new Error('no lane');
    const integrated = await integrateLane(
      { ...ctx, mergeChecks: { post: 'full' } },
      'wf:produce',
      lane,
      'abort',
    );
    expect(integrated).toMatchObject({ code: 'MERGE-CHECKS-UNCONFIGURED' });
    expect(integrated?.message).toContain('execution.mergeChecks.post');
    expect(ctx.laneRegistry.has('wf:produce')).toBe(true);
  });
});

describe('runMergeStep', () => {
  it('merges a single predecessor lane cleanly into the integration branch, removing the lane worktree afterward', async () => {
    const projectRoot = await createTempRepo('merge-clean');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge' });
    const producerNode = node({
      id: 'wf:produce',
      kind: 'command',
      run: 'echo hello > out.txt',
      produces: ['out.txt'],
    });
    const producerOutcome = await executeStep(producerNode, ctx);
    expect(producerOutcome.status).toBe('succeeded');
    expect(ctx.laneRegistry.has('wf:produce')).toBe(true);

    const mergeNode = node({
      id: 'wf:merge',
      kind: 'merge',
      dependsOn: ['wf:produce'],
      mergePolicy: { conflict: 'abort' },
    });
    const mergeOutcome = await executeStep(mergeNode, ctx);

    expect(mergeOutcome.status).toBe('succeeded');
    expect(mergeOutcome.detail.kind).toBe('merge');
    if (mergeOutcome.detail.kind === 'merge') {
      expect(mergeOutcome.detail.merges).toHaveLength(1);
      expect(mergeOutcome.detail.merges[0]?.stepId).toBe('wf:produce');
      expect(mergeOutcome.detail.merges[0]?.outcome.kind).toBe('clean');
    }
    // Merged into the integration path (== projectRoot for this fixture) -- the file is now visible there.
    await expect(readFileInRepo(projectRoot, 'out.txt')).resolves.toContain('hello');
    // The lane is no longer tracked -- removed from the registry once successfully merged.
    expect(ctx.laneRegistry.has('wf:produce')).toBe(false);
  });

  it('emits MergeQueued, MergeStarted, then MergeCompleted for a clean merge', async () => {
    const projectRoot = await createTempRepo('merge-events');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge-events' });
    await executeStep(
      node({ id: 'wf:produce', kind: 'command', run: 'echo x > out.txt', produces: ['out.txt'] }),
      ctx,
    );

    await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        mergePolicy: { conflict: 'abort' },
      }),
      ctx,
    );

    const events = [];
    for await (const event of readEvents(projectRoot, 'run-merge-events')) events.push(event);
    const mergeEvents = events.filter((event) =>
      ['MergeQueued', 'MergeStarted', 'MergeCompleted'].includes(event.type),
    );
    expect(mergeEvents.map((event) => event.type)).toEqual([
      'MergeQueued',
      'MergeStarted',
      'MergeCompleted',
    ]);
  });

  it('merges more than one predecessor lane in the same merge step -- "processing for a set of lanes"', async () => {
    const projectRoot = await createTempRepo('merge-multi');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge-multi' });
    await executeStep(
      node({ id: 'wf:produce-a', kind: 'command', run: 'echo a > a.txt', produces: ['a.txt'] }),
      ctx,
    );
    await executeStep(
      node({ id: 'wf:produce-b', kind: 'command', run: 'echo b > b.txt', produces: ['b.txt'] }),
      ctx,
    );

    const mergeOutcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce-a', 'wf:produce-b'],
        mergePolicy: { conflict: 'abort' },
      }),
      ctx,
    );

    expect(mergeOutcome.status).toBe('succeeded');
    await expect(readFileInRepo(projectRoot, 'a.txt')).resolves.toContain('a');
    await expect(readFileInRepo(projectRoot, 'b.txt')).resolves.toContain('b');
    expect(ctx.laneRegistry.size).toBe(0);
  });

  it('a merge step naming a predecessor with no registered lane (e.g. an inline command) simply has nothing to merge for it, succeeding vacuously', async () => {
    const projectRoot = await createTempRepo('merge-no-lane');
    const ctx = createTestContext({ projectRoot });
    await executeStep(
      node({ id: 'wf:inline', kind: 'command', run: 'true', laneAffinity: 'inline' }),
      ctx,
    );

    const mergeOutcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:inline'],
        mergePolicy: { conflict: 'abort' },
      }),
      ctx,
    );

    expect(mergeOutcome.status).toBe('succeeded');
  });

  it('an abort-policy conflict aborts cleanly and reports a failed outcome, rather than throwing', async () => {
    const projectRoot = await createTempRepo('merge-conflict');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge-conflict' });
    // A predecessor lane creates out.txt...
    await executeStep(
      node({
        id: 'wf:produce',
        kind: 'command',
        run: 'echo lane-version > out.txt',
        produces: ['out.txt'],
      }),
      ctx,
    );
    // ...while the integration branch independently creates a conflicting out.txt after the lane branched
    // off -- a genuine "both sides added the same path with different content" conflict once the lane's
    // own commit is rebased onto this new integration state.
    await writeFile(path.join(projectRoot, 'out.txt'), 'integration-version\n');
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '-m', 'integration change'], { cwd: projectRoot });

    const mergeOutcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        mergePolicy: { conflict: 'abort' },
      }),
      ctx,
    );

    expect(mergeOutcome.status).toBe('failed');
    expect(mergeOutcome.failure?.source).toBe('merge');
    expect(mergeOutcome.failure?.code).toBe('MERGE-CONFLICT-UNRESOLVED');
    // The lane is retained (not removed) for inspection since the merge never actually completed.
    expect(ctx.laneRegistry.has('wf:produce')).toBe(true);
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-merge-conflict')) events.push(event);
    expect(events.map((event) => event.type)).toContain('MergeConflict');
  });

  it('throws RUN-039 for a merge node missing its own mergePolicy field', async () => {
    const projectRoot = await createTempRepo('merge-missing-policy');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({ id: 'wf:merge', kind: 'merge', dependsOn: [] });

    let caught: unknown;
    try {
      await executeStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-039');
  });

  it('throws RUN-041 for a mergePolicy.conflict value that is not agent, human, or abort', async () => {
    const projectRoot = await createTempRepo('merge-bad-policy');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:merge',
      kind: 'merge',
      dependsOn: [],
      mergePolicy: { conflict: 'bogus' },
    });

    let caught: unknown;
    try {
      await executeStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-041');
  });

  it('a failing pre-merge check aborts before any merge attempt, reporting a failed outcome and retaining the lane', async () => {
    const projectRoot = await createTempRepo('merge-precheck-fail');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge-precheck-fail' });
    await executeStep(
      node({ id: 'wf:produce', kind: 'command', run: 'echo x > out.txt', produces: ['out.txt'] }),
      ctx,
    );

    const mergeOutcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        mergePolicy: { conflict: 'abort', preChecks: 'exit 1' },
      }),
      ctx,
    );

    expect(mergeOutcome.status).toBe('failed');
    expect(mergeOutcome.failure?.source).toBe('merge');
    expect(mergeOutcome.failure?.code).toBe('MERGE-PRE-CHECK-FAILED');
    expect(mergeOutcome.failure?.message).toContain('Pre-merge check failed');
    expect(ctx.laneRegistry.has('wf:produce')).toBe(true);
    // The integration branch never received the change -- the pre-check ran before any merge attempt.
    await expect(readFileInRepo(projectRoot, 'out.txt')).rejects.toThrow();
  });

  it('a failing post-merge check automatically reverts an otherwise-clean merge, emitting MergeReverted', async () => {
    const projectRoot = await createTempRepo('merge-postcheck-fail');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge-postcheck-fail' });
    await executeStep(
      node({ id: 'wf:produce', kind: 'command', run: 'echo x > out.txt', produces: ['out.txt'] }),
      ctx,
    );

    const mergeOutcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        mergePolicy: { conflict: 'abort', postChecks: 'exit 1' },
      }),
      ctx,
    );

    expect(mergeOutcome.status).toBe('failed');
    expect(mergeOutcome.failure?.source).toBe('merge');
    expect(mergeOutcome.failure?.code).toBe('MERGE-POST-CHECK-FAILED');
    // The revert restores the pre-merge tree exactly -- the file the merge briefly introduced is gone.
    await expect(readFileInRepo(projectRoot, 'out.txt')).rejects.toThrow();
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-merge-postcheck-fail'))
      events.push(event);
    expect(events.map((event) => event.type)).toContain('MergeReverted');
  });

  it('emits LaneRemoved once a clean merge actually removes the lane worktree', async () => {
    const projectRoot = await createTempRepo('merge-lane-removed');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge-lane-removed' });
    await executeStep(
      node({ id: 'wf:produce', kind: 'command', run: 'echo x > out.txt', produces: ['out.txt'] }),
      ctx,
    );

    await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        mergePolicy: { conflict: 'abort' },
      }),
      ctx,
    );

    const events = [];
    for await (const event of readEvents(projectRoot, 'run-merge-lane-removed')) events.push(event);
    expect(events.map((event) => event.type)).toContain('LaneRemoved');
  });

  it('a conflict under a non-abort policy with no conflictResolver configured (the real default for this milestone) fails as data, never escaping as a thrown VcsError', async () => {
    const projectRoot = await createTempRepo('merge-agent-policy-no-resolver');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge-agent-policy' });
    // The identical conflict-construction technique as the abort-policy test above: a real add/add
    // conflict once the lane's own commit is rebased onto the integration branch's own independent
    // change to the same path.
    await executeStep(
      node({
        id: 'wf:produce',
        kind: 'command',
        run: 'echo lane-version > out.txt',
        produces: ['out.txt'],
      }),
      ctx,
    );
    await writeFile(path.join(projectRoot, 'out.txt'), 'integration-version\n');
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '-m', 'integration change'], { cwd: projectRoot });

    // createTestContext's own default mergeQueue is built with no conflictResolver at all -- exactly
    // the only real configuration this milestone's own scope can produce (Q77), since no resolver
    // mechanism is built yet.
    const mergeOutcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        mergePolicy: { conflict: 'agent' },
      }),
      ctx,
    );

    expect(mergeOutcome.status).toBe('failed');
    expect(mergeOutcome.failure?.source).toBe('vcs');
    expect(mergeOutcome.failure?.code).toBe('VCS-MISSING-CONFLICT-RESOLVER');
    // The lane is retained, exactly like every other merge failure mode -- nothing actually merged.
    expect(ctx.laneRegistry.has('wf:produce')).toBe(true);
  });

  it('PLAN-M14.md P35: the identical fixture succeeds when ExecuteStepContext.conflictResolver supplies a per-call resolver, even though the facade itself was built with none', async () => {
    const projectRoot = await createTempRepo('merge-per-call-resolver');
    let resolverCalled = false;
    const ctx = createTestContext({
      projectRoot,
      runId: 'run-merge-per-call-resolver',
      // No mergeQueue override here: createTestContext's own default facade is built with no
      // constructor-bound resolver at all (the identical default the test above relies on).
      conflictResolver: async (conflict) => {
        resolverCalled = true;
        await writeFile(path.join(conflict.worktreePath, 'out.txt'), 'resolved-version\n');
        return 'resolved';
      },
    });
    await executeStep(
      node({
        id: 'wf:produce',
        kind: 'command',
        run: 'echo lane-version > out.txt',
        produces: ['out.txt'],
      }),
      ctx,
    );
    await writeFile(path.join(projectRoot, 'out.txt'), 'integration-version\n');
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '-m', 'integration change'], { cwd: projectRoot });

    const mergeOutcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce'],
        mergePolicy: { conflict: 'agent' },
      }),
      ctx,
    );

    expect(mergeOutcome.status).toBe('succeeded');
    expect(resolverCalled).toBe(true);
    await expect(readFileInRepo(projectRoot, 'out.txt')).resolves.toBe('resolved-version\n');
    expect(ctx.laneRegistry.has('wf:produce')).toBe(false);
  });

  it("a multi-lane merge step keeps every lane's own outcome in detail.merges, and reports the first real failure even when an earlier lane in the same call succeeded", async () => {
    const projectRoot = await createTempRepo('merge-multi-mixed');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge-multi-mixed' });
    await executeStep(
      node({ id: 'wf:produce-a', kind: 'command', run: 'echo a > a.txt', produces: ['a.txt'] }),
      ctx,
    );
    await executeStep(
      node({ id: 'wf:produce-b', kind: 'command', run: 'echo b > b.txt', produces: ['b.txt'] }),
      ctx,
    );

    const mergeOutcome = await executeStep(
      node({
        id: 'wf:merge',
        kind: 'merge',
        dependsOn: ['wf:produce-a', 'wf:produce-b'],
        // wf:produce-a merges cleanly; wf:produce-b's own pre-merge check always fails -- a single
        // mergePolicy applies to every predecessor lane a merge step processes, so this is the
        // simplest way to make exactly one of two lanes fail while the other genuinely succeeds.
        // `case`, not `test ... != *pattern*`: POSIX `test`'s `!=` is a literal string comparison, not
        // glob matching, so it would never actually distinguish the two lanes' own paths.
        mergePolicy: {
          conflict: 'abort',
          preChecks: 'case "$PWD" in *wf-produce-b*) exit 1;; esac',
        },
      }),
      ctx,
    );

    expect(mergeOutcome.status).toBe('failed');
    // The failure names the real, failing lane -- not silently masked by the other lane's success.
    expect(mergeOutcome.failure?.message).toContain('Pre-merge check failed');
    expect(mergeOutcome.detail.kind).toBe('merge');
    if (mergeOutcome.detail.kind === 'merge') {
      // Both lanes' own outcomes survive in detail.merges -- neither is silently discarded in favour
      // of the other, unlike a single `merge: MergeOutcome` field ever could represent for two lanes.
      expect(mergeOutcome.detail.merges).toHaveLength(2);
      const byStep = new Map(
        mergeOutcome.detail.merges.map((entry) => [entry.stepId, entry.outcome]),
      );
      expect(byStep.get('wf:produce-a')?.kind).toBe('clean');
      expect(byStep.get('wf:produce-b')?.kind).toBe('pre-check-failed');
    }
    // wf:produce-a's own lane was still genuinely merged and removed despite wf:produce-b's failure.
    expect(ctx.laneRegistry.has('wf:produce-a')).toBe(false);
    expect(ctx.laneRegistry.has('wf:produce-b')).toBe(true);
  });

  it("two independent merge-kind steps against two unrelated lanes, dispatched concurrently (Promise.all, matching driveToCompletion's own real batch-admission shape), both complete cleanly with no lost or corrupted commit -- a fresh adversarial review found nothing serialized `MergeQueueFacade.process` calls against the shared integration path before this fix", async () => {
    const projectRoot = await createTempRepo('merge-concurrent');
    const ctx = createTestContext({ projectRoot, runId: 'run-merge-concurrent' });
    await executeStep(
      node({ id: 'wf:produce-a', kind: 'command', run: 'echo a > a.txt', produces: ['a.txt'] }),
      ctx,
    );
    await executeStep(
      node({ id: 'wf:produce-b', kind: 'command', run: 'echo b > b.txt', produces: ['b.txt'] }),
      ctx,
    );

    // Two real merge steps, each depending on its own, unrelated producer lane -- no dependsOn edge
    // between the two merge steps themselves, the exact shape the scheduler admits together in one
    // batch in production since neither's `produces` (empty, for a merge-kind step) overlaps the
    // other's. Dispatched with Promise.all here for the identical reason `driveToCompletion` does.
    const [outcomeA, outcomeB] = await Promise.all([
      executeStep(
        node({
          id: 'wf:merge-a',
          kind: 'merge',
          dependsOn: ['wf:produce-a'],
          mergePolicy: { conflict: 'abort' },
        }),
        ctx,
      ),
      executeStep(
        node({
          id: 'wf:merge-b',
          kind: 'merge',
          dependsOn: ['wf:produce-b'],
          mergePolicy: { conflict: 'abort' },
        }),
        ctx,
      ),
    ]);

    expect(outcomeA.status).toBe('succeeded');
    expect(outcomeB.status).toBe('succeeded');
    // Both real files landed in the shared integration path -- neither merge silently lost the
    // other's own commit, which is exactly what a raced `git merge --no-ff`/`git commit` pair could
    // otherwise do (an interleaved commit, a stale MERGE_HEAD, or one process's abort racing the
    // other's own in-flight merge).
    await expect(readFileInRepo(projectRoot, 'a.txt')).resolves.toContain('a');
    await expect(readFileInRepo(projectRoot, 'b.txt')).resolves.toContain('b');
    // Both lanes were genuinely merged and removed -- neither stranded by a raced abort.
    expect(ctx.laneRegistry.has('wf:produce-a')).toBe(false);
    expect(ctx.laneRegistry.has('wf:produce-b')).toBe(false);
    // The integration branch's own history has two real, distinct merge commits, never one process's
    // commit silently swallowed by the other's concurrent write to the same working directory.
    const log = await execa('git', ['log', '--oneline', 'main'], { cwd: projectRoot });
    const commitCount = log.stdout.split('\n').filter((line) => line.length > 0).length;
    // init + produce-a + produce-b + merge-a + merge-b == 5, at minimum (a merge commit may add one
    // more depending on fast-forward-ability, so this asserts a floor, not an exact count).
    expect(commitCount).toBeGreaterThanOrEqual(5);
  });
});

describe('runMergeStep — replayFrom (PLAN-M14.md P35)', () => {
  it("a lane stacked on a predecessor that lands with a RESOLVED conflict is itself landed with --onto: the landing resolver is called ZERO times for the stacked lane's own landing", async () => {
    const projectRoot = await createTempRepo('merge-replay-from');
    const resolverCalls: string[][] = [];
    const conflictResolver = async (conflict: {
      readonly conflictedFiles: readonly { readonly path: string }[];
      readonly worktreePath: string;
    }): Promise<'resolved'> => {
      resolverCalls.push(conflict.conflictedFiles.map((file) => file.path));
      await writeFile(path.join(conflict.worktreePath, 'shared.txt'), 'resolved-version\n');
      return 'resolved';
    };
    const base = createTestContext({ projectRoot, runId: 'run-replay-from', conflictResolver });
    const nodeA = node({
      id: 'wf:a',
      kind: 'command',
      run: 'echo a-version > shared.txt',
      produces: ['shared.txt'],
    });
    const nodeB = node({
      id: 'wf:b',
      kind: 'command',
      run: 'echo b > b-out.txt',
      dependsOn: ['wf:a'],
      produces: ['b-out.txt'],
    });
    const nodeMerge = node({
      id: 'wf:merge',
      kind: 'merge',
      dependsOn: ['wf:b'],
      mergePolicy: { conflict: 'agent' },
    });
    const ctx = withStepGraph(base, [nodeA, nodeB, nodeMerge]);

    expect((await executeStep(nodeA, ctx)).status).toBe('succeeded');
    expect((await executeStep(nodeB, ctx)).status).toBe('succeeded');
    // b's own lane stacks on a's ORIGINAL lane (a fast-forward join: nothing has landed yet at this
    // point, so the tip b's lane is created from still contains a's own, still-unlanded commit).
    expect(ctx.laneRegistry.get('wf:b')).toMatchObject({ stackedOn: 'wf:a' });

    // A "concurrent" change lands directly on the integration branch between b's own lane creation and
    // a's own landing -- what makes a's own rebase-at-landing-time genuinely conflict (the identical
    // technique `vcs/test/merge-queue.test.ts`'s own conflict fixtures use, one layer down).
    await writeFile(path.join(projectRoot, 'shared.txt'), 'concurrent-version\n');
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '-m', 'concurrent integration change'], { cwd: projectRoot });

    const mergeOutcome = await executeStep(nodeMerge, ctx);

    expect(mergeOutcome.status).toBe('succeeded');
    // Exactly one resolution, for a's own conflict -- landing b calls the resolver zero times.
    expect(resolverCalls).toEqual([['shared.txt']]);
    await expect(readFileInRepo(projectRoot, 'shared.txt')).resolves.toBe('resolved-version\n');
    await expect(readFileInRepo(projectRoot, 'b-out.txt')).resolves.toContain('b');
    // Exactly two merge commits (a's, b's) -- never a third, stale copy of a's own pre-resolution diff.
    const mergeCommits = await execa('git', ['log', '--merges', '--format=%H'], {
      cwd: projectRoot,
    });
    expect(mergeCommits.stdout.split('\n').filter((line) => line !== '')).toHaveLength(2);
    expect(ctx.laneRegistry.size).toBe(0);
  });
});

const REVIEW_REPORTS_ROOT = 'docs/forge/sessions/reviews';

/** Writes `<reportId>.md` directly onto a fresh lane's own branch -- exactly what `runMergeStep`
 * (`PLAN-M14.md` P18) reads: a real, committed front-matter document on a real git lane, nothing more.
 * Bypasses the real swarm-review dispatch (`PLAN-M14.md` P14's own tests already cover that it writes
 * this shape); this piece only cares what a `merge` step does once such a document is already committed.
 * `frontMatterExtra` is raw YAML appended after `id`/`type` (e.g. `'verdict: concerns\n'`, or `''` for no
 * `verdict` key at all -- every report this engine wrote before P14). */
async function createReviewLane(
  ctx: ExecuteStepContext,
  stepId: string,
  reportId: string,
  frontMatterExtra: string,
  subdir = '',
): Promise<LaneHandle> {
  const lane = await ctx.vcs.createLane(stepId, ctx.integrationBase);
  const dir = path.join(lane.path, REVIEW_REPORTS_ROOT, subdir);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${reportId}.md`),
    `---\nid: ${reportId}\ntype: ReviewReport\n${frontMatterExtra}---\n\nBody.\n`,
  );
  await ctx.vcs.commit(
    lane,
    `forge(review): ${stepId}\n\nForge-Step: ${stepId}\nForge-Run: ${ctx.runId}`,
    false,
  );
  ctx.laneRegistry.set(stepId, lane);
  return lane;
}

function swarmReviewNode(id: string, dependsOn: readonly string[]): StepNode {
  return node({ id, kind: 'agent', interactionMode: 'swarm-review', dependsOn });
}

function mergeStepNode(id: string, dependsOn: readonly string[]): StepNode {
  return node({ id, kind: 'merge', dependsOn, mergePolicy: { conflict: 'abort' } });
}

function withStepGraph(ctx: ExecuteStepContext, nodes: readonly StepNode[]): ExecuteStepContext {
  return { ...ctx, stepGraph: new Map(nodes.map((entry) => [entry.id, entry] as const)) };
}

describe('runMergeStep — swarm-review verdict binding (PLAN-M14.md P18)', () => {
  it('an incomplete verdict refuses the review lane with MERGE-REVIEW-INCOMPLETE, keeps it registered, names the report/review step/forge resume, leaves the tip unchanged, and also refuses the stacked implement lane it reviews', async () => {
    const projectRoot = await createTempRepo('merge-review-incomplete');
    const ctx = createTestContext({ projectRoot, runId: 'run-review-incomplete' });
    const implement = node({
      id: 'wf:implement',
      kind: 'command',
      run: 'echo hi > impl.txt',
      produces: ['impl.txt'],
    });
    expect((await executeStep(implement, ctx)).status).toBe('succeeded');
    await createReviewLane(ctx, 'wf:review', 'REVIEW-001', 'verdict: incomplete\n');
    const review = swarmReviewNode('wf:review', ['wf:implement']);
    const merge = mergeStepNode('wf:merge', ['wf:review']);
    const withGraph = withStepGraph(ctx, [implement, review, merge]);
    const { stdout: preHead } = await execa('git', ['rev-parse', 'HEAD'], { cwd: projectRoot });

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('merge');
    expect(outcome.failure?.code).toBe('MERGE-REVIEW-INCOMPLETE');
    expect(outcome.failure?.message).toContain('REVIEW-001');
    expect(outcome.failure?.message).toContain('wf:review');
    expect(outcome.failure?.message).toContain('forge resume');
    // The review lane itself is kept, registered for the next merge that scopes it to retry.
    expect(withGraph.laneRegistry.has('wf:review')).toBe(true);
    // The reverse rule (P38 stacking): the implement lane the refused review reviews is not landed
    // either, even though (processed first, dependencies-first order) it would otherwise land cleanly.
    expect(withGraph.laneRegistry.has('wf:implement')).toBe(true);
    // The integration branch's tip never moved, and the implement lane's own file never reached it.
    const { stdout: postHead } = await execa('git', ['rev-parse', 'HEAD'], { cwd: projectRoot });
    expect(postHead).toBe(preHead);
    await expect(readFileInRepo(projectRoot, 'impl.txt')).rejects.toThrow();
  });

  it("reproduces implement-story.workflow.yaml's own multi-hop chain (green -> refactor -> self-verify -> review, review dependsOn: [self-verify] only): the reverse rule reaches every stacked lane upstream of the review within this merge's own scope, not just its one direct dependency", async () => {
    const projectRoot = await createTempRepo('merge-review-multihop');
    const ctx = createTestContext({ projectRoot, runId: 'run-review-multihop' });
    const green = node({
      id: 'wf:green',
      kind: 'command',
      run: 'echo code > green.txt',
      produces: ['green.txt'],
    });
    const refactor = node({
      id: 'wf:refactor',
      kind: 'command',
      run: 'echo refactored > refactor.txt',
      dependsOn: ['wf:green'],
      produces: ['refactor.txt'],
    });
    // A content-less verification step, exactly like implement-story.workflow.yaml's own `self-verify`
    // (`forge story verify ... --json`): review's own dependsOn names only this, several stacked hops
    // downstream of the real code in wf:green/wf:refactor.
    const selfVerify = node({
      id: 'wf:self-verify',
      kind: 'command',
      run: 'true',
      dependsOn: ['wf:refactor'],
    });
    const review = swarmReviewNode('wf:review', ['wf:self-verify']);
    const merge = mergeStepNode('wf:merge', ['wf:review']);
    const withGraph = withStepGraph(ctx, [green, refactor, selfVerify, review, merge]);

    expect((await executeStep(green, withGraph)).status).toBe('succeeded');
    expect((await executeStep(refactor, withGraph)).status).toBe('succeeded');
    expect((await executeStep(selfVerify, withGraph)).status).toBe('succeeded');
    await createReviewLane(withGraph, 'wf:review', 'REVIEW-001', 'verdict: incomplete\n');

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('MERGE-REVIEW-INCOMPLETE');
    // The whole stacked chain the review builds on stays registered -- not merely wf:self-verify, the
    // review's own one direct dependency.
    expect(withGraph.laneRegistry.has('wf:review')).toBe(true);
    expect(withGraph.laneRegistry.has('wf:self-verify')).toBe(true);
    expect(withGraph.laneRegistry.has('wf:refactor')).toBe(true);
    expect(withGraph.laneRegistry.has('wf:green')).toBe(true);
    // Neither real-code lane's file reached the integration branch.
    await expect(readFileInRepo(projectRoot, 'green.txt')).rejects.toThrow();
    await expect(readFileInRepo(projectRoot, 'refactor.txt')).rejects.toThrow();
  });

  it('refuses every downstream lane of a refused review too, via the ordinary MERGE-DEPENDENCY-NOT-LANDED path (not a second copy of the review-specific logic)', async () => {
    const projectRoot = await createTempRepo('merge-review-downstream');
    const ctx = createTestContext({ projectRoot, runId: 'run-review-downstream' });
    await createReviewLane(ctx, 'wf:review', 'REVIEW-001', 'verdict: incomplete\n');
    const review = swarmReviewNode('wf:review', []);
    const document = node({
      id: 'wf:document',
      kind: 'command',
      run: 'echo hi > doc.txt',
      dependsOn: ['wf:review'],
      produces: ['doc.txt'],
    });
    expect((await executeStep(document, ctx)).status).toBe('succeeded');
    const merge = mergeStepNode('wf:merge', ['wf:document']);
    const withGraph = withStepGraph(ctx, [review, document, merge]);

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('failed');
    // The review's own lane is kept for the reason already covered above; the downstream lane that
    // depends on it is refused too, through the pre-existing, generic blockedBy mechanism -- not a
    // second, review-specific implementation of the same "do not land a lane whose dependency did not
    // land" rule.
    expect(withGraph.laneRegistry.has('wf:review')).toBe(true);
    expect(withGraph.laneRegistry.has('wf:document')).toBe(true);
    await expect(readFileInRepo(projectRoot, 'doc.txt')).rejects.toThrow();
  });

  it('a report with no verdict key at all (every report the engine wrote before PLAN-M14.md P14) is treated exactly like incomplete', async () => {
    const projectRoot = await createTempRepo('merge-review-no-verdict');
    const ctx = createTestContext({ projectRoot, runId: 'run-review-no-verdict' });
    await createReviewLane(ctx, 'wf:review', 'REVIEW-001', '');
    const review = swarmReviewNode('wf:review', []);
    const merge = mergeStepNode('wf:merge', ['wf:review']);
    const withGraph = withStepGraph(ctx, [review, merge]);

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('MERGE-REVIEW-INCOMPLETE');
    expect(withGraph.laneRegistry.has('wf:review')).toBe(true);
  });

  it("a REVIEW-*.md nested one directory below the reports root is not read as the report: the lookup requires the exact reports directory, matching resumeSwarmReviewStep's own identical rule", async () => {
    const projectRoot = await createTempRepo('merge-review-nested');
    const ctx = createTestContext({ projectRoot, runId: 'run-review-nested' });
    // A `clear` verdict would land cleanly if this nested file were mistakenly read as the report --
    // instead nothing at the exact reports directory means no report at all, so the lane refuses exactly
    // like the "no verdict key" case above.
    await createReviewLane(ctx, 'wf:review', 'REVIEW-001', 'verdict: clear\n', 'sub');
    const review = swarmReviewNode('wf:review', []);
    const merge = mergeStepNode('wf:merge', ['wf:review']);
    const withGraph = withStepGraph(ctx, [review, merge]);

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('MERGE-REVIEW-INCOMPLETE');
    expect(withGraph.laneRegistry.has('wf:review')).toBe(true);
  });

  it('a blocked verdict also refuses landing (defense in depth: PLAN-M14.md P14 already fails and deregisters a blocked review at step time -- this covers the same committed shape reached any other way, e.g. a hand-edited lane, SPEC-QUESTIONS.md Q229)', async () => {
    const projectRoot = await createTempRepo('merge-review-blocked');
    const ctx = createTestContext({ projectRoot, runId: 'run-review-blocked' });
    await createReviewLane(ctx, 'wf:review', 'REVIEW-001', 'verdict: blocked\n');
    const review = swarmReviewNode('wf:review', []);
    const merge = mergeStepNode('wf:merge', ['wf:review']);
    const withGraph = withStepGraph(ctx, [review, merge]);

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('MERGE-REVIEW-INCOMPLETE');
  });

  it('a concerns verdict lands: detail.merges carries reviewVerdict/reviewReportId and the merge commit carries the Forge-Review-Verdict trailer', async () => {
    const projectRoot = await createTempRepo('merge-review-concerns');
    const ctx = createTestContext({ projectRoot, runId: 'run-review-concerns' });
    await createReviewLane(ctx, 'wf:review', 'REVIEW-001', 'verdict: concerns\n');
    const review = swarmReviewNode('wf:review', []);
    const merge = mergeStepNode('wf:merge', ['wf:review']);
    const withGraph = withStepGraph(ctx, [review, merge]);

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail.kind).toBe('merge');
    if (outcome.detail.kind !== 'merge') throw new Error('unreachable');
    expect(outcome.detail.merges).toHaveLength(1);
    expect(outcome.detail.merges[0]?.reviewVerdict).toBe('concerns');
    expect(outcome.detail.merges[0]?.reviewReportId).toBe('REVIEW-001');
    const landedOutcome = outcome.detail.merges[0]?.outcome;
    if (landedOutcome?.kind !== 'clean') throw new Error('expected a clean merge outcome');
    const { stdout } = await execa(
      'git',
      ['log', '-1', '--format=%B', landedOutcome.mergeCommitSha],
      {
        cwd: projectRoot,
      },
    );
    expect(stdout).toContain('Forge-Review-Verdict: concerns (REVIEW-001)');
    expect(withGraph.laneRegistry.has('wf:review')).toBe(false);
  });

  it('a clear verdict lands with no Forge-Review-Verdict trailer, though detail.merges still carries its reviewVerdict/reviewReportId (the trailer gate is concerns-only; the outcome metadata is not)', async () => {
    const projectRoot = await createTempRepo('merge-review-clear');
    const ctx = createTestContext({ projectRoot, runId: 'run-review-clear' });
    await createReviewLane(ctx, 'wf:review', 'REVIEW-001', 'verdict: clear\n');
    const review = swarmReviewNode('wf:review', []);
    const merge = mergeStepNode('wf:merge', ['wf:review']);
    const withGraph = withStepGraph(ctx, [review, merge]);

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail.kind).toBe('merge');
    if (outcome.detail.kind !== 'merge') throw new Error('unreachable');
    expect(outcome.detail.merges[0]?.reviewVerdict).toBe('clear');
    expect(outcome.detail.merges[0]?.reviewReportId).toBe('REVIEW-001');
    const landedOutcome = outcome.detail.merges[0]?.outcome;
    if (landedOutcome?.kind !== 'clean') throw new Error('expected a clean merge outcome');
    const { stdout } = await execa(
      'git',
      ['log', '-1', '--format=%B', landedOutcome.mergeCommitSha],
      {
        cwd: projectRoot,
      },
    );
    expect(stdout).not.toContain('Forge-Review-Verdict');
  });

  it('a non-swarm-review lane with a stray REVIEW-*.md file is landed untouched: the check only ever looks at interactionMode === "swarm-review" nodes', async () => {
    const projectRoot = await createTempRepo('merge-review-stray');
    const ctx = createTestContext({ projectRoot, runId: 'run-review-stray' });
    // A blocked-verdict report, on a lane whose own step is NOT swarm-review -- if the check mistakenly
    // keyed off the file's own name/content instead of the node's interactionMode, this would wrongly
    // refuse the lane; it must land exactly like any other lane instead.
    await createReviewLane(ctx, 'wf:stray', 'REVIEW-999', 'verdict: blocked\n');
    const stray = node({ id: 'wf:stray', kind: 'command', run: 'true' });
    const merge = mergeStepNode('wf:merge', ['wf:stray']);
    const withGraph = withStepGraph(ctx, [stray, merge]);

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('succeeded');
    await expect(
      readFileInRepo(projectRoot, `${REVIEW_REPORTS_ROOT}/REVIEW-999.md`),
    ).resolves.toContain('blocked');
    expect(withGraph.laneRegistry.has('wf:stray')).toBe(false);
  });

  it('resume after a crash between LaneReady and the merge still refuses: a fresh context and a fresh, freshly-populated laneRegistry re-derive the same refusal purely from the committed report, never from anything the original attempt computed', async () => {
    const projectRoot = await createTempRepo('merge-review-resume');
    const original = createTestContext({ projectRoot, runId: 'run-review-resume' });
    const reviewLane = await createReviewLane(
      original,
      'wf:review',
      'REVIEW-001',
      'verdict: incomplete\n',
    );

    // A brand-new context and a brand-new, empty laneRegistry, as a real resume rebuilds both -- with
    // only the LaneHandle re-registered (what orphan reclamation restores). Nothing about the original
    // attempt's own in-memory state (which never existed here in the first place, since the report was
    // written directly) can leak through: the refusal below can only come from reading the committed
    // file.
    const resumed = createTestContext({ projectRoot, runId: 'run-review-resume' });
    resumed.laneRegistry.set('wf:review', reviewLane);
    const review = swarmReviewNode('wf:review', []);
    const merge = mergeStepNode('wf:merge', ['wf:review']);
    const withGraph = withStepGraph(resumed, [review, merge]);

    const outcome = await executeStep(merge, withGraph);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('MERGE-REVIEW-INCOMPLETE');
  });
});
