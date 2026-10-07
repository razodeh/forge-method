/**
 * `evidenceBundle1To2` — `EvidenceBundle`'s own `1→2` migration (`18` §18.9, `specs/22` M16 P5): the
 * second of this milestone's two migrations.
 *
 * `up` sets `schemaVersion: 2` and changes nothing else: a version-1 bundle (no `parityEvidence`) is
 * otherwise already a valid version-2 bundle (`18` §18.7: the field is optional even at version 2).
 *
 * `down` strips `parityEvidence` (when present) and sets `schemaVersion: 1`. Always reversible, unlike
 * `mutationEvidence1To2`: `EvidenceBundle` has no hunk-level counterpart (`process/SPEC-QUESTIONS.md`
 * Q294 Decision 10: "the bundle contains no hunk-level markers") — every `EvidenceBundle` a version-2
 * bundle could be is already a version-1 bundle once its one new, optional field is removed, so there
 * is no record shape this migration could be asked to revert that has no version-1 form, the way a
 * hunk-level `MutationEvidence` record does.
 *
 * Pure (`types.ts`'s own contract). This module throws nothing: there is no refusal case, so, unlike
 * `mutationEvidence1To2`, the `@forge/schemas` zero-`@forge/*`-imports boundary (`process/
 * SPEC-QUESTIONS.md` Q3) never comes up here.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7, §18.9
 * @see process/plans/PLAN-M16.md P5
 * @see process/SPEC-QUESTIONS.md Q294 Decision 10
 */
import type { Migration, MigratableDocument } from './types.ts';

function up(doc: MigratableDocument): MigratableDocument {
  return { ...doc, frontmatter: { ...doc.frontmatter, schemaVersion: 2 } };
}

function down(doc: MigratableDocument): MigratableDocument {
  const withoutParityEvidence = Object.fromEntries(
    Object.entries(doc.frontmatter).filter(([key]) => key !== 'parityEvidence'),
  );
  return { ...doc, frontmatter: { ...withoutParityEvidence, schemaVersion: 1 } };
}

export const evidenceBundle1To2: Migration = {
  from: 1,
  to: 2,
  types: ['EvidenceBundle'],
  description:
    'Add the optional parityEvidence id list to EvidenceBundle (specs/22 M16 P5, 18 §18.7).',
  reversible: true,
  up,
  down,
};
