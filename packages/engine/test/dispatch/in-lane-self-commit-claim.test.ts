/**
 * In-lane commits honour the write claim (`specs/22` M17 P15, defect C, `SPEC-QUESTIONS.md` Q294 D2): a
 * session's own commit, made INSIDE its own lane, must be checked against the step's declared write claim
 * at landing, exactly as an uncommitted write already is -- not landed silently just because it arrived
 * via a commit instead of a dirty working tree.
 *
 * Before this piece, `runLaneLifecycle` (`steps.ts`) ran its commit-and-claim-enforcement block only
 * `if (work.changed)`, and `runAgentWork` computed `changed` from the adapter's own self-reported
 * `SessionResult.changedFiles` -- which a real adapter derives from `git status --porcelain` in the lane
 * (Q294 D2's own finding). A session that commits everything itself leaves that status clean, so
 * `changedFiles` comes back empty, `work.changed` reads `false`, and the WHOLE commit+claim block --
 * including `enforceClaim` -- never runs: whatever the session committed, in or out of its claim, reaches
 * the lane's HEAD untouched and is integrated as though it had been reviewed.
 *
 * `FakePlatformAdapter` always derives `SessionResult.changedFiles` from what it was scripted to
 * `writeFiles` (`fake-adapter.ts`'s own `changedFiles.push(file.relativePath)`), never re-derived from
 * git the way a real adapter is -- so it cannot, by itself, script a session whose own self-report has
 * gone stale relative to the real lane. `selfCommittingAdapter` below closes exactly that gap, faithfully:
 * it lets the real fake adapter write the scripted files for real (every existing write-grant/tool-call
 * check still runs), then -- mirroring what a real session's own `git commit` inside the lane would leave
 * behind -- commits them for real and reports `changedFiles: []`, the exact shape a real adapter's own
 * post-session `git status` check would compute against a now-clean tree.
 *
 * Real assembly, a real git lane, the real claim enforcement and event log; only the model session is
 * faked, and even then only its own self-report is touched -- every byte it writes is a real file.
 *
 * @see specs/06 §6.4, §6.7
 * @see SPEC-QUESTIONS.md Q294 D2
 * @see PLAN-M17.md P15
 */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { slugifyStepId } from '@forge/vcs';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { createVcsFacade } from '../../src/dispatch/facades.ts';
