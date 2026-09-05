/**
 * `defectSchema` — `13` §13's `DefectRecord`.
 *
 * @see specs/13-frameworks-testing-and-debugging.md §13
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { defectSchema } from '../../src/artifacts/defect.ts';

function validDefect(): Record<string, unknown> {
  return {
    id: 'DEF-014',
    type: 'Defect',
    schemaVersion: 1,
    title: 'Invoice totals off by one cent on 3-item invoices',
    status: 'open',
    created: '2026-03-09',
    updated: '2026-03-09',
    revision: 1,
    author: 'diagnostician',
    changelog: [],
    observed: 'Invoice total is $10.01',
    expected: 'Invoice total is $10.00',
    first_seen: '2026-03-09',
    frequency: 'every 3-item invoice with 10% tax',
    environment: 'production',
    severity: 'Sev2',
    affected: ['CAP-004', 'STORY-014'],
    evidence: ['failing test tests/billing/preview.test.ts', 'log excerpt trace-id abc123'],
  };
}

describe('defectSchema — valid', () => {
  it('accepts a well-formed defect record', () => {
    expect(defectSchema.safeParse(validDefect()).success).toBe(true);
  });

  it.each(['Sev1', 'Sev2', 'Sev3', 'Sev4'])('accepts severity %s', (severity) => {
    expect(defectSchema.safeParse({ ...validDefect(), severity }).success).toBe(true);
  });
});

describe('defectSchema — invalid, each asserting the error path', () => {
  it('rejects a severity outside the Sev1-4 enum', () => {
    const result = defectSchema.safeParse({ ...validDefect(), severity: 'critical' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['severity']);
  });

  it('rejects a missing observed', () => {
    const withoutObserved = validDefect();
    delete withoutObserved['observed'];
    const result = defectSchema.safeParse(withoutObserved);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['observed']);
  });

  it('rejects a non-array evidence', () => {
    const result = defectSchema.safeParse({ ...validDefect(), evidence: 'a stack trace' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['evidence']);
  });
});
