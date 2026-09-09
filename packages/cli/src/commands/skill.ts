/**
 * `forge skill <list|validate>` — `03` §3.2.8, thin wrappers over `@forge/extensions/skills`' own
 * already-built `parseSkillPackage`/`validateSkill` (M2).
 *
 * @see specs/03 §3.2.8
 * @see specs/15 §15.4
 */
import { listDirEntriesSorted, pathExists, type ProjectPaths } from '@forge/core/fs';
import {
  parseSkillPackage,
  validateSkill,
  type SkillValidationOutcome,
} from '@forge/extensions/skills';

export interface SkillCommandContext {
  readonly paths: ProjectPaths;
}

/** No spec page numbers a hard token cap (`SPEC-QUESTIONS.md` Q33); `10_000` matches this
 * codebase's own already-established test default (`packages/extensions/test/skills/
 * built-in-skill-library.test.ts`'s own `HARD_CAP_TOKENS`), reused here rather than a second,
 * independently-chosen number. */
const HARD_CAP_TOKENS = 10_000;

const SKILLS_ROOT = '.forge/skills';

/** `list` — every real, materialized skill id under `.forge/skills/` (`forge init`'s own real write
 * target). Each top-level directory here is one real skill package. */
export async function skillList(ctx: SkillCommandContext): Promise<readonly string[]> {
  if (!(await pathExists(ctx.paths.resolveWithin(SKILLS_ROOT)))) return [];
  const entries = await listDirEntriesSorted(ctx.paths.resolveWithin(SKILLS_ROOT));
  return entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
}

/** `validate <id>` — the real skill package's own real validation outcome. */
export async function skillValidate(
  ctx: SkillCommandContext,
  id: string,
): Promise<SkillValidationOutcome> {
  const dir = ctx.paths.resolveWithin(`${SKILLS_ROOT}/${id}`);
  const skill = await parseSkillPackage(dir);
  return validateSkill(skill, { hardCapTokens: HARD_CAP_TOKENS });
}
