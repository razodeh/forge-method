/**
 * `buildEvidenceIndex`/`isKnownEvidence` — `17` §17.2 phase 3's own "every claim cites evidence from
 * phases 1-2" rule, built against a real `Survey`/`Inventory` pair from `PLAN-M10.md` P15's own real
 * fixture, not a hand-typed stand-in.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P16
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildEvidenceIndex, isKnownEvidence } from '../../src/adopt/evidence.ts';
import { runInventory, type Inventory } from '../../src/adopt/inventory.ts';
import { runSurvey, type Survey } from '../../src/adopt/survey.ts';
import { nodeFixtureFiles, populateFixture, STUB_GIT_PROFILE } from './fixtures.ts';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function realFixture(): Promise<{ survey: Survey; inventory: Inventory }> {
  dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-evidence-'));
  await populateFixture(dir, nodeFixtureFiles());
  const { survey } = await runSurvey({ rootDir: dir, gitProfile: STUB_GIT_PROFILE });
  const inventory = await runInventory({ rootDir: dir, survey });
  return { survey, inventory };
}

describe('buildEvidenceIndex / isKnownEvidence', () => {
  it('indexes a real path INVENTORY/SURVEY actually produced', async () => {
    const { survey, inventory } = await realFixture();
    const index = buildEvidenceIndex(survey, inventory);
    expect(isKnownEvidence({ kind: 'path', path: 'src/routes.ts' }, index)).toBe(true);
    expect(isKnownEvidence({ kind: 'path', path: 'package.json' }, index)).toBe(true);
  });

  it('does not know a path that was never in SURVEY/INVENTORY -- the core anti-fabrication property', async () => {
    const { survey, inventory } = await realFixture();
    const index = buildEvidenceIndex(survey, inventory);
    expect(isKnownEvidence({ kind: 'path', path: 'src/payments/invented-service.ts' }, index)).toBe(
      false,
    );
  });

  it('indexes a real fact string for a signal with no single natural path (a dependency cycle)', async () => {
    const { survey, inventory } = await realFixture();
    const index = buildEvidenceIndex(survey, inventory);
    const [cycle] = inventory.dependencyGraph.cycles;
    expect(cycle).toBeDefined();
    const description = `dependency-cycle:${(cycle ?? []).join('->')}`;
    expect(isKnownEvidence({ kind: 'fact', description }, index)).toBe(true);
  });

  it('does not know a fabricated fact string', async () => {
    const { survey, inventory } = await realFixture();
    const index = buildEvidenceIndex(survey, inventory);
    expect(
      isKnownEvidence({ kind: 'fact', description: 'dependency-cycle:invented->cycle' }, index),
    ).toBe(false);
  });

  it('indexes a real public-api-surface fact', async () => {
    const { survey, inventory } = await realFixture();
    const index = buildEvidenceIndex(survey, inventory);
    const routeSignal = inventory.publicApiSurface.find((s) => s.kind === 'http-route');
    if (routeSignal === undefined) throw new Error('fixture has no http-route signal');
    const description = `public-api:${routeSignal.kind}:${routeSignal.name}@${routeSignal.path}`;
    expect(isKnownEvidence({ kind: 'fact', description }, index)).toBe(true);
  });

  it('indexes a data-surface fact with no name and an external dependency with no version -- both real, optional fields', () => {
    const survey: Survey = {
      size: { totalFiles: 0, totalLines: 0, byLanguage: [] },
      manifests: [],
      entryPoints: [],
      deployableUnits: [],
      datastores: [],
      testSetup: { testDirs: [], frameworks: [], ciTestCommands: [] },
      ci: [],
      gitProfile: {
        hasCommits: false,
        ageDays: undefined,
        commitCount: 0,
        contributorCount: 0,
        churnHotspots: [],
        filesChangedTogether: [],
      },
      existingDocs: [],
      health: { todoFixmeCount: 0, lintConfigPresent: false, typeCheckConfigPresent: false },
    };
    const inventory: Inventory = {
      dependencyGraph: { nodes: [], cycles: [] },
      publicApiSurface: [],
      dataSurface: [{ kind: 'migration', path: 'migrations/0001.sql', name: undefined }],
      configSurface: [],
      externalDependencies: [{ name: 'left-pad', version: undefined, ecosystem: 'npm' }],
    };
    const index = buildEvidenceIndex(survey, inventory);
    expect(
      isKnownEvidence(
        { kind: 'fact', description: 'data-surface:migration:@migrations/0001.sql' },
        index,
      ),
    ).toBe(true);
    expect(
      isKnownEvidence({ kind: 'fact', description: 'external-dependency:left-pad@' }, index),
    ).toBe(true);
  });
});
