/**
 * `applyRules` — `PLAN-M6.md` M2's own Checks section.
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M2
 */
import { describe, expect, it } from 'vitest';

import { loadFramework } from '../../src/schema/load.ts';
import { applyRules } from '../../src/score/rules.ts';
import { REPO_STRATEGY } from '../fixtures/repo-strategy.ts';

function repoStrategy() {
  const result = loadFramework(REPO_STRATEGY, 'repo-strategy.framework.yaml');
  if (!result.success) throw new Error('fixture framework failed to load');
  return result.framework;
}

describe('applyRules', () => {
  it('the worked repo-strategy example: deployable_units == 1 eliminates polyrepo/meta-repo and prefers monorepo-single-package', () => {
    const result = applyRules(repoStrategy(), { deployable_units: 1 });
    expect([...result.eliminated.keys()].sort()).toEqual(['meta-repo', 'polyrepo']);
    expect(result.preferred).toBe('monorepo-single-package');
  });

  it('a rule whose condition is false eliminates nothing', () => {
    const result = applyRules(repoStrategy(), { deployable_units: 3 });
    expect(result.eliminated.size).toBe(0);
    expect(result.preferred).toBeUndefined();
  });

  it('unions eliminate ids across every matching rule', () => {
    const result = applyRules(repoStrategy(), {
      deployable_units: 1,
      regulatory: { code_isolation_required: true },
    });
    expect([...result.eliminated.keys()].sort()).toEqual([
      'meta-repo',
      'monorepo-single-package',
      'monorepo-workspaces',
      'polyrepo',
    ]);
  });

  it('records which rule eliminated each option, for eliminatedBy', () => {
    const result = applyRules(repoStrategy(), { deployable_units: 1 });
    expect(result.eliminated.get('polyrepo')).toBe('deployable_units == 1');
  });

  it('a framework with no rules eliminates nothing and prefers nothing', () => {
    const framework = { ...repoStrategy(), rules: undefined };
    const result = applyRules(framework, {});
    expect(result.eliminated.size).toBe(0);
    expect(result.preferred).toBeUndefined();
  });

  it('when two matching rules disagree on prefer, the last matching rule wins', () => {
    const framework = {
      ...repoStrategy(),
      rules: [
        { if: 'true', then: { prefer: 'monorepo-single-package' } },
        { if: 'true', then: { prefer: 'monorepo-workspaces' } },
      ],
    };
    const result = applyRules(framework, {});
    expect(result.preferred).toBe('monorepo-workspaces');
  });

  it('a preferred option that a later rule also eliminates is not reported as preferred -- self-contradictory otherwise', () => {
    const framework = {
      ...repoStrategy(),
      rules: [
        { if: 'true', then: { prefer: 'polyrepo' } },
        { if: 'true', then: { eliminate: ['polyrepo'] } },
      ],
    };
    const result = applyRules(framework, {});
    expect(result.eliminated.has('polyrepo')).toBe(true);
    expect(result.preferred).toBeUndefined();
  });
});
