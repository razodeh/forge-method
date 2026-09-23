/**
 * `gateReportSchema` — base front matter narrowed to `type: 'GateReport'`; see `SPEC-QUESTIONS.md`
 * Q23 for why this schema carries no type-specific fields.
 *
 * @see specs/10-workflow-engine-and-lifecycle.md §10
 * @see specs/21 §21.3
 * @see SPEC-QUESTIONS.md Q23
 */
import { describe, expect, it } from 'vitest';

import { gateReportSchema } from '../../src/artifacts/gate-report.ts';

function validGateReport(): Record<string, unknown> {
  return {
    id: 'GATE-001',
    type: 'GateReport',
    schemaVersion: 1,
    title: 'G-Design gate evaluation',
    status: 'approved',
    created: '2026-03-05',
    updated: '2026-03-05',
    revision: 1,
    author: 'orchestrator',
    changelog: [],
  };
}

describe('gateReportSchema — valid', () => {
  it('accepts base front matter with type GateReport', () => {
    expect(gateReportSchema.safeParse(validGateReport()).success).toBe(true);
  });
});

describe('gateReportSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match its type', () => {
    const result = gateReportSchema.safeParse({ ...validGateReport(), id: 'RUN-001' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a type other than the literal "GateReport"', () => {
    const result = gateReportSchema.safeParse({ ...validGateReport(), type: 'Runbook' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  it('rejects an unknown top-level key', () => {
    const result = gateReportSchema.safeParse({ ...validGateReport(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});

// `PLAN-M14.md` P17: `gate`, `outcome` and `evaluatedAt` — the fields `renderGateReportFile`
// (`@forge/engine/gates`) writes, all optional so a report written before this piece (or the static
// stub template, `templates/artifacts/GateReport.md`) still validates.
describe('gateReportSchema — gate/outcome/evaluatedAt (PLAN-M14.md P17)', () => {
  it('accepts front matter with no gate/outcome/evaluatedAt at all (a report written before this piece, or the stub template)', () => {
    expect(gateReportSchema.safeParse(validGateReport()).success).toBe(true);
  });

  it('accepts a real gate/outcome/evaluatedAt triple', () => {
    const result = gateReportSchema.safeParse({
      ...validGateReport(),
      gate: 'G-Design',
      outcome: 'waived',
      evaluatedAt: '2026-03-05T12:00:00.000Z',
    });
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it.each(['passed', 'failed', 'waived'] as const)('accepts outcome: %s', (outcome) => {
    expect(gateReportSchema.safeParse({ ...validGateReport(), outcome }).success).toBe(true);
  });

  it('rejects an outcome outside passed|failed|waived', () => {
    const result = gateReportSchema.safeParse({ ...validGateReport(), outcome: 'approved' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['outcome']);
  });

  it('rejects a blank gate', () => {
    const result = gateReportSchema.safeParse({ ...validGateReport(), gate: '' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['gate']);
  });

  it('rejects an evaluatedAt that is not a real ISO instant', () => {
    const result = gateReportSchema.safeParse({ ...validGateReport(), evaluatedAt: '2026-03-05' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['evaluatedAt']);
  });
});
