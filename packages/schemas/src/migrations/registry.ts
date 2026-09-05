/**
 * `MIGRATIONS`, `validateMigrationRegistry` — the real migration set and its registration rule.
 *
 * `MIGRATIONS` is empty at M1: `18` §18.6's `schemaVersion` starts at `1` for every type, so there is
 * nothing yet to migrate from. This piece delivers the runner and its own tests, per `PLAN-M1.md` P10.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 */
import type { ArtifactTypeId } from '../registry/artifact-types.ts';
import type {
  Migration,
  MigrationRegistryFailureReason,
  ValidateMigrationRegistryResult,
} from './types.ts';

/** The real, committed migration chain. Empty at M1 — see this file's doc comment. */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Refuses a malformed migration registry — "at registration" per `PLAN-M1.md` P10's Check, i.e.
 * independent of any particular `planMigrations` query, so a malformed entry is caught even for a
 * version range nothing currently requests. Two independent rules, checked in this order:
 *
 * 1. A migration's `reversible` flag must agree with whether it defines `down`.
 * 2. No two migrations may claim to bridge the same version, for the same type — `planUp`/`planDown`
 *    resolve a step with `Array.prototype.find`, so a second migration claiming an already-claimed
 *    `(type, from, to)` would silently never be reachable rather than being reported as the
 *    copy-paste or merge mistake it almost certainly is.
 *
 * Stops at the first violation found: `planMigrations` calls this once per resolution and only needs
 * to know *whether* the registry is valid.
 */
export function validateMigrationRegistry(
  migrations: readonly Migration[],
): ValidateMigrationRegistryResult {
  for (const migration of migrations) {
    const reason = registrationFailure(migration);
    if (reason !== undefined) return { success: false, reason };
  }

  const duplicate = findDuplicateStep(migrations);
  if (duplicate !== undefined) return { success: false, reason: duplicate };

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

function findDuplicateStep(
  migrations: readonly Migration[],
): MigrationRegistryFailureReason | undefined {
  const claimed = new Map<string, Migration>();
  for (const migration of migrations) {
    for (const type of migration.types) {
      const key = stepKey(type, migration.from, migration.to);
      const first = claimed.get(key);
      if (first !== undefined) {
        return {
          kind: 'duplicate-step',
          type,
          from: migration.from,
          to: migration.to,
          first,
          second: migration,
        };
      }
      claimed.set(key, migration);
    }
  }
  return undefined;
}

function stepKey(type: ArtifactTypeId, from: number, to: number): string {
  return `${type}:${String(from)}->${String(to)}`;
}
