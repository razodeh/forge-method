/**
 * `loadCatalogEntry` — `PLAN-M6.md` C1's own Checks section.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */
import { describe, expect, it } from 'vitest';

import { loadCatalogEntry } from '../../src/schema/load.ts';
import { POSTGRESQL } from '../fixtures/postgresql.ts';

describe('loadCatalogEntry', () => {
  it('round-trips the full 12 §12.2 postgresql worked example with every field intact', () => {
    const result = loadCatalogEntry(POSTGRESQL, 'datastore/postgresql.entry.yaml');

    if (!result.success)
      throw new Error(`expected success, got issues: ${JSON.stringify(result.issues)}`);
    expect(result.entry.id).toBe('postgresql');
    expect(result.entry.kind).toBe('datastore');
    expect(result.entry.name).toBe('PostgreSQL');
    expect(result.entry.maturity).toBe('mature');
    expect(result.entry.managed_options).toHaveLength(7);
    expect(result.entry.strengths).toHaveLength(3);
    expect(result.entry.weaknesses).toHaveLength(3);
    expect(result.entry.fits_when).toHaveLength(3);
    expect(result.entry.avoid_when).toHaveLength(2);
    expect(result.entry.pairs_with).toEqual([
      'pgbouncer',
      'flyway',
      'prisma',
      'sqlc',
      'debezium',
      'timescaledb',
    ]);
    expect(result.entry.alternatives).toHaveLength(6);
    expect(result.entry.operational_burden).toBe('medium');
    expect(result.entry.team_familiarity_weight).toBe('high');
    expect(result.entry.exit_cost).toBe('medium');
    expect(result.entry.agent_friendliness).toBe('high');
    expect(result.entry.notes_for_agents).toHaveLength(2);
  });

  it('rejects a genuine YAML syntax error as a real issue, not a thrown error', () => {
    const result = loadCatalogEntry('id: a\n  bad indentation:', 'bad.entry.yaml');
    expect(result.success).toBe(false);
  });

  it('rejects an unknown kind value', () => {
    const source = POSTGRESQL.replace('kind: datastore', 'kind: not-a-real-kind');
    const result = loadCatalogEntry(source, 'x.entry.yaml');
    expect(result.success).toBe(false);
  });

  it('accepts every one of the 20 declared kind values', () => {
    const kinds = [
      'language',
      'framework',
      'datastore',
      'queue',
      'stream',
      'cache',
      'search',
      'ci',
      'observability',
      'infra',
      'auth',
      'payments',
      'testing',
      'frontend',
      'mobile',
      'orm',
      'api-style',
      'cloud',
      'container',
      'iac',
    ];
    expect(kinds).toHaveLength(20);
    for (const kind of kinds) {
      const source = POSTGRESQL.replace('kind: datastore', `kind: ${kind}`);
      const result = loadCatalogEntry(source, `${kind}/postgresql.entry.yaml`);
      expect(result.success).toBe(true);
    }
  });

  it('accepts "low" as a burden/weight/cost/friendliness value, the inferred third ordinal value', () => {
    const source = POSTGRESQL.replace('operational_burden: medium', 'operational_burden: low');
    const result = loadCatalogEntry(source, 'x.entry.yaml');
    expect(result.success).toBe(true);
  });

  it('rejects an unknown top-level field rather than silently ignoring it (.strict())', () => {
    const source = POSTGRESQL.replace('kind: datastore', 'kind: datastore\nbogus_field: 1');
    const result = loadCatalogEntry(source, 'x.entry.yaml');
    expect(result.success).toBe(false);
  });

  it('rejects an entry with an empty strengths list', () => {
    const source = POSTGRESQL.replace(/strengths:\n(\s+- .*\n)+/, 'strengths: []\n');
    const result = loadCatalogEntry(source, 'x.entry.yaml');
    expect(result.success).toBe(false);
  });

  it('accepts an entry with no managed_options, pairs_with, or alternatives -- all optional', () => {
    const source = POSTGRESQL.replace(
      'managed_options: [ aws-rds, aws-aurora, gcp-cloudsql, azure-flexible, neon, supabase, crunchy ]\n',
      '',
    )
      .replace('pairs_with: [ pgbouncer, flyway, prisma, sqlc, debezium, timescaledb ]\n', '')
      .replace('alternatives: [ mysql, cockroachdb, yugabyte, dynamodb, mongodb, sqlite ]\n', '');
    const result = loadCatalogEntry(source, 'x.entry.yaml');
    expect(result.success).toBe(true);
  });
});
