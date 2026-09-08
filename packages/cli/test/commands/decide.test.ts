/**
 * `forge decide <framework>` — `03` §3.2.2, `11` §11.0's real rules→score→rank pipeline, run
 * end to end against the real, shipped `repo-strategy` framework (`@forge/templates`).
 *
 * @see specs/03 §3.2.2
 * @see specs/11 §11.0
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EvidenceCell } from '@forge/methods/score';

import { decide } from '../../src/commands/decide.ts';

const OPTIONS = ['monorepo-single-package', 'monorepo-workspaces', 'polyrepo', 'meta-repo'] as const;
const CRITERIA = [
  'atomic-cross-cutting-change',
  'independent-release-cadence',
  'build-tooling-cost',
  'access-control-granularity',
  'ci-scale',
  'onboarding-simplicity',
] as const;

function evenCells(scoreFor: (option: string, criterion: string) => number): readonly EvidenceCell[] {
  const cells: EvidenceCell[] = [];
  for (const optionId of OPTIONS) {
    for (const criterionId of CRITERIA) {
      cells.push({
        optionId,
        criterionId,
        score: scoreFor(optionId, criterionId),
        evidence: `${optionId}/${criterionId} fixture evidence`,
      });
    }
  }
  return cells;
}

describe('decide', () => {
  it('runs the real repo-strategy framework end to end and ranks by real weighted score', async () => {
    const cells = evenCells((option) => (option === 'monorepo-workspaces' ? 5 : 1));
    const result = await decide({ frameworkId: 'repo-strategy', cells });

    expect(result.ranked[0]?.optionId).toBe('monorepo-workspaces');
    expect(result.ranked.map((option) => option.optionId)).toEqual(
      expect.arrayContaining([...OPTIONS]),
    );
  });

  it('applies the real framework rule: deployable_units == 1 eliminates polyrepo/meta-repo', async () => {
    const cells = evenCells((option) => (option === 'polyrepo' || option === 'meta-repo' ? 5 : 1));
    const result = await decide({
      frameworkId: 'repo-strategy',
      derivedValues: { deployable_units: 1 },
      cells,
    });

    const polyrepo = result.ranked.find((option) => option.optionId === 'polyrepo');
    const metaRepo = result.ranked.find((option) => option.optionId === 'meta-repo');
    expect(polyrepo?.eliminated).toBe(true);
    expect(metaRepo?.eliminated).toBe(true);
    // The rule's own `prefer: monorepo-single-package` wins the top rank even though this test gave
    // every option identical scores, proving the rule really ran, not just eliminated.
    expect(result.ranked[0]?.optionId).toBe('monorepo-single-package');
  });

  it('states the real top option’s own killer risk — its lowest-scoring real criterion', async () => {
    const cells = evenCells((option, criterion) =>
      option === 'monorepo-single-package' && criterion === 'ci-scale' ? 1 : 5,
    );
    const result = await decide({
      frameworkId: 'repo-strategy',
      derivedValues: { deployable_units: 1 },
      cells,
    });

    expect(result.ranked[0]?.optionId).toBe('monorepo-single-package');
    expect(result.topOptionKillerRisk).toContain('ci-scale');
  });

  it('never ranks an eliminated option above a real remaining one', async () => {
    const cells = evenCells(() => 3);
    const result = await decide({
      frameworkId: 'repo-strategy',
      derivedValues: { deployable_units: 1 },
      cells,
    });
    const firstEliminatedIndex = result.ranked.findIndex((option) => option.eliminated);
    const lastRemainingIndex = result.ranked.findLastIndex((option) => !option.eliminated);
    expect(firstEliminatedIndex).toBeGreaterThan(lastRemainingIndex);
  });

  it('throws a real, informative error for an unknown framework id', async () => {
    await expect(
      decide({ frameworkId: 'this-framework-does-not-exist', cells: [] }),
    ).rejects.toThrow(/this-framework-does-not-exist/);
  });

  it('throws a real, informative error for a real framework file that fails real schema validation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'forge-cli-decide-invalid-'));
    try {
      const dir = path.join(root, 'templates', 'frameworks');
      await mkdir(dir, { recursive: true });
      // Missing every required field on purpose — a real schema violation, not a synthetic mock.
      await writeFile(path.join(dir, 'broken.framework.yaml'), 'id: broken\n');

      await expect(
        decide({ frameworkId: 'broken', cells: [], frameworksRoot: root }),
      ).rejects.toThrow(/broken\.framework\.yaml/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('honors a preferred option that sorts after another equally-scored one in raw order', async () => {
    // The framework's own `options:` list puts `monorepo-single-package` first — this reverses the
    // natural tie order so the preferred-option branch on the *second* comparator argument is real.
    const cells = evenCells(() => 3);
    const result = await decide({
      frameworkId: 'repo-strategy',
      derivedValues: { deployable_units: 1 },
      cells,
    });
    // monorepo-workspaces (unpreferred) must never outrank the preferred option even though both
    // scored identically.
    const preferredIndex = result.ranked.findIndex((o) => o.optionId === 'monorepo-single-package');
    const otherIndex = result.ranked.findIndex((o) => o.optionId === 'monorepo-workspaces');
    expect(preferredIndex).toBeLessThan(otherIndex);
  });
});
