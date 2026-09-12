/**
 * `analyzeGaps`/`renderGapsReport`/`writeGapArtifacts` — `PLAN-M10.md` P19's own Checks section,
 * literally: "GAP ANALYSIS against a fixture repo with seeded defects in every one of the 6 gap classes
 * finds every seeded defect, per M10's own Acceptance criterion." `seededDefectFixture()` below builds
 * one combined `GapAnalysisInput` with exactly one deliberate, identifiable defect per gap class named
 * in `17` §17.2 phase 7's own table (knowledge/verification/delivery/operability/safety/consistency);
 * `describe('the literal M10 exit test...')` asserts every one of the six is actually found, by
 * `gapClass` *and* by content, not merely by count — a test that only checked
 * `findings.length === 6` would pass even if two defects landed in the wrong class.
 *
 * @see specs/17 §17.2 phase 7
 * @see specs/22 (M10 Acceptance)
 * @see PLAN-M10.md P19
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SYSTEM_CLOCK } from '@forge/core';
import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzeGaps,
  renderGapsReport,
  writeGapArtifacts,
  type GapAnalysisInput,
  type GapAnalysisResult,
  type GapClass,
} from '../../src/adopt/gap-analysis.ts';
import type { CartographyResult } from '../../src/adopt/cartography.ts';
import type { Inventory } from '../../src/adopt/inventory.ts';
import type { InferenceResult } from '../../src/adopt/inference.ts';
import type { Survey } from '../../src/adopt/survey.ts';
import type { VerificationResult } from '../../src/adopt/verification.ts';

function baseSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    size: {
      totalFiles: 10,
      totalLines: 500,
      byLanguage: [{ language: 'TypeScript', files: 10, lines: 500 }],
    },
    manifests: [{ toolchain: 'node', path: 'package.json' }],
    entryPoints: [{ kind: 'package-main', path: 'src/index.ts', value: 'src/index.ts' }],
    deployableUnits: [{ kind: 'dockerfile', path: 'Dockerfile', name: 'Dockerfile' }],
    datastores: [],
    testSetup: { testDirs: ['test'], frameworks: ['vitest'], ciTestCommands: ['npm test'] },
    ci: [{ system: 'github-actions', path: '.github/workflows/ci.yml', jobs: ['build'] }],
    gitProfile: {
      hasCommits: true,
      ageDays: 30,
      commitCount: 5,
      contributorCount: 1,
      churnHotspots: [],
      filesChangedTogether: [],
    },
    existingDocs: [{ kind: 'readme', path: 'README.md' }],
    health: { todoFixmeCount: 0, lintConfigPresent: true, typeCheckConfigPresent: true },
    ...overrides,
  };
}

function baseInventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    dependencyGraph: { nodes: [{ module: 'src/index', imports: [] }], cycles: [] },
    publicApiSurface: [],
    dataSurface: [],
    configSurface: [],
    externalDependencies: [
      { name: 'express', version: '4.18.0', ecosystem: 'npm' },
      { name: 'pino', version: '8.0.0', ecosystem: 'npm' },
    ],
    ...overrides,
  };
}

function baseCartography(overrides: Partial<CartographyResult> = {}): CartographyResult {
  return { findings: [], rejected: [], sharedWriteTables: [], ...overrides };
}

function baseInference(overrides: Partial<InferenceResult> = {}): InferenceResult {
  return { findings: [], rejected: [], ...overrides };
}

function baseVerification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return { findings: [], gaps: [], ...overrides };
}

/**
 * One combined input with exactly one deliberate, distinguishable defect per gap class — the literal
 * M10 exit-test fixture. Every field not directly relevant to a seeded defect is set to a "healthy"
 * value (a logging dependency present, a deployable unit present, a CI pipeline present, no cycles) so
 * that class's own detector does not incidentally also fire from an unrelated, unseeded gap, which
 * would make "found every seeded defect" too easy to satisfy by accident.
 */
