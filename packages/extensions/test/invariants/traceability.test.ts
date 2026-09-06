/**
 * `checkTraceabilityNotDisabled` (I6) — `15` §15.10: "traceability edges required by the spec graph
 * cannot be disabled."
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import { describe, expect, it } from 'vitest';

import { checkTraceabilityNotDisabled } from '../../src/invariants/traceability.ts';

describe('checkTraceabilityNotDisabled (I6)', () => {
  it('refuses disabling a real, required edge from 09 §9.4 (STORY partOf EPIC)', () => {
    const violations = checkTraceabilityNotDisabled([
      { from: 'STORY', edge: 'partOf', to: 'EPIC' },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('SPEC-501');
    expect(violations[0]?.message).toContain('STORY:partOf:EPIC');
  });

  it('does not flag an edge that is not in REQUIRED_EDGES at all', () => {
    const violations = checkTraceabilityNotDisabled([
      { from: 'NOT-REAL', edge: 'partOf', to: 'ALSO-NOT-REAL' },
    ]);
    expect(violations).toEqual([]);
  });

  it('does not flag an edge whose required-ness is advisory, not "yes" (FILE primaryFor STORY)', () => {
    const violations = checkTraceabilityNotDisabled([
      { from: 'FILE', edge: 'primaryFor', to: 'STORY' },
    ]);
    expect(violations).toEqual([]);
  });

  it('reports one violation per disabled required edge, when several are given', () => {
    const violations = checkTraceabilityNotDisabled([
      { from: 'STORY', edge: 'partOf', to: 'EPIC' },
      { from: 'CAP', edge: 'realises', to: 'VIS' },
    ]);
    expect(violations).toHaveLength(2);
  });

  it('matches each real target of a compound required row (NFR verifiedBy TEST/benchmark/monitor)', () => {
    for (const target of ['TEST', 'benchmark', 'monitor']) {
      const violations = checkTraceabilityNotDisabled([
        { from: 'NFR', edge: 'verifiedBy', to: target },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.code).toBe('SPEC-501');
    }
  });

  it("does not flag a target that is not one of the compound row's own real options", () => {
    const violations = checkTraceabilityNotDisabled([
      { from: 'NFR', edge: 'verifiedBy', to: 'something-else' },
    ]);
    expect(violations).toEqual([]);
  });
});
