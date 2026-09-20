/**
 * Agent prompt files for agents analyst..frontend (alphabetical) -- `PLAN-M13.md` P3a's own batch of `@forge/templates`' `PROMPT_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/prompts/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/prompts/` is left out of the index.
 *
 * The 26 keys below are this batch (`PLAN-M13.md` P3c dropped four unattachable specialisations, merged
 * data-engineer's two into one and re-keyed the rest, see `SPEC-QUESTIONS.md` Q205); each maps to a file under `templates/prompts/`:
 *   - analyst.system
 *   - analyst.frame-problem
 *   - architect.system
 *   - architect.select-architecture-style
 *   - architect.change-impact-analysis
 *   - backend.system
 *   - backend.implement-story
 *   - base-engineer.system
 *   - base-engineer.implement-story
 *   - compliance.system
 *   - critic.system
 *   - critic.critique-architecture
 *   - data-architect.system
 *   - data-architect.model-data
 *   - data-engineer.system
 *   - data-engineer.implement-story
 *   - diagnostician.system
 *   - diagnostician.run-rca-framework
 *   - domain-modeler.system
 *   - em.system
 *   - em.run-retro
 *   - facilitator.system
 *   - finops.system
 *   - frontend.system
 *   - frontend.implement-story
 *   - frontend.document-story
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P3a
 */
export const PROMPTS_A: Readonly<Record<string, string>> = {
  'analyst.system': 'templates/prompts/analyst.system.md',
  'analyst.frame-problem': 'templates/prompts/analyst.frame-problem.md',
  'architect.system': 'templates/prompts/architect.system.md',
  'architect.select-architecture-style': 'templates/prompts/architect.select-architecture-style.md',
  'architect.change-impact-analysis': 'templates/prompts/architect.change-impact-analysis.md',
  'backend.system': 'templates/prompts/backend.system.md',
  'backend.implement-story': 'templates/prompts/backend.implement-story.md',
  'base-engineer.system': 'templates/prompts/base-engineer.system.md',
  'base-engineer.implement-story': 'templates/prompts/base-engineer.implement-story.md',
  'compliance.system': 'templates/prompts/compliance.system.md',
  'critic.system': 'templates/prompts/critic.system.md',
  'critic.critique-architecture': 'templates/prompts/critic.critique-architecture.md',
  'data-architect.system': 'templates/prompts/data-architect.system.md',
  'data-architect.model-data': 'templates/prompts/data-architect.model-data.md',
  'data-engineer.system': 'templates/prompts/data-engineer.system.md',
  'data-engineer.implement-story': 'templates/prompts/data-engineer.implement-story.md',
  'diagnostician.system': 'templates/prompts/diagnostician.system.md',
  'diagnostician.run-rca-framework': 'templates/prompts/diagnostician.run-rca-framework.md',
  'domain-modeler.system': 'templates/prompts/domain-modeler.system.md',
  'em.system': 'templates/prompts/em.system.md',
  'em.run-retro': 'templates/prompts/em.run-retro.md',
  'facilitator.system': 'templates/prompts/facilitator.system.md',
  'finops.system': 'templates/prompts/finops.system.md',
  'frontend.system': 'templates/prompts/frontend.system.md',
  'frontend.implement-story': 'templates/prompts/frontend.implement-story.md',
  'frontend.document-story': 'templates/prompts/frontend.document-story.md',
};
