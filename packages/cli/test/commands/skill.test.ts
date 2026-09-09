/**
 * `forge skill <list|validate>` — thin wrappers over `@forge/extensions/skills`.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { skillList, skillValidate } from '../../src/commands/skill.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

describe('skillList', () => {
  it('lists every real, materialized skill id under .forge/skills/', async () => {
    const project = await createTestProject();
    const skills = await skillList({ paths: project.paths });
    expect(skills.length).toBeGreaterThan(0);
  });

  it('returns a real, empty list — not a thrown error — when .forge/skills/ does not exist at all', async () => {
    const project = await createTestProject();
    const { rm } = await import('node:fs/promises');
    await rm(project.paths.resolveWithin('.forge/skills'), { recursive: true, force: true });
    const skills = await skillList({ paths: project.paths });
    expect(skills).toEqual([]);
  });
});

describe('skillValidate', () => {
  it('validates one real, materialized skill package', async () => {
    const project = await createTestProject();
    const skills = await skillList({ paths: project.paths });
    const first = skills[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const outcome = await skillValidate({ paths: project.paths }, first);
    expect(typeof outcome.valid).toBe('boolean');
  });
});
