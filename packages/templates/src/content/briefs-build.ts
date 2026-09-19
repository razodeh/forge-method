/**
 * The build/verify/deliver-path workflow briefs (plus the fm-service/fm-mobile module workflows' briefs) -- `PLAN-M13.md` P2b's own batch of `@forge/templates`' `BRIEF_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/briefs/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/briefs/` is left out of the index.
 *
 * Empty until P2b lands its content. Assigned to this batch (author exactly these, no others):
 *   - freeze-contracts
 *   - write-failing-tests
 *   - implement-story
 *   - rca
 *   - stage-retro
 *   - plan-story
 *   - refactor-story
 *   - document-story
 *   - reproduce-defect
 *   - fix-defect
 *   - verify-nfrs
 *   - design-cicd-pipeline
 *   - design-deployment-strategy
 *   - run-rca-framework
 *   - state-refactor-invariants
 *   - refactor
 *   - security-hardening-pass
 *   - performance-hardening-pass
 *   - prepare-release-build
 *   - prepare-store-submission
 *   - draft-contract
 *   - write-contract-tests
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P2b
 */
export const BUILD_BRIEFS: Readonly<Record<string, string>> = {};
