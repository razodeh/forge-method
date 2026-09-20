/**
 * Brief/prompt regenerable content in `forge init` — `PLAN-M13.md` P1: what a real init writes for the
 * two new content kinds, and that the loader returns the authored text (not FORGE's own
 * `forge:generated` bookkeeping) from a file stamped by the real `withGeneratedHeader`.
 *
 * @see specs/03 §3.3
 * @see PLAN-M13.md P1
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveContentReference } from '@forge/agents/prompt';
import { ProjectPaths, writeFileAtomic } from '@forge/core';
import { afterEach, describe, expect, it } from 'vitest';

import { withGeneratedHeader } from '../../src/init/generated-header.ts';
import { sha256 } from '../../src/init/hash.ts';
import { cleanupAll, createTestProject } from '../commands/upgrade/helpers.ts';

const dirs: string[] = [];
afterEach(async () => {
  await cleanupAll();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('brief/prompt regenerable content', () => {
  it('a real forge init materializes shipped content into both .forge/briefs and .forge/prompts (M13 P2/P3 authored it; Q197 recorded the empty state)', async () => {
    const project = await createTestProject();
    for (const dir of ['.forge/briefs', '.forge/prompts']) {
      const entries = await readdir(project.paths.resolveWithin(dir));
      expect(entries.filter((name) => name.endsWith('.md')).length, dir).toBeGreaterThan(0);
    }
  });

  it.each([
    ['plain markdown', 'Write the vision.\n'],
    ['markdown with front matter', '---\ntitle: Vision brief\n---\nWrite the vision.\n'],
  ])(
    'resolves %s stamped by the real withGeneratedHeader back to exactly the authored text',
    async (_label, body) => {
      const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-brief-content-'));
      dirs.push(dir);
      const paths = new ProjectPaths(dir);
      const stamped = withGeneratedHeader(body, '.forge/briefs/vision.md', '1.2.3', sha256(body));
      expect(stamped).toContain('forge:generated');
      await writeFileAtomic(paths.resolveWithin('.forge/briefs/vision.md'), stamped);

      expect(await resolveContentReference(paths, 'briefs/vision.md')).toBe(body);
    },
  );
});
