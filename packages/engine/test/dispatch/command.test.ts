/**
 * `runCommandStep` (via `executeStep`) — `PLAN-M5.md` P15's own Checks text: a `command` step with
 * `inline: true` never creates a lane; a non-inline command step runs the identical lane lifecycle an
 * agent step does (create, commit, enforce claim -- and, under `strict`, an out-of-claim write fails it
 * too, `PLAN-M14.md` P3, `06` §6.7 as amended).
 *
 * @see specs/06 §6.4, §6.7
 * @see specs/10 §10.1
 * @see PLAN-M5.md P15
 * @see PLAN-M14.md P3
 */
import { mkdtemp, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { VcsError, worktreesRootFor } from '@forge/vcs';
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

    const worktreesDir = await worktreesRootFor(await realpath(projectRoot));
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

  // `PLAN-M14.md` P2 let a `command` step author `produces` for the first time; this proves the inline
  // path -- which never has a lane, and so never reaches `resolveStepClaim`/`enforceClaim` at all --
  // grants a declared `produces` no exception. Without this, "the inline execution path never reads
  // produces" was true only by reading `steps.ts`, not by a regression test.
  it("an inline command step's own declared produces grants no exception: a matching write is still reverted and the step still fails", async () => {
    const projectRoot = await createTempRepo('command-inline-produces');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:lint',
      kind: 'command',
      run: 'echo bad > allowed.txt',
      laneAffinity: 'inline',
      produces: ['allowed.txt'],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('INLINE-CHANGED-INTEGRATION-TREE');
    await expect(readFileInRepo(projectRoot, 'allowed.txt')).rejects.toThrow();
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
    const worktreesDir = await worktreesRootFor(await realpath(projectRoot));
    const [laneDir] = await readdir(worktreesDir);
    expect(laneDir).toBeDefined();
    const content = await readFileInRepo(path.join(worktreesDir, laneDir ?? ''), 'out.txt');
    expect(content.trim()).toBe('generated');
  });

  it("a non-inline command step's own out-of-claim write is reverted through this entry point, identically to an agent step, and fails it under strict", async () => {
    const projectRoot = await createTempRepo('command-claim');
    const ctx = createTestContext({ projectRoot, claimPolicy: 'strict' });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo ok > allowed.txt && echo bad > forbidden.txt',
      produces: ['allowed.txt'],
    });

    const outcome = await executeStep(stepNode, ctx);

    // `PLAN-M14.md` P3, `06` §6.7 as amended: `strict` still reverts the out-of-claim file exactly as
    // before, but a `command` step's claim violation now fails it too, identically to an `agent` step's.
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
    const worktreesDir = await worktreesRootFor(await realpath(projectRoot));
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
    const worktreesDir = await worktreesRootFor(await realpath(projectRoot));
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
    const runId = 'run-test';
    // `removeLaneIfPresent` overridden to a no-op, not omitted: `specs/22` M17 P10 (#3)'s "recreate the
    // lane" fix makes createLaneForStep clear any stale lane for this exact (runId, stepId) pair before
    // every creation, so simply calling executeStep twice for the identical node no longer collides the
    // way it did before that fix (the first, successful attempt's own lane is cleared out of the way,
    // and the second attempt creates a fresh one and succeeds too). The underlying "two real
    // createLaneWorktree calls for the identical pair collide" fact is unchanged and still covered
    // directly against @forge/vcs itself (packages/vcs/test/lanes.test.ts); this test's own job is
    // narrower -- proving runVcsStep really does fold a real VcsError into StepOutcome data end to end,
    // rather than letting one escape this module uncaught -- so the collision is engineered directly:
    // disabling only that one optional cleanup call leaves the stale lane the first attempt leaves
    // behind (never merged or removed) there to collide with on the second, exactly as it always was.
    const vcsWithoutCleanup = {
      ...createVcsFacade(projectRoot, runId),
      removeLaneIfPresent: () => Promise.resolve(),
    };
    const ctx = createTestContext({ projectRoot, runId, vcs: vcsWithoutCleanup });
    const stepNode = node({
      id: 'wf:generate',
      kind: 'command',
      run: 'echo done > out.txt',
      produces: ['out.txt'],
    });
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

describe("runCommandStep — a failed command's message combines a bounded stderr+stdout tail and surfaces a --json envelope's own problems/error.message, dropping known runtime-warning lines (specs/22 M17 P12) (#7)", () => {
  it('a stderr that is only a known Node runtime warning does not hide the real problem a --json envelope on stdout names via error.message', async () => {
    const projectRoot = await createTempRepo('command-json-error-message');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:check',
      kind: 'command',
      run:
        'node -e "' +
        "console.error('(node:12345) ExperimentalWarning: fake runtime warning for testing'); " +
        "console.error('(Use \\`node --trace-warnings=...\\` to show where the warning was created)'); " +
        "console.log(JSON.stringify({v:1,ok:false,error:{code:'X',message:'the real problem'}})); " +
        'process.exit(1)"',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toContain('the real problem');
    expect(outcome.failure?.message).not.toContain('ExperimentalWarning');
    expect(outcome.failure?.message).not.toContain('trace-warnings');
  });

  it("surfaces a --json envelope's own problems array when there is no error object", async () => {
    const projectRoot = await createTempRepo('command-json-problems');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:check',
      kind: 'command',
      run:
        'node -e "' +
        "console.log(JSON.stringify({v:1,problems:['problem one','problem two']})); " +
        'process.exit(1)"',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toContain('problem one');
    expect(outcome.failure?.message).toContain('problem two');
  });

  it('with no --json envelope at all, combines stderr (known-warning lines dropped) AND stdout, rather than picking only one', async () => {
    const projectRoot = await createTempRepo('command-combine-tail');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:check',
      kind: 'command',
      run:
        'node -e "' +
        "console.error('(node:999) ExperimentalWarning: unrelated noise'); " +
        "console.error('real stderr problem line'); " +
        "console.log('real stdout line'); " +
        'process.exit(1)"',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toContain('real stderr problem line');
    expect(outcome.failure?.message).toContain('real stdout line');
    expect(outcome.failure?.message).not.toContain('ExperimentalWarning');
  });

  it("the inline command path gets the identical treatment: stdout's own --json error.message survives a noisy stderr", async () => {
    const projectRoot = await createTempRepo('command-inline-json-error');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:check',
      kind: 'command',
      laneAffinity: 'inline',
      run:
        'node -e "' +
        "console.error('(node:1) DeprecationWarning: fake'); " +
        "console.log(JSON.stringify({v:1,ok:false,error:{message:'inline real problem'}})); " +
        'process.exit(1)"',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toContain('inline real problem');
    expect(outcome.failure?.message).not.toContain('DeprecationWarning');
  });

  it('keeps BOTH the head and the tail of a long stderr, not only the tail (gauntlet critic round 1, MAJOR: a real Node uncaught exception puts its own Error: <message> line near the TOP of stderr, immediately followed by a long stack trace -- a tail-only cut silently drops it)', async () => {
    const projectRoot = await createTempRepo('command-long-stderr-head-tail');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:check',
      kind: 'command',
      run:
        'node -e "' +
        "console.error('Error: the real cause'); " +
        "for (let i = 2; i <= 25; i++) console.error('    at frame' + String(i).padStart(2,'0') + ' (file.js:' + i + ':1)'); " +
        "console.error('END-MARKER-the-last-line'); " +
        'process.exit(1)"',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    const message = outcome.failure?.message ?? '';
    // The head: the real cause, near the top of the 26-line stderr.
    expect(message).toContain('Error: the real cause');
    // The tail: the last line, proving this is a head-AND-tail excerpt, not merely a head-only one.
    expect(message).toContain('END-MARKER-the-last-line');
    // Still bounded: a frame from the middle (never named by either end) must not survive.
    expect(message).not.toContain('frame13');
  });

  it('gives a bulky head the budget a short tail does not need, rather than capping both at a rigid fixed half each (gauntlet critic round 2, BLOCKING: a real cause past a FIXED half of a bulky head was dropped even though the short tail used only a sliver of its own half)', async () => {
    const projectRoot = await createTempRepo('command-dynamic-budget-reallocation');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:check',
      kind: 'command',
      run:
        'node -e "' +
        "for (let i = 0; i < 9; i++) console.error('H'.repeat(300)); " +
        "console.error('B'.repeat(280) + ' REAL-CAUSE-MARKER-XYZ'); " +
        "for (let i = 0; i < 5; i++) console.error('MIDDLE-FILLER-' + i); " +
        "for (let i = 0; i < 10; i++) console.error('ok' + i); " +
        'process.exit(1)"',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    const message = outcome.failure?.message ?? '';
    // The real cause sits past character 2000 of the bulky (10-line, ~3000-char) head -- a rigid,
    // fixed half-each split drops it; the short ten-line tail (well under 100 characters total) frees
    // up budget the head actually needs.
    expect(message).toContain('REAL-CAUSE-MARKER-XYZ');
    // The short tail still survives in full.
    expect(message).toContain('ok5');
    // Still bounded: the omitted middle lines never survive, however the remaining budget is split.
    expect(message).not.toContain('MIDDLE-FILLER-2');
  });

  it('a single long line with no newlines at all: content near either edge AND at the true middle now survives, content strictly BETWEEN an edge and the middle does not -- the Q324-disclosed structural limit, closed for the one point it named specifically (M17 Phase A hardening: a third, true-middle allocation mode, never silently overlapping the other two)', async () => {
    const projectRoot = await createTempRepo('command-single-line-triple-split');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:check',
      kind: 'command',
      // 6000 chars total, five contiguous blocks with no overlap: a head-slice marker (survives, as
      // before), a gap1 marker strictly between the head slice and the true-middle slice (does NOT
      // survive -- the one kind of residual gap this fix still has), a true-middle marker (THE fix:
      // this now survives, where it never could before), a gap2 marker strictly between the
      // true-middle slice and the tail slice (does NOT survive, the symmetric residual gap), and a
      // tail-slice marker (survives, as before).
      run:
        'node -e "' +
        "const headBlock = 'A'.repeat(50) + 'HEAD-MARKER-ABC' + 'A'.repeat(1268); " +
        "const gap1Block = 'B'.repeat(493) + 'GAP1-MARKER-XYZ' + 'B'.repeat(493); " +
        "const midBlock = 'C'.repeat(657) + 'MIDDLE-MARKER-GHI' + 'C'.repeat(658); " +
        "const gap2Block = 'D'.repeat(492) + 'GAP2-MARKER-UVW' + 'D'.repeat(493); " +
        "const tailBlock = 'E'.repeat(1268) + 'TAIL-MARKER-DEF' + 'E'.repeat(50); " +
        'console.error(headBlock + gap1Block + midBlock + gap2Block + tailBlock); ' +
        'process.exit(1)"',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    const message = outcome.failure?.message ?? '';
    // The positive guarantee, unchanged from before this fix: either edge survives.
    expect(message).toContain('HEAD-MARKER-ABC');
    expect(message).toContain('TAIL-MARKER-DEF');
    // The fix itself: the blob's own true middle, previously unreachable by any two-edge scheme, now
    // survives too.
    expect(message).toContain('MIDDLE-MARKER-GHI');
    // The still-disclosed residual: content strictly BETWEEN an edge and the middle slice remains
    // genuinely unreachable -- narrower than before (two smaller gaps instead of one big one), not
    // eliminated.
    expect(message).not.toContain('GAP1-MARKER-XYZ');
    expect(message).not.toContain('GAP2-MARKER-UVW');
  });

  it("never drops a project's own warning emitted via the standard process.emitWarning API under a custom name -- only Node's own closed set of built-in warning names is known (gauntlet critic round 1, MAJOR: a bare \\w*Warning: wildcard would have deleted this real, load-bearing diagnostic outright)", async () => {
    const projectRoot = await createTempRepo('command-custom-warning-kept');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:check',
      kind: 'command',
      // The exact line `process.emitWarning('...', 'CapacityWarning')` itself prints by default
      // (confirmed directly) -- printed here via `console.error` instead of the real API, so the
      // test is not racing that API's own asynchronous emission against the immediate `process.exit`
      // right after it (a real, separate hazard this test does not exist to cover).
      run:
        'node -e "' +
        "console.error('(node:1) CapacityWarning: Disk usage at 95 percent, data loss imminent'); " +
        "console.error('the real stderr problem'); " +
        'process.exit(1)"',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toContain('CapacityWarning');
    expect(outcome.failure?.message).toContain('Disk usage at 95 percent');
    expect(outcome.failure?.message).toContain('the real stderr problem');
  });

  it("bounds a --json envelope's own problem text (error.message), not just the raw stderr/stdout excerpt below it (gauntlet critic round 1, MODERATE)", async () => {
    const projectRoot = await createTempRepo('command-json-error-bounded');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:check',
      kind: 'command',
      run:
        'node -e "' +
        "const long = 'x'.repeat(5000); " +
        'console.log(JSON.stringify({v:1,ok:false,error:{message:long}})); ' +
        'process.exit(1)"',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    const message = outcome.failure?.message ?? '';
    const leadLine = message.split('\n')[0] ?? '';
    expect(leadLine.length).toBeLessThan(2100);
    expect(leadLine).toContain('truncated');
  });
});
