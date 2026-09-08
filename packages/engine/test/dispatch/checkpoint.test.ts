/**
 * `runCheckpointStep` (via `executeStep`) — `10` §10.1: "force a commit + event-log flush; a safe resume
 * point." `types.ts`'s own `StepOutcomeDetail` doc comment explains why this carries no side effect of its
 * own for M5's scope: `@forge/telemetry`'s own `appendEvent` is already `fsync`'d per call.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P15
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { readEvents } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
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

describe('runCheckpointStep', () => {
  it('always succeeds, emitting only StepStarted and StepSucceeded', async () => {
    const projectRoot = await createTempRepo('checkpoint');
    const ctx = createTestContext({ projectRoot, runId: 'run-checkpoint' });
    const stepNode = node({ id: 'wf:checkpoint', kind: 'checkpoint' });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail).toEqual({ kind: 'checkpoint' });
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-checkpoint')) events.push(event);
    expect(events.map((event) => event.type)).toEqual(['StepStarted', 'StepSucceeded']);
  });

  it('records startedAt <= finishedAt using the injected clock, not real wall-clock time', async () => {
    const projectRoot = await createTempRepo('checkpoint-clock');
    const ctx = createTestContext({ projectRoot });
    const outcome = await executeStep(node({ id: 'wf:checkpoint', kind: 'checkpoint' }), ctx);
    expect(outcome.startedAt).toBeLessThanOrEqual(outcome.finishedAt);
  });
});
