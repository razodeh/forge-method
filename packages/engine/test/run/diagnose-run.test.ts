/**
 * `diagnoseRun` — a run that did not complete always says why (`PLAN-M13.md` P12, `Q208` finding 1):
 * every unfinished step is classified, and the run-level reason and message name something actionable.
 *
 * @see specs/06 §6.3, §6.9
 * @see specs/18 §18.4
 */
import { describe, expect, it } from 'vitest';

import { toAgentId } from '../../src/plan/index.ts';
import {
  MAX_RECORDED_UNFINISHED,
  describeBudgetRefusal,
  diagnoseRun,
  type BudgetRefusal,
} from '../../src/run/failure.ts';
import type { ConcurrencyLimits, StepStatus } from '../../src/scheduler/types.ts';
import { node } from '../dispatch/helpers.ts';

const limits: ConcurrencyLimits = {
  global: 4,
  perAgent: new Map(),
  perResourceClass: new Map(),
};

function run(
  statuses: Readonly<Record<string, StepStatus>>,
  nodes: ReturnType<typeof node>[],
  refusals: Readonly<Record<string, BudgetRefusal>> = {},
  concurrency: ConcurrencyLimits = limits,
) {
  return diagnoseRun({
    nodes,
    status: (id) => statuses[id] ?? 'pending',
    budgetRefusals: new Map(Object.entries(refusals)),
    limits: concurrency,
  });
}

const refusal = (stepId: string): BudgetRefusal => ({
  admit: false,
  level: 'run',
  stepId,
  reservationUsd: 3,
  spentUsd: 0.5,
  capUsd: 2,
});

