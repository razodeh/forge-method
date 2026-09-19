/**
 * The planning-path workflow briefs -- `PLAN-M13.md` P2a's own batch of `@forge/templates`' `BRIEF_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/briefs/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/briefs/` is left out of the index.
 *
 * Empty until P2a lands its content. Assigned to this batch (author exactly these, no others):
 *   - propose-level
 *   - seed-glossary
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
export const PLANNING_BRIEFS: Readonly<Record<string, string>> = {};
