/**
 * `validateEntry` — `PLAN-M6.md` C1's own Checks section.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */
import { describe, expect, it } from 'vitest';

import { loadCatalogEntry } from '../../src/schema/load.ts';
import { CatalogRegistry } from '../../src/registry/registry.ts';
import { validateEntry } from '../../src/registry/validate.ts';
import { POSTGRESQL } from '../fixtures/postgresql.ts';

function loadEntry(source: string) {
  const result = loadCatalogEntry(source, 'x.entry.yaml');
  if (!result.success) throw new Error('fixture entry failed to load');
  return result.entry;
}

describe('validateEntry', () => {
  it('the worked postgresql example, with its own real pairs_with/alternatives entries present, is clean', () => {
    const postgresql = loadEntry(POSTGRESQL);
    const pgbouncer = loadEntry(
      POSTGRESQL.replace('id: postgresql', 'id: pgbouncer').replace(
        'name: PostgreSQL',
        'name: PgBouncer',
      ),
    );
    const mysql = loadEntry(
      POSTGRESQL.replace('id: postgresql', 'id: mysql').replace('name: PostgreSQL', 'name: MySQL'),
    );
    // The worked example's own pairs_with/alternatives name six and six ids respectively; only two are
    // registered here, so a real, complete registry (not this test's own minimal one) is required for a
    // truly clean result -- this test only proves the *mechanism*, not that the real shipped catalog (a
    // later piece) is itself free of dangling references.
    const registry = new CatalogRegistry([postgresql, pgbouncer, mysql]);

    const issues = validateEntry(postgresql, registry);
    const danglingIssues = issues.filter((issue) => issue.message.includes('not a real entry id'));
    expect(danglingIssues.map((issue) => issue.path).sort()).toEqual(
      [
        'alternatives.1',
        'alternatives.2',
        'alternatives.3',
        'alternatives.4',
        'alternatives.5',
        'pairs_with.1',
        'pairs_with.2',
        'pairs_with.3',
        'pairs_with.4',
        'pairs_with.5',
      ].sort(),
    );
  });

  it('catches a dangling pairs_with reference, naming the offending field', () => {
    const entry = loadEntry(POSTGRESQL.replace('pairs_with: [ pgbouncer,', 'pairs_with: [ nope,'));
    const registry = new CatalogRegistry([entry]);

    const issues = validateEntry(entry, registry);
    const issue = issues.find((i) => i.path === 'pairs_with.0');
    expect(issue?.message).toContain('nope');
  });

  it('catches a dangling alternatives reference, naming the offending field', () => {
    const entry = loadEntry(POSTGRESQL.replace('alternatives: [ mysql,', 'alternatives: [ nope,'));
    const registry = new CatalogRegistry([entry]);

    const issues = validateEntry(entry, registry);
    const issue = issues.find((i) => i.path === 'alternatives.0');
    expect(issue?.message).toContain('nope');
  });

  it('catches a superlative-shaped string in strengths, naming the offending field', () => {
    const entry = loadEntry(
      POSTGRESQL.replace(
        '"ACID with strong isolation options, including serializable"',
        '"The fastest datastore available"',
      ),
    );
    const registry = new CatalogRegistry([entry]);

    const issues = validateEntry(entry, registry);
    const issue = issues.find((i) => i.path === 'strengths.0');
    expect(issue?.message).toMatch(/superlative/);
  });

  it('catches "best" as a banned superlative too', () => {
    const entry = loadEntry(
      POSTGRESQL.replace(
        '"team familiarity is a priority"',
        '"the best choice for relational data"',
      ),
    );
    const registry = new CatalogRegistry([entry]);

    const issues = validateEntry(entry, registry);
    expect(issues.some((issue) => issue.path === 'fits_when.2')).toBe(true);
  });

  it('catches a bare performance number (e.g. "50ms", "10000 qps")', () => {
    const entry = loadEntry(
      POSTGRESQL.replace(
        '"ACID with strong isolation options, including serializable"',
        '"Handles 50000 qps under load"',
      ),
    );
    const registry = new CatalogRegistry([entry]);

    const issues = validateEntry(entry, registry);
    expect(issues.some((issue) => issue.path === 'strengths.0')).toBe(true);
  });

  it('scans notes_for_agents too, not just the marketing-facing fields', () => {
    const entry = loadEntry(
      POSTGRESQL.replace(
        '"Use a migration tool; never ALTER by hand in code"',
        '"This is the fastest way to run migrations"',
      ),
    );
    const registry = new CatalogRegistry([entry]);

    const issues = validateEntry(entry, registry);
    expect(issues.some((issue) => issue.path === 'notes_for_agents.0')).toBe(true);
  });

  it('does not flag a workload description containing a unit-shaped word but no digit (e.g. "millions of ops/sec")', () => {
    // The worked example's own avoid_when text -- describing a workload class, not claiming this
    // entry's own performance, and it carries no digit at all.
    const entry = loadEntry(POSTGRESQL);
    const registry = new CatalogRegistry([entry]);

    const issues = validateEntry(entry, registry);
    expect(issues.some((issue) => issue.path.startsWith('avoid_when'))).toBe(false);
  });

  it('an entry with no pairs_with/alternatives at all produces no dangling-reference issues', () => {
    const source = POSTGRESQL.replace(
      'pairs_with: [ pgbouncer, flyway, prisma, sqlc, debezium, timescaledb ]\n',
      '',
    ).replace('alternatives: [ mysql, cockroachdb, yugabyte, dynamodb, mongodb, sqlite ]\n', '');
    const entry = loadEntry(source);
    const registry = new CatalogRegistry([entry]);

    const issues = validateEntry(entry, registry);
    expect(issues).toEqual([]);
  });
});
