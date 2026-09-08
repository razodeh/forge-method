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
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { readEvents } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
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
});
