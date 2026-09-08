/**
 * `score`/`killerRisk` — `PLAN-M6.md` M2's own Checks section.
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M2
 */
import { describe, expect, it } from 'vitest';

import { loadFramework } from '../../src/schema/load.ts';
import type { EvidenceCell } from '../../src/score/types.ts';
import { killerRisk, score } from '../../src/score/score.ts';
import { REPO_STRATEGY } from '../fixtures/repo-strategy.ts';

function repoStrategy() {
  const result = loadFramework(REPO_STRATEGY, 'repo-strategy.framework.yaml');
  if (!result.success) throw new Error('fixture framework failed to load');
  return result.framework;
}

const CRITERIA_ORDER = [
  'atomic-cross-cutting-change',
  'independent-release-cadence',
  'build-tooling-cost',
  'access-control-granularity',
  'ci-scale',
  'onboarding-simplicity',
] as const;

function cellsFor(optionId: string, scores: readonly number[]): EvidenceCell[] {
  return CRITERIA_ORDER.map((criterionId, index) => ({
    optionId,
    criterionId,
    score: scores[index] ?? 0,
    evidence: `${optionId}/${criterionId} evidence`,
  }));
}

describe('score', () => {
  it('a rubric with no matching rule scores every option; ranked order matches a hand-computed weighted sum', () => {
    const framework = repoStrategy();
    const cells = [
      ...cellsFor('monorepo-single-package', [8, 6, 7, 5, 6, 9]),
      ...cellsFor('monorepo-workspaces', [9, 8, 6, 6, 7, 6]),
      ...cellsFor('polyrepo', [4, 9, 4, 9, 5, 3]),
      ...cellsFor('meta-repo', [6, 7, 5, 7, 6, 5]),
    ];

    const result = score(framework, cells);

    // Hand-computed: 0.25*9 + 0.20*8 + 0.15*6 + 0.10*6 + 0.15*7 + 0.15*6 = 7.3
    expect(result[0]?.optionId).toBe('monorepo-workspaces');
    expect(result[0]?.totalScore).toBeCloseTo(7.3, 10);
    expect(result.every((option) => !option.eliminated)).toBe(true);
  });

  it('an eliminated option never outranks a non-eliminated option, even with a higher real weighted score', () => {
    const framework = repoStrategy();
    const cells = [
      ...cellsFor('monorepo-single-package', [1, 1, 1, 1, 1, 1]),
      ...cellsFor('polyrepo', [10, 10, 10, 10, 10, 10]),
    ];
    const eliminated = new Map([['polyrepo', 'deployable_units == 1']]);

    const result = score(framework, cells, eliminated);

    const polyrepo = result.find((option) => option.optionId === 'polyrepo');
    // Real weighted sum is preserved, not zeroed -- discarding it would lose the "would have scored
    // well but is disqualified" signal a comparison table needs.
    expect(polyrepo?.totalScore).toBe(10);
    expect(polyrepo?.eliminated).toBe(true);
    expect(polyrepo?.eliminatedBy).toBe('deployable_units == 1');
    expect(result[0]?.optionId).toBe('monorepo-single-package');
  });

  it('determinism: identical cells/eliminated input produces byte-identical output across repeated calls', () => {
    const framework = repoStrategy();
    const cells = cellsFor('monorepo-single-package', [8, 6, 7, 5, 6, 9]);
    const first = score(framework, cells);
    const second = score(framework, cells);
    expect(second).toEqual(first);
  });

  it('a criterion with no matching cell contributes 0 to that option’s own sum, not an error', () => {
    const framework = repoStrategy();
    // Only the first criterion has a cell; the rest are missing entirely for this option.
    const cells: EvidenceCell[] = [
      {
        optionId: 'monorepo-single-package',
        criterionId: 'atomic-cross-cutting-change',
        score: 8,
        evidence: 'partial evidence',
      },
    ];

    const result = score(framework, cells);
    const option = result.find((o) => o.optionId === 'monorepo-single-package');
    // Hand-computed: 0.25 * 8 = 2.0, every other criterion contributes 0.
    expect(option?.totalScore).toBeCloseTo(2.0, 10);
  });

  it('a cell whose optionId names no declared option is silently dropped from the result', () => {
    const framework = repoStrategy();
    const cells: EvidenceCell[] = [
      {
        optionId: 'not-a-real-option',
        criterionId: 'atomic-cross-cutting-change',
        score: 10,
        evidence: 'evidence for a nonexistent option',
      },
    ];

    const result = score(framework, cells);
    expect(result.some((option) => option.optionId === 'not-a-real-option')).toBe(false);
    expect(result).toHaveLength(framework.options.length);
  });

  it('a framework with no criteria at all (scoring: rules-only) scores every option 0', () => {
    const framework = { ...repoStrategy(), criteria: undefined };
    const result = score(framework, []);
    expect(result.every((option) => option.totalScore === 0)).toBe(true);
  });

  it('refuses an evidence-free cell', () => {
    const framework = repoStrategy();
    const cells: EvidenceCell[] = [
      {
        optionId: 'monorepo-single-package',
        criterionId: 'atomic-cross-cutting-change',
        score: 8,
        evidence: '',
      },
    ];
    expect(() => score(framework, cells)).toThrow(/evidence/);
  });
});

describe('killerRisk', () => {
  it('never names an eliminated option’s own weakness -- only the winning, non-eliminated option’s lowest cell', () => {
    const framework = repoStrategy();
    const cells = [
      ...cellsFor('monorepo-single-package', [8, 6, 7, 2, 6, 9]),
      ...cellsFor('polyrepo', [1, 1, 1, 1, 1, 1]),
    ];
    const eliminated = new Map([['polyrepo', 'deployable_units == 1']]);

    const ranked = score(framework, cells, eliminated);
    const winner = ranked[0];
    if (winner === undefined) throw new Error('expected a ranked option');

    expect(winner.optionId).toBe('monorepo-single-package');
    const risk = killerRisk(winner, framework);
    expect(risk).toContain('access-control-granularity');
    expect(risk).not.toContain('polyrepo');
  });

  it('returns undefined for an option with no relevant evidence cells', () => {
    const framework = repoStrategy();
    const emptyOption = score(framework, [])[0];
    if (emptyOption === undefined) throw new Error('expected a ranked option');
    expect(killerRisk(emptyOption, framework)).toBeUndefined();
  });

  it('on a tie for lowest score, resolves to the cell earliest in the option’s own cell order', () => {
    const framework = repoStrategy();
    const cells = cellsFor('monorepo-single-package', [8, 3, 7, 3, 6, 9]);
    const ranked = score(framework, cells);
    const option = ranked[0];
    if (option === undefined) throw new Error('expected a ranked option');

    const risk = killerRisk(option, framework);
    expect(risk).toContain('independent-release-cadence');
  });
});
