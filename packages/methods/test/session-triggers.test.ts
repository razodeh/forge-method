/**
 * `SESSION_TRIGGERS`/`evaluateSessionTrigger` — `PLAN-M10.md` P14's own Checks: `16` §16.6's own three
 * triggered placements (`premortem` at L3+, `standup` on elapsed time/blocked-lane count, `war-room` on
 * Sev1) each carry a real, evaluable expression, not a placeholder string.
 *
 * @see specs/16 §16.6
 * @see PLAN-M10.md P14
 */
import { describe, expect, it } from 'vitest';

import { evaluateSessionTrigger, SESSION_TRIGGERS } from '../src/session-triggers.ts';
import { evaluateCondition, parseExpression } from '../src/expr.ts';

describe('SESSION_TRIGGERS', () => {
  it('every trigger expression parses as a well-formed expression', () => {
    for (const trigger of Object.values(SESSION_TRIGGERS)) {
      expect(parseExpression(trigger.expression)).toBeDefined();
    }
  });

  it('is not a hand-typed set of placeholder strings — every expression is a real, meaningful, non-tautological condition', () => {
    for (const trigger of Object.values(SESSION_TRIGGERS)) {
      // A tautological expression (`evaluateCondition` always true against both an empty context and a
      // context deliberately shaped to make it false) would compile and "parse" cleanly while still
      // being exactly the placeholder this piece must not ship.
      expect(evaluateCondition(trigger.expression, {})).toBe(false);
    }
  });
});

describe('evaluateSessionTrigger — premortem (level == L3 or L4)', () => {
  it('fires at L3', () => {
    expect(evaluateSessionTrigger('premortem', { level: 'L3' })).toBe(true);
  });

  it('fires at L4', () => {
    expect(evaluateSessionTrigger('premortem', { level: 'L4' })).toBe(true);
  });

  it('does not fire at L2 or L1', () => {
    expect(evaluateSessionTrigger('premortem', { level: 'L2' })).toBe(false);
    expect(evaluateSessionTrigger('premortem', { level: 'L1' })).toBe(false);
  });

  it('does not fire with no level in context at all', () => {
    expect(evaluateSessionTrigger('premortem', {})).toBe(false);
  });
});

describe('evaluateSessionTrigger — standup (elapsed time or blocked-lane count)', () => {
  it('fires past the elapsed-time threshold even with zero blocked lanes', () => {
    expect(
      evaluateSessionTrigger('standup', { run: { elapsedMs: 3_700_000, blockedLaneCount: 0 } }),
    ).toBe(true);
  });

  it('fires at the blocked-lane-count threshold even with negligible elapsed time', () => {
    expect(
      evaluateSessionTrigger('standup', { run: { elapsedMs: 1000, blockedLaneCount: 2 } }),
    ).toBe(true);
  });

  it('does not fire below both thresholds', () => {
    expect(
      evaluateSessionTrigger('standup', { run: { elapsedMs: 1000, blockedLaneCount: 1 } }),
    ).toBe(false);
  });
});

describe('evaluateSessionTrigger — war-room (Sev1)', () => {
  it('fires for a Sev1 defect', () => {
    expect(evaluateSessionTrigger('war-room', { defect: { severity: 'Sev1' } })).toBe(true);
  });

  it('does not fire for a lower-severity defect', () => {
    expect(evaluateSessionTrigger('war-room', { defect: { severity: 'Sev3' } })).toBe(false);
  });
});
