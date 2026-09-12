/**
 * `assembleVerification`/`verifyCartographyFinding`/`verifyConventionFinding`/
 * `classifyCartographyCheckKind` — `17` §17.2 phase 5's own pure, deterministic re-check logic
 * (`PLAN-M10.md` P17). The real sandboxed build/test execution this phase also requires lives in
 * `@forge/engine/adopt/verification.ts` (see that package's own test file) — this file covers only the
 * evidence-drift re-checks and the promotion/downgrade/gap assembly rule, which do not need process
 * execution at all.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P17
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CartographyFinding } from '../../src/adopt/cartography.ts';
import { buildEvidenceIndex, type EvidenceIndex } from '../../src/adopt/evidence.ts';
import type { InferenceFinding } from '../../src/adopt/inference.ts';
import { runInventory } from '../../src/adopt/inventory.ts';
import { runSurvey } from '../../src/adopt/survey.ts';
import {
  assembleVerification,
  classifyCartographyCheckKind,
  verifyCartographyFinding,
  verifyConventionFinding,
  type RawVerificationCheck,
} from '../../src/adopt/verification.ts';
import { nodeFixtureFiles, populateFixture, STUB_GIT_PROFILE } from './fixtures.ts';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function realIndex(): Promise<EvidenceIndex> {
  dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-verification-'));
  await populateFixture(dir, nodeFixtureFiles());
  const { survey } = await runSurvey({ rootDir: dir, gitProfile: STUB_GIT_PROFILE });
  const inventory = await runInventory({ rootDir: dir, survey });
  return buildEvidenceIndex(survey, inventory);
}

function componentFinding(evidence: CartographyFinding['evidence']): CartographyFinding {
  return {
    kind: 'component',
    statement: 'src/routes.ts is a routing component.',
    confidence: 'medium',
    evidence,
  };
}

describe('classifyCartographyCheckKind', () => {
  it('classifies data-ownership claims as schema', () => {
    const finding: CartographyFinding = {
      kind: 'data-ownership',
      statement: 'users lives in the users table.',
      confidence: 'medium',
      evidence: [{ kind: 'path', path: 'migrations/0001_init.sql' }],
      table: 'users',
      owner: 'api',
    };
    expect(classifyCartographyCheckKind(finding)).toBe('schema');
  });

  it('classifies a claim citing a ci: fact as pipeline', () => {
    const finding = componentFinding([
      { kind: 'fact', description: 'ci:github-actions@.github/workflows/ci.yml' },
    ]);
    expect(classifyCartographyCheckKind(finding)).toBe('pipeline');
  });

  it('classifies a claim citing a public-api:http-route fact as route', () => {
    const finding = componentFinding([
      { kind: 'fact', description: 'public-api:http-route:GET /health@src/routes.ts' },
    ]);
    expect(classifyCartographyCheckKind(finding)).toBe('route');
  });

  it('falls back to call-graph for an ordinary structural claim', () => {
    const finding = componentFinding([{ kind: 'path', path: 'src/routes.ts' }]);
    expect(classifyCartographyCheckKind(finding)).toBe('call-graph');
  });
});

describe('verifyCartographyFinding', () => {
  it('passes when every cited evidence entry still resolves', async () => {
    const index = await realIndex();
    const finding = componentFinding([{ kind: 'path', path: 'src/routes.ts' }]);
    const check = verifyCartographyFinding(finding, index, '2026-09-12T00:00:00.000Z');
    expect(check.outcome).toBe('pass');
    expect(check.kind).toBe('call-graph');
    expect(check.subject).toEqual({ origin: 'cartography', statement: finding.statement });
  });

  it('fails -- disproves the claim -- when a cited path no longer exists in a fresh index', async () => {
    const index = await realIndex();
    const finding = componentFinding([{ kind: 'path', path: 'src/this-file-was-deleted.ts' }]);
    const check = verifyCartographyFinding(finding, index, '2026-09-12T00:00:00.000Z');
    expect(check.outcome).toBe('fail');
    expect(check.detail).toContain('src/this-file-was-deleted.ts');
  });

  it('fails whole when only one of two citations still resolves', async () => {
    const index = await realIndex();
    const finding = componentFinding([
      { kind: 'path', path: 'src/routes.ts' },
      { kind: 'path', path: 'src/fabricated.ts' },
    ]);
    const check = verifyCartographyFinding(finding, index, '2026-09-12T00:00:00.000Z');
    expect(check.outcome).toBe('fail');
  });

  it('classifies a data-ownership finding as schema even when it passes', async () => {
    const index = await realIndex();
    const finding: CartographyFinding = {
      kind: 'data-ownership',
      statement: 'users lives in migrations/0001_init.sql.',
      confidence: 'high',
      evidence: [{ kind: 'path', path: 'migrations/0001_init.sql' }],
      table: 'users',
      owner: 'api',
    };
    const check = verifyCartographyFinding(finding, index, '2026-09-12T00:00:00.000Z');
    expect(check.kind).toBe('schema');
    expect(check.outcome).toBe('pass');
  });
});

describe('verifyConventionFinding', () => {
  const finding: InferenceFinding = {
    kind: 'convention',
    statement: 'Handlers validate input before use.',
    evidence: [{ kind: 'path', path: 'src/routes.ts' }],
    confidence: 'medium',
    status: 'draft',
    adherenceRatio: '17 of 21',
  };

  it('is inconclusive when no fresh ratio could be recomputed', () => {
    const check = verifyConventionFinding(finding, undefined, '2026-09-12T00:00:00.000Z');
    expect(check.outcome).toBe('inconclusive');
    expect(check.kind).toBe('convention');
  });

  it('passes when the re-counted ratio matches the claimed one', () => {
    const check = verifyConventionFinding(
      finding,
      { matched: 17, total: 21 },
      '2026-09-12T00:00:00.000Z',
    );
    expect(check.outcome).toBe('pass');
  });

  it('fails -- disproves the claim -- when the re-counted ratio disagrees', () => {
    const check = verifyConventionFinding(
      finding,
      { matched: 3, total: 21 },
      '2026-09-12T00:00:00.000Z',
    );
    expect(check.outcome).toBe('fail');
    expect(check.detail).toContain('3 of 21');
    expect(check.detail).toContain('17 of 21');
  });

  it('passes with no prior ratio to compare against', () => {
    const noPrior: InferenceFinding = {
      kind: finding.kind,
      statement: finding.statement,
      evidence: finding.evidence,
      confidence: finding.confidence,
      status: finding.status,
    };
    const check = verifyConventionFinding(
      noPrior,
      { matched: 5, total: 5 },
      '2026-09-12T00:00:00.000Z',
    );
    expect(check.outcome).toBe('pass');
  });
});

describe('assembleVerification', () => {
  const measuredAt = '2026-09-12T00:00:00.000Z';

  it('promotes a passing repository-origin build check to confidence: verified, with its command stored', () => {
    const checks: RawVerificationCheck[] = [
      {
        kind: 'build',
        subject: { origin: 'repository', statement: 'the build succeeds' },
        outcome: 'pass',
        detail: 'npm run build exited 0 in 812ms.',
        command: 'npm run build',
        measuredAt,
      },
    ];
    const result = assembleVerification(checks);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      promotion: 'verified',
      confidenceAfter: 'verified',
    });
    expect(result.findings[0]?.command).toBe('npm run build');
    expect(result.gaps).toHaveLength(0);
  });

  it('records a failed build as a real finding and a gap, and never aborts the batch', () => {
    const checks: RawVerificationCheck[] = [
      {
        kind: 'build',
        subject: { origin: 'repository', statement: 'the build succeeds' },
        outcome: 'fail',
        detail: 'npm run build exited 1: Cannot find module "./missing.ts"',
        command: 'npm run build',
        measuredAt,
      },
      {
        kind: 'call-graph',
        subject: { origin: 'cartography', statement: 'src/routes.ts is a routing component.' },
        outcome: 'pass',
        detail: 'still resolves.',
        measuredAt,
      },
    ];
    const result = assembleVerification(checks);
    // The batch is not aborted by the first failure -- the second, unrelated check is still present.
    expect(result.findings).toHaveLength(2);
    const buildFinding = result.findings.find((f) => f.kind === 'build');
    expect(buildFinding?.promotion).toBe('downgraded');
    // A repository-origin fact (not a prior KB claim) has no confidence value to downgrade.
    expect(buildFinding?.confidenceAfter).toBeUndefined();
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]?.kind).toBe('build');
    expect(result.gaps[0]?.command).toBe('npm run build');
  });

  it('downgrades a cartography claim VERIFICATION disproves to confidence: low, never leaving it unchanged', () => {
    const checks: RawVerificationCheck[] = [
      {
        kind: 'call-graph',
        subject: { origin: 'cartography', statement: 'A calls B.' },
        outcome: 'fail',
        detail: 'evidence no longer resolves: src/fabricated.ts',
        measuredAt,
      },
    ];
    const result = assembleVerification(checks);
    expect(result.findings[0]?.promotion).toBe('downgraded');
    expect(result.findings[0]?.confidenceAfter).toBe('low');
    expect(result.gaps).toHaveLength(1);
  });

  it('leaves an inconclusive check unchanged, with no confidenceAfter, but still records it as a gap', () => {
    const checks: RawVerificationCheck[] = [
      {
        kind: 'convention',
        subject: { origin: 'inference', statement: 'Handlers validate input.' },
        outcome: 'inconclusive',
        detail: 'no fresh adherence ratio could be recomputed.',
        measuredAt,
      },
    ];
    const result = assembleVerification(checks);
    expect(result.findings[0]?.promotion).toBe('unchanged');
    expect(result.findings[0]?.confidenceAfter).toBeUndefined();
    expect(result.gaps).toHaveLength(1);
  });

  it('handles an empty check list', () => {
    expect(assembleVerification([])).toEqual({ findings: [], gaps: [] });
  });
});
