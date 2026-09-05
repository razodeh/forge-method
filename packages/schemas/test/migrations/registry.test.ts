/**
 * `MIGRATIONS`, `validateMigrationRegistry`.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 */
import { describe, expect, it } from 'vitest';

import { MIGRATIONS, validateMigrationRegistry } from '../../src/migrations/registry.ts';
import type { Migration } from '../../src/migrations/types.ts';

const reversibleWithDown: Migration = {
  from: 1,
  to: 2,
  types: ['ADR'],
  description: 'reversible, with down',
  reversible: true,
  up: (doc) => doc,
  down: (doc) => doc,
};

const irreversibleWithoutDown: Migration = {
  from: 1,
  to: 2,
  types: ['ADR'],
  description: 'irreversible, without down',
  reversible: false,
  up: (doc) => doc,
};

describe('MIGRATIONS', () => {
  it('is empty at M1 — every artifact type starts at schemaVersion 1', () => {
    expect(MIGRATIONS).toEqual([]);
  });
});

describe('validateMigrationRegistry', () => {
  it('accepts an empty registry', () => {
    expect(validateMigrationRegistry([])).toEqual({ success: true });
  });

  it('accepts a reversible migration that defines down, and an irreversible one that does not', () => {
    expect(validateMigrationRegistry([reversibleWithDown, irreversibleWithoutDown])).toEqual({
      success: true,
    });
  });

  it('refuses a reversible: true migration with no down', () => {
    // Built from `irreversibleWithoutDown` (which already omits `down`) rather than spreading
    // `reversibleWithDown` with `down: undefined` — `exactOptionalPropertyTypes` treats an explicit
    // `undefined` as distinct from an absent optional property.
    const reversibleWithoutDown: Migration = { ...irreversibleWithoutDown, reversible: true };
    const result = validateMigrationRegistry([reversibleWithoutDown]);
    expect(result).toEqual({
      success: false,
      reason: { kind: 'reversible-without-down', migration: reversibleWithoutDown },
    });
  });

  it('refuses a reversible: false migration that defines down', () => {
    const irreversibleWithDown: Migration = { ...irreversibleWithoutDown, down: (doc) => doc };
    const result = validateMigrationRegistry([irreversibleWithDown]);
    expect(result).toEqual({
      success: false,
      reason: { kind: 'irreversible-with-down', migration: irreversibleWithDown },
    });
  });

  it('reports the first violation when several migrations are malformed', () => {
    const badFirst: Migration = { ...irreversibleWithoutDown, reversible: true };
    const badSecond: Migration = { ...irreversibleWithoutDown, down: (doc) => doc };
    const result = validateMigrationRegistry([badFirst, badSecond]);
    expect(result).toEqual({
      success: false,
      reason: { kind: 'reversible-without-down', migration: badFirst },
    });
  });
});
