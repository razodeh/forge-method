/**
 * `runCommandStep` (via `executeStep`) — `PLAN-M5.md` P15's own Checks text: a `command` step with
 * `inline: true` never creates a lane; a non-inline command step runs the identical lane lifecycle an
 * agent step does (create, commit, enforce claim).
 *
 * @see specs/06 §6.4
 * @see specs/10 §10.1
 * @see PLAN-M5.md P15
 */
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { VcsError } from '@forge/vcs';
import { readEvents } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { createVcsFacade } from '../../src/dispatch/facades.ts';
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

describe('runCommandStep', () => {
  it('an inline command step never creates a lane, running directly in the project root', async () => {
    const projectRoot = await createTempRepo('command-inline');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:lint',
      kind: 'command',
      run: 'echo hello',
      laneAffinity: 'inline',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail.kind).toBe('command');
    if (outcome.detail.kind === 'command') expect(outcome.detail.stdout.trim()).toBe('hello');

    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    await expect(readdir(worktreesDir)).rejects.toThrow();
  });

  it("an inline command step's own failing exit code produces a failed outcome, without ever touching a lane", async () => {
    const projectRoot = await createTempRepo('command-inline-fail');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:lint',
      kind: 'command',
      run: 'exit 3',
      laneAffinity: 'inline',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('command');
    expect(outcome.failure?.code).toBe('3');
  });

  it('a non-inline command step creates a real lane, runs the command there, and commits its own changes', async () => {
    const projectRoot = await createTempRepo('command-lane');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo generated > out.txt',
      produces: ['out.txt'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    const [laneDir] = await readdir(worktreesDir);
    expect(laneDir).toBeDefined();
    const content = await readFileInRepo(path.join(worktreesDir, laneDir ?? ''), 'out.txt');
    expect(content.trim()).toBe('generated');
  });

  it("a non-inline command step's own out-of-claim write is reverted through this entry point, identically to an agent step", async () => {
    const projectRoot = await createTempRepo('command-claim');
    const ctx = createTestContext({ projectRoot, claimPolicy: 'strict' });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo ok > allowed.txt && echo bad > forbidden.txt',
      produces: ['allowed.txt'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    const [laneDir] = await readdir(worktreesDir);
    const laneRoot = path.join(worktreesDir, laneDir ?? '');
    const files = await readdir(laneRoot);
    expect(files).toContain('allowed.txt');
    expect(files).not.toContain('forbidden.txt');
  });

  it('a non-inline command step emits the identical lane-lifecycle event sequence an agent step does', async () => {
    const projectRoot = await createTempRepo('command-events');
    const ctx = createTestContext({ projectRoot, runId: 'run-cmd-events' });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo x > out.txt',
      produces: ['out.txt'],
    });

    await executeStep(stepNode, ctx);

    const events = [];
    for await (const event of readEvents(projectRoot, 'run-cmd-events')) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      'StepStarted',
      'LaneCreated',
      'LaneCommitted',
      'LaneReady',
      'StepSucceeded',
    ]);
  });

  it('a non-inline command step that fails still runs claim enforcement and reports a failed outcome with the real exit code', async () => {
    const projectRoot = await createTempRepo('command-lane-fail');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo partial > out.txt && exit 7',
      produces: ['out.txt'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('command');
    expect(outcome.failure?.code).toBe('7');
    // The lane's own changes are still committed and claim-enforced despite the failure -- a failing
    // command still produced real output worth preserving for inspection (06 §6.4 step 4: "On failure ->
    // keep the worktree for inspection").
    const worktreesDir = path.join(projectRoot, '.forge', 'state', 'worktrees');
    const [laneDir] = await readdir(worktreesDir);
    expect(laneDir).toBeDefined();
  });

  it('throws RUN-039 for a command node missing its own run field', async () => {
    const projectRoot = await createTempRepo('command-missing-field');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({ id: 'wf:generate', kind: 'command' });

    let caught: unknown;
    try {
      await executeStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-039');
  });

  it('a genuine VCS failure (a colliding lane) is folded into a failed StepOutcome, not thrown', async () => {
    const projectRoot = await createTempRepo('command-vcs-failure');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo done > out.txt',
      produces: ['out.txt'],
    });
    // The first call creates a real lane for wf:generate and leaves it alive (never merged or
    // removed). @forge/vcs's own createLaneWorktree refuses a second call for the identical
    // (runId, stepId) pair with a real VcsError while that lane is still alive
    // (packages/vcs/test/lanes.test.ts already covers this directly against @forge/vcs itself); this
    // proves runVcsStep really does catch and fold that failure into StepOutcome data end to end,
    // rather than letting a real VcsError escape this module uncaught.
    const first = await executeStep(stepNode, ctx);
    expect(first.status).toBe('succeeded');

    const second = await executeStep(stepNode, ctx);

    expect(second.status).toBe('failed');
    expect(second.failure?.source).toBe('vcs');
    expect(second.failure?.code).toBe('VCS-GIT-OPERATION-FAILED');
  });

  it('a VCS failure that is not Error-shaped at all still becomes failure data, with UNKNOWN/String() fallbacks', async () => {
    const projectRoot = await createTempRepo('command-vcs-non-error-throw');
    const ctx = createTestContext({
      projectRoot,
      vcs: {
        ...createVcsFacade(projectRoot, 'run-test'),
        resolveRevision() {
          // Deliberately not an Error and not `{code: string}`-shaped -- proves runVcsStep's own
          // isErrorWithCode/instanceof-Error fallbacks (UNKNOWN, String(cause)) really are reachable,
          // not merely defensive dead code, for a caller that throws something unusual.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return Promise.reject('a bare string rejection');
        },
      },
    });
    const stepNode = node({ id: 'wf:generate', kind: 'command', run: 'echo hi' });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('vcs');
    expect(outcome.failure?.code).toBe('UNKNOWN');
    expect(outcome.failure?.message).toBe('a bare string rejection');
  });

  it("a real resolveRevision failure (a nonexistent integration base) is folded into a failed StepOutcome, with detail.kind still matching this step's real kind", async () => {
    const projectRoot = await createTempRepo('command-bad-integration-base');
    const ctx = createTestContext({ projectRoot, integrationBase: 'this-ref-does-not-exist' });
    const stepNode = node({ id: 'wf:generate', kind: 'command', run: 'echo hi' });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('vcs');
    // Even though this failure happens before any real command ever ran, detail.kind must still say
    // 'command' -- a bare '{kind:"checkpoint"}' placeholder here would misrepresent what kind of step
    // actually failed to any later reader of this outcome (a retry classifier, an audit trail).
    expect(outcome.detail.kind).toBe('command');
  });

  it('a genuine commit failure is folded into a failed StepOutcome', async () => {
    const projectRoot = await createTempRepo('command-commit-fails');
    const ctx = createTestContext({
      projectRoot,
      vcs: {
        ...createVcsFacade(projectRoot, 'run-test'),
        commit() {
          return Promise.reject(
            new VcsError({
              code: 'VCS-TEST-INJECTED',
              message: 'injected commit failure',
              remedy: 'n/a',
            }),
          );
        },
      },
    });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo x > out.txt',
      produces: ['out.txt'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('vcs');
    expect(outcome.failure?.code).toBe('VCS-TEST-INJECTED');
  });

  it('a genuine enforceClaim failure is folded into a failed StepOutcome', async () => {
    const projectRoot = await createTempRepo('command-enforce-claim-fails');
    const ctx = createTestContext({
      projectRoot,
      vcs: {
        ...createVcsFacade(projectRoot, 'run-test'),
        enforceClaim() {
          return Promise.reject(
            new VcsError({
              code: 'VCS-TEST-INJECTED',
              message: 'injected enforceClaim failure',
              remedy: 'n/a',
            }),
          );
        },
      },
    });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo x > out.txt',
      produces: ['out.txt'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('vcs');
  });

  it('a genuine failure committing the post-enforcement revert is folded into a failed StepOutcome', async () => {
    const projectRoot = await createTempRepo('command-revert-commit-fails');
    const realVcs = createVcsFacade(projectRoot, 'run-test');
    let commitCalls = 0;
    const ctx = createTestContext({
      projectRoot,
      claimPolicy: 'strict',
      vcs: {
        ...realVcs,
        async commit(handle, message, sign) {
          commitCalls += 1;
          // The first commit (the step's own work) must genuinely succeed so enforceClaim has a real
          // out-of-claim revert to make; only the second commit (the revert itself) fails.
          if (commitCalls === 2) {
            return Promise.reject(
              new VcsError({
                code: 'VCS-TEST-INJECTED',
                message: 'injected revert-commit failure',
                remedy: 'n/a',
              }),
            );
          }
          return realVcs.commit(handle, message, sign);
        },
      },
    });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo ok > allowed.txt && echo bad > forbidden.txt',
      produces: ['allowed.txt'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('vcs');
    expect(outcome.failure?.code).toBe('VCS-TEST-INJECTED');
  });
});
