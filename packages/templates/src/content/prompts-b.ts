/**
 * Agent prompt files for agents integration-architect..ux (alphabetical) -- `PLAN-M13.md` P3b's own batch of `@forge/templates`' `PROMPT_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/prompts/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/prompts/` is left out of the index.
 *
 * Empty until P3b lands its content. Assigned to this batch (author exactly these, no others):
 *   - integration-architect.system
 *   - integration-architect.design-integration
 *   - ml-engineer.system
 *   - ml-engineer.integrate-model
 *   - mobile.system
 *   - mobile.implement-story
 *   - mobile.prepare-release-build
 *   - orchestrator.system
 *   - orchestrator.schedule-run
 *   - platform.system
 *   - platform.initialize-project
 *   - pm.system
 *   - pm.define-product
 *   - po.system
 *   - po.write-stories
 *   - release.system
 *   - release.write-release-notes
 *   - reviewer.system
 *   - reviewer.swarm-review
 *   - sdet.system
 *   - sdet.write-failing-tests
 *   - security.system
 *   - security.threat-model
 *   - sre.system
 *   - sre.design-delivery
 *   - techwriter.system
 *   - techwriter.write-docs
 *   - test-architect.system
 *   - test-architect.plan-testing
 *   - ux.system
 *   - ux.design-flows
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P3b
 */
export const PROMPTS_B: Readonly<Record<string, string>> = {};
