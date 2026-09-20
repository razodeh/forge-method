/**
 * The operate/adopt/migrate/retro/replan workflow briefs and the ten gate advisory critique briefs -- `PLAN-M13.md` P2c's own batch of `@forge/templates`' `BRIEF_INDEX`, kept in its own file so
 * concurrently-authored content batches never edit the same lines of `../index.ts`. Each entry maps a
 * content key (the reference's basename minus `.md`) to its file, relative to this package's own root:
 * `'<key>': 'templates/briefs/<key>.md'`. `../index.ts` spreads every batch into the one exported index;
 * `../../../agents/test/prompt/content-index.test.ts` proves each entry names a real, non-empty file, and
 * that no file under `templates/briefs/` is left out of the index.
 *
 * The keys of this batch (exactly these, no others):
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
export const OPS_AND_GATE_BRIEFS: Readonly<Record<string, string>> = {
  'reverse-derive-specs': 'templates/briefs/reverse-derive-specs.md',
  'adoption-gap-analysis': 'templates/briefs/adoption-gap-analysis.md',
  'plan-migration': 'templates/briefs/plan-migration.md',
  'migration-expand': 'templates/briefs/migration-expand.md',
  'migration-contract': 'templates/briefs/migration-contract.md',
  'instrument-observability': 'templates/briefs/instrument-observability.md',
  'define-slos': 'templates/briefs/define-slos.md',
  'write-runbooks': 'templates/briefs/write-runbooks.md',
  'propose-change': 'templates/briefs/propose-change.md',
  'change-impact-analysis': 'templates/briefs/change-impact-analysis.md',
  'run-retro': 'templates/briefs/run-retro.md',
  'critique-delivery-readiness': 'templates/briefs/critique-delivery-readiness.md',
  'critique-architecture': 'templates/briefs/critique-architecture.md',
  'critique-project-foundation': 'templates/briefs/critique-project-foundation.md',
  'critique-integration': 'templates/briefs/critique-integration.md',
  'critique-operational-readiness': 'templates/briefs/critique-operational-readiness.md',
  'critique-problem-framing': 'templates/briefs/critique-problem-framing.md',
  'critique-product-definition': 'templates/briefs/critique-product-definition.md',
  'critique-stage-plan': 'templates/briefs/critique-stage-plan.md',
  'critique-stabilization': 'templates/briefs/critique-stabilization.md',
  'critique-verification': 'templates/briefs/critique-verification.md',
};
