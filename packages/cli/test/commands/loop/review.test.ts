/**
 * `forge review [--diff <range>]` — real dispatch to `@forge/engine/interaction`'s own
 * `dispatchAgentStep(..., 'swarm-review', ...)`, against a real `git diff` and a real, materialized
 * `.forge/agents/reviewer.yaml`.
 *
 * @see specs/03 §3.2.5
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { reviewChange, type ReviewDeps } from '../../../src/commands/loop/review.ts';
import { AGENTS_ROOT, CHECKS_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

function reviewDeps(project: Awaited<ReturnType<typeof createTestProject>>): ReviewDeps {
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, { text: ['looks fine'], structured: ['a real finding'] });
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: project.config,
    adapter,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
  };
}

describe('reviewChange', () => {
  it('drives four real perspective sessions against a real git diff and merges real findings', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, 'changed.txt'), 'real content\n');
    await execa('git', ['add', 'changed.txt'], { cwd: project.dir });

    const outcome = await reviewChange(reviewDeps(project));

    expect(outcome.participants).toHaveLength(4);
    expect(outcome.reviewReport?.perspectives).toEqual([
      'design',
      'security',
      'testing',
      'performance',
    ]);
    expect(outcome.reviewReport?.findings[0]?.summary).toBe('a real finding');
    // Every one of the 4 perspectives independently reported the identical finding text — a real
    // de-duplication into one finding with all 4 attributions.
    expect(outcome.reviewReport?.findings[0]?.perspectives).toHaveLength(4);
  });

  it('defaults to a real `git diff HEAD` when no --diff range is given', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, 'changed.txt'), 'real content\n');

    const outcome = await reviewChange(reviewDeps(project));
    expect(outcome.participants).toHaveLength(4);
  });

  it('throws RUN-056 when the project has no real reviewer agent materialized', async () => {
    const project = await createTestProject();
    const { rm } = await import('node:fs/promises');
    await rm(path.join(project.dir, AGENTS_ROOT, 'reviewer.yaml'));
    await expect(reviewChange(reviewDeps(project))).rejects.toMatchObject({ code: 'RUN-056' });
  });
});
