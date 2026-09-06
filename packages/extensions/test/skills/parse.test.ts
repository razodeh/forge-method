/**
 * `parseSkillPackage` — `15` §15.4.2's `SKILL.md` package layout.
 *
 * @see specs/15 §15.4.2
 * @see PLAN-M2.md P4
 */
import { ProjectPaths, isForgeError } from '@forge/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseSkillPackage } from '../../src/skills/parse.ts';

let projectRoot: string | undefined;

function freshSkillDir(skillId: string): {
  paths: ProjectPaths;
  dir: ReturnType<ProjectPaths['resolveWithin']>;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-skills-'));
  projectRoot = root;
  const paths = new ProjectPaths(root);
  const relative = `skills/${skillId}`;
  mkdirSync(path.join(root, relative), { recursive: true });
  return { paths, dir: paths.resolveWithin(relative) };
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

const MINIMAL_FRONT_MATTER = [
  '---',
  'id: acme-java-standards',
  'name: ACME Java service standards',
  'version: 2.1.0',
  "description: 'How ACME writes Spring Boot services.'",
  "when_to_use: 'Any Java source change in a service module.'",
  'budget_tokens: 3000',
  '---',
  '',
  'Body text.',
  '',
].join('\n');

describe('parseSkillPackage', () => {
  it('reads SKILL.md front matter and body', async () => {
    const { dir } = freshSkillDir('acme-java-standards');
    writeFileSync(path.join(dir, 'SKILL.md'), MINIMAL_FRONT_MATTER);
    const skill = await parseSkillPackage(dir);
    expect(skill.frontMatter).toMatchObject({ id: 'acme-java-standards', budget_tokens: 3000 });
    expect(skill.body).toBe('\nBody text.\n');
  });

  it('lists references/ files, sorted, when the directory exists', async () => {
    const { dir } = freshSkillDir('acme-java-standards');
    writeFileSync(path.join(dir, 'SKILL.md'), MINIMAL_FRONT_MATTER);
    mkdirSync(path.join(dir, 'references'));
    writeFileSync(path.join(dir, 'references', 'logging.md'), 'x');
    writeFileSync(path.join(dir, 'references', 'error-handling.md'), 'x');
    const skill = await parseSkillPackage(dir);
    expect(skill.referenceFiles).toEqual(['error-handling.md', 'logging.md']);
  });

  it('returns an empty references list when the directory does not exist', async () => {
    const { dir } = freshSkillDir('acme-java-standards');
    writeFileSync(path.join(dir, 'SKILL.md'), MINIMAL_FRONT_MATTER);
    const skill = await parseSkillPackage(dir);
    expect(skill.referenceFiles).toEqual([]);
  });

  it('lists scripts/ files when the directory exists', async () => {
    const { dir } = freshSkillDir('acme-java-standards');
    writeFileSync(path.join(dir, 'SKILL.md'), MINIMAL_FRONT_MATTER);
    mkdirSync(path.join(dir, 'scripts'));
    writeFileSync(path.join(dir, 'scripts', 'check-layering.sh'), '#!/bin/sh\n', { mode: 0o755 });
    const skill = await parseSkillPackage(dir);
    expect(skill.scriptFiles).toEqual(['check-layering.sh']);
  });

  it('does not validate the front matter against the skill schema — a structurally valid but schema-invalid document still parses', async () => {
    const { dir } = freshSkillDir('broken');
    writeFileSync(
      path.join(dir, 'SKILL.md'),
      ['---', 'id: broken', 'this_is_not_a_real_field: true', '---', '', 'Body.', ''].join('\n'),
    );
    const skill = await parseSkillPackage(dir);
    expect(skill.frontMatter).toMatchObject({ id: 'broken' });
  });

  it('throws CFG-005 for a SKILL.md with no front matter delimiter at all', async () => {
    const { dir } = freshSkillDir('acme-java-standards');
    writeFileSync(path.join(dir, 'SKILL.md'), 'Just a body, no front matter.\n');
    try {
      await parseSkillPackage(dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isForgeError(error) && error.code).toBe('CFG-005');
    }
  });

  it('throws CFG-006 for unterminated front matter', async () => {
    const { dir } = freshSkillDir('acme-java-standards');
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nid: x\n');
    try {
      await parseSkillPackage(dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isForgeError(error) && error.code).toBe('CFG-006');
    }
  });

  it('throws CFG-007 for front matter that is not valid YAML', async () => {
    const { dir } = freshSkillDir('acme-java-standards');
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nid: [unterminated\n---\nBody.\n');
    try {
      await parseSkillPackage(dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isForgeError(error) && error.code).toBe('CFG-007');
    }
  });
});
