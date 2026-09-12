/**
 * `reportInjectionAttempt` — `20` §20.5 point 2's own "removed and logged as `InjectionAttemptBlocked`,"
 * tested directly against a real `ExecuteStepContext`'s telemetry facade rather than only through
 * `cartography.ts`/`inference.ts`'s own end-to-end dispatch tests, since a JSON-encoded evidence block
 * cannot currently drive `strippedCount > 0` for real (see this function's own doc comment).
 *
 * @see specs/20 §20.5 point 2
 * @see PLAN-M10.md P16
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { readEvents } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import { reportInjectionAttempt } from '../../src/adopt/injection-telemetry.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createTestContext } from '../dispatch/helpers.ts';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function tempRepo(): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'forge-engine-adopt-injection-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('reportInjectionAttempt', () => {
  it('emits a real InjectionAttemptBlocked event when strippedCount > 0', async () => {
    const projectRoot = await tempRepo();
    const ctx = createTestContext({ projectRoot, runId: 'run-injection' });

    await reportInjectionAttempt(
      ctx,
      'adopt:cartography:component',
      toAgentId('architect'),
      'cartography',
      'component',
      2,
    );

    const events = [];
    for await (const event of readEvents(projectRoot, 'run-injection')) events.push(event);
    const blocked = events.find((event) => event.type === 'InjectionAttemptBlocked');
    expect(blocked).toBeDefined();
    expect(blocked?.payload).toEqual({ phase: 'cartography', kind: 'component', strippedCount: 2 });
  });

  it('emits nothing when strippedCount is 0', async () => {
    const projectRoot = await tempRepo();
    const ctx = createTestContext({ projectRoot, runId: 'run-no-injection' });

    await reportInjectionAttempt(
      ctx,
      'adopt:inference:intent',
      toAgentId('architect'),
      'inference',
      'intent',
      0,
    );

    const events = [];
    for await (const event of readEvents(projectRoot, 'run-no-injection')) events.push(event);
    expect(events.find((event) => event.type === 'InjectionAttemptBlocked')).toBeUndefined();
  });
});
