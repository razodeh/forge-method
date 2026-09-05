/**
 * `planMigrations` — resolves an ordered chain of migrations between two `schemaVersion`s, or fails.
 *
 * Returns a typed result rather than throwing or returning a bare array, per `SPEC-QUESTIONS.md` Q27
 * (the same `schemas ← (no forge deps)` tension Q3 resolves for `ForgeError`, recurring here). The
 * `migrations` parameter defaults to the real `MIGRATIONS` registry, which is empty at M1 (`18` §18.6:
 * every type's `schemaVersion` starts at `1`) — passing a fixture array is how this piece's own tests
 * exercise chain resolution before any real migration exists.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 * @see SPEC-QUESTIONS.md Q27
 */
import type { ArtifactTypeId } from '../registry/artifact-types.ts';
import { MIGRATIONS, validateMigrationRegistry } from './registry.ts';
import type { Migration, PlanMigrationsResult } from './types.ts';

/**
 * `fromVersion === toVersion` resolves to an empty, direction-`'up'` plan — applying it is a no-op,
 * not an error, since a document already at its target version needs no migration.
 *
 * Only migrations naming `type` in their `types` are considered, so a chain gap for an unrelated type
 * cannot block this one. Each step must bridge exactly one version (`to === from + 1`), matching `18`
 * §18.9's one-file-per-increment convention (`003-story-add-dod-profile.ts`, ...).
 */
export function planMigrations(
  type: ArtifactTypeId,
  fromVersion: number,
  toVersion: number,
  migrations: readonly Migration[] = MIGRATIONS,
): PlanMigrationsResult {
  const registryCheck = validateMigrationRegistry(migrations);
  if (!registryCheck.success) return { success: false, reason: registryCheck.reason };

  if (fromVersion === toVersion) {
    return { success: true, plan: { direction: 'up', steps: [] } };
  }

  const relevant = migrations.filter((migration) => migration.types.includes(type));

  if (toVersion > fromVersion) {
    return planUp(type, fromVersion, toVersion, relevant);
  }
  return planDown(type, fromVersion, toVersion, relevant);
}

function planUp(
  type: ArtifactTypeId,
  fromVersion: number,
  toVersion: number,
  relevant: readonly Migration[],
): PlanMigrationsResult {
  const steps: Migration[] = [];
  for (let version = fromVersion; version < toVersion; version++) {
    const step = relevant.find(
      (migration) => migration.from === version && migration.to === version + 1,
    );
    if (step === undefined) {
      return { success: false, reason: { kind: 'gap', type, missingFrom: version } };
    }
    steps.push(step);
  }
  return { success: true, plan: { direction: 'up', steps } };
}

/**
 * Walks from `fromVersion` down to `toVersion`, one version at a time, requiring the forward
 * migration that produced each version to be reversible. `steps` comes out already in the order
 * `applyMigrations` should run them — highest version's undo first — so it never needs to know which
 * direction produced the plan.
 */
function planDown(
  type: ArtifactTypeId,
  fromVersion: number,
  toVersion: number,
  relevant: readonly Migration[],
): PlanMigrationsResult {
  const steps: Migration[] = [];
  for (let version = fromVersion; version > toVersion; version--) {
    const step = relevant.find(
      (migration) => migration.from === version - 1 && migration.to === version,
    );
    if (step === undefined) {
      return { success: false, reason: { kind: 'gap', type, missingFrom: version - 1 } };
    }
    if (!step.reversible || step.down === undefined) {
      return { success: false, reason: { kind: 'not-reversible', type, migration: step } };
    }
    steps.push(step);
  }
  return { success: true, plan: { direction: 'down', steps } };
}
