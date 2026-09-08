/**
 * `AgentContextPack`, `SkillPackEntry` — `05` §5.4's context pack, extended with the skill-body
 * inclusion `@forge/kb/pack`'s own `ContextPack` (M3) has no field for (that package cannot depend on
 * `@forge/extensions/skills`, the package graph runs the other way — `agents ← kb, extensions` per `02`
 * §2.2's own boundary graph). Wraps `ContextPack` rather than modifying it: this piece's own real work
 * is the skill layer, not a redesign of the already-gauntlet-passed pinned-core/declared-inputs/
 * retrieved layers M3 already built.
 *
 * @see specs/05 §5.4
 * @see specs/15 §15.4.3
 * @see PLAN-M6.md A4
 */
import type { ContextPack } from '@forge/kb/pack';

/**
 * One attached skill's own contribution to a step's context. `description`/`whenToUse` (`15` §15.4.2's
 * own front-matter fields) are always included -- "cheap, ~40 tokens each" (`15` §15.4.3 point 2). The
 * body is included only when `bodyIncluded` is `true`; `demoted` distinguishes "never included" (an
 * `activation: explicit` skill whose applicability was never established) from "would have been
 * included, but this specific pack ran out of budget" -- `15` §15.4.3 point 3's own "the demotion is
 * logged, never silent" requirement needs the second case to be a real, inspectable fact about this
 * pack, not indistinguishable from a skill that was never in scope at all.
 */
export interface SkillPackEntry {
  readonly id: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly bodyIncluded: boolean;
  readonly body?: string | undefined;
  readonly demoted: boolean;
}

export interface AgentContextPack extends ContextPack {
  readonly skills: readonly SkillPackEntry[];
}
