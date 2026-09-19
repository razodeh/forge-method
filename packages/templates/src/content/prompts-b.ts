/**
 * Agent prompt files for agents integration-architect..ux (alphabetical) -- `PLAN-M13.md` P3b's own batch of `@forge/templates`' `PROMPT_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/prompts/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/prompts/` is left out of the index.
 *
 * Assigned to this batch (exactly these, no others):
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
export const PROMPTS_B: Readonly<Record<string, string>> = {
  'integration-architect.system': 'templates/prompts/integration-architect.system.md',
  'integration-architect.design-integration':
    'templates/prompts/integration-architect.design-integration.md',
  'ml-engineer.system': 'templates/prompts/ml-engineer.system.md',
  'ml-engineer.integrate-model': 'templates/prompts/ml-engineer.integrate-model.md',
  'mobile.system': 'templates/prompts/mobile.system.md',
  'mobile.implement-story': 'templates/prompts/mobile.implement-story.md',
  'mobile.prepare-release-build': 'templates/prompts/mobile.prepare-release-build.md',
  'orchestrator.system': 'templates/prompts/orchestrator.system.md',
  'orchestrator.schedule-run': 'templates/prompts/orchestrator.schedule-run.md',
  'platform.system': 'templates/prompts/platform.system.md',
  'platform.initialize-project': 'templates/prompts/platform.initialize-project.md',
  'pm.system': 'templates/prompts/pm.system.md',
  'pm.define-product': 'templates/prompts/pm.define-product.md',
  'po.system': 'templates/prompts/po.system.md',
  'po.write-stories': 'templates/prompts/po.write-stories.md',
  'release.system': 'templates/prompts/release.system.md',
  'release.write-release-notes': 'templates/prompts/release.write-release-notes.md',
  'reviewer.system': 'templates/prompts/reviewer.system.md',
  'reviewer.swarm-review': 'templates/prompts/reviewer.swarm-review.md',
  'sdet.system': 'templates/prompts/sdet.system.md',
  'sdet.write-failing-tests': 'templates/prompts/sdet.write-failing-tests.md',
  'security.system': 'templates/prompts/security.system.md',
  'security.threat-model': 'templates/prompts/security.threat-model.md',
  'sre.system': 'templates/prompts/sre.system.md',
  'sre.design-delivery': 'templates/prompts/sre.design-delivery.md',
  'techwriter.system': 'templates/prompts/techwriter.system.md',
  'techwriter.write-docs': 'templates/prompts/techwriter.write-docs.md',
  'test-architect.system': 'templates/prompts/test-architect.system.md',
  'test-architect.plan-testing': 'templates/prompts/test-architect.plan-testing.md',
  'ux.system': 'templates/prompts/ux.system.md',
  'ux.design-flows': 'templates/prompts/ux.design-flows.md',
};
