/**
 * Agent prompt files for agents analyst..frontend (alphabetical) -- `PLAN-M13.md` P3a's own batch of `@forge/templates`' `PROMPT_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/prompts/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/prompts/` is left out of the index.
 *
 * The 31 keys below are this batch; each maps to a file under `templates/prompts/`:
 *   - analyst.system
 *   - analyst.discovery
 *   - architect.system
 *   - architect.design-system
 *   - architect.review-change
 *   - backend.system
 *   - backend.implement-story
 *   - base-engineer.system
 *   - base-engineer.implement-story
 *   - compliance.system
 *   - compliance.map-compliance
 *   - critic.system
 *   - critic.critique-architecture
 *   - data-architect.system
 *   - data-architect.design-data-model
 *   - data-engineer.system
 *   - data-engineer.implement-pipeline
 *   - data-engineer.model-warehouse
 *   - diagnostician.system
 *   - diagnostician.run-rca-framework
 *   - domain-modeler.system
 *   - domain-modeler.model-domain
 *   - em.system
 *   - em.run-retro
 *   - facilitator.system
 *   - facilitator.run-session
 *   - finops.system
 *   - finops.model-cost
 *   - frontend.system
 *   - frontend.implement-story
 *   - frontend.component-spec
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P3a
 */
export const PROMPTS_A: Readonly<Record<string, string>> = {
  'analyst.system': 'templates/prompts/analyst.system.md',
  'analyst.discovery': 'templates/prompts/analyst.discovery.md',
  'architect.system': 'templates/prompts/architect.system.md',
  'architect.design-system': 'templates/prompts/architect.design-system.md',
  'architect.review-change': 'templates/prompts/architect.review-change.md',
  'backend.system': 'templates/prompts/backend.system.md',
  'backend.implement-story': 'templates/prompts/backend.implement-story.md',
  'base-engineer.system': 'templates/prompts/base-engineer.system.md',
  'base-engineer.implement-story': 'templates/prompts/base-engineer.implement-story.md',
  'compliance.system': 'templates/prompts/compliance.system.md',
  'compliance.map-compliance': 'templates/prompts/compliance.map-compliance.md',
  'critic.system': 'templates/prompts/critic.system.md',
  'critic.critique-architecture': 'templates/prompts/critic.critique-architecture.md',
  'data-architect.system': 'templates/prompts/data-architect.system.md',
  'data-architect.design-data-model': 'templates/prompts/data-architect.design-data-model.md',
  'data-engineer.system': 'templates/prompts/data-engineer.system.md',
  'data-engineer.implement-pipeline': 'templates/prompts/data-engineer.implement-pipeline.md',
  'data-engineer.model-warehouse': 'templates/prompts/data-engineer.model-warehouse.md',
  'diagnostician.system': 'templates/prompts/diagnostician.system.md',
  'diagnostician.run-rca-framework': 'templates/prompts/diagnostician.run-rca-framework.md',
  'domain-modeler.system': 'templates/prompts/domain-modeler.system.md',
  'domain-modeler.model-domain': 'templates/prompts/domain-modeler.model-domain.md',
  'em.system': 'templates/prompts/em.system.md',
  'em.run-retro': 'templates/prompts/em.run-retro.md',
  'facilitator.system': 'templates/prompts/facilitator.system.md',
  'facilitator.run-session': 'templates/prompts/facilitator.run-session.md',
  'finops.system': 'templates/prompts/finops.system.md',
  'finops.model-cost': 'templates/prompts/finops.model-cost.md',
  'frontend.system': 'templates/prompts/frontend.system.md',
  'frontend.implement-story': 'templates/prompts/frontend.implement-story.md',
  'frontend.component-spec': 'templates/prompts/frontend.component-spec.md',
};
