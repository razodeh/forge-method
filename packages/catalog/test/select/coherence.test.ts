/**
 * `scoreCoherence` — `PLAN-M6.md` C5's own Checks section.
 *
 * @see specs/12 §12.3
 * @see PLAN-M6.md C5
 */
import { describe, expect, it } from 'vitest';

import { scoreCoherence } from '../../src/select/coherence.ts';
import type { CatalogEntry } from '../../src/schema/types.ts';

function makeEntry(overrides: Partial<CatalogEntry> & { id: string }): CatalogEntry {
  return {
    kind: 'framework',
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

describe('scoreCoherence', () => {
  it('is 0 for an empty or single-entry set', () => {
    expect(scoreCoherence([])).toBe(0);
    expect(scoreCoherence([makeEntry({ id: 'a' })])).toBe(0);
  });

  it('rewards a one-directional pairs_with edge between two selected entries', () => {
    const a = makeEntry({ id: 'a', pairs_with: ['b'] });
    const b = makeEntry({ id: 'b' });
    expect(scoreCoherence([a, b])).toBe(1);
  });

  it('rewards a mutual pairs_with edge twice, once per direction', () => {
    const a = makeEntry({ id: 'a', pairs_with: ['b'] });
    const b = makeEntry({ id: 'b', pairs_with: ['a'] });
    expect(scoreCoherence([a, b])).toBe(2);
  });

  it('never rewards a pairs_with edge to an entry outside the selected set', () => {
    const a = makeEntry({ id: 'a', pairs_with: ['not-selected'] });
    expect(scoreCoherence([a])).toBe(0);
  });

  it('penalises 2 points per language-kind entry beyond the first', () => {
    const languages = [
      makeEntry({ id: 'a', kind: 'language' }),
      makeEntry({ id: 'b', kind: 'language' }),
      makeEntry({ id: 'c', kind: 'language' }),
    ];
    expect(scoreCoherence(languages)).toBe(-4); // 2 extra languages * -2
  });

  it('penalises datastore, iac, and container kinds the same way, independently per kind', () => {
    const entries = [
      makeEntry({ id: 'ds1', kind: 'datastore' }),
      makeEntry({ id: 'ds2', kind: 'datastore' }),
      makeEntry({ id: 'iac1', kind: 'iac' }),
      makeEntry({ id: 'iac2', kind: 'iac' }),
    ];
    expect(scoreCoherence(entries)).toBe(-4); // -2 for the extra datastore, -2 for the extra iac
  });

  it('never penalises a kind outside the runtime-count-penalty set, however many are selected', () => {
    const entries = [
      makeEntry({ id: 'a', kind: 'auth' }),
      makeEntry({ id: 'b', kind: 'auth' }),
      makeEntry({ id: 'c', kind: 'auth' }),
    ];
    expect(scoreCoherence(entries)).toBe(0);
  });

  it('combines rewards and penalties in one score', () => {
    const entries = [
      makeEntry({ id: 'a', kind: 'framework', pairs_with: ['b'] }),
      makeEntry({ id: 'b', kind: 'datastore' }),
      makeEntry({ id: 'c', kind: 'datastore' }),
    ];
    expect(scoreCoherence(entries)).toBe(-1); // +1 edge, -2 extra datastore
  });

  it('is deterministic: identical input always produces the identical score', () => {
    const entries = [makeEntry({ id: 'a', pairs_with: ['b'] }), makeEntry({ id: 'b' })];
    expect(scoreCoherence(entries)).toBe(scoreCoherence(entries));
  });
});
