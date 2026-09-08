/**
 * `CatalogRegistry` — `PLAN-M6.md` C1's own Checks section.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */
import { describe, expect, it } from 'vitest';

import { loadCatalogEntry } from '../../src/schema/load.ts';
import { CatalogRegistry } from '../../src/registry/registry.ts';
import { POSTGRESQL } from '../fixtures/postgresql.ts';

function loadEntry(source: string) {
  const result = loadCatalogEntry(source, 'x.entry.yaml');
  if (!result.success) throw new Error('fixture entry failed to load');
  return result.entry;
}

describe('CatalogRegistry', () => {
  it('get() finds an entry by (kind, id)', () => {
    const registry = new CatalogRegistry([loadEntry(POSTGRESQL)]);
    expect(registry.get('datastore', 'postgresql')?.name).toBe('PostgreSQL');
  });

  it('get() returns undefined for a real id under the wrong kind', () => {
    const registry = new CatalogRegistry([loadEntry(POSTGRESQL)]);
    expect(registry.get('framework', 'postgresql')).toBeUndefined();
  });

  it('hasId() finds an entry by id alone, regardless of kind', () => {
    const registry = new CatalogRegistry([loadEntry(POSTGRESQL)]);
    expect(registry.hasId('postgresql')).toBe(true);
    expect(registry.hasId('not-a-real-id')).toBe(false);
  });

  it('byKind() returns every entry of that kind, no more, no fewer', () => {
    const mysql = loadEntry(
      POSTGRESQL.replace('id: postgresql', 'id: mysql').replace('name: PostgreSQL', 'name: MySQL'),
    );
    const registry = new CatalogRegistry([loadEntry(POSTGRESQL), mysql]);
    expect(
      registry
        .byKind('datastore')
        .map((e) => e.id)
        .sort(),
    ).toEqual(['mysql', 'postgresql']);
    expect(registry.byKind('language')).toEqual([]);
  });

  it('all() returns every entry across every kind', () => {
    const registry = new CatalogRegistry([loadEntry(POSTGRESQL)]);
    expect(registry.all()).toHaveLength(1);
  });

  it('add() with a repeated (kind, id) replaces the earlier entry', () => {
    const registry = new CatalogRegistry([loadEntry(POSTGRESQL)]);
    const updated = loadEntry(POSTGRESQL.replace('name: PostgreSQL', 'name: PostgreSQL (updated)'));
    registry.add(updated);
    expect(registry.all()).toHaveLength(1);
    expect(registry.get('datastore', 'postgresql')?.name).toBe('PostgreSQL (updated)');
  });
});
