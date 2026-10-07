/**
 * `mutationEvidence1To2` — `MutationEvidence`'s own `1→2` migration (`18` §18.9, `specs/22` M16 P5):
 * the first of this milestone's two, and the first real entry `MIGRATIONS` has ever had.
 *
 * `up` sets `schemaVersion: 2` and changes nothing else: a version-1 `revert-implementation` record is
 * otherwise already a valid version-2 record (`18` §18.7 — the new `hunkRun` field is additive and
 * optional), so there is no field to add or default.
 *
 * `down` is declared `reversible: true` for a CHANGE-level record (`mutationKind:
 * 'revert-implementation'`): it strips the version-2-only field (`hunkRun` — a `revert-implementation`
 * record never has one, so this is a no-op for it in practice, present for symmetry with
 * `evidenceBundle1To2`) and sets `schemaVersion: 1`. For a hunk-level record (`mutationKind:
 * 'revert-hunks'`) it REFUSES outright, never a silent strip or a crash: `revert-hunks` has no
 * version-1 form at all (`18` §18.7's own words), so "reverting" one is not merely lossy, it is
 * meaningless — there is no schema-1-shaped `MutationEvidence` that a hunk run could honestly become.
 * This is `process/plans/PLAN-M16.md`'s own "Left to a piece's own BUILD" item resolved: a CHANGE-
 * level record's migration is reversible; it is not uniformly so for every record the TYPE can hold.
 *
 * **The refusal is a plain `Error`, never a `ForgeError`.** `specs/02` §2.2 places `@forge/schemas` at
 * the bottom of the dependency graph with zero `@forge/*` imports (`process/SPEC-QUESTIONS.md` Q3:
 * "`@forge/schemas` never throws... leaving `@forge/core` as the only place a failure becomes a thrown
 * `ForgeError`" — `registry/paths.ts`'s own doc comment states the identical rule for
 * `renderArtifactPath`), so this module cannot import `ForgeError` to throw one itself. `up`/`down`
 * are pure (`types.ts`'s own contract: document in, document out, no FS/network/clock) — a plain throw
 * is still not a silent no-op or an uncaught crash: `applyMigrations`' own `catch` turns it into a
 * structured `MigrationStepFailure` (`{migration, cause}`), and the one REAL caller today,
 * `packages/cli/src/commands/upgrade/migrate-artifacts.ts` (already shipped, unchanged by this piece),
 * already wraps that `cause` into a real, typed `ForgeError('CFG-019', { path, detail })` whose
 * `detail` carries this plain error's own message verbatim.
 *
 * **This piece's own tests cover both halves, neither "end to end through the CLI".** The plain-
 * `Error` refusal is tested directly against `applyMigrations` (`@forge/schemas`); the real
 * `ForgeError('CFG-019', ...)` wrapping is tested by feeding a HAND-BUILT `PlannedDocumentMigration`
 * (`direction: 'down'`, this migration as its one step) straight to the already-shipped
 * `applyArtifactMigrations` (`@forge/cli`, `migrate-artifacts.test.ts`). It is hand-built on purpose,
 * never produced by `planArtifactMigrations` itself: that function's own `latestSchemaVersionFor`
 * only ever RAISES its running target (`if (migration.to > latest) latest = migration.to`), so the
 * version `planMigrations` is asked to reach is always `>= current`, which only ever resolves a
 * `direction: 'up'` plan or a no-op — there is no code path through the real `forge upgrade` CLI,
 * today or previously, that can ever request `direction: 'down'` for ANY registered type (confirmed
 * by reading `latestSchemaVersionFor`, a round-2 critic's own finding, not assumed). "End to end
 * through `migrate-artifacts.ts`'s own CLI pathway" was therefore never an achievable test for this
 * refusal — only a direct call to `applyArtifactMigrations` with a hand-built plan can reach it, which
 * is exactly what the test above does.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7, §18.9
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-10
 * @see process/plans/PLAN-M16.md P5
 * @see process/SPEC-QUESTIONS.md Q3, Q294 Decision 8, Decision 10
 */
import type { Migration, MigratableDocument } from './types.ts';

function up(doc: MigratableDocument): MigratableDocument {
  return { ...doc, frontmatter: { ...doc.frontmatter, schemaVersion: 2 } };
}

function down(doc: MigratableDocument): MigratableDocument {
  if (doc.frontmatter['mutationKind'] === 'revert-hunks') {
    const id = typeof doc.frontmatter['id'] === 'string' ? doc.frontmatter['id'] : '(unknown id)';
    throw new Error(
      `MutationEvidence ${id} cannot be migrated down to schemaVersion 1: its mutationKind is ` +
        '"revert-hunks", which has no version-1 form.',
    );
  }
  const withoutHunkRun = Object.fromEntries(
    Object.entries(doc.frontmatter).filter(([key]) => key !== 'hunkRun'),
  );
  return { ...doc, frontmatter: { ...withoutHunkRun, schemaVersion: 1 } };
}

export const mutationEvidence1To2: Migration = {
  from: 1,
  to: 2,
  types: ['MutationEvidence'],
  description:
    'Add the optional hunk-level (revert-hunks) shape to MutationEvidence (specs/22 M16 P5, 13 F-TEST-10).',
  reversible: true,
  up,
  down,
};
