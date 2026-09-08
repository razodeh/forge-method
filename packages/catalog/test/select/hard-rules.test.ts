/**
 * `evaluateHardRules`/`isMandated` — `PLAN-M6.md` C5's own Checks section: `12` §12.3's own three "Hard
 * rules".
 *
 * @see specs/12 §12.3
 * @see PLAN-M6.md C5
 */
import { describe, expect, it } from 'vitest';

import { evaluateHardRules, isMandated } from '../../src/select/hard-rules.ts';
import type { CatalogEntry } from '../../src/schema/types.ts';
import type { ChosenEntry } from '../../src/select/types.ts';

function makeEntry(overrides: Partial<CatalogEntry> & { id: string }): CatalogEntry {
  return {
    kind: 'language',
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

function makeChosen(entry: CatalogEntry): ChosenEntry {
  return {
    catalogKind: entry.kind,
    entry,
    reason: { kind: 'scored', weightedScore: 1, coherenceBonus: 0 },
  };
}

describe('evaluateHardRules', () => {
  it('does not flag a single primary language at any level', () => {
    const chosen = [makeChosen(makeEntry({ id: 'a', kind: 'language' }))];
    expect(evaluateHardRules(chosen, 'L1').some((f) => f.rule === 'primary-language-count')).toBe(
      false,
    );
  });

  it('flags more than 1 primary language at a level other than L3', () => {
    const chosen = [
      makeChosen(makeEntry({ id: 'a', kind: 'language' })),
      makeChosen(makeEntry({ id: 'b', kind: 'language' })),
    ];
    const flags = evaluateHardRules(chosen, 'L2');
    expect(flags.some((f) => f.rule === 'primary-language-count')).toBe(true);
  });

  it('allows exactly 2 primary languages at L3 without flagging', () => {
    const chosen = [
      makeChosen(makeEntry({ id: 'a', kind: 'language' })),
      makeChosen(makeEntry({ id: 'b', kind: 'language' })),
    ];
    expect(evaluateHardRules(chosen, 'L3').some((f) => f.rule === 'primary-language-count')).toBe(
      false,
    );
  });

  it('flags more than 2 primary languages even at L3', () => {
    const chosen = [
      makeChosen(makeEntry({ id: 'a', kind: 'language' })),
      makeChosen(makeEntry({ id: 'b', kind: 'language' })),
      makeChosen(makeEntry({ id: 'c', kind: 'language' })),
    ];
    expect(evaluateHardRules(chosen, 'L3').some((f) => f.rule === 'primary-language-count')).toBe(
      true,
    );
  });

  it('flags any chosen entry with maturity: emerging, naming its id', () => {
    const chosen = [makeChosen(makeEntry({ id: 'risky', kind: 'frontend', maturity: 'emerging' }))];
    const flags = evaluateHardRules(chosen, 'L2');
    const flag = flags.find((f) => f.rule === 'emerging-maturity');
    expect(flag?.entryId).toBe('risky');
  });

  it('does not flag a mature, growing, legacy, or declining entry as emerging', () => {
    const chosen = [
      makeChosen(makeEntry({ id: 'a', maturity: 'mature' })),
      makeChosen(makeEntry({ id: 'b', maturity: 'growing' })),
      makeChosen(makeEntry({ id: 'c', maturity: 'legacy' })),
      makeChosen(makeEntry({ id: 'd', maturity: 'declining' })),
    ];
    expect(evaluateHardRules(chosen, 'L2').some((f) => f.rule === 'emerging-maturity')).toBe(false);
  });

  it('flags every emerging entry among multiple chosen, not just the first', () => {
    const chosen = [
      makeChosen(makeEntry({ id: 'a', maturity: 'emerging' })),
      makeChosen(makeEntry({ id: 'b', maturity: 'emerging' })),
    ];
    const flags = evaluateHardRules(chosen, 'L2').filter((f) => f.rule === 'emerging-maturity');
    expect(flags).toHaveLength(2);
  });
});

describe('isMandated', () => {
  it('is true when the entry id is in constraints.mandated', () => {
    expect(isMandated(makeEntry({ id: 'postgresql' }), ['postgresql'])).toBe(true);
  });

  it('is false when the entry id is not in constraints.mandated', () => {
    expect(isMandated(makeEntry({ id: 'mysql-mariadb' }), ['postgresql'])).toBe(false);
  });

  it('is false for an empty mandated list', () => {
    expect(isMandated(makeEntry({ id: 'postgresql' }), [])).toBe(false);
  });
});
