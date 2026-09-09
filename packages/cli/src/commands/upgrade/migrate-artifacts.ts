/**
 * `planArtifactMigrations`/`applyArtifactMigrations` — `03` §3.4 step 4: "apply schema migrations to
 * artifacts (front-matter versions bump; content transformed)," real for every spec-tree document,
 * built directly on `@forge/schemas/migrations`' own already-built `planMigrations`/`applyMigrations`
 * engine rather than a second, duplicate implementation.
 *
 * `18` §18.9's per-artifact `schemaVersion` (what this module migrates) is a distinct axis from `03`
 * §3.4's own project/manifest version (what `version.ts`'s `compareVersions` and the manifest-rebuild
 * step in `run-upgrade.ts` compare) — see `SPEC-QUESTIONS.md` for the full record of why the two are
 * not conflated.
 *
 * @see specs/03 §3.4
 * @see specs/18 §18.9
 */
import { ArtifactDocument, writeArtifact } from '@forge/core/artifacts';
import { ForgeError } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import type { ArtifactTypeId } from '@forge/schemas';
import {
  applyMigrations,
  planMigrations,
  type Migration,
  type MigrationPlan,
  type MigrationPlanFailureReason,
} from '@forge/schemas/migrations';
import * as YAML from 'yaml';

import { listSpecArtifacts } from '../shared.ts';
import type { DocumentMigrationPlan } from './types.ts';

export interface PlannedDocumentMigration {
  readonly doc: ArtifactDocument;
  readonly migrationPlan: MigrationPlan;
  readonly summary: DocumentMigrationPlan;
}

/** The highest `to` any migration in `migrations` declares for `type` — real, mechanical "the latest
 * known schema version for this type," derived from the registry itself rather than a second,
 * separately-maintained source of truth. With the real, currently-empty `MIGRATIONS` registry (`18`
 * §18.6: every type starts at `schemaVersion` `1`), this always resolves back to `current` — a real,
 * honest no-op plan for every real document today, not a fabricated target. */
function latestSchemaVersionFor(
  type: ArtifactTypeId,
  current: number,
  migrations: readonly Migration[],
): number {
  let latest = current;
  for (const migration of migrations) {
    if (migration.types.includes(type) && migration.to > latest) latest = migration.to;
  }
  return latest;
}

function describeFailure(reason: MigrationPlanFailureReason): string {
  switch (reason.kind) {
    case 'gap':
      return `no migration bridges ${reason.type} schemaVersion ${String(reason.missingFrom)}.`;
    case 'not-reversible':
      return `${reason.migration.description} is not reversible (needed to downgrade ${reason.type}).`;
    case 'reversible-without-down':
      return `${reason.migration.description} is marked reversible but defines no down().`;
    case 'irreversible-with-down':
      return `${reason.migration.description} is marked irreversible but defines a down().`;
    case 'duplicate-step':
      return `two migrations both claim ${reason.type} ${String(reason.from)} -> ${String(reason.to)}.`;
  }
}

/** Walks every real document under `specsRoot`, resolving each's own real migration plan (skipped
 * entirely — no `Migration`/`ForgeError` involved — for a document whose front matter does not carry
 * a real `type`/`schemaVersion` pair, since that is `forge spec validate`'s own concern, not this
 * step's). Throws `CFG-019` the moment any one document's own real chain cannot be resolved, rather
 * than silently skipping it and regenerating/re-doctoring over a project this step could not actually
 * finish migrating. */
export async function planArtifactMigrations(
  paths: ProjectPaths,
  specsRoot: string,
  migrations: readonly Migration[],
): Promise<readonly PlannedDocumentMigration[]> {
  const docs = await listSpecArtifacts(paths, specsRoot);
  const planned: PlannedDocumentMigration[] = [];

  for (const doc of docs) {
    // `ArtifactDocument.parse` (via `readArtifact`, inside `listSpecArtifacts`) already guarantees
    // `frontMatter` is a real YAML mapping (`CFG-007`) -- the remaining, real uncertainty is only
    // whether the two specific fields this step needs are present and correctly typed.
    const frontMatter = doc.frontMatter as Record<string, unknown>;
    const rawType = frontMatter['type'];
    const rawVersion = frontMatter['schemaVersion'];
    if (typeof rawType !== 'string' || typeof rawVersion !== 'number') continue;
    const type = rawType as ArtifactTypeId;

    const target = latestSchemaVersionFor(type, rawVersion, migrations);
    const result = planMigrations(type, rawVersion, target, migrations);
    if (!result.success) {
      throw new ForgeError('CFG-019', { path: doc.path, detail: describeFailure(result.reason) });
    }
    planned.push({
      doc,
      migrationPlan: result.plan,
      summary: {
        path: doc.path,
        type,
        fromSchemaVersion: rawVersion,
        toSchemaVersion: target,
        stepCount: result.plan.steps.length,
      },
    });
  }

  return planned;
}

function migrateOneDocument(entry: PlannedDocumentMigration): ArtifactDocument {
  const result = applyMigrations(
    {
      type: entry.summary.type,
      frontmatter: entry.doc.frontMatter as Record<string, unknown>,
      body: entry.doc.body,
    },
    entry.migrationPlan,
  );
  if (!result.success) {
    throw new ForgeError('CFG-019', {
      path: entry.doc.path,
      detail: `${result.failure.migration.description} failed: ${result.failure.cause instanceof Error ? result.failure.cause.message : String(result.failure.cause)}`,
    });
  }

  const serialized = `---\n${YAML.stringify(result.document.frontmatter)}---\n\n${result.document.body}`;
  return ArtifactDocument.parse(serialized, entry.doc.path);
}

/** Applies every real, non-empty plan `planArtifactMigrations` resolved, writing each migrated
 * document back to disk. Reconstructs each file through a fresh `ArtifactDocument.parse` (rather than
 * hand-splicing the existing document's own preserved formatting) deliberately: a migration that
 * genuinely changes structure is not the "untouched, byte-exact" case `ArtifactDocument`'s own doc
 * comment describes `set()`/`toString()` for — the migrated front matter is real, new content, and
 * `ArtifactDocument.parse` re-validates it is still well-formed before anything is written.
 *
 * Runs in two real passes, deliberately: every document is migrated *in memory* first, and only once
 * every one of them has succeeded does the second pass write any of them to disk. A critic round
 * caught the original single-pass version writing documents to disk as it went — if document 3 of 5
 * failed to migrate, documents 1-2 were left rewritten in their new schema version on disk while 3-5
 * stayed untouched, a real, worse-than-before partially-migrated state with no way back. Splitting the
 * passes means a real failure anywhere in the batch leaves every real document exactly as it was. */
export async function applyArtifactMigrations(
  paths: ProjectPaths,
  planned: readonly PlannedDocumentMigration[],
): Promise<void> {
  const toWrite: ArtifactDocument[] = [];
  for (const entry of planned) {
    if (entry.migrationPlan.steps.length === 0) continue;
    toWrite.push(migrateOneDocument(entry));
  }
  for (const migrated of toWrite) {
    await writeArtifact(paths, migrated);
  }
}
