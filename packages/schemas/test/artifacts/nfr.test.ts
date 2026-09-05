/**
 * `nfrSchema` — `specs/09` §9.3's NFR, "must be numeric and verifiable".
 *
 * @see specs/09 §9.3
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { nfrSchema } from '../../src/artifacts/nfr.ts';

function validNfr(): Record<string, unknown> {
  return {
    id: 'NFR-0002',
    type: 'NFR',
    schemaVersion: 1,
    title: 'Invoice list page performance',
    status: 'active',
    created: '2026-03-04',
    updated: '2026-03-04',
    revision: 1,
    author: 'po',
    changelog: [],
    category: 'performance',
    statement:
      'Invoice list page returns in under 300 ms at p95 for accounts with ≤ 5000 invoices.',
    metric: 'http_server_duration_p95{route=/invoices}',
    target: '< 300ms',
    conditions: 'warm cache, 5k invoices, 50 rps',
    verification: { kind: 'test', ref: 'TEST-231', command: 'pnpm bench:invoices --p95 300' },
    applies_to: ['component:api', 'component:web'],
  };
}

describe('nfrSchema — valid', () => {
  it('accepts the spec §9.3 example', () => {
    expect(nfrSchema.safeParse(validNfr()).success).toBe(true);
  });

  it('accepts a numeric target without an explicit comparison operator', () => {
    expect(nfrSchema.safeParse({ ...validNfr(), target: '99.9% uptime' }).success).toBe(true);
  });

  it.each([
    'performance',
    'availability',
    'scalability',
    'security',
    'privacy',
    'maintainability',
    'operability',
    'cost',
    'accessibility',
    'compliance',
  ])('accepts category %s', (category) => {
    expect(nfrSchema.safeParse({ ...validNfr(), category }).success).toBe(true);
  });
});

describe('nfrSchema — invalid, each asserting the error path', () => {
  it('rejects a non-numeric target — "should be fast" (specs/09 §9.3\'s own example)', () => {
    const result = nfrSchema.safeParse({ ...validNfr(), target: 'should be fast' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['target']);
  });

  it('rejects qualitative prose that merely contains a digit ("ship version 2 of the dashboard")', () => {
    // A "does the string contain any digit at all" check was tried and rejected — this and the case
    // below are exactly the false positives it let through, appearing "numeric and verifiable" only
    // because a number happens to occur somewhere in an otherwise qualitative sentence.
    const result = nfrSchema.safeParse({
      ...validNfr(),
      target: 'ship version 2 of the dashboard',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['target']);
  });

  it('rejects qualitative prose that merely contains a digit ("reduce onboarding to 1 click")', () => {
    const result = nfrSchema.safeParse({
      ...validNfr(),
      target: 'reduce onboarding to 1 click before launch',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['target']);
  });

  it('rejects a category outside the closed enum', () => {
    const result = nfrSchema.safeParse({ ...validNfr(), category: 'usability' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['category']);
  });

  it('rejects a verification.kind outside its closed enum', () => {
    const result = nfrSchema.safeParse({
      ...validNfr(),
      verification: { kind: 'inspection', ref: 'TEST-231' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['verification', 'kind']);
  });

  it('rejects a missing metric', () => {
    const withoutMetric = validNfr();
    delete withoutMetric['metric'];
    const result = nfrSchema.safeParse(withoutMetric);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['metric']);
  });
});
