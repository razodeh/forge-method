/**
 * Types for `@forge/extensions/skills` — `15` §15.4's Skill packet.
 *
 * @see specs/15 §15.4
 * @see PLAN-M2.md P4
 */
import type { AbsolutePath } from '@forge/core';

/**
 * A parsed `SKILL.md` package — `15` §15.4.2's directory layout, read but not yet validated.
 *
 * `frontMatter` is deliberately `unknown`, not `SkillFrontMatter`: "front matter schema" is one of
 * `validateSkill`'s own checks (`15` §15.4.5's own list), so parsing a `SKILL.md` whose front matter
 * is well-formed YAML but does not match the skill shape must still succeed here and be reported by
 * `validateSkill` instead, the same "parse succeeds, schema validation is a separate, non-throwing
 * step" split `@forge/core/artifacts`'s `ArtifactDocument`/`validateArtifact` already established.
 */
export interface ParsedSkill {
  readonly dir: AbsolutePath;
  readonly skillFilePath: string;
  readonly frontMatter: unknown;
  readonly body: string;
  /** Paths relative to `references/`, sorted. Empty if the directory does not exist. */
  readonly referenceFiles: readonly string[];
  /** Paths relative to `scripts/`, sorted. Empty if the directory does not exist. */
  readonly scriptFiles: readonly string[];
}

export type SkillFindingSeverity = 'warning' | 'error';

export type SkillFindingCode =
  | 'schema'
  | 'dead-reference'
  | 'orphaned-reference-file'
  | 'over-budget'
  | 'over-hard-cap'
  | 'script-missing'
  | 'script-not-executable'
  | 'injection'
  | 'secret';

export interface SkillValidationFinding {
  readonly severity: SkillFindingSeverity;
  readonly code: SkillFindingCode;
  readonly message: string;
}

export interface SkillValidationOutcome {
  /** `false` when any finding is `error`-severity; a skill with only warnings is still valid. */
  readonly valid: boolean;
  readonly findings: readonly SkillValidationFinding[];
}

/** `15` §15.4.5: "body ≤ budget_tokens (warn) and ≤ hard cap (error)" — the hard cap has no spec
 * number (`SPEC-QUESTIONS.md` Q33), so the caller supplies it. */
export interface ValidateSkillOptions {
  readonly hardCapTokens: number;
}
