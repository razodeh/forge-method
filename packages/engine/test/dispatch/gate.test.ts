/**
 * `runGateStep` (via `executeStep`) — `10` §10.3's own gate mechanism (`@forge/engine/gates`, P14) driven
 * through the real dispatcher: a `gate`-kind step names a bare gate id (`StepNode.gate`), looked up from
 * the run's own gate registry (`ExecuteStepContext.gateRegistry`) and evaluated with real shell commands.
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P15
 */
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { readEvents } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import type { GateDefinition } from '../../src/gates/index.ts';
import { createTestContext, node } from './helpers.ts';

// Not in helpers.ts: node:os's tmpdir is R10-restricted in production code, and the test-file
// exemption in eslint.config.js only covers files literally named *.test.ts (matching
// @forge/vcs's own test convention of a small, duplicated per-file helper).
async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-dispatch-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

function gate(overrides: Partial<GateDefinition> & { readonly id: string }): GateDefinition {
  return {
    checks: { deterministic: [], advisory: [] },
    openQuestionsPolicy: 'block',
    ...overrides,
  };
}

describe('runGateStep', () => {
  it('a gate whose deterministic checks all pass produces a succeeded outcome, emitting GateEvaluated then GateApproved', async () => {
    const projectRoot = await createTempRepo('gate-pass');
    const gateRegistry = new Map([
      [
        'G-Test',
        gate({
          id: 'G-Test',
          checks: {
            deterministic: [{ id: 'check-a', run: `echo '{"errors":0}'`, failOn: 'errors > 0' }],
            advisory: [],
          },
        }),
      ],
    ]);
    const ctx = createTestContext({ projectRoot, gateRegistry, runId: 'run-gate-pass' });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Test' });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail.kind).toBe('gate');
    if (outcome.detail.kind === 'gate') expect(outcome.detail.report.approved).toBe(true);

    const events = [];
    for await (const event of readEvents(projectRoot, 'run-gate-pass')) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      'StepStarted',
      'GateEvaluated',
      'GateApproved',
      'StepSucceeded',
    ]);
  });

  it('a gate with a failing deterministic check produces a failed outcome, emitting GateRejected', async () => {
    const projectRoot = await createTempRepo('gate-fail');
    const gateRegistry = new Map([
      [
        'G-Test',
        gate({
          id: 'G-Test',
          checks: {
            deterministic: [{ id: 'check-a', run: `echo '{"errors":5}'`, failOn: 'errors > 0' }],
            advisory: [],
          },
        }),
      ],
    ]);
    const ctx = createTestContext({ projectRoot, gateRegistry, runId: 'run-gate-fail' });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Test' });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('gate');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-gate-fail')) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      'StepStarted',
      'GateEvaluated',
      'GateRejected',
      'StepFailed',
    ]);
  });

  it('an advisory-only check never fails the gate, even when the gate has no passing deterministic check of its own to rely on -- rule 2', async () => {
    // A gate with ZERO deterministic checks and one advisory check passes vacuously (P14's own established
    // behaviour, `evaluateGate` never even looks at `advisory` for pass/fail) -- confirming that behaviour
    // is preserved end to end through this dispatcher, not just inside @forge/engine/gates' own tests.
    const projectRoot = await createTempRepo('gate-advisory');
    const gateRegistry = new Map([
      [
        'G-Test',
        gate({
          id: 'G-Test',
          checks: {
            deterministic: [],
            advisory: [{ id: 'review', agent: 'critic', brief: 'briefs/review.md' }],
          },
        }),
      ],
    ]);
    const ctx = createTestContext({ projectRoot, gateRegistry });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Test' });

    const outcome = await executeStep(stepNode, ctx);
    expect(outcome.status).toBe('succeeded');
  });

  it("throws RUN-040 for a gate id absent from the run's own gate registry, rather than silently failing the step", async () => {
    const projectRoot = await createTempRepo('gate-missing');
    const ctx = createTestContext({ projectRoot, gateRegistry: new Map() });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Nonexistent' });

    let caught: unknown;
    try {
      await executeStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-040');
  });

  it('a gate step never creates a lane -- gates evaluate against a shared directory, not an isolated worktree', async () => {
    const projectRoot = await createTempRepo('gate-no-lane');
    const gateRegistry = new Map([
      ['G-Test', gate({ id: 'G-Test', checks: { deterministic: [], advisory: [] } })],
    ]);
    const ctx = createTestContext({ projectRoot, gateRegistry });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Test' });

    await executeStep(stepNode, ctx);

    await expect(readdir(path.join(projectRoot, '.forge', 'state', 'worktrees'))).rejects.toThrow();
  });

  it('evaluates a gate against ctx.integrationPath, not ctx.projectRoot -- the directory a merge step actually lands its result in', async () => {
    const projectRoot = await createTempRepo('gate-project-root');
    // A distinct real repo standing in for a maintained integration worktree -- @forge/vcs's own
    // processMergeCandidate requires a caller-maintained one at ctx.integrationPath (types.ts's own
    // doc comment), which need not be projectRoot at all, unlike every other fixture in this file.
    const integrationPath = await createTempRepo('gate-integration-path');
    await writeFile(path.join(integrationPath, 'marker.txt'), 'only in integrationPath\n');
    const gateRegistry = new Map([
      [
        'G-Test',
        gate({
          id: 'G-Test',
          checks: {
            deterministic: [
              {
                id: 'check-marker',
                run: `test -f marker.txt && echo '{"errors":0}' || echo '{"errors":1}'`,
                failOn: 'errors > 0',
              },
            ],
            advisory: [],
          },
        }),
      ],
    ]);
    const ctx = createTestContext({ projectRoot, integrationPath, gateRegistry });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Test' });

    const outcome = await executeStep(stepNode, ctx);

    // Only passes if the check actually ran with integrationPath as its cwd -- marker.txt does not
    // exist in projectRoot at all, so evaluating there would fail this same check.
    expect(outcome.status).toBe('succeeded');
  });

  it('throws RUN-039 for a gate node missing its own gate field', async () => {
    const projectRoot = await createTempRepo('gate-missing-field');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({ id: 'wf:gate', kind: 'gate' });

    let caught: unknown;
    try {
      await executeStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-039');
  });

  it('propagates a genuinely unexpected evaluator failure unwrapped, rather than mistaking it for an unregistered gate id', async () => {
    const projectRoot = await createTempRepo('gate-evaluator-throws');
    const ctx = createTestContext({
      projectRoot,
      gates: {
        evaluate() {
          throw new Error('the evaluator itself is broken');
        },
      },
    });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Test' });

    let caught: unknown;
    try {
      await executeStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ForgeError);
    expect((caught as Error).message).toBe('the evaluator itself is broken');
  });
});
