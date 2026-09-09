/**
 * `forge deploy <env>` — real, thin dispatch to `deliver-stage`.
 *
 * @see specs/03 §3.2.5
 */
import { afterEach, describe, expect, it } from 'vitest';

import { deployEnvironment } from '../../../src/commands/loop/deploy.ts';
import { cleanupAll, createTestProject, fixtureAdapter, testRunDeps } from './helpers.ts';

afterEach(cleanupAll);

describe('deployEnvironment', () => {
  it('threads env into the compiled plan and completes a real run', async () => {
    const project = await createTestProject();
    const deps = testRunDeps(project, fixtureAdapter('staging.txt'));
    const result = await deployEnvironment(deps, 'staging', { host: 'test-host' });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('completed');
  });

  it('dry-run resolves the real compiled produces glob from env', async () => {
    const project = await createTestProject();
    const result = await deployEnvironment(testRunDeps(project), 'staging', {
      dryRun: true,
      host: 'test-host',
    });
    expect(result.kind).toBe('dry-run');
    if (result.kind !== 'dry-run' || !result.plan.success) throw new Error('unreachable');
    expect(result.plan.nodes[0]?.produces).toEqual(['staging.txt']);
  });
});
