/**
 * `buildGateReport` — `10` §10.3's own rule 4: every gate evaluation writes a report with the exact
 * command output; rule 3: gates are re-runnable and idempotent.
 *
 * `renderGateReportFile`/`sanitizedCheckText`/`gateReportOutcome` (`PLAN-M14.md` P17): the real,
 * schema-conformant document that rule 4's "audit trail" actually means, and the sanitised, capped text
 * `recordChecks` (`approve.ts`) digests -- "the digests verify against it."
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 * @see PLAN-M14.md P17
 */
import { createHash } from 'node:crypto';

import { ArtifactDocument, validateArtifact } from '@forge/core/artifacts';
import { describe, expect, it } from 'vitest';

import { recordChecks } from '../../src/gates/approve.ts';
import {
  MAX_GATE_REPORT_CHECK_TEXT_BYTES,
  buildGateReport,
  gateReportOutcome,
  renderGateReportFile,
  sanitizedCheckText,
  type GateReportFileInput,
} from '../../src/gates/report.ts';
import { applyWaiver } from '../../src/gates/waiver.ts';
import type {
  DeterministicCheckResult,
  GateDefinition,
  GateEvaluationResult,
  GateReport,
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
    warnings: [],
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

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The `## `-level headings of `text`, in document order (the same shape `validateArtifact`'s own
 * `topLevelHeadings` extracts, reproduced here in miniature rather than imported: this test only needs
 * the extraction, not `@forge/core/artifacts`' own private helper). */
function topLevelHeadings(text: string): string[] {
  return (text.match(/^## .*$/gm) ?? []).map((line) => line.slice('## '.length));
}

describe('gateReportOutcome', () => {
  it('is "passed" when the evaluation passed, "waived" when a waiver was applied, "failed" otherwise', () => {
    const g = gate({ id: 'G-Test' });
    expect(gateReportOutcome(buildGateReport(g, result({ passed: true })))).toBe('passed');
    expect(gateReportOutcome(buildGateReport(g, result({ passed: false })))).toBe('failed');
    const waiver: Waiver = { reason: 'r', owner: 'o', expiresAt: '2099-01-01T00:00:00.000Z' };
    const waived = applyWaiver(
      result({ passed: false }),
      waiver,
      Date.parse('2026-01-01T00:00:00.000Z'),
    );
    expect(gateReportOutcome(buildGateReport(g, waived))).toBe('waived');
  });
});

describe('renderGateReportFile', () => {
  const GATE = gate({
    id: 'G-Design',
    checks: {
      deterministic: [
        { id: 'spec:validate', run: 'forge spec validate --json', failOn: 'errors > 0' },
      ],
      advisory: [{ id: 'architect-review', agent: 'critic', brief: 'briefs/critique.md' }],
    },
  });

  function fileInput(overrides: Partial<GateReportFileInput> = {}): GateReportFileInput {
    const report: GateReport = buildGateReport(
      GATE,
      result({
        gateId: 'G-Design',
        passed: false,
        checks: [
          checkResult({
            checkId: 'spec:validate',
            passed: false,
            stdout: '{"errors":1}',
            stderr: 'a warning on stderr',
            exitCode: 0,
            reason: 'errors > 0',
          }),
        ],
      }),
    );
    return {
      id: 'GATE-001',
      gate: GATE,
      report,
      runId: 'run-1',
      evaluatedAt: '2026-03-04T12:00:00.000Z',
      ...overrides,
    };
  }

  it('renders byte-identically for two freshly, separately built but structurally identical inputs -- no clock, no I/O, no randomness', () => {
    expect(renderGateReportFile(fileInput())).toBe(renderGateReportFile(fileInput()));
  });

  it("front matter validates against the real gateReportSchema, carrying the document's own id, the gate id, outcome and evaluatedAt", () => {
    const text = renderGateReportFile(fileInput());
    const doc = ArtifactDocument.parse(text, 'GATE-001.md');
    expect(doc.frontMatter).toMatchObject({
      id: 'GATE-001',
      type: 'GateReport',
      gate: 'G-Design',
      outcome: 'failed',
      evaluatedAt: '2026-03-04T12:00:00.000Z',
    });
    expect(validateArtifact(doc)).toEqual({ valid: true });
  });

  it('lists one ## section per deterministic check and one per advisory check, the advisory one saying it did not run', () => {
    const text = renderGateReportFile(fileInput());
    expect(topLevelHeadings(text)).toEqual(['spec:validate', 'architect-review (advisory)']);
    expect(text).toContain('- agent: critic');
    expect(text).toContain('- run: not run');
  });

  it('a deterministic check section carries run (from the check RESULT, its exact command), exitCode, passed, failOn (from the gate definition, which alone declares it) and reason', () => {
    const text = renderGateReportFile(fileInput());
    // `checkResult`'s own default `run` is `"run spec:validate"` -- the check RESULT's own recorded
    // command, distinct from (here, deliberately different text than) the gate definition's `run`, so
    // this also proves the section reads `run` from the result, not from `declared.run`.
    expect(text).toContain('- run: run spec:validate');
    expect(text).toContain('- exitCode: 0');
    expect(text).toContain('- passed: false');
    expect(text).toContain('- failOn: errors > 0');
    expect(text).toContain('- reason: errors > 0');
  });

  it('lists the waiver in force, when one was applied', () => {
    const waiver: Waiver = {
      reason: 'known flaky',
      owner: 'radwan',
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    const waived = applyWaiver(
      result({
        gateId: 'G-Design',
        passed: false,
        checks: [checkResult({ checkId: 'spec:validate', passed: false, stdout: '{"errors":1}' })],
      }),
      waiver,
      Date.parse('2026-01-01T00:00:00.000Z'),
    );
    const text = renderGateReportFile(fileInput({ report: buildGateReport(GATE, waived) }));
    expect(text).toContain('## Waiver');
    expect(text).toContain('- owner: radwan');
    expect(text).toContain('- expiresAt: 2099-01-01T00:00:00.000Z');
    expect(text).toContain('- reason: known flaky');
  });

  it("redacts an AKIA-shaped key in a check's stdout, and recordChecks digests the identical redacted text the report fences", () => {
    const key = `AKIA${'A'.repeat(16)}`;
    const stdout = `{"errors":1,"leaked":"${key}"}`;
    const check = checkResult({ checkId: 'spec:validate', passed: false, stdout, exitCode: 0 });
    const report = buildGateReport(
      GATE,
      result({ gateId: 'G-Design', passed: false, checks: [check] }),
    );
    const text = renderGateReportFile(fileInput({ report }));

    expect(text).not.toContain(key);
    expect(text).toContain('[REDACTED]');

    const sanitized = sanitizedCheckText(stdout);
    expect(text).toContain(sanitized);
    expect(recordChecks({ checks: [check] }, false)[0]?.stdoutSha256).toBe(sha256(sanitized));
  });

  it('caps stdout at MAX_GATE_REPORT_CHECK_TEXT_BYTES with a truncation marker, and recordChecks digests the SAME capped text', () => {
    const huge = 'x'.repeat(MAX_GATE_REPORT_CHECK_TEXT_BYTES + 1000);
    const check = checkResult({
      checkId: 'spec:validate',
      passed: false,
      stdout: huge,
      exitCode: 0,
    });
    const report = buildGateReport(
      GATE,
      result({ gateId: 'G-Design', passed: false, checks: [check] }),
    );
    const text = renderGateReportFile(fileInput({ report }));

    expect(text).toContain('[truncated:');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(2 * MAX_GATE_REPORT_CHECK_TEXT_BYTES);

    const sanitized = sanitizedCheckText(huge);
    expect(sanitized).toContain('[truncated:');
    expect(text).toContain(sanitized);
    expect(recordChecks({ checks: [check] }, false)[0]?.stdoutSha256).toBe(sha256(sanitized));
  });

  it('strips a terminal escape sequence out of stdout before it is ever fenced', () => {
    const dirty = '{"errors":1}\u001b[31mred\u001b[0m';
    const check = checkResult({
      checkId: 'spec:validate',
      passed: false,
      stdout: dirty,
      exitCode: 0,
    });
    const report = buildGateReport(
      GATE,
      result({ gateId: 'G-Design', passed: false, checks: [check] }),
    );
    const text = renderGateReportFile(fileInput({ report }));

    // eslint-disable-next-line no-control-regex -- asserting the escape byte is genuinely gone
    expect(text).not.toMatch(/\u001b/);
    expect(text).toContain('{"errors":1}red');
  });

  it('fences a stray ``` inside stdout with a wider fence, so the block cannot be broken out of', () => {
    const trickyStdout = '{"errors":1}\n```\nnot a real fence close\n````';
    const check = checkResult({
      checkId: 'spec:validate',
      passed: false,
      stdout: trickyStdout,
      exitCode: 0,
    });
    const report = buildGateReport(
      GATE,
      result({ gateId: 'G-Design', passed: false, checks: [check] }),
    );
    const text = renderGateReportFile(fileInput({ report }));

    // The report's own front matter/body structure still parses: no stray fence broke out and forged a
    // second front-matter block or an extra heading.
    const doc = ArtifactDocument.parse(text, 'GATE-001.md');
    expect(doc.frontMatter).toMatchObject({ type: 'GateReport' });
    expect(topLevelHeadings(text)).toEqual(['spec:validate', 'architect-review (advisory)']);
  });
});
