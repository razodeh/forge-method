/**
 * `forge refactor <target> --goal <text>` — real, thin dispatch to `refactor`.
 *
 * @see specs/03 §3.2.5
 */
import { afterEach, describe, expect, it } from 'vitest';

import { refactorTarget } from '../../../src/commands/loop/refactor.ts';
import { cleanupAll, createTestProject, fixtureAdapter, testRunDeps } from './helpers.ts';

afterEach(cleanupAll);

describe('refactorTarget', () => {
  it('threads target/goal into the compiled plan and completes a real run', async () => {
    const project = await createTestProject();
    const deps = testRunDeps(project, fixtureAdapter('payments-strategy.txt'));
    const result = await refactorTarget(deps, 'payments', 'strategy', { host: 'test-host' });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('completed');
  });

  it('dry-run resolves the real compiled produces glob from target/goal', async () => {
    const project = await createTestProject();
    const result = await refactorTarget(testRunDeps(project), 'payments', 'strategy', {
      dryRun: true,
      host: 'test-host',
    });
    expect(result.kind).toBe('dry-run');
    if (result.kind !== 'dry-run' || !result.plan.success) throw new Error('unreachable');
    expect(result.plan.nodes[0]?.produces).toEqual(['payments-strategy.txt']);
  });
});
