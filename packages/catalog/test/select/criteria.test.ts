/**
 * `scoreCandidate` — `PLAN-M6.md` C5's own Checks section.
 *
 * @see specs/12 §12.3
 * @see PLAN-M6.md C5
 */
import { describe, expect, it } from 'vitest';

import { scoreCandidate } from '../../src/select/criteria.ts';
import type { CatalogEntry } from '../../src/schema/types.ts';
import type { StackSelectionInput } from '../../src/select/types.ts';

function makeEntry(overrides: Partial<CatalogEntry> & { id: string }): CatalogEntry {
  return {
    kind: 'framework',
    name: overrides.id,
    category: 'test',
    maturity: 'mature',
    licence: 'MIT',
    strengths: ['a real strength'],
    weaknesses: ['a real weakness'],
    fits_when: ['a high-throughput API'],
    avoid_when: ['condition three', 'condition four'],
    operational_burden: 'low',
    team_familiarity_weight: 'medium',
    exit_cost: 'low',
    agent_friendliness: 'high',
    notes_for_agents: ['a real note'],
    ...overrides,
  };
}

function makeInput(overrides: Partial<StackSelectionInput> = {}): StackSelectionInput {
  return {
    constraints: { mandated: [], forbidden: [], teamSkills: [] },
    architectureStyle: '',
    accessPatterns: [],
    nfrs: [],
    deploymentTargets: [],
    level: 'L2',
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('scores fit-to-requirements higher when input signals appear in fits_when text', () => {
    const entry = makeEntry({ id: 'a', fits_when: ['a high-throughput API', 'low latency'] });
    const matching = scoreCandidate(entry, makeInput({ accessPatterns: ['high-throughput API'] }));
    const nonMatching = scoreCandidate(entry, makeInput({ accessPatterns: ['batch processing'] }));
    expect(matching).toBeGreaterThan(nonMatching);
  });

  it('gives a full team-familiarity score when the entry is explicitly named in constraints.teamSkills', () => {
    const entry = makeEntry({ id: 'rust', team_familiarity_weight: 'low' });
    const named = scoreCandidate(
      entry,
      makeInput({ constraints: { mandated: [], forbidden: [], teamSkills: ['rust'] } }),
    );
    const unnamed = scoreCandidate(entry, makeInput());
    expect(named).toBeGreaterThan(unnamed);
  });

  it('team-skill matching checks both id and name, case-insensitively', () => {
    const entry = makeEntry({
      id: 'typescript-js',
      name: 'TypeScript/JavaScript',
      team_familiarity_weight: 'low',
    });
    const byId = scoreCandidate(
      entry,
      makeInput({ constraints: { mandated: [], forbidden: [], teamSkills: ['TypeScript-JS'] } }),
    );
    const byName = scoreCandidate(
      entry,
      makeInput({
        constraints: { mandated: [], forbidden: [], teamSkills: ['typescript/javascript'] },
      }),
    );
    const unnamed = scoreCandidate(entry, makeInput());
    expect(byId).toBeGreaterThan(unnamed);
    expect(byName).toBeGreaterThan(unnamed);
  });

  it('scores mature maturity higher than declining, all else equal', () => {
    const mature = makeEntry({ id: 'a', maturity: 'mature' });
    const declining = makeEntry({ id: 'b', maturity: 'declining' });
    const input = makeInput();
    expect(scoreCandidate(mature, input)).toBeGreaterThan(scoreCandidate(declining, input));
  });

  it('scores low operational_burden higher than high, all else equal', () => {
    const low = makeEntry({ id: 'a', operational_burden: 'low' });
    const high = makeEntry({ id: 'b', operational_burden: 'high' });
    const input = makeInput();
    expect(scoreCandidate(low, input)).toBeGreaterThan(scoreCandidate(high, input));
  });

  it('scores high agent_friendliness higher than low, all else equal', () => {
    const high = makeEntry({ id: 'a', agent_friendliness: 'high' });
    const low = makeEntry({ id: 'b', agent_friendliness: 'low' });
    const input = makeInput();
    expect(scoreCandidate(high, input)).toBeGreaterThan(scoreCandidate(low, input));
  });

  it('scores low exit_cost higher than high -- easier to leave is better', () => {
    const low = makeEntry({ id: 'a', exit_cost: 'low' });
    const high = makeEntry({ id: 'b', exit_cost: 'high' });
    const input = makeInput();
    expect(scoreCandidate(low, input)).toBeGreaterThan(scoreCandidate(high, input));
  });

  it('is deterministic: identical entry/input always produce the identical score', () => {
    const entry = makeEntry({ id: 'a' });
    const input = makeInput({ accessPatterns: ['a high-throughput API'] });
    expect(scoreCandidate(entry, input)).toBe(scoreCandidate(entry, input));
  });

  it('never throws on an entry with empty fits_when-matching input signals', () => {
    const entry = makeEntry({ id: 'a' });
    expect(() => scoreCandidate(entry, makeInput())).not.toThrow();
  });
});
