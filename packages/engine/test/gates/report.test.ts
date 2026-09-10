/**
 * `buildGateReport` — `10` §10.3's own rule 4: every gate evaluation writes a report with the exact
 * command output; rule 3: gates are re-runnable and idempotent.
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 */
import { describe, expect, it } from 'vitest';

import { buildGateReport } from '../../src/gates/report.ts';
import { applyWaiver } from '../../src/gates/waiver.ts';
import type {
  DeterministicCheckResult,
  GateDefinition,
  GateEvaluationResult,
  Waiver,
} from '../../src/gates/types.ts';

function gate(overrides: Partial<GateDefinition> & { readonly id: string }): GateDefinition {
  return {
    checks: { deterministic: [], advisory: [] },
    openQuestionsPolicy: 'block',
    ...overrides,
  };
}

function checkResult(
  overrides: Partial<DeterministicCheckResult> & { readonly checkId: string },
): DeterministicCheckResult {
  return { run: `run ${overrides.checkId}`, passed: true, stdout: '{}', exitCode: 0, ...overrides };
}

function result(
  overrides: Partial<GateEvaluationResult> & { readonly passed: boolean },
): GateEvaluationResult {
  return {
    gateId: 'G-Test',
    checks: [],
    advisory: [],
    openQuestionsPolicy: 'block',
    waiver: undefined,
    waiverAppliedAt: undefined,
    ...overrides,
  };
}

describe('buildGateReport', () => {
  it("carries the gate id, pass/fail, and every check's own real command output through into the report", () => {
    const checks = [
      checkResult({ checkId: 'a', passed: true, stdout: '{"errors":0}' }),
      checkResult({ checkId: 'b', passed: false, stdout: '{"errors":3}', reason: 'errors > 0' }),
    ];
    const report = buildGateReport(
      gate({ id: 'G-Design' }),
      result({ passed: false, gateId: 'G-Design', checks }),
    );
    expect(report.gateId).toBe('G-Design');
    expect(report.passed).toBe(false);
    expect(report.checks).toEqual(checks);
  });

  it('reports approved: false for a failing gate with no waiver', () => {
    const report = buildGateReport(gate({ id: 'G-Test' }), result({ passed: false }));
    expect(report.approved).toBe(false);
  });

  it('reports approved: true for a passing gate', () => {
    const report = buildGateReport(gate({ id: 'G-Test' }), result({ passed: true }));
    expect(report.approved).toBe(true);
  });

  it('reports approved: true for a failing gate once a valid waiver has been applied, and carries the waiver itself and waiverAppliedAt through', () => {
    const waiver: Waiver = {
      reason: 'known false positive',
      owner: 'alice',
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    const appliedAt = Date.parse('2026-01-01T00:00:00.000Z');
    const waived = applyWaiver(result({ passed: false }), waiver, appliedAt);
    const report = buildGateReport(gate({ id: 'G-Test' }), waived);
    expect(report.approved).toBe(true);
    expect(report.waiver).toEqual(waiver);
    expect(report.waiverAppliedAt).toBe(appliedAt);
  });

  it('is idempotent: building a report twice from the identical (gate, result) pair produces a byte-identical report (rule 3)', () => {
    const g = gate({ id: 'G-Test' });
    const r = result({ passed: false, checks: [checkResult({ checkId: 'a', passed: false })] });
    expect(buildGateReport(g, r)).toEqual(buildGateReport(g, r));
  });

  it('is idempotent even across two freshly, separately constructed (gate, result) pairs that are merely structurally identical -- not just the same object references reused twice', () => {
    // A critic round found the test above calls buildGateReport with the SAME g/r object references both
    // times, which cannot distinguish real idempotence from an implementation that happened to cache or
    // memoize by reference identity. Two independently-built, deep-equal-but-reference-distinct inputs
    // rule that out.
    const first = buildGateReport(
      gate({ id: 'G-Test' }),
      result({
        passed: false,
        checks: [checkResult({ checkId: 'a', passed: false, reason: 'errors > 0' })],
      }),
    );
    const second = buildGateReport(
      gate({ id: 'G-Test' }),
      result({
        passed: false,
        checks: [checkResult({ checkId: 'a', passed: false, reason: 'errors > 0' })],
      }),
    );
    expect(first).toEqual(second);
  });

  it('sources gateId and openQuestionsPolicy from the gate definition, not the evaluation result -- a verify round found an earlier version split these two identity/policy fields inconsistently, with no real reason for the difference', () => {
    // For any output of the real evaluateGate -> applyWaiver pipeline these always agree anyway
    // (evaluateGate itself only ever copies both from the same gate it was given); this test deliberately
    // constructs a mismatched pair to prove which one wins, not to exercise a real, supported use case.
    const g = gate({ id: 'G-Real', openQuestionsPolicy: 'warn' });
    const r = result({ passed: true, gateId: 'G-Mismatched', openQuestionsPolicy: 'block' });
    const report = buildGateReport(g, r);
    expect(report.gateId).toBe('G-Real');
    expect(report.openQuestionsPolicy).toBe('warn');
  });
});
