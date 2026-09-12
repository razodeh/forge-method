/**
 * `canComplete` — `16` §16.5's own mandatory write-back gate.
 *
 * @see specs/16 §16.5
 * @see PLAN-M10.md P9
 */
import { describe, expect, it } from 'vitest';

import { canComplete } from '../../src/phase-machine/can-complete.ts';
import type { SessionState } from '../../src/phase-machine/types.ts';

const BASE: SessionState = {
  phase: 'RECORD',
  sessionType: 'brainstorm',
  participants: [{ role: 'pm' }],
  technique: [],
  framing: {
    question: 'q',
    constraintsApplied: [],
    outOfScope: [],
    goodOutcomeLooksLike: 'x',
  },
  startedAt: '2026-03-08T14:00:00.000Z',
  ideas: [],
  clusters: [],
  objections: [],
  decisions: [],
  nonDecisions: [],
  actions: [],
  truncated: false,
};

describe('canComplete', () => {
  it('is false for zero decisions and zero actions with no inconclusive reason', () => {
    expect(canComplete(BASE)).toBe(false);
  });

  it('is false for zero decisions and zero actions with an empty/whitespace-only reason', () => {
    expect(canComplete({ ...BASE, inconclusiveReason: '' })).toBe(false);
    expect(canComplete({ ...BASE, inconclusiveReason: '   ' })).toBe(false);
  });

  it('is true for zero decisions and zero actions given a real, non-empty inconclusive reason', () => {
    expect(canComplete({ ...BASE, inconclusiveReason: 'No consensus reached' })).toBe(true);
  });

  it('is false when a decision has no artifact reference', () => {
    expect(
      canComplete({
        ...BASE,
        decisions: [{ id: 'D-001', decision: 'do x', owner: 'pm' }],
      }),
    ).toBe(false);
  });

  it('is false when an action has no owner', () => {
    expect(
      canComplete({
        ...BASE,
        actions: [{ id: 'A-001', action: 'do x' }],
      }),
    ).toBe(false);
  });

  it('is true once every decision has an artifact reference and every action has an owner', () => {
    expect(
      canComplete({
        ...BASE,
        decisions: [{ id: 'D-001', decision: 'do x', owner: 'pm', artifactRef: 'CAP-009' }],
        actions: [{ id: 'A-001', action: 'do y', owner: 'architect', artifactRef: 'ADR-0019' }],
      }),
    ).toBe(true);
  });

  it('is false when one of several decisions is missing its artifact reference, even if the others have one', () => {
    expect(
      canComplete({
        ...BASE,
        decisions: [
          { id: 'D-001', decision: 'a', owner: 'pm', artifactRef: 'CAP-009' },
          { id: 'D-002', decision: 'b', owner: 'pm' },
        ],
      }),
    ).toBe(false);
  });

  it('ignores an inconclusive reason once real decisions or actions exist -- it must still satisfy the reference/owner rule', () => {
    expect(
      canComplete({
        ...BASE,
        inconclusiveReason: 'stray reason',
        decisions: [{ id: 'D-001', decision: 'a', owner: 'pm' }],
      }),
    ).toBe(false);
  });
});