describe('diagnoseRun', () => {
  it('reports a budget refusal with the step, reservation, spent and cap, and every step it blocks', () => {
    const nodes = [
      node({ id: 'wf:think', kind: 'agent' }),
      node({ id: 'wf:sync', kind: 'command', dependsOn: ['wf:think'] }),
    ];
    const result = run({}, nodes, { 'wf:think': refusal('wf:think') });
    expect(result.reason).toBe('budget');
    expect(result.message).toContain('wf:think');
    expect(result.message).toContain('$3.00');
    expect(result.message).toContain(
      '$0.50 already spent plus that would reach the run budget (budget.perRunUsd) of $2.00 ($1.50 remains)',
    );
    expect(result.unfinished).toEqual([
      {
        stepId: 'wf:think',
        cause: { kind: 'budget', level: 'run', reservationUsd: 3, spentUsd: 0.5, capUsd: 2 },
      },
      { stepId: 'wf:sync', cause: { kind: 'dependency-unfinished', dependencyId: 'wf:think' } },
    ]);
  });

  it('names the daily cap for a period refusal', () => {
    const nodes = [node({ id: 'wf:a', kind: 'agent' })];
    const result = run({}, nodes, { 'wf:a': { ...refusal('wf:a'), level: 'period' } });
    expect(result.message).toContain('daily budget (budget.dailyUsd)');
  });

  it('reports a failed step and the dependents that therefore never ran', () => {
    const nodes = [
      node({ id: 'wf:a', kind: 'agent' }),
      node({ id: 'wf:b', kind: 'command', dependsOn: ['wf:a'] }),
    ];
    const result = run({ 'wf:a': 'failed' }, nodes);
    expect(result.reason).toBe('step-failed');
    expect(result.failedSteps).toEqual(['wf:a']);
    expect(result.failedTotal).toBe(1);
    expect(result.unfinished).toEqual([
      { stepId: 'wf:b', cause: { kind: 'dependency-failed', dependencyId: 'wf:a' } },
    ]);
    expect(result.message).toContain('wf:a');
    expect(result.message).toContain('1 dependent step(s) never ran');
  });

  it('a budget refusal takes precedence over a failed step as the run-level reason, but both are recorded', () => {
    const nodes = [node({ id: 'wf:a', kind: 'agent' }), node({ id: 'wf:b', kind: 'agent' })];
    const result = run({ 'wf:a': 'failed' }, nodes, { 'wf:b': refusal('wf:b') });
    expect(result.reason).toBe('budget');
    expect(result.failedSteps).toEqual(['wf:a']);
  });

  it('explains a step nothing could admit because concurrency is zero', () => {
    const nodes = [node({ id: 'wf:a', kind: 'agent' })];
    const result = run({}, nodes, {}, { ...limits, global: 0 });
    expect(result.reason).toBe('no-admissible-step');
    expect(result.unfinished).toEqual([
      {
        stepId: 'wf:a',
        cause: { kind: 'concurrency', detail: 'the global concurrency limit is 0' },
      },
    ]);
    expect(result.message).toContain('the global concurrency limit is 0');
  });

  it('explains a per-agent concurrency limit of zero', () => {
    const nodes = [node({ id: 'wf:a', kind: 'agent', agent: toAgentId('em') })];
    const result = run({}, nodes, {}, { ...limits, perAgent: new Map([[toAgentId('em'), 0]]) });
    expect(result.unfinished[0]?.cause).toEqual({
      kind: 'concurrency',
      detail: 'the concurrency limit for agent em is 0',
    });
  });

  it('never returns a reason-less failure: a ready step nothing admitted is still named', () => {
    const nodes = [node({ id: 'wf:a', kind: 'agent' })];
    const result = run({}, nodes);
    expect(result.reason).toBe('no-admissible-step');
    expect(result.unfinished).toEqual([{ stepId: 'wf:a', cause: { kind: 'not-admitted' } }]);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('a step depending on a skipped step is blocked by it, not reported as a mystery', () => {
    const nodes = [
      node({ id: 'wf:a', kind: 'agent' }),
      node({ id: 'wf:b', kind: 'agent', dependsOn: ['wf:a'] }),
    ];
    const result = run({ 'wf:a': 'skipped' }, nodes);
    expect(result.unfinished).toEqual([
      { stepId: 'wf:b', cause: { kind: 'dependency-unfinished', dependencyId: 'wf:a' } },
    ]);
  });

  it('reports skipped-only incompleteness rather than an empty reason', () => {
    const nodes = [node({ id: 'wf:a', kind: 'agent' })];
    const result = run({ 'wf:a': 'skipped' }, nodes);
    expect(result.reason).toBe('incomplete');
    expect(result.message).toContain('1 skipped step(s)');
  });

  it('caps the recorded unfinished list but keeps the true total', () => {
    const many = Array.from({ length: MAX_RECORDED_UNFINISHED + 10 }, (_, i) =>
      node({ id: `wf:s${String(i)}`, kind: 'agent' }),
    );
    const result = run({}, many, {}, { ...limits, global: 0 });
    expect(result.unfinished).toHaveLength(MAX_RECORDED_UNFINISHED);
    expect(result.unfinishedTotal).toBe(MAX_RECORDED_UNFINISHED + 10);
  });
});

describe('diagnoseRun under a large plan', () => {
  it('records budget refusals first, so the payload cap can never cut off the entry that decides the reason', () => {
    const blocked = Array.from({ length: MAX_RECORDED_UNFINISHED + 5 }, (_, i) =>
      node({ id: `wf:blocked${String(i)}`, kind: 'agent', dependsOn: ['wf:failed'] }),
    );
    const nodes = [
      node({ id: 'wf:failed', kind: 'agent' }),
      ...blocked,
      node({ id: 'wf:late', kind: 'agent' }),
    ];
    const result = run({ 'wf:failed': 'failed' }, nodes, { 'wf:late': refusal('wf:late') });
    expect(result.reason).toBe('budget');
    expect(result.unfinished).toHaveLength(MAX_RECORDED_UNFINISHED);
    expect(result.unfinished[0]).toEqual({
      stepId: 'wf:late',
      cause: { kind: 'budget', level: 'run', reservationUsd: 3, spentUsd: 0.5, capUsd: 2 },
    });
    expect(result.unfinishedTotal).toBe(MAX_RECORDED_UNFINISHED + 6);
  });

  it('caps the failed-step list too, keeping the true count', () => {
    const nodes = Array.from({ length: MAX_RECORDED_UNFINISHED + 20 }, (_, i) =>
      node({ id: `wf:f${String(i)}`, kind: 'agent' }),
    );
    const statuses = Object.fromEntries(nodes.map((n) => [n.id, 'failed' as const]));
    const result = run(statuses, nodes);
    expect(result.failedSteps).toHaveLength(MAX_RECORDED_UNFINISHED);
    expect(result.failedTotal).toBe(MAX_RECORDED_UNFINISHED + 20);
  });
});

describe('describeBudgetRefusal amounts', () => {
  it('shows four decimals for a sub-cent amount so a small refusal is explainable', () => {
    const text = describeBudgetRefusal({
      stepId: 'wf:a',
      level: 'run',
      reservationUsd: 0.003,
      spentUsd: 0.002,
      capUsd: 0.004,
    });
    expect(text).toContain('$0.0030');
    expect(text).toContain('$0.0020');
    expect(text).toContain('$0.0040');
  });
});

describe('describeBudgetRefusal', () => {
  it('never reports a negative remainder when spend already exceeds the cap', () => {
    const text = describeBudgetRefusal({
      stepId: 'wf:a',
      level: 'run',
      reservationUsd: 1,
      spentUsd: 5,
      capUsd: 2,
    });
    expect(text).toContain('($0.00 remains)');
  });
});
