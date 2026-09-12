/**
 * `computeMeasuredFacts`/`evaluateGAdoptGate`/`diffBaselines` — `17` §17.2 phase 8's own measured-facts
 * snapshot and `G-Adopt` gate, and `PLAN-M10.md` P19's own literal Checks-section exit test: "`G-Adopt`
 * refuses to pass with an unconfirmed `high`-impact claim present."
 *
 * @see specs/17 §17.2 phase 8
 * @see PLAN-M10.md P19
 */
import { describe, expect, it } from 'vitest';

import {
  computeMeasuredFacts,
  diffBaselines,
  evaluateGAdoptGate,
  type BaselineSnapshot,
  type GAdoptGateInput,
} from '../../src/adopt/baseline.ts';
import type { ConfirmableClaim, ConfirmationOutcome } from '../../src/adopt/confirmation.ts';
import type { GapAnalysisResult } from '../../src/adopt/gap-analysis.ts';
import type { Inventory } from '../../src/adopt/inventory.ts';
import type { Survey } from '../../src/adopt/survey.ts';
import type { VerificationResult } from '../../src/adopt/verification.ts';

function claim(overrides: Partial<ConfirmableClaim> & { id: string }): ConfirmableClaim {
  return {
    section: 'architecture',
    statement: `Claim ${overrides.id}`,
    evidence: [],
    confidence: 'low',
    impact: 'medium',
    consequenceIfWrong: 'unknown',
    ...overrides,
  };
}

function confirmedOutcome(claimId: string): ConfirmationOutcome {
  return {
    claimId,
    answer: 'confirm',
    confidence: 'high',
    status: 'active',
    openQuestion: undefined,
  };
}

const emptyGapAnalysis: GapAnalysisResult = { findings: [] };

function minimalSurvey(): Survey {
  return {
    size: { totalFiles: 1, totalLines: 10, byLanguage: [] },
    manifests: [],
    entryPoints: [],
    deployableUnits: [],
    datastores: [],
    testSetup: { testDirs: [], frameworks: [], ciTestCommands: [] },
    ci: [],
    gitProfile: {
      hasCommits: true,
      ageDays: 1,
      commitCount: 1,
      contributorCount: 1,
      churnHotspots: [],
      filesChangedTogether: [],
    },
    existingDocs: [],
    health: { todoFixmeCount: 0, lintConfigPresent: false, typeCheckConfigPresent: false },
  };
}

function minimalInventory(): Inventory {
  return {
    dependencyGraph: { nodes: [], cycles: [] },
    publicApiSurface: [],
    dataSurface: [],
    configSurface: [],
    externalDependencies: [{ name: 'a', version: '1.0.0', ecosystem: 'npm' }],
  };
}

function verificationWith(
  overrides: Partial<VerificationResult['findings'][number]>[] = [],
): VerificationResult {
  return {
    findings: overrides.map((o) => ({
      kind: 'build',
      subject: { origin: 'repository', statement: 'build' },
      outcome: 'pass',
      detail: 'ok',
      measuredAt: '2026-01-01T00:00:00.000Z',
      promotion: 'verified',
      confidenceAfter: 'verified',
      ...o,
    })),
    gaps: [],
  };
}

describe('computeMeasuredFacts', () => {
  it('measures a real test pass rate from repository-origin test findings', () => {
    const verification: VerificationResult = {
      findings: [
        {
          kind: 'test',
          subject: { origin: 'repository', statement: 'test' },
          outcome: 'pass',
          detail: 'ok',
          measuredAt: '2026-01-01T00:00:00.000Z',
          promotion: 'verified',
          confidenceAfter: 'verified',
          coverage: 92,
        },
        {
          kind: 'test',
          subject: { origin: 'repository', statement: 'test' },
          outcome: 'fail',
          detail: 'failed',
          measuredAt: '2026-01-01T00:00:00.000Z',
          promotion: 'downgraded',
        },
      ],
      gaps: [],
    };
    const facts = computeMeasuredFacts(
      {
        survey: minimalSurvey(),
        inventory: minimalInventory(),
        verification,
        gapAnalysis: emptyGapAnalysis,
      },
      '2026-01-01',
    );
    expect(facts.testCount).toBe(2);
    expect(facts.testPassRate).toBeCloseTo(0.5);
    expect(facts.coverage).toBe(92);
  });

  it('reports testPassRate 0 (never NaN) when there are no test findings at all', () => {
    const facts = computeMeasuredFacts(
      {
        survey: minimalSurvey(),
        inventory: minimalInventory(),
        verification: verificationWith([]),
        gapAnalysis: emptyGapAnalysis,
      },
      '2026-01-01',
    );
    expect(facts.testCount).toBe(0);
    expect(facts.testPassRate).toBe(0);
    expect(Number.isNaN(facts.testPassRate)).toBe(false);
  });

  it('counts gaps per class from a real GapAnalysisResult', () => {
    const gapAnalysis: GapAnalysisResult = {
      findings: [
        {
          gapClass: 'safety',
          severity: 'critical',
          statement: 's',
          evidence: [],
          actionable: true,
          mitigation: 'm',
        },
        {
          gapClass: 'safety',
          severity: 'high',
          statement: 's2',
          evidence: [],
          actionable: true,
          mitigation: 'm',
        },
        {
          gapClass: 'knowledge',
          severity: 'low',
          statement: 's3',
          evidence: [],
          actionable: true,
          mitigation: 'm',
        },
      ],
    };
    const facts = computeMeasuredFacts(
      {
        survey: minimalSurvey(),
        inventory: minimalInventory(),
        verification: verificationWith([]),
        gapAnalysis,
      },
      '2026-01-01',
    );
    expect(facts.gapCounts.safety).toBe(2);
    expect(facts.gapCounts.knowledge).toBe(1);
    expect(facts.gapCounts.consistency).toBe(0);
  });
});

