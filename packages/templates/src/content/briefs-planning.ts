/**
 * The planning-path workflow briefs -- `PLAN-M13.md` P2a's own batch of `@forge/templates`' `BRIEF_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/briefs/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/briefs/` is left out of the index.
 *
 * Assigned to this batch (exactly these, no others):
 *   - propose-level
 *   - seed-glossary
 *   - capture-constraints (PLAN-M13.md P20)
 *   - frame-problem
 *   - define-success-metrics
 *   - write-vision
 *   - write-prd
 *   - write-ux-spec
 *   - select-architecture-style
 *   - model-data
 *   - select-tech-stack
 *   - threat-model
 *   - decide-repo-strategy
 *   - scaffold-project
 *   - scaffold-ci
 *   - decompose-stages
 *   - review-stage-plan
 *   - write-epics
 *   - write-stories
 *   - write-test-plan
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P2a
 */
export const PLANNING_BRIEFS: Readonly<Record<string, string>> = {
  'propose-level': 'templates/briefs/propose-level.md',
  'seed-glossary': 'templates/briefs/seed-glossary.md',
  'capture-constraints': 'templates/briefs/capture-constraints.md',
  'frame-problem': 'templates/briefs/frame-problem.md',
  'define-success-metrics': 'templates/briefs/define-success-metrics.md',
  'write-vision': 'templates/briefs/write-vision.md',
  'write-prd': 'templates/briefs/write-prd.md',
  'write-ux-spec': 'templates/briefs/write-ux-spec.md',
  'select-architecture-style': 'templates/briefs/select-architecture-style.md',
  'model-data': 'templates/briefs/model-data.md',
  'select-tech-stack': 'templates/briefs/select-tech-stack.md',
  'threat-model': 'templates/briefs/threat-model.md',
  'decide-repo-strategy': 'templates/briefs/decide-repo-strategy.md',
  'scaffold-project': 'templates/briefs/scaffold-project.md',
  'scaffold-ci': 'templates/briefs/scaffold-ci.md',
  'decompose-stages': 'templates/briefs/decompose-stages.md',
  'review-stage-plan': 'templates/briefs/review-stage-plan.md',
  'write-epics': 'templates/briefs/write-epics.md',
  'write-stories': 'templates/briefs/write-stories.md',
  'write-test-plan': 'templates/briefs/write-test-plan.md',
};