import type { LaneHandle, StepOutcome } from '../../src/dispatch/types.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createFixtureAssembly, createTestContext, fixtureAgent, node } from './helpers.ts';

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-self-commit-${prefix}-`));
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

/**
 * Wraps a real `FakePlatformAdapter`'s `startSession` (an own property shadowing the class's prototype
 * method on this one instance -- every other method stays the real, unmodified fake) so the scripted
 * session, having written its `writeFiles` for real, ALSO commits them for real inside the lane before
 * returning, and reports `changedFiles: []` -- the one thing nothing in `@forge/testkit` can script
 * directly today, since its own `changedFiles` is always an echo of `writeFiles`, never re-derived from
 * git the way a real adapter's own `changed-files.ts` is (this test file's own doc comment, Q294 D2).
 */
function selfCommittingAdapter(adapter: FakePlatformAdapter): FakePlatformAdapter {
  const realStartSession = adapter.startSession.bind(adapter);
  adapter.startSession = async (request) => {
    const handle = await realStartSession(request);
    return {
      ...handle,
      result: async () => {
        const session = await handle.result();
        if (session.changedFiles.length > 0) {
          await execa('git', ['add', '-A'], { cwd: request.cwd });
          await execa(
            'git',
            ['commit', '--quiet', '-m', 'session self-commit inside its own lane'],
            {
              cwd: request.cwd,
            },
          );
        }
        return { ...session, changedFiles: [] };
      },
    };
  };
  return adapter;
}

interface Scenario {
  readonly produces: readonly string[];
  readonly writes: readonly { readonly relativePath: string; readonly content: string }[];
  readonly claimPolicy: 'strict' | 'warn';
  /** Drives the scripted session to end `ok: false` (the `!session.ok` branch in `runAgentWork`) rather
   * than complete normally — the self-commit still happens first (`writeFiles` are processed before
   * `endReason` takes effect, `fake-adapter.ts`'s own `runScriptPhases`), so this exercises exactly the
   * same `hasChanges`-not-`session.changedFiles` fix on a DIFFERENT one of its three return points. */
  readonly endReason?: 'complete' | 'error';
  readonly errorInfo?: { readonly code: string; readonly message: string };
  /** Runs after the temp repo exists but before the step does — used to make `writeResultRecord` itself
   * throw (the `resultFailure !== undefined` branch), by pre-creating a directory at the exact path
   * `result.md` needs to be a file. */
  readonly beforeRun?: (projectRoot: string, runId: string) => Promise<void>;
}

async function run(scenario: Scenario) {
  const projectRoot = await createTempRepo('scenario');
  const runId = 'run-self-commit';
  if (scenario.beforeRun !== undefined) await scenario.beforeRun(projectRoot, runId);
  const adapter = selfCommittingAdapter(new FakePlatformAdapter());
  adapter.script(() => true, {
    text: ['done'],
    writeFiles: [...scenario.writes],
    ...(scenario.endReason === undefined ? {} : { endReason: scenario.endReason }),
    ...(scenario.errorInfo === undefined ? {} : { errorInfo: scenario.errorInfo }),
  });
  // The lane is captured at creation: a failed step is not registered, and its branch is still the real
  // record of what survived (or did not survive) claim enforcement.
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
      loadAgent: (agentId) => Promise.resolve(fixtureAgent(agentId)),
    }),
  });
  const stepNode = node({
    id: 'wf:step',
    kind: 'agent',
    agent: toAgentId('po'),
    brief: 'do the work',
    outputs: [],
    produces: scenario.produces,
  });
  const outcome = await executeStep(stepNode, ctx);
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(projectRoot, runId)) events.push(event);
  const committed = await treeAt(created?.path);
  return { outcome, events, committed };
}

interface ViolationPayload {
  readonly kind: string;
  readonly policy: string;
  readonly stepFailed: boolean;
  readonly paths: string[];
  readonly totalOutOfClaim: number;
  readonly totalReverted: number;
}

function violations(events: readonly ForgeEvent[]): ViolationPayload[] {
  return events
    .filter((event) => event.type === 'PolicyViolation')
    .map((event) => event.payload as ViolationPayload);
}

function failureOf(outcome: StepOutcome): NonNullable<StepOutcome['failure']> {
  expect(outcome.status).toBe('failed');
  if (outcome.failure === undefined) throw new Error('a failed outcome carries a failure');
  return outcome.failure;
}

describe('in-lane commits honour the write claim (specs/22 M17 P15)', () => {
  it('reverts a self-committed write into the never-writable floor even under warn, same as an uncommitted one', async () => {
    const { outcome, events, committed } = await run({
      produces: ['allowed/**'],
      writes: [
        { relativePath: 'allowed/ok.md', content: 'in claim\n' },
        { relativePath: '.forge/parity/tampered.txt', content: 'tampered\n' },
      ],
      claimPolicy: 'warn',
    });

    expect(committed).toContain('allowed/ok.md');
    // The never-writable floor (`NEVER_WRITABLE_GLOBS`) is a denial, not a claim question: it is reverted
    // under `warn` too (`enforceClaim`'s own doc comment) -- this must hold for a self-committed write
    // exactly as it already does for an uncommitted one.
    expect(committed).not.toContain('.forge/parity/tampered.txt');
    expect(outcome.status).toBe('succeeded'); // warn never fails the step, even when it reverts the floor
    expect(violations(events)).toEqual([
      {
        kind: 'out-of-claim-write',
        policy: 'warn',
        stepFailed: false,
        paths: ['.forge/parity/tampered.txt'],
        totalOutOfClaim: 1,
        totalReverted: 1,
      },
    ]);
  });

  it('reverts an ordinary out-of-claim self-commit under strict, and fails the step (06 §6.7 as amended)', async () => {
    const { outcome, events, committed } = await run({
      produces: ['allowed/**'],
      writes: [
        { relativePath: 'allowed/ok.md', content: 'in claim\n' },
        { relativePath: 'out-of-claim.md', content: 'stray\n' },
      ],
      claimPolicy: 'strict',
    });

    expect(committed).toContain('allowed/ok.md');
    expect(committed).not.toContain('out-of-claim.md');
    expect(failureOf(outcome)).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(violations(events)).toEqual([
      {
        kind: 'out-of-claim-write',
        policy: 'strict',
        stepFailed: true,
        paths: ['out-of-claim.md'],
        totalOutOfClaim: 1,
        totalReverted: 1,
      },
    ]);
  });

  it('keeps but flags an ordinary out-of-claim self-commit under warn, same as the uncommitted case', async () => {
    const { outcome, events, committed } = await run({
      produces: ['allowed/**'],
      writes: [
        { relativePath: 'allowed/ok.md', content: 'in claim\n' },
        { relativePath: 'out-of-claim.md', content: 'stray\n' },
      ],
      claimPolicy: 'warn',
    });

    expect(committed).toContain('allowed/ok.md');
    // `warn` keeps an ordinary (non-excluded) out-of-claim write -- its own "flag, do not revert" contract,
    // unchanged by this piece -- but it must now at least be SEEN and recorded, never silently integrated
    // just because it arrived as a commit the adapter's own self-report never mentioned.
    expect(committed).toContain('out-of-claim.md');
    expect(outcome.status).toBe('succeeded');
    expect(violations(events)).toEqual([
      {
        kind: 'out-of-claim-write',
        policy: 'warn',
        stepFailed: false,
        paths: ['out-of-claim.md'],
        totalOutOfClaim: 1,
        totalReverted: 0,
      },
    ]);
  });

  it('still commits and enforces normally when the session reports its own changes honestly (no regression)', async () => {
    // The ordinary, overwhelmingly common path -- an uncommitted write the adapter DOES report -- must
    // keep working exactly as `output-claim.test.ts`/`empty-claim.test.ts` already prove: this is not a
    // dedicated regression suite for that (out of this piece's own scope), just one sanity check that
    // `hasChanges`-based detection agrees with the honest-report case too, not only the dishonest one.
    const projectRoot = await createTempRepo('honest');
    const adapter = new FakePlatformAdapter(); // no self-commit wrapper: an ordinary, honest session
    adapter.script(() => true, {
      text: ['done'],
      writeFiles: [
        { relativePath: 'allowed/ok.md', content: 'in claim\n' },
        { relativePath: 'out-of-claim.md', content: 'stray\n' },
      ],
    });
    const runId = 'run-honest';
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
      claimPolicy: 'strict',
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) => Promise.resolve(fixtureAgent(agentId)),
      }),
    });
    const stepNode = node({
      id: 'wf:step',
      kind: 'agent',
      agent: toAgentId('po'),
      brief: 'do the work',
      outputs: [],
      produces: ['allowed/**'],
    });
    const outcome = await executeStep(stepNode, ctx);
    const committed = await treeAt(created?.path);
    expect(committed).toContain('allowed/ok.md');
    expect(committed).not.toContain('out-of-claim.md');
    expect(failureOf(outcome)).toMatchObject({ source: 'claim', code: 'RUN-104' });
  });

  // M17 P15 round 2 (gauntlet critic finding): one of `runAgentWork`'s three return points -- the
  // ordinary, `session.ok === true` success path -- is exercised above, but the fix (`hasChanges`
  // instead of `session.changedFiles.length > 0`) touches all three, and a mutation probe against
  // the OTHER two (reverting just one line of three) left every test above still green. These two
  // close that gap directly.
  it('reverts a self-committed out-of-claim write even when the session itself ends in adapter failure (the !session.ok return point)', async () => {
    const { outcome, events, committed } = await run({
      produces: ['allowed/**'],
      writes: [
        { relativePath: 'allowed/ok.md', content: 'in claim\n' },
        { relativePath: 'out-of-claim.md', content: 'stray\n' },
      ],
      claimPolicy: 'strict',
      endReason: 'error',
      errorInfo: { code: 'FAKE_ADAPTER_ERROR', message: 'the session itself went wrong' },
    });

    expect(committed).toContain('allowed/ok.md');
    expect(committed).not.toContain('out-of-claim.md');
    expect(violations(events)).toEqual([
      expect.objectContaining({
        kind: 'out-of-claim-write',
        policy: 'strict',
        paths: ['out-of-claim.md'],
        totalOutOfClaim: 1,
        totalReverted: 1,
      }),
    ]);
    // The session's own adapter failure is real and happened first; it is the step's reported cause
    // here, not the claim violation -- but the violation's own revert and trace above are unconditional,
    // never contingent on which failure the step ends up reporting (`runLaneLifecycle`'s own `work.failure
    // ?? claimFailure(...)` ordering).
    expect(failureOf(outcome)).toMatchObject({ source: 'adapter', code: 'FAKE_ADAPTER_ERROR' });
  });

  it('reverts a self-committed out-of-claim write even when the result record itself cannot be written (the resultFailure return point)', async () => {
    const { outcome, events, committed } = await run({
      produces: ['allowed/**'],
      writes: [
        { relativePath: 'allowed/ok.md', content: 'in claim\n' },
        { relativePath: 'out-of-claim.md', content: 'stray\n' },
      ],
      claimPolicy: 'strict',
      beforeRun: async (projectRoot, runId) => {
        // A directory where result.md must go (the identical technique result-record.test.ts's own
        // "fails the step, visibly, when the answer cannot be recorded" test uses): writeResultRecord
        // throws, so runAgentWork takes its resultFailure return point instead of the plain success one.
        await mkdir(
          path.join(
            projectRoot,
            '.forge',
            'state',
            'runs',
            runId,
            'steps',
            slugifyStepId('wf:step'),
            'result.md',
          ),
          { recursive: true },
        );
      },
    });

    expect(committed).toContain('allowed/ok.md');
    expect(committed).not.toContain('out-of-claim.md');
    expect(violations(events)).toEqual([
      expect.objectContaining({
        kind: 'out-of-claim-write',
        policy: 'strict',
        paths: ['out-of-claim.md'],
        totalOutOfClaim: 1,
        totalReverted: 1,
      }),
    ]);
    expect(failureOf(outcome).message).toContain('Could not record the session result');
  });
});
