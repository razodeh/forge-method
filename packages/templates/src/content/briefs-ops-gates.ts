/**
 * The operate/adopt/migrate/retro/replan workflow briefs and the ten gate advisory critique briefs -- `PLAN-M13.md` P2c's own batch of `@forge/templates`' `BRIEF_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/briefs/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/briefs/` is left out of the index.
 *
 * Empty until P2c lands its content. Assigned to this batch (author exactly these, no others):
 *   - reverse-derive-specs
 *   - adoption-gap-analysis
 *   - plan-migration
 *   - migration-expand
 *   - migration-contract
 *   - instrument-observability
 *   - define-slos
 *   - write-runbooks
 *   - propose-change
 *   - change-impact-analysis
 *   - run-retro
 *   - critique-delivery-readiness
 *   - critique-architecture
 *   - critique-project-foundation
 *   - critique-integration
 *   - critique-operational-readiness
 *   - critique-problem-framing
 *   - critique-product-definition
 *   - critique-stage-plan
 *   - critique-stabilization
 *   - critique-verification
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P2c
 */
export const OPS_AND_GATE_BRIEFS: Readonly<Record<string, string>> = {};
