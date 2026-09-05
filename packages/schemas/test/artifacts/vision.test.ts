/**
 * `visionSchema` — `specs/09` §9.3's Vision.
 *
 * @see specs/09 §9.3
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { visionSchema } from '../../src/artifacts/vision.ts';

function validVision(): Record<string, unknown> {
  return {
    id: 'VIS-001',
    type: 'Vision',
    schemaVersion: 1,
    title: 'Invoicing for small agencies',
    status: 'active',
    created: '2026-03-04',
    updated: '2026-03-04',
    revision: 1,
    author: 'po',
    changelog: [],
    product: 'acme-billing',
    one_liner: 'Invoicing that a 3-person agency can run without a bookkeeper.',
    problem: 'KB-PROD-0001',
    target_users: ['persona:agency-owner', 'persona:freelancer'],
    value_hypothesis: 'Agencies will pay for invoicing that needs no bookkeeper.',
    success_metrics: [
      {
        id: 'MET-001',
        statement: 'Median time from signup to first sent invoice',
        baseline: 'unknown',
        target: '< 10 minutes',
        instrumentation: 'event:invoice_sent minus event:signup',
      },
    ],
    non_goals: ['payroll', 'multi-currency at MVP'],
    horizon: 'MVP in 6 weeks',
  };
}

describe('visionSchema — valid', () => {
  it('accepts the spec §9.3 example', () => {
    expect(visionSchema.safeParse(validVision()).success).toBe(true);
  });
});

describe('visionSchema — invalid, each asserting the error path', () => {
  it('rejects an id that does not match the VIS prefix', () => {
    const result = visionSchema.safeParse({ ...validVision(), id: 'STORY-001' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a missing product', () => {
    const withoutProduct = validVision();
    delete withoutProduct['product'];
    const result = visionSchema.safeParse(withoutProduct);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['product']);
  });

  it('rejects a success_metrics entry missing a required field', () => {
    const result = visionSchema.safeParse({
      ...validVision(),
      success_metrics: [{ id: 'MET-001', statement: 'x', baseline: 'unknown', target: 'x' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['success_metrics', 0, 'instrumentation']);
    }
  });

  it('rejects a non-array target_users', () => {
    const result = visionSchema.safeParse({ ...validVision(), target_users: 'persona:solo' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['target_users']);
  });

  it('rejects an unknown top-level key', () => {
    const result = visionSchema.safeParse({ ...validVision(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
