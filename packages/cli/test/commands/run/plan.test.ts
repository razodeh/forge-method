/**
 * `workflowIdForPlanPhase` — the real `03` §3.2.3 phase → `10` §10.5 workflow id mapping, and the real
 * refusal for the two phases with no corresponding workflow.
 *
 * @see specs/03 §3.2.3
 * @see specs/10 §10.5
 */
import { describe, expect, it } from 'vitest';

import { workflowIdForPlanPhase, type PlanPhase } from '../../../src/commands/run/plan.ts';

describe('workflowIdForPlanPhase', () => {
  const cases: readonly [PlanPhase, string][] = [
    ['product', 'define-product'],
    ['architecture', 'shape-solution'],
    ['init', 'initialize-project'],
    ['delivery', 'deliver-stage'],
    ['stages', 'plan-stages'],
    ['stage', 'plan-stage'],
    ['replan', 'replan'],
  ];

  it.each(cases)('maps phase %s to workflow id %s', (phase, workflowId) => {
    expect(workflowIdForPlanPhase(phase)).toBe(workflowId);
  });

  it.each(['data', 'testing'] as const)(
    'throws USR-003 for phase %s, which has no real corresponding workflow',
    (phase) => {
      expect(() => workflowIdForPlanPhase(phase)).toThrow(
        expect.objectContaining({ code: 'USR-003' }),
      );
    },
  );
});
