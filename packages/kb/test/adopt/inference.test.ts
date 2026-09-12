/**
 * `assembleInference` — `17` §17.2 phase 4's own Checks (`PLAN-M10.md` P16): every accepted finding is
 * `confidence: low|medium`/`status: draft`, structurally, regardless of what a raw claim itself asserted,
 * and a real numeric adherence ratio is required for a `convention` claim.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P16
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildEvidenceIndex, type EvidenceIndex } from '../../src/adopt/evidence.ts';
import {
  assembleInference,
  clampInferenceConfidence,
  validateInferenceEvidence,
  type RawInferenceClaim,
} from '../../src/adopt/inference.ts';
import { runInventory } from '../../src/adopt/inventory.ts';
import { runSurvey } from '../../src/adopt/survey.ts';
import { nodeFixtureFiles, populateFixture, STUB_GIT_PROFILE } from './fixtures.ts';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function realIndex(): Promise<EvidenceIndex> {
  dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-inference-'));
  await populateFixture(dir, nodeFixtureFiles());
  const { survey } = await runSurvey({ rootDir: dir, gitProfile: STUB_GIT_PROFILE });
  const inventory = await runInventory({ rootDir: dir, survey });
  return buildEvidenceIndex(survey, inventory);
}

describe('clampInferenceConfidence', () => {
  it('keeps "low" as "low"', () => {
    expect(clampInferenceConfidence('low')).toBe('low');
  });

  it('clamps "medium" to "medium"', () => {
    expect(clampInferenceConfidence('medium')).toBe('medium');
  });

  it('clamps "high" down to "medium" -- no path to a higher value from this phase', () => {
    expect(clampInferenceConfidence('high')).toBe('medium');
  });

  it('clamps "verified" down to "medium"', () => {
    expect(clampInferenceConfidence('verified')).toBe('medium');
  });

  it('clamps a malformed/unrecognised value down to "medium", never crashes', () => {
    expect(clampInferenceConfidence('extremely-confident')).toBe('medium');
  });
});

describe('validateInferenceEvidence', () => {
  it('rejects a convention claim with no adherence ratio', async () => {
    const index = await realIndex();
    const claim: RawInferenceClaim = {
      kind: 'convention',
      statement: 'Handlers validate input before use.',
      confidence: 'medium',
      evidence: [{ kind: 'path', path: 'src/routes.ts' }],
    };
    expect(validateInferenceEvidence(claim, index)).toBe('convention claim has no adherence ratio');
  });

  it('accepts a convention claim with a real "17 of 21"-shaped ratio', async () => {
    const index = await realIndex();
    const claim: RawInferenceClaim = {
      kind: 'convention',
      statement: 'Most route handlers read config via process.env directly.',
      confidence: 'medium',
      evidence: [{ kind: 'path', path: 'src/routes.ts' }],
      adherence: { matched: 17, total: 21 },
    };
    expect(validateInferenceEvidence(claim, index)).toBeUndefined();
  });

  it('rejects an invalid adherence ratio (matched > total)', async () => {
    const index = await realIndex();
    const claim: RawInferenceClaim = {
      kind: 'convention',
      statement: 'Impossible ratio.',
      confidence: 'medium',
      evidence: [{ kind: 'path', path: 'src/routes.ts' }],
      adherence: { matched: 22, total: 21 },
    };
    expect(validateInferenceEvidence(claim, index)).toContain('invalid adherence ratio');
  });

  it('rejects a fabricated claim citing evidence outside SURVEY/INVENTORY', async () => {
    const index = await realIndex();
    const claim: RawInferenceClaim = {
      kind: 'intent',
      statement: 'The invented CacheWarmer component exists to pre-load hot data.',
      confidence: 'high',
      evidence: [{ kind: 'path', path: 'src/invented/cache-warmer.ts' }],
    };
    expect(validateInferenceEvidence(claim, index)).toContain('evidence not found');
  });

  it('rejects a glossary claim missing term/definition', async () => {
    const index = await realIndex();
    const claim: RawInferenceClaim = {
      kind: 'glossary',
      statement: 'A domain term appears in the routes.',
      confidence: 'low',
      evidence: [{ kind: 'path', path: 'src/routes.ts' }],
    };
    expect(validateInferenceEvidence(claim, index)).toBe(
      'glossary claim missing term or definition',
    );
  });
});

describe('assembleInference', () => {
  it('every accepted finding is confidence low|medium and status draft, no exceptions', async () => {
    const index = await realIndex();
    const rawClaims: readonly RawInferenceClaim[] = [
      {
        kind: 'convention',
        statement: 'Route handlers read env vars directly.',
        confidence: 'verified',
        evidence: [{ kind: 'path', path: 'src/routes.ts' }],
        adherence: { matched: 2, total: 2 },
      },
      {
        kind: 'intent',
        statement: 'The db module centralises the connection string.',
        confidence: 'low',
        evidence: [{ kind: 'path', path: 'src/db.ts' }],
      },
      {
        kind: 'glossary',
        statement: 'The term "fixture" recurs across the repo.',
        confidence: 'high',
        evidence: [{ kind: 'path', path: 'package.json' }],
        term: 'fixture',
        definition: 'A small, deliberately-shaped example repository used for testing.',
      },
    ];
    const result = assembleInference(rawClaims, index);
    expect(result.findings).toHaveLength(3);
    for (const finding of result.findings) {
      expect(['low', 'medium']).toContain(finding.confidence);
      expect(finding.status).toBe('draft');
    }
    const convention = result.findings.find((f) => f.kind === 'convention');
    expect(convention?.adherenceRatio).toBe('2 of 2');
    expect(convention?.confidence).toBe('medium'); // clamped from 'verified'
  });

  it('a fabricated claim is rejected, a real one in the same batch is kept', async () => {
    const index = await realIndex();
    const rawClaims: readonly RawInferenceClaim[] = [
      {
        kind: 'nfr',
        statement: 'No timeout is configured on the outbound Postgres connection.',
        confidence: 'medium',
        evidence: [{ kind: 'path', path: 'src/db.ts' }],
      },
      {
        kind: 'nfr',
        statement: 'An invented rate limiter exists at src/invented/rate-limiter.ts.',
        confidence: 'high',
        evidence: [{ kind: 'path', path: 'src/invented/rate-limiter.ts' }],
      },
    ];
    const result = assembleInference(rawClaims, index);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.statement).toContain('Postgres');
    expect(result.rejected).toHaveLength(1);
  });
});