function seededDefectFixture(): GapAnalysisInput {
  return {
    survey: baseSurvey({
      // delivery seed: no CI pipeline at all (deployable unit stays present so only *this* delivery
      // defect fires).
      ci: [],
    }),
    inventory: baseInventory({
      // operability seed: no logging/tracing library among external dependencies.
      externalDependencies: [],
      // consistency seed: a genuine cyclic dependency.
      dependencyGraph: {
        nodes: [
          { module: 'src/cycle-a', imports: ['src/cycle-b'] },
          { module: 'src/cycle-b', imports: ['src/cycle-a'] },
        ],
        cycles: [['src/cycle-a', 'src/cycle-b', 'src/cycle-a']],
      },
    }),
    cartography: baseCartography({
      findings: [
        // knowledge seed: a component CARTOGRAPHY could only place at low confidence.
        {
          kind: 'component',
          statement: 'Unexplained legacy billing shim',
          evidence: [{ kind: 'path', path: 'src/legacy-shim.ts' }],
          confidence: 'low',
        },
      ],
      // safety seed: a real shared-write table.
      sharedWriteTables: [{ table: 'users', owners: ['billing', 'accounts'] }],
    }),
    inference: baseInference(),
    inferenceRan: true,
    verification: baseVerification({
      // verification seed: a real, recorded verification gap (a failed check VERIFICATION could not
      // promote).
      gaps: [
        {
          subject: { origin: 'repository', statement: 'test suite' },
          kind: 'test',
          detail: 'The test suite failed: 3 of 40 tests failing.',
        },
      ],
    }),
  };
}

const GAP_CLASSES: readonly GapClass[] = [
  'knowledge',
  'verification',
  'delivery',
  'operability',
  'safety',
  'consistency',
];

