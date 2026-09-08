/**
 * "scheduler determinism" — `PLAN-M5.md` P20's own Checks text: the same fixture workflow compiled and
 * run to completion twice with the same seed produces byte-identical scheduling order and final state,
 * and a *different* seed is proven capable of producing a *different* (but still valid) order —
 * determinism is not the same claim as "the scheduler ignores the seed," and both halves are tested.
 *
 * @see specs/06 §6.3
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P20
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { readEvents } from '@forge/telemetry/events';
import { FakePlatformAdapter } from '@forge/testkit';
import { describe, expect, it } from 'vitest';

import { runEngine } from '../../src/run/run-engine.ts';
import {
  fixtureExpressionContext,
  fixtureRunEngineContext,
  FIXTURE_WORKFLOW_SOURCE,
} from './fixture-workflow.ts';

// Not in a shared helper: node:os's tmpdir is R10-restricted in production code
// (packages/engine/test/dispatch/helpers.ts's own doc comment has the fuller reasoning).
async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-e2e-determinism-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** The real, observable scheduling order: `StepScheduled` is emitted, in `scheduler.next()`'s own
 * returned order, by a plain sequential `for` loop over one tick's admitted batch (`run-engine.ts`'s own
 * `driveToCompletion`) *before* that batch's real work ever starts running concurrently — unlike each
 * step's own `StepStarted`/`StepSucceeded`, whose relative order across two *different* steps in the
 * same concurrent batch depends on real async I/O completion timing, not the scheduler's own decision,
 * `StepScheduled` order is the one signal in the durable log that is genuinely the scheduler's own
 * output, deterministic by construction. */
async function schedulingOrder(projectRoot: string, runId: string): Promise<readonly string[]> {
  const order: string[] = [];
  for await (const event of readEvents(projectRoot, runId)) {
    if (event.type === 'StepScheduled' && event.stepId !== undefined) order.push(event.stepId);
  }
  return order;
}

async function runFixture(
  seed: string,
  label: string,
): Promise<{ projectRoot: string; runId: string }> {
  const projectRoot = await createTempRepo(label);
  const runId = `run-${label}`;
  const ctx = fixtureRunEngineContext(projectRoot, runId, seed);
  await runEngine(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext(), ctx);
  return { projectRoot, runId };
}

describe('scheduler determinism', () => {
  it('the same seed produces byte-identical scheduling order and final state across two independent runs', async () => {
    const seed = 'determinism-seed';
    const first = await runFixture(seed, 'same-seed-a');
    const second = await runFixture(seed, 'same-seed-b');

    const firstOrder = await schedulingOrder(first.projectRoot, first.runId);
    const secondOrder = await schedulingOrder(second.projectRoot, second.runId);
    expect(firstOrder).toEqual(secondOrder);
    expect(firstOrder.length).toBeGreaterThan(0);

    const { reconstructRunState } = await import('../../src/resume/reconstruct.ts');
    const firstState = await reconstructRunState(readEvents(first.projectRoot, first.runId));
    const secondState = await reconstructRunState(readEvents(second.projectRoot, second.runId));
    expect(firstState.runStatus).toBe(secondState.runStatus);
    expect(Object.fromEntries(firstState.stepStatuses)).toEqual(
      Object.fromEntries(secondState.stepStatuses),
    );
  });

  it('a different seed is capable of producing a different (but still valid) scheduling order -- determinism is not "the scheduler ignores the seed"', async () => {
    // The main fixture's own two `implement` instances turned out NOT to be a genuine tie in practice:
    // confirmed empirically (searching 30 candidate seeds directly against `orderReadyNodes`, no flip)
    // that `06` §6.3's own rules 1-3 (both feed the same downstream `merge`) already fully resolve their
    // relative order before rule 4 (seed) is ever consulted. Proving "the seed genuinely matters" needs
    // two ready nodes that are *actually* tied on rules 1-3 -- two independent agent steps with no
    // dependents at all, so cost/critical-path/descendant-count agree for both and only the seeded hash
    // can break the tie. `@forge/engine/scheduler`'s own `ordering.test.ts` already proves this same
    // property at the unit level directly against `orderReadyNodes`; this is the identical claim
    // exercised through the real, full `runEngine` path instead, matching this piece's own Checks text
    // ("the same fixture workflow... run to completion").
    // "dominant" alone wins the critical path outright (its own hugely higher maxCostUsd), so neither
    // "a" nor "b" is on it either way -- tied on rule 2, not merely "both absent, so a wins by
    // declaration order" the way two plain nodes with nothing else in the plan actually would
    // (`computeCriticalPath`'s own doc comment: ties break by shallowest depth, then declaration order
    // -- confirmed empirically before settling on this shape: two bare independent steps alone, with no
    // third "dominant" node, never actually reached rule 4 at all). Both "a"/"b" cost the same -- tied
    // on rule 3 too. Only rule 4 (seed) can be deciding between them.
    const tiedWorkflow = `
id: tied-fixture
name: Tied fixture
version: 1.0.0
description: Two independent agent steps with no dependents -- a genuine 06 §6.3 rule-4 tie.

steps:
  - id: dominant
    kind: agent
    agent: engineer
    brief: "dominant"
    limits: { maxCostUsd: 1000000 }

  - id: a
    kind: agent
    agent: engineer
    brief: "step a"

  - id: b
    kind: agent
    agent: engineer
    brief: "step b"
`;
    const tiedAdapter = () => {
      const adapter = new FakePlatformAdapter();
      adapter.script(() => true, { text: ['done'] });
      return adapter;
    };

    async function runTied(seed: string, label: string): Promise<readonly string[]> {
      const projectRoot = await createTempRepo(label);
      const runId = `run-${label}`;
      const ctx = fixtureRunEngineContext(projectRoot, runId, seed, { adapter: tiedAdapter() });
      await runEngine(tiedWorkflow, {}, ctx);
      return schedulingOrder(projectRoot, runId);
    }

    const baselineOrder = await runTied('seed-a', 'tied-baseline');

    // Try enough seeds that at least one produces the opposite order -- the identical "try enough
    // seeds" approach ordering.test.ts's own rule-4 test already uses, for the identical reason (a
    // single arbitrary seed pair might coincidentally hash to the same relative order).
    let foundDifferentOrder = false;
    for (let index = 0; index < 20; index += 1) {
      const order = await runTied(
        `seed-candidate-${String(index)}`,
        `tied-candidate-${String(index)}`,
      );
      if (JSON.stringify(order) !== JSON.stringify(baselineOrder)) {
        foundDifferentOrder = true;
        break;
      }
    }

    expect(foundDifferentOrder).toBe(true);
  });
});
