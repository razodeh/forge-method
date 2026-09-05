/**
 * `waiverSchema` — one `WAIVER-###` entry in `reports/waivers.md`.
 *
 * @see specs/20-security-safety-and-cost.md §20
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { waiverSchema } from '../../src/artifacts/waiver.ts';

function validWaiver(): Record<string, unknown> {
  return {
    id: 'WAIVER-001',
    reason:
      'Coverage tool flakes on this file at full-suite scale; documented in SPEC-QUESTIONS Q17',
    owner: 'architect',
    expiry: '2026-06-01',
  };
}

describe('waiverSchema — valid', () => {
  it('accepts a well-formed waiver', () => {
    expect(waiverSchema.safeParse(validWaiver()).success).toBe(true);
  });
});

describe('waiverSchema — invalid, each asserting the error path', () => {
  it('rejects a missing reason (PLAN-M1.md P7 Check)', () => {
    const withoutReason = validWaiver();
    delete withoutReason['reason'];
    const result = waiverSchema.safeParse(withoutReason);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['reason']);
  });

  it('rejects a missing owner (PLAN-M1.md P7 Check)', () => {
    const withoutOwner = validWaiver();
    delete withoutOwner['owner'];
    const result = waiverSchema.safeParse(withoutOwner);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['owner']);
  });

  it('rejects a missing expiry (PLAN-M1.md P7 Check)', () => {
    const withoutExpiry = validWaiver();
    delete withoutExpiry['expiry'];
    const result = waiverSchema.safeParse(withoutExpiry);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['expiry']);
  });

  it('rejects a malformed expiry date', () => {
    const result = waiverSchema.safeParse({ ...validWaiver(), expiry: '06/01/2026' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['expiry']);
  });
});
