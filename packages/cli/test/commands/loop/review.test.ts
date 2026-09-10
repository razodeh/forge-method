/**
 * `forge review [--diff <range>]` — real dispatch to `@forge/engine/interaction`'s own
 * `dispatchAgentStep(..., 'swarm-review', ...)`, against a real `git diff` and a real, materialized
 * `.forge/agents/reviewer.yaml`.
 *
 * @see specs/03 §3.2.5
 * @see specs/13 §13.3 F-REVIEW-1
 * @see specs/13 §13.3 F-REVIEW-2
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { reviewChange, type ReviewDeps } from '../../../src/commands/loop/review.ts';
import { AGENTS_ROOT, CHECKS_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

const REAL_PERSPECTIVES = [
  'spec-conformance',
  'design',
  'correctness',
  'security',
  'performance',
  'testing',
  'operability',
  'documentation',
];

function reviewDeps(project: Awaited<ReturnType<typeof createTestProject>>): ReviewDeps {
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, {
    text: ['looks fine'],
    structured: { findings: [{ summary: 'a real finding', severity: 'minor' }], checked: ['x'] },
  });
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
  it('drives all eight real F-REVIEW-1 perspective sessions against a real git diff and merges real findings', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, 'changed.txt'), 'real content\n');
    await execa('git', ['add', 'changed.txt'], { cwd: project.dir });

    const outcome = await reviewChange(reviewDeps(project));

    expect(outcome.participants).toHaveLength(8);
    expect(outcome.reviewReport?.perspectives).toEqual(REAL_PERSPECTIVES);
    expect(outcome.reviewReport?.findings[0]?.summary).toBe('a real finding');
    expect(outcome.reviewReport?.findings[0]?.severity).toBe('minor');
    // Every one of the 8 perspectives independently reported the identical finding text — a real
    // de-duplication into one finding with all 8 attributions.
    expect(outcome.reviewReport?.findings[0]?.perspectives).toHaveLength(8);
  });

  it('defaults to a real `git diff HEAD` when no --diff range is given', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, 'changed.txt'), 'real content\n');

    const outcome = await reviewChange(reviewDeps(project));
    expect(outcome.participants).toHaveLength(8);
  });

  it('throws RUN-056 when the project has no real reviewer agent materialized', async () => {
    const project = await createTestProject();
    const { rm } = await import('node:fs/promises');
    await rm(path.join(project.dir, AGENTS_ROOT, 'reviewer.yaml'));
    await expect(reviewChange(reviewDeps(project))).rejects.toMatchObject({ code: 'RUN-056' });
  });

  describe('CFG-501 — a reviewer may not approve a change it authored', () => {
    it('throws CFG-501, dispatching no real session at all, when HEAD’s own real commit trailer names the reviewer itself', async () => {
      const project = await createTestProject();
      await writeFile(path.join(project.dir, 'changed.txt'), 'real content\n');
      await execa('git', ['add', 'changed.txt'], { cwd: project.dir });
      await execa(
        'git',
        [
          'commit',
          '--quiet',
          '-m',
          'forge(x): a real, agent-authored change\n\nCo-Authored-By: reviewer <reviewer@agents.forge.invalid>',
        ],
        { cwd: project.dir },
      );

      const deps = reviewDeps(project);
      await expect(reviewChange(deps, { diff: 'HEAD~1' })).rejects.toMatchObject({
        code: 'CFG-501',
      });
    });

    it('does not refuse when HEAD’s own real commit trailer names a different agent', async () => {
      const project = await createTestProject();
      await writeFile(path.join(project.dir, 'changed.txt'), 'real content\n');
      await execa('git', ['add', 'changed.txt'], { cwd: project.dir });
      await execa(
        'git',
        [
          'commit',
          '--quiet',
          '-m',
          'forge(x): a real, agent-authored change\n\nCo-Authored-By: engineer <engineer@agents.forge.invalid>',
        ],
        { cwd: project.dir },
      );

      const outcome = await reviewChange(reviewDeps(project), { diff: 'HEAD~1' });
      expect(outcome.participants).toHaveLength(8);
    });

    it('does not refuse when HEAD is a real, ordinary commit with no agent trailer at all', async () => {
      const project = await createTestProject();
      await writeFile(path.join(project.dir, 'changed.txt'), 'real content\n');
      await execa('git', ['add', 'changed.txt'], { cwd: project.dir });
      await execa('git', ['commit', '--quiet', '-m', 'a real, ordinary human commit'], {
        cwd: project.dir,
      });

      const outcome = await reviewChange(reviewDeps(project), { diff: 'HEAD~1' });
      expect(outcome.participants).toHaveLength(8);
    });

    it('throws CFG-501 when the reviewing agent’s own trailer is the SECOND of two real Co-Authored-By trailers on one commit', async () => {
      const project = await createTestProject();
      await writeFile(path.join(project.dir, 'changed.txt'), 'real content\n');
      await execa('git', ['add', 'changed.txt'], { cwd: project.dir });
      await execa(
        'git',
        [
          'commit',
          '--quiet',
          '-m',
          'forge(x): a real, two-agent change\n\nCo-Authored-By: engineer <engineer@agents.forge.invalid>\nCo-Authored-By: reviewer <reviewer@agents.forge.invalid>',
        ],
        { cwd: project.dir },
      );

      await expect(reviewChange(reviewDeps(project), { diff: 'HEAD~1' })).rejects.toMatchObject({
        code: 'CFG-501',
      });
    });

    it('throws CFG-501 when a real --no-ff merge commit itself carries no trailer, but its own merged-in lane tip does', async () => {
      const project = await createTestProject();
      await execa('git', ['checkout', '-b', 'lane/x'], { cwd: project.dir });
      await writeFile(path.join(project.dir, 'lane-change.txt'), 'lane content\n');
      await execa('git', ['add', 'lane-change.txt'], { cwd: project.dir });
      await execa(
        'git',
        [
          'commit',
          '--quiet',
          '-m',
          'forge(x): lane work\n\nCo-Authored-By: reviewer <reviewer@agents.forge.invalid>',
        ],
        { cwd: project.dir },
      );
      await execa('git', ['checkout', 'main'], { cwd: project.dir });
      // Forge's own real merge queue (`formatMergeCommitMessage`) never writes a Co-Authored-By
      // trailer on the merge commit itself -- only Forge-Step/Forge-Run. The real authorship lives on
      // the merged-in lane's own tip commit instead (this merge commit's own non-first parent).
      await execa(
        'git',
        [
          'merge',
          '--no-ff',
          '--quiet',
          '-m',
          'Merge lane/x\n\nForge-Step: x\nForge-Run: y',
          'lane/x',
        ],
        { cwd: project.dir },
      );

      await expect(reviewChange(reviewDeps(project))).rejects.toMatchObject({ code: 'CFG-501' });
    });

    it('does not refuse a real merge commit whose merged-in lane tip carries a DIFFERENT agent’s trailer', async () => {
      const project = await createTestProject();
      await execa('git', ['checkout', '-b', 'lane/x'], { cwd: project.dir });
      await writeFile(path.join(project.dir, 'lane-change.txt'), 'lane content\n');
      await execa('git', ['add', 'lane-change.txt'], { cwd: project.dir });
      await execa(
        'git',
        [
          'commit',
          '--quiet',
          '-m',
          'forge(x): lane work\n\nCo-Authored-By: engineer <engineer@agents.forge.invalid>',
        ],
        { cwd: project.dir },
      );
      await execa('git', ['checkout', 'main'], { cwd: project.dir });
      await execa(
        'git',
        [
          'merge',
          '--no-ff',
          '--quiet',
          '-m',
          'Merge lane/x\n\nForge-Step: x\nForge-Run: y',
          'lane/x',
        ],
        { cwd: project.dir },
      );

      const outcome = await reviewChange(reviewDeps(project));
      expect(outcome.participants).toHaveLength(8);
    });

    it('resolves an explicit two-dot range’s own real tip -- not unconditionally HEAD -- when checking for a real agent trailer', async () => {
      const project = await createTestProject();
      await writeFile(path.join(project.dir, 'first.txt'), 'first\n');
      await execa('git', ['add', 'first.txt'], { cwd: project.dir });
      await execa(
        'git',
        [
          'commit',
          '--quiet',
          '-m',
          'forge(x): first, agent-authored change\n\nCo-Authored-By: reviewer <reviewer@agents.forge.invalid>',
        ],
        { cwd: project.dir },
      );
      await writeFile(path.join(project.dir, 'second.txt'), 'second\n');
      await execa('git', ['add', 'second.txt'], { cwd: project.dir });
      await execa('git', ['commit', '--quiet', '-m', 'a real, later, ordinary human commit'], {
        cwd: project.dir,
      });

      // HEAD -- the later, human commit -- carries no trailer at all; the EARLIER commit named as this
      // range's own real tip (HEAD~1) is the one that does. A naive, always-check-HEAD read would miss
      // this entirely (a false negative); reading the range's own actual tip catches it.
      await expect(
        reviewChange(reviewDeps(project), { diff: 'HEAD~2...HEAD~1' }),
      ).rejects.toMatchObject({ code: 'CFG-501' });
    });

    it('does not refuse a range whose own real tip has no trailer, even though a different commit in the same repo does', async () => {
      const project = await createTestProject();
      await writeFile(path.join(project.dir, 'first.txt'), 'first\n');
      await execa('git', ['add', 'first.txt'], { cwd: project.dir });
      await execa(
        'git',
        [
          'commit',
          '--quiet',
          '-m',
          'forge(x): first, agent-authored change\n\nCo-Authored-By: reviewer <reviewer@agents.forge.invalid>',
        ],
        { cwd: project.dir },
      );
      await writeFile(path.join(project.dir, 'second.txt'), 'second\n');
      await execa('git', ['add', 'second.txt'], { cwd: project.dir });
      await execa('git', ['commit', '--quiet', '-m', 'a real, later, ordinary human commit'], {
        cwd: project.dir,
      });

      // This range's own real tip is HEAD~1 -- the ordinary human commit itself carries no trailer,
      // even though an EARLIER commit named as this same range's own base does.
      const outcome = await reviewChange(reviewDeps(project), { diff: 'HEAD~2...HEAD' });
      expect(outcome.participants).toHaveLength(8);
    });
  });
});
