/**
 * `@forge/templates`'s 32 built-in skills (`15` §15.4.4), validated against this package's own real
 * `validateSkill`/`parseSkillPackage` (M2 P4, already built) — `PLAN-M6.md` T5's own Checks section:
 * "every skill validates against `@forge/extensions/skills`' own `skillFrontMatterSchema`/
 * `validateSkill` ... with zero errors ... on real, shipped content, not just on P4's own test
 * fixtures."
 *
 * Lives here, not at the repository root: `02` §2.2's own boundary graph runs `extensions ->
 * templates` (`tools/eslint-plugin-forge-boundaries/src/graph.mjs`), so — unlike T1-T4's own
 * cross-package checks, where neither package could import the other — this package can import
 * `@forge/templates` directly, and the ordinary per-package `test/` location applies.
 *
 * @see specs/15 §15.4
 * @see PLAN-M6.md T5
 */
import { ProjectPaths } from '@forge/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SKILL_INDEX, type SkillId } from '@forge/templates';

import { parseSkillPackage } from '../../src/skills/parse.ts';
import { validateSkill } from '../../src/skills/validate.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');
const templatesPaths = new ProjectPaths(templatesPackageRoot);

const ALL_SKILL_IDS = Object.keys(SKILL_INDEX) as SkillId[];

/** `15` §15.4.5's own hard cap has no spec number (`SPEC-QUESTIONS.md` Q33) — this piece's own
 * `validate.test.ts` already established `10_000` as a representative fixture value; reused here for
 * the identical reason (nothing in this piece's own scope is the one that should invent a different
 * real number). */
const HARD_CAP_TOKENS = 10_000;

describe('T5: the 32 built-in skills (15 §15.4.4) all validate cleanly', () => {
  it('SKILL_INDEX names exactly the 32 skills the six-group table lists, no more and no fewer', () => {
    expect(ALL_SKILL_IDS).toHaveLength(32);
  });

  it.each(ALL_SKILL_IDS)(
    '%s validates with zero findings against the real validateSkill',
    async (id) => {
      const dir = templatesPaths.resolveWithin(SKILL_INDEX[id]);
      const skill = await parseSkillPackage(dir);
      const outcome = await validateSkill(skill, { hardCapTokens: HARD_CAP_TOKENS });
      expect(outcome, JSON.stringify(outcome.findings, null, 2)).toEqual({
        valid: true,
        findings: [],
      });
    },
  );

  it.each(ALL_SKILL_IDS)(
    "%s's own id in its front matter matches its own SKILL_INDEX key",
    async (id) => {
      const dir = templatesPaths.resolveWithin(SKILL_INDEX[id]);
      const skill = await parseSkillPackage(dir);
      expect((skill.frontMatter as { id: string }).id).toBe(id);
    },
  );
});
