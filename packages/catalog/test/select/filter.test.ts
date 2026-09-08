/**
 * `filterByConstraints` — `PLAN-M6.md` C5's own Checks section.
 *
 * @see specs/12 §12.3
 * @see PLAN-M6.md C5
 */
import { describe, expect, it } from 'vitest';

import { filterByConstraints } from '../../src/select/filter.ts';
import type { CatalogEntry } from '../../src/schema/types.ts';

function makeEntry(overrides: Partial<CatalogEntry> & { id: string }): CatalogEntry {
  return {
    kind: 'datastore',
    name: overrides.id,
    category: 'test',
    maturity: 'mature',
    licence: 'MIT',
    strengths: ['a real strength'],
    weaknesses: ['a real weakness'],
    fits_when: ['condition one', 'condition two'],
    avoid_when: ['condition three', 'condition four'],
    operational_burden: 'low',
    team_familiarity_weight: 'medium',
    exit_cost: 'low',
    agent_friendliness: 'high',
    notes_for_agents: ['a real note'],
    ...overrides,
  };
}

const BASE_CONSTRAINTS = { mandated: [], forbidden: [], teamSkills: [] };

describe('filterByConstraints', () => {
  it('removes a candidate whose id is on constraints.forbidden, naming why', () => {
    const candidates = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })];
    const result = filterByConstraints(candidates, { ...BASE_CONSTRAINTS, forbidden: ['a'] });
    expect(result.kept.map((e) => e.id)).toEqual(['b']);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.entry.id).toBe('a');
    expect(result.removed[0]?.reason).toContain('forbidden');
  });

  it('removes a candidate whose licence contains a banned licencePolicy term', () => {
    const candidates = [
      makeEntry({ id: 'a', licence: 'SSPL 1.0' }),
      makeEntry({ id: 'b', licence: 'MIT' }),
    ];
    const result = filterByConstraints(candidates, {
      ...BASE_CONSTRAINTS,
      licencePolicy: ['SSPL'],
    });
    expect(result.kept.map((e) => e.id)).toEqual(['b']);
    expect(result.removed[0]?.reason).toContain('SSPL');
  });

  it('licence policy matching is case-insensitive', () => {
    const candidates = [makeEntry({ id: 'a', licence: 'sspl 1.0' })];
    const result = filterByConstraints(candidates, {
      ...BASE_CONSTRAINTS,
      licencePolicy: ['SSPL'],
    });
    expect(result.kept).toEqual([]);
  });

  it('removes a candidate whose every managed option is specific to a different cloud', () => {
    const candidates = [
      makeEntry({ id: 'aws-only', managed_options: ['aws-rds', 'aws-aurora'] }),
      makeEntry({ id: 'gcp-only', managed_options: ['gcp-cloudsql'] }),
    ];
    const result = filterByConstraints(candidates, { ...BASE_CONSTRAINTS, cloud: 'gcp' });
    expect(result.kept.map((e) => e.id)).toEqual(['gcp-only']);
    expect(result.removed[0]?.entry.id).toBe('aws-only');
  });

  it('keeps a candidate with at least one managed option matching the requested cloud, even if others differ', () => {
    const candidates = [makeEntry({ id: 'multi', managed_options: ['aws-rds', 'gcp-cloudsql'] })];
    const result = filterByConstraints(candidates, { ...BASE_CONSTRAINTS, cloud: 'gcp' });
    expect(result.kept.map((e) => e.id)).toEqual(['multi']);
  });

  it('keeps a candidate with no managed options at all, regardless of cloud constraint', () => {
    const candidates = [makeEntry({ id: 'self-hosted' })];
    const result = filterByConstraints(candidates, { ...BASE_CONSTRAINTS, cloud: 'aws' });
    expect(result.kept.map((e) => e.id)).toEqual(['self-hosted']);
  });

  it('does not filter on constraints.teamSkills -- it is a scoring signal, not a hard constraint', () => {
    const candidates = [makeEntry({ id: 'a' })];
    const result = filterByConstraints(candidates, { ...BASE_CONSTRAINTS, teamSkills: ['b', 'c'] });
    expect(result.kept.map((e) => e.id)).toEqual(['a']);
  });

  it('does not mechanically filter on constraints.compliance -- no catalog field carries that data', () => {
    const candidates = [makeEntry({ id: 'a' })];
    const result = filterByConstraints(candidates, { ...BASE_CONSTRAINTS, compliance: ['HIPAA'] });
    expect(result.kept.map((e) => e.id)).toEqual(['a']);
  });

  it('is deterministic: identical candidates/constraints always produce the identical result', () => {
    const candidates = [makeEntry({ id: 'a' }), makeEntry({ id: 'b', licence: 'SSPL' })];
    const constraints = { ...BASE_CONSTRAINTS, licencePolicy: ['SSPL'] };
    const first = filterByConstraints(candidates, constraints);
    const second = filterByConstraints(candidates, constraints);
    expect(second).toEqual(first);
  });
});