function baseGateInput(): GAdoptGateInput {
  return {
    kbLint: { clean: true, errors: [] },
    highImpactClaims: [],
    verification: verificationWith([{ kind: 'build' }, { kind: 'test' }]),
    gapReportExists: true,
  };
}

describe('evaluateGAdoptGate', () => {
  it('passes when all four `17` §17.2 phase 8 conditions hold', () => {
    const result = evaluateGAdoptGate(baseGateInput());
    expect(result.passed).toBe(true);
    expect(result.conditions).toHaveLength(4);
    expect(result.conditions.every((c) => c.passed)).toBe(true);
  });

  it('the literal M10 exit test: refuses to pass with an unconfirmed high-impact claim present', () => {
    const highImpactClaim = claim({ id: 'HI-1', impact: 'high', confidence: 'low' });
    const result = evaluateGAdoptGate({
      ...baseGateInput(),
      highImpactClaims: [{ claim: highImpactClaim, outcome: undefined }],
    });
    expect(result.passed).toBe(false);
    const condition = result.conditions.find((c) => c.name === 'high-impact-claims-resolved');
    expect(condition?.passed).toBe(false);
    expect(condition?.detail).toContain('Claim HI-1');
  });

  it('passes once that same high-impact claim is confirmed', () => {
    const highImpactClaim = claim({ id: 'HI-1', impact: 'high', confidence: 'low' });
    const result = evaluateGAdoptGate({
      ...baseGateInput(),
      highImpactClaims: [{ claim: highImpactClaim, outcome: confirmedOutcome('HI-1') }],
    });
    expect(result.passed).toBe(true);
  });

  it('passes a high-impact claim that VERIFICATION already promoted to verified, with no confirmation needed', () => {
    const verifiedClaim = claim({ id: 'HI-2', impact: 'high', confidence: 'verified' });
    const result = evaluateGAdoptGate({
      ...baseGateInput(),
      highImpactClaims: [{ claim: verifiedClaim, outcome: undefined }],
    });
    expect(result.passed).toBe(true);
  });

  it('a claim answered "reject" is not treated as confirmed — still refuses the gate', () => {
    const highImpactClaim = claim({ id: 'HI-3', impact: 'high', confidence: 'low' });
    const result = evaluateGAdoptGate({
      ...baseGateInput(),
      highImpactClaims: [
        {
          claim: highImpactClaim,
          outcome: {
            claimId: 'HI-3',
            answer: 'reject',
            confidence: 'low',
            status: 'draft',
            openQuestion: 'q',
          },
        },
      ],
    });
    expect(result.passed).toBe(false);
  });

  it('fails when the KB does not lint clean', () => {
    const result = evaluateGAdoptGate({
      ...baseGateInput(),
      kbLint: { clean: false, errors: ['KB-001: bad'] },
    });
    expect(result.passed).toBe(false);
    expect(result.conditions.find((c) => c.name === 'kb-lint-clean')?.passed).toBe(false);
  });

  it('fails when the build or test verification result is missing', () => {
    const result = evaluateGAdoptGate({
      ...baseGateInput(),
      verification: verificationWith([{ kind: 'build' }]),
    });
    expect(result.passed).toBe(false);
    const condition = result.conditions.find((c) => c.name === 'build-and-test-recorded');
    expect(condition?.passed).toBe(false);
    expect(condition?.detail).toContain('test');
  });

  it('fails when the gap report does not exist', () => {
    const result = evaluateGAdoptGate({ ...baseGateInput(), gapReportExists: false });
    expect(result.passed).toBe(false);
  });

  it('reports all four conditions even when several fail (no short-circuit)', () => {
    const result = evaluateGAdoptGate({
      kbLint: { clean: false, errors: ['x'] },
      highImpactClaims: [
        { claim: claim({ id: 'HI', impact: 'high', confidence: 'low' }), outcome: undefined },
      ],
      verification: verificationWith([]),
      gapReportExists: false,
    });
    expect(result.passed).toBe(false);
    expect(result.conditions).toHaveLength(4);
    expect(result.conditions.filter((c) => !c.passed)).toHaveLength(4);
  });
});

describe('diffBaselines', () => {
  it('computes a real numeric delta per field, including per-gap-class deltas', () => {
    const previous: BaselineSnapshot = {
      tag: 'BASELINE',
      commit: 'abc123',
      createdAt: '2026-01-01T00:00:00.000Z',
      facts: computeMeasuredFacts(
        {
          survey: minimalSurvey(),
          inventory: minimalInventory(),
          verification: verificationWith([]),
          gapAnalysis: emptyGapAnalysis,
        },
        '2026-01-01',
      ),
      gate: evaluateGAdoptGate(baseGateInput()),
    };
    const current = computeMeasuredFacts(
      {
        survey: minimalSurvey(),
        inventory: { ...minimalInventory(), externalDependencies: [] },
        verification: verificationWith([]),
        gapAnalysis: {
          findings: [
            {
              gapClass: 'safety',
              severity: 'high',
              statement: 's',
              evidence: [],
              actionable: true,
              mitigation: 'm',
            },
          ],
        },
      },
      '2026-02-01',
    );

    const diff = diffBaselines(previous, current);
    expect(diff.deltas['dependencyCount']).toBe(-1);
    expect(diff.deltas['gapCounts.safety']).toBe(1);
    expect(diff.deltas['gapCounts.knowledge']).toBe(0);
  });
});
