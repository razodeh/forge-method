/**
 * `MIGRATIONS`, `validateMigrationRegistry` — the real migration set and its registration rule.
 *
 * `MIGRATIONS` is empty at M1: `18` §18.6's `schemaVersion` starts at `1` for every type, so there is
 * nothing yet to migrate from. This piece delivers the runner and its own tests, per `PLAN-M1.md` P10.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 */
import type {
  Migration,
  MigrationRegistryFailureReason,
  ValidateMigrationRegistryResult,
} from './types.ts';

/** The real, committed migration chain. Empty at M1 — see this file's doc comment. */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Refuses a migration whose `reversible` flag disagrees with whether it defines `down` — "at
 * registration" per `PLAN-M1.md` P10's Check, i.e. independent of any particular `planMigrations`
 * query, so a malformed entry is caught even for a version range nothing currently requests.
 *
 * Checks every entry rather than stopping at the first failure: `planMigrations` calls this once per
 * resolution and only needs to know *whether* the registry is valid, so the first violation found is
 * enough to report.
 */
export function validateMigrationRegistry(
  migrations: readonly Migration[],
): ValidateMigrationRegistryResult {
  for (const migration of migrations) {
    const reason = registrationFailure(migration);
    if (reason !== undefined) return { success: false, reason };
  }
  return { success: true };
}

function registrationFailure(migration: Migration): MigrationRegistryFailureReason | undefined {
  const hasDown = migration.down !== undefined;
  if (migration.reversible && !hasDown) {
    return { kind: 'reversible-without-down', migration };
  }
  if (!migration.reversible && hasDown) {
    return { kind: 'irreversible-with-down', migration };
  }
  return undefined;
}
