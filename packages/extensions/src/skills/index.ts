/**
 * `@forge/extensions/skills` — Skill packet parsing and validation, per `15` §15.4.
 *
 * @see specs/15 §15.4
 * @see PLAN-M2.md P4
 */
export { INJECTION_PATTERNS, SECRET_PATTERNS } from './patterns.ts';
export { parseSkillPackage } from './parse.ts';
export {
  skillFrontMatterSchema,
  type SkillFrontMatter,
  type SkillProvidedCheck,
  type SkillScript,
} from './schema.ts';
export {
  type ParsedSkill,
  type SkillFindingCode,
  type SkillFindingSeverity,
  type SkillValidationFinding,
  type SkillValidationOutcome,
  type ValidateSkillOptions,
} from './types.ts';
export { validateSkill } from './validate.ts';
