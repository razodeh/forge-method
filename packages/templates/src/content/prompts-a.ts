/**
 * Agent prompt files for agents analyst..frontend (alphabetical) -- `PLAN-M13.md` P3a's own batch of `@forge/templates`' `PROMPT_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/prompts/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/prompts/` is left out of the index.
 *
 * Empty until P3a lands its content. Assigned to this batch (author exactly these, no others):
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
export const PROMPTS_A: Readonly<Record<string, string>> = {};
