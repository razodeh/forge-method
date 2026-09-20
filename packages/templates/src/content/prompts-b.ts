/**
 * Agent prompt files for agents integration-architect..ux (alphabetical) -- `PLAN-M13.md` P3b's own batch of `@forge/templates`' `PROMPT_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/prompts/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/prompts/` is left out of the index.
 *
 * Assigned to this batch (exactly these, no others; `PLAN-M13.md` P3c re-keyed, split or dropped the
 * specialisations that could never attach, see `SPEC-QUESTIONS.md` Q205):
 *   - integration-architect.system
 *   - integration-architect.draft-contract
 *   - ml-engineer.system
 *   - ml-engineer.implement-story
 *   - mobile.system
 *   - mobile.implement-story
 *   - mobile.prepare-release-build
 *   - orchestrator.system
 *   - platform.system
 *   - platform.decide-repo-strategy
 *   - platform.scaffold-project
 *   - pm.system
 *   - pm.write-vision
 *   - pm.decompose-stages
 *   - po.system
 *   - po.write-stories
 *   - release.system
 *   - release.prepare-store-submission
 *   - reviewer.system
 *   - reviewer.swarm-review
 *   - sdet.system
 *   - sdet.write-failing-tests
 *   - security.system
 *   - security.threat-model
 *   - sre.system
 *   - sre.design-cicd-pipeline
 *   - sre.design-deployment-strategy
 *   - techwriter.system
 *   - test-architect.system
 *   - test-architect.write-test-plan
 *   - ux.system
 *   - ux.write-ux-spec
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P3b
 */
export const PROMPTS_B: Readonly<Record<string, string>> = {
  'integration-architect.system': 'templates/prompts/integration-architect.system.md',
  'integration-architect.draft-contract':
    'templates/prompts/integration-architect.draft-contract.md',
  'ml-engineer.system': 'templates/prompts/ml-engineer.system.md',
  'ml-engineer.implement-story': 'templates/prompts/ml-engineer.implement-story.md',
  'mobile.system': 'templates/prompts/mobile.system.md',
  'mobile.implement-story': 'templates/prompts/mobile.implement-story.md',
  'mobile.prepare-release-build': 'templates/prompts/mobile.prepare-release-build.md',
  'orchestrator.system': 'templates/prompts/orchestrator.system.md',
  'platform.system': 'templates/prompts/platform.system.md',
  'platform.decide-repo-strategy': 'templates/prompts/platform.decide-repo-strategy.md',
  'platform.scaffold-project': 'templates/prompts/platform.scaffold-project.md',
  'pm.system': 'templates/prompts/pm.system.md',
  'pm.write-vision': 'templates/prompts/pm.write-vision.md',
  'pm.decompose-stages': 'templates/prompts/pm.decompose-stages.md',
  'po.system': 'templates/prompts/po.system.md',
  'po.write-stories': 'templates/prompts/po.write-stories.md',
  'release.system': 'templates/prompts/release.system.md',
  'release.prepare-store-submission': 'templates/prompts/release.prepare-store-submission.md',
  'reviewer.system': 'templates/prompts/reviewer.system.md',
  'reviewer.swarm-review': 'templates/prompts/reviewer.swarm-review.md',
  'sdet.system': 'templates/prompts/sdet.system.md',
  'sdet.write-failing-tests': 'templates/prompts/sdet.write-failing-tests.md',
  'security.system': 'templates/prompts/security.system.md',
  'security.threat-model': 'templates/prompts/security.threat-model.md',
  'sre.system': 'templates/prompts/sre.system.md',
  'sre.design-cicd-pipeline': 'templates/prompts/sre.design-cicd-pipeline.md',
  'sre.design-deployment-strategy': 'templates/prompts/sre.design-deployment-strategy.md',
  'techwriter.system': 'templates/prompts/techwriter.system.md',
  'test-architect.system': 'templates/prompts/test-architect.system.md',
  'test-architect.write-test-plan': 'templates/prompts/test-architect.write-test-plan.md',
  'ux.system': 'templates/prompts/ux.system.md',
  'ux.write-ux-spec': 'templates/prompts/ux.write-ux-spec.md',
};
