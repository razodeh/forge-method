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
