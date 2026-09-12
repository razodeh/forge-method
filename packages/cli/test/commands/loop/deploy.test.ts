/**
 * `forge deploy <env>` — real, thin dispatch to `deliver-stage`.
 *
 * @see specs/03 §3.2.5
 */
import { destructiveConfirmationPhrase } from '@forge/engine/security';
import { afterEach, describe, expect, it } from 'vitest';

import { deployEnvironment } from '../../../src/commands/loop/deploy.ts';
import { cleanupAll, createTestProject, fixtureAdapter, testRunDeps } from './helpers.ts';

afterEach(cleanupAll);

describe('deployEnvironment', () => {
  it('threads env into the compiled plan and completes a real run', async () => {
    const project = await createTestProject();
    const deps = testRunDeps(project, fixtureAdapter('staging.txt'));
    // `20` §20.10 S7: a real deploy now requires a real, typed confirmation naming the environment and
    // resource — this test's own well-formed one, proving the gate lets a genuinely confirmed deploy
    // proceed. The refusal path (no/wrong confirmation) is `s7-destructive-confirmation.test.ts`'s own
    // job, at the mechanism level `requireDestructiveConfirmation` itself lives at.
    const confirmation = destructiveConfirmationPhrase('staging', project.config.project.name);
    const result = await deployEnvironment(deps, 'staging', { host: 'test-host', confirmation });
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

  it('throws RUN-075 (20 §20.10 S7) for a real, non-dry-run deploy with no confirmation', async () => {
    const project = await createTestProject();
    const deps = testRunDeps(project, fixtureAdapter('staging.txt'));
    await expect(deployEnvironment(deps, 'staging', { host: 'test-host' })).rejects.toMatchObject({
      code: 'RUN-075',
    });
  });

  it('throws RUN-075 for a real deploy whose confirmation names the wrong environment', async () => {
    const project = await createTestProject();
    const deps = testRunDeps(project, fixtureAdapter('staging.txt'));
    const wrongConfirmation = destructiveConfirmationPhrase(
      'production',
      project.config.project.name,
    );
    await expect(
      deployEnvironment(deps, 'staging', { host: 'test-host', confirmation: wrongConfirmation }),
    ).rejects.toMatchObject({ code: 'RUN-075' });
  });

  it('never even evaluates the confirmation gate for --dry-run -- no confirmation needed to plan', async () => {
    const project = await createTestProject();
    const result = await deployEnvironment(testRunDeps(project), 'staging', {
      dryRun: true,
      host: 'test-host',
    });
    expect(result.kind).toBe('dry-run');
  });
});