describe('analyzeGaps — the literal M10 exit test (seeded defects in all 6 gap classes)', () => {
  const result = analyzeGaps(seededDefectFixture());

  it('finds at least one finding in every one of the 6 gap classes', () => {
    for (const gapClass of GAP_CLASSES) {
      const inClass = result.findings.filter((f) => f.gapClass === gapClass);
      expect(inClass.length, `expected at least one "${gapClass}" finding`).toBeGreaterThan(0);
    }
  });

  it('finds the specific seeded knowledge defect (the low-confidence component)', () => {
    expect(
      result.findings.some(
        (f) =>
          f.gapClass === 'knowledge' && f.statement.includes('Unexplained legacy billing shim'),
      ),
    ).toBe(true);
  });

  it('finds the specific seeded verification defect (the recorded verification gap)', () => {
    expect(
      result.findings.some(
        (f) => f.gapClass === 'verification' && f.statement.includes('test suite failed'),
      ),
    ).toBe(true);
  });

  it('finds the specific seeded delivery defect (no CI pipeline)', () => {
    expect(
      result.findings.some(
        (f) => f.gapClass === 'delivery' && f.statement.toLowerCase().includes('ci/cd pipeline'),
      ),
    ).toBe(true);
  });

  it('finds the specific seeded operability defect (no logging/tracing dependency)', () => {
    expect(
      result.findings.some(
        (f) =>
          f.gapClass === 'operability' && f.statement.toLowerCase().includes('logging or tracing'),
      ),
    ).toBe(true);
  });

  it('finds the specific seeded safety defect (the shared-write table)', () => {
    expect(
      result.findings.some((f) => f.gapClass === 'safety' && f.statement.includes('"users"')),
    ).toBe(true);
  });

  it('finds the specific seeded consistency defect (the dependency cycle)', () => {
    expect(
      result.findings.some(
        (f) => f.gapClass === 'consistency' && f.statement.includes('src/cycle-a -> src/cycle-b'),
      ),
    ).toBe(true);
  });

  it('does not report any gap class as empty when defects are seeded in all six', () => {
    const report = renderGapsReport(result);
    expect(report).not.toMatch(/## .+\n\nNone found\./);
  });
});

describe('analyzeGaps — a clean fixture with no seeded defects', () => {
  it('reports zero findings', () => {
    const clean: GapAnalysisInput = {
      survey: baseSurvey(),
      inventory: baseInventory(),
      cartography: baseCartography(),
      inference: baseInference(),
      inferenceRan: true,
      verification: baseVerification(),
    };
    expect(analyzeGaps(clean).findings).toEqual([]);
  });
});

describe('analyzeGaps — the "no evidenced authorization convention" false-positive fix', () => {
  const withRoute: GapAnalysisInput = {
    survey: baseSurvey(),
    inventory: baseInventory({
      publicApiSurface: [
        {
          kind: 'http-route',
          name: 'GET /orders',
          path: 'src/routes.ts',
          evidence: 'app.get(...)',
        },
      ],
    }),
    cartography: baseCartography(),
    inference: baseInference(),
    inferenceRan: true,
    verification: baseVerification(),
  };

  it('flags a real route when INFERENCE genuinely ran and found no auth convention', () => {
    const result = analyzeGaps(withRoute);
    expect(
      result.findings.some(
        (f) => f.gapClass === 'safety' && f.statement.includes('no evidenced authorization'),
      ),
    ).toBe(true);
  });

  it('a fresh critic round found this defaulted to a systematic false positive on every route -- does not flag a route at all when INFERENCE never ran', () => {
    const result = analyzeGaps({ ...withRoute, inferenceRan: false });
    expect(
      result.findings.some(
        (f) => f.gapClass === 'safety' && f.statement.includes('no evidenced authorization'),
      ),
    ).toBe(false);
  });

  it('does not flag a route when INFERENCE ran and did find an auth convention', () => {
    const result = analyzeGaps({
      ...withRoute,
      inference: {
        findings: [
          {
            kind: 'convention',
            statement: '18 of 20 routes check auth',
            evidence: [],
            confidence: 'medium',
            status: 'draft',
          },
        ],
        rejected: [],
      },
    });
    expect(
      result.findings.some(
        (f) => f.gapClass === 'safety' && f.statement.includes('no evidenced authorization'),
      ),
    ).toBe(false);
  });
});

describe('renderGapsReport', () => {
  it('renders every gap class heading, including "None found." for an empty class', () => {
    const result = analyzeGaps({
      survey: baseSurvey(),
      inventory: baseInventory(),
      cartography: baseCartography({ sharedWriteTables: [{ table: 't', owners: ['a', 'b'] }] }),
      inference: baseInference(),
      inferenceRan: true,
      verification: baseVerification(),
    });
    const report = renderGapsReport(result);
    expect(report).toContain('## Knowledge gaps (0)');
    expect(report).toContain('None found.');
    expect(report).toContain('## Safety gaps (1)');
    expect(report).toContain('[critical]');
  });
});

describe('writeGapArtifacts', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes a RISK-### for every actionable high/critical finding and an OQ-### for actionable low/medium knowledge findings', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-gap-artifacts-'));
    dirs.push(dir);
    const paths = new ProjectPaths(dir);
    const result = analyzeGaps(seededDefectFixture());

    const written = await writeGapArtifacts(
      { paths, clock: SYSTEM_CLOCK, kbRoot: 'kb' },
      'adoption',
      result,
    );

    // Seeded defects: knowledge (medium -> OQ), safety (critical -> RISK), verification-repository
    // (high -> RISK), delivery (high -> RISK), consistency (medium, not knowledge -> neither).
    expect(written.riskIds.length).toBeGreaterThan(0);
    expect(written.openQuestionIds.length).toBeGreaterThan(0);
    expect(written.riskIds.every((id) => /^RISK-\d{3,4}$/.test(id))).toBe(true);
    expect(written.openQuestionIds.every((id) => /^OQ-\d{3,4}$/.test(id))).toBe(true);
    // A fresh critic round found the prior version of this test asserted only `.length`, which would
    // not have caught a real, silent id collision (two distinct findings colliding into one entry).
    const allIds = [...written.riskIds, ...written.openQuestionIds];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('writes two distinct entries for two findings that share identical statement text but different evidence', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-gap-artifacts-'));
    dirs.push(dir);
    const paths = new ProjectPaths(dir);
    const deps = { paths, clock: SYSTEM_CLOCK, kbRoot: 'kb' };
    const collidingResult: GapAnalysisResult = {
      findings: [
        {
          gapClass: 'safety',
          severity: 'critical',
          statement: 'Shared-write table: boilerplate wording.',
          evidence: ['componentA'],
          actionable: true,
          mitigation: 'm',
        },
        {
          gapClass: 'safety',
          severity: 'critical',
          statement: 'Shared-write table: boilerplate wording.',
          evidence: ['componentB'],
          actionable: true,
          mitigation: 'm',
        },
      ],
    };

    const written = await writeGapArtifacts(deps, 'adoption', collidingResult);

    expect(written.riskIds).toHaveLength(2);
    expect(new Set(written.riskIds).size).toBe(2);
  });

  it('is idempotent: calling it twice for the identical finding set never writes duplicate entries', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-gap-artifacts-'));
    dirs.push(dir);
    const paths = new ProjectPaths(dir);
    const result = analyzeGaps(seededDefectFixture());
    const deps = { paths, clock: SYSTEM_CLOCK, kbRoot: 'kb' };

    const first = await writeGapArtifacts(deps, 'adoption', result);
    const second = await writeGapArtifacts(deps, 'adoption', result);

    expect(second.riskIds).toEqual(first.riskIds);
    expect(second.openQuestionIds).toEqual(first.openQuestionIds);
  });
});
