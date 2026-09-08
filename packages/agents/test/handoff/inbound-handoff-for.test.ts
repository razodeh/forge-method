/**
 * `inboundHandoffFor` — `05` §5.6: "The receiving agent's context pack always includes the inbound
 * handoff record."
 *
 * @see specs/05 §5.6
 * @see PLAN-M6.md A7
 */
import type { HandoffRecord } from '@forge/schemas/artifacts';
import { describe, expect, it } from 'vitest';

import { inboundHandoffFor } from '../../src/handoff/inbound-handoff-for.ts';

function record(overrides: Partial<HandoffRecord> & { readonly id: string; readonly step: string }): HandoffRecord {
  return {
    from: 'architect',
    to: 'platform',
    timestamp: '2026-03-04T12:41:02Z',
    delivered: [],
    open_questions: [],
    assumptions: [],
    constraints_for_receiver: [],
    acceptance_for_receiver: [],
    ...overrides,
  };
}

describe('inboundHandoffFor', () => {
  it('correctly finds the one real record for a receiving step among several unrelated ones', () => {
    const records = [
      record({ id: 'HO-0001', step: 'design-system → initialize-repo' }),
      record({ id: 'HO-0002', step: 'initialize-repo → implement-story-1' }),
      record({ id: 'HO-0003', step: 'implement-story-1 → review-story-1' }),
    ];

    expect(inboundHandoffFor('implement-story-1', records)?.id).toBe('HO-0002');
    expect(inboundHandoffFor('review-story-1', records)?.id).toBe('HO-0003');
  });

  it('returns undefined for a step with no inbound handoff record at all', () => {
    const records = [record({ id: 'HO-0001', step: 'design-system → initialize-repo' })];
    expect(inboundHandoffFor('unrelated-step', records)).toBeUndefined();
  });

  it('when two records name the same receiving step (a fan-in step), returns the most recently emitted one, not whichever appears first', () => {
    const records = [
      record({
        id: 'HO-0001',
        step: 'architect:design → platform:initialize',
        timestamp: '2026-03-04T09:00:00Z',
      }),
      record({
        id: 'HO-0002',
        step: 'security:review → platform:initialize',
        timestamp: '2026-03-04T12:41:02Z',
      }),
    ];

    // HO-0002 is later than HO-0001 but appears second in the array -- a bare "first match" would
    // wrongly return HO-0001.
    expect(inboundHandoffFor('platform:initialize', records)?.id).toBe('HO-0002');
  });
});
