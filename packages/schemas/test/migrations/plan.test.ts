/**
 * `planMigrations`.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 */
import { describe, expect, it } from 'vitest';

import { planMigrations } from '../../src/migrations/plan.ts';
import type { Migration } from '../../src/migrations/types.ts';

const adr1to2: Migration = {
  from: 1,
  to: 2,
  types: ['ADR'],
  description: 'ADR 1 to 2',
  reversible: true,
  up: (doc) => doc,
  down: (doc) => doc,
};

const adr2to3: Migration = {
  from: 2,
  to: 3,
  types: ['ADR'],
  description: 'ADR 2 to 3',
  reversible: true,
  up: (doc) => doc,
  down: (doc) => doc,
};

const adr3to4Irreversible: Migration = {
  from: 3,
  to: 4,
  types: ['ADR'],
  description: 'ADR 3 to 4, irreversible',
  reversible: false,
  up: (doc) => doc,
};

const story1to2: Migration = {
  from: 1,
  to: 2,
  types: ['Story'],
  description: 'Story 1 to 2',
  reversible: true,
  up: (doc) => doc,
  down: (doc) => doc,
};

const chain = [adr1to2, adr2to3, adr3to4Irreversible, story1to2];

describe('planMigrations', () => {
  it('resolves an empty, up-direction plan when fromVersion equals toVersion', () => {
    const result = planMigrations('ADR', 2, 2, chain);
    expect(result).toEqual({ success: true, plan: { direction: 'up', steps: [] } });
  });

  it('resolves a chain spanning multiple versions, in order', () => {
    const result = planMigrations('ADR', 1, 3, chain);
    expect(result).toEqual({
      success: true,
      plan: { direction: 'up', steps: [adr1to2, adr2to3] },
    });
  });

  it('only considers migrations registered for the queried type', () => {
    const result = planMigrations('Story', 1, 2, chain);
    expect(result).toEqual({ success: true, plan: { direction: 'up', steps: [story1to2] } });
  });

  it('refuses a chain with a gap, naming the missing step', () => {
    const gappy = [adr1to2]; // no migration from 2 to 3
    const result = planMigrations('ADR', 1, 3, gappy);
    expect(result).toEqual({
      success: false,
      reason: { kind: 'gap', type: 'ADR', missingFrom: 2 },
    });
  });

  it('refuses a query for a type with no registered migrations at all', () => {
    const result = planMigrations('ADR', 1, 2, [story1to2]);
    expect(result).toEqual({
      success: false,
      reason: { kind: 'gap', type: 'ADR', missingFrom: 1 },
    });
  });

  it('resolves a down-direction chain in reverse-application order', () => {
    const result = planMigrations('ADR', 3, 1, chain);
    expect(result).toEqual({
      success: true,
      plan: { direction: 'down', steps: [adr2to3, adr1to2] },
    });
  });

  it('refuses a down-direction chain with a gap, naming the missing step', () => {
    const result = planMigrations('ADR', 3, 1, [adr2to3]); // no migration from 1 to 2
    expect(result).toEqual({
      success: false,
      reason: { kind: 'gap', type: 'ADR', missingFrom: 1 },
    });
  });

  it('refuses a down-direction chain through an irreversible migration', () => {
    const result = planMigrations('ADR', 4, 3, chain);
    expect(result).toEqual({
      success: false,
      reason: { kind: 'not-reversible', type: 'ADR', migration: adr3to4Irreversible },
    });
  });

  it('propagates a registration failure before attempting to resolve any chain', () => {
    // Built from `adr3to4Irreversible` (which already omits `down`) rather than spreading a
    // `down`-defining migration with `down: undefined` — `exactOptionalPropertyTypes` treats an
    // explicit `undefined` as distinct from an absent optional property.
    const malformed: Migration = { ...adr3to4Irreversible, reversible: true };
    const result = planMigrations('ADR', 1, 2, [malformed]);
    expect(result).toEqual({
      success: false,
      reason: { kind: 'reversible-without-down', migration: malformed },
    });
  });

  it('defaults to the real MIGRATIONS registry, which is empty', () => {
    const result = planMigrations('ADR', 1, 2);
    expect(result).toEqual({
      success: false,
      reason: { kind: 'gap', type: 'ADR', missingFrom: 1 },
    });
  });
});
