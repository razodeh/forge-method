/**
 * `handoffRecordSchema` — one `HO-###` entry in `reports/handoffs.md`.
 *
 * @see specs/05 §5.6
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { handoffRecordSchema } from '../../src/artifacts/handoff-record.ts';

function validHandoff(): Record<string, unknown> {
  return {
    id: 'HO-0042',
    from: 'architect',
    to: 'platform',
    step: 'design-system → initialize-repo',
    timestamp: '2026-03-04T12:41:02Z',
    delivered: ['ADR-0011 monorepo strategy', 'ADR-0012 build system'],
    open_questions: ['Do we need a separate package for shared domain types?'],
    assumptions: [
      {
        id: 'ASM-004',
        text: 'Single deployable at MVP; second service arrives at M2',
        confidence: 'high',
        validate_by: 'stage plan review at M2 kickoff',
      },
    ],
    constraints_for_receiver: ['Do not introduce a new language runtime without an ADR'],
    acceptance_for_receiver: ['pnpm install && pnpm build && pnpm test succeed from clean clone'],
  };
}

describe('handoffRecordSchema — valid', () => {
  it('accepts the spec §5.6 example', () => {
    expect(handoffRecordSchema.safeParse(validHandoff()).success).toBe(true);
  });
});

describe('handoffRecordSchema — invalid, each asserting the error path', () => {
  it('rejects an id whose prefix does not match HandoffRecord', () => {
    const result = handoffRecordSchema.safeParse({ ...validHandoff(), id: 'RCA-0042' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a non-datetime timestamp (a date-only string is not enough)', () => {
    const result = handoffRecordSchema.safeParse({ ...validHandoff(), timestamp: '2026-03-04' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['timestamp']);
  });

  it('rejects an embedded assumption missing a required field', () => {
    const result = handoffRecordSchema.safeParse({
      ...validHandoff(),
      assumptions: [{ id: 'ASM-004', text: 'x', confidence: 'high' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['assumptions', 0, 'validate_by']);
    }
  });

  it('rejects an unknown key', () => {
    const result = handoffRecordSchema.safeParse({ ...validHandoff(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
