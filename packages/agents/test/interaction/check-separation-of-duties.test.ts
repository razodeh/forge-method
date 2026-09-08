/**
 * `checkSeparationOfDuties` — `05` §5.2's own runtime separation-of-duties check.
 *
 * @see specs/05 §5.2
 * @see PLAN-M6.md A6
 */
import { describe, expect, it } from 'vitest';

import { checkSeparationOfDuties } from '../../src/interaction/check-separation-of-duties.ts';

describe('checkSeparationOfDuties', () => {
  it('refuses a fixture where the same session instance both implemented a story and was then assigned its own review step', () => {
    const authoredBy = new Map([['review-story-1', 'session-alpha']]);
    const violation = checkSeparationOfDuties(
      'run-1',
      'review-story-1',
      'session-alpha',
      authoredBy,
      'reviewer',
    );
    expect(violation).toEqual({
      runId: 'run-1',
      stepId: 'review-story-1',
      role: 'reviewer',
      agentInstanceId: 'session-alpha',
    });
  });

  it('permits the identical fixture with two distinct instances', () => {
    const authoredBy = new Map([['review-story-1', 'session-alpha']]);
    const violation = checkSeparationOfDuties(
      'run-1',
      'review-story-1',
      'session-beta',
      authoredBy,
      'reviewer',
    );
    expect(violation).toBeUndefined();
  });

  it('permits a review step with no recorded author at all (nothing to compare against yet)', () => {
    const violation = checkSeparationOfDuties('run-1', 'review-story-1', 'session-alpha', new Map(), 'reviewer');
    expect(violation).toBeUndefined();
  });

  it('applies identically to all four separation-of-duties roles: critic, diagnostician, test-architect', () => {
    const authoredBy = new Map([['step-1', 'session-alpha']]);
    for (const role of ['critic', 'diagnostician', 'test-architect'] as const) {
      const violation = checkSeparationOfDuties('run-1', 'step-1', 'session-alpha', authoredBy, role);
      expect(violation?.role).toBe(role);
    }
  });
});
