/**
 * `runInvariants` — `15` §15.10's twelve compile-time invariants, run against whichever slice of a
 * `ResolvedSet` a caller supplies.
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import { describe, expect, it } from 'vitest';

import { runInvariants } from '../../src/invariants/run.ts';
import type { ResolvedSet } from '../../src/invariants/types.ts';

describe('runInvariants', () => {
  it('returns no violations for an empty resolved set', () => {
    expect(runInvariants({})).toEqual([]);
  });

  it('checks only the invariants whose slice is present, skipping the rest', () => {
    const resolvedSet: ResolvedSet = {
      observability: { eventLogEnabled: false, costLedgerEnabled: true, auditTrailEnabled: true },
    };
    const violations = runInvariants(resolvedSet);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe('I10');
  });

  it('aggregates violations across every invariant a full resolved set touches', () => {
    const resolvedSet: ResolvedSet = {
      outputReviewAssignments: [
        { outputId: 'A', producerAgent: 'x', reviewerAgent: 'x', reviewerRole: 'reviewer' },
      ],
      testImplementationAssignments: [
        {
          storyId: 'STORY-1',
          testAuthorAgent: 'x',
          implementerAgent: 'x',
          implementerFileOwnership: [],
          testPaths: [],
        },
      ],
      gateConfigs: [
        { gateId: 'G-Design', checkIds: [], requiredCheckIds: [], disabledCheckIds: [] },
      ],
      gateAutonomyOverrides: [
        { gateId: 'G-Deliver', baseAutonomy: 'alwaysHuman', overlayAutonomy: 'autonomous' },
      ],
      disabledTraceabilityEdges: [{ from: 'STORY', edge: 'partOf', to: 'EPIC' }],
      toolCeilingChecks: [
        {
          agentId: 'x',
          roleTags: { isReviewOrCritic: false, isOps: false },
          ceiling: { write: false },
          requested: { write: true },
          escalations: [],
        },
      ],
      scanTargets: [{ location: 'x', text: 'AKIAABCDEFGHIJKLMNOP' }],
      observability: { eventLogEnabled: false, costLedgerEnabled: true, auditTrailEnabled: true },
      customAgents: [{ id: 'x' }],
      roster: { disable: ['architect'] },
      currentLevel: 'L2',
    };
    const violations = runInvariants(resolvedSet);
    const ids = new Set(violations.map((violation) => violation.id));
    expect(ids).toEqual(new Set(['I1', 'I2', 'I4', 'I5', 'I6', 'I7', 'I8', 'I10', 'I11', 'I12']));
  });

  it('does not check I12 when only one of roster/currentLevel is supplied', () => {
    expect(runInvariants({ roster: { disable: ['architect'] } })).toEqual([]);
    expect(runInvariants({ currentLevel: 'L2' })).toEqual([]);
  });
});
