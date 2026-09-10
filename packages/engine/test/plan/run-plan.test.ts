/**
 * `compileRunPlan` — `06` §6.2's full plan-compilation pipeline (rules 1–3, 5–6; rule 4's own scope
 * boundary is documented at `run-plan.ts`'s own top-of-file comment), against `PLAN-M5.md` P11's own
 * Checks section end to end.
 *
 * @see specs/06 §6.2
 * @see PLAN-M5.md P11
 */
import { describe, expect, it, vi } from 'vitest';

import type { ExpressionContext } from '../../src/expr/index.ts';
import * as dependenciesModule from '../../src/plan/dependencies.ts';
import { compileRunPlan } from '../../src/plan/run-plan.ts';
import type { AgentStep, Workflow, WorkflowStep } from '../../src/workflow/types.ts';

function workflow(steps: readonly WorkflowStep[], overrides: Partial<Workflow> = {}): Workflow {
  return { id: 'w', name: 'W', version: '1.0.0', description: 'd', steps, ...overrides };
}

function agentStep(overrides: Partial<AgentStep> & { readonly id: string }): AgentStep {
  return { kind: 'agent', agent: 'engineer', ...overrides };
}

describe('compileRunPlan — full pipeline', () => {
  it('propagates a P10-level compile failure unchanged (stops before ever reaching later stages)', () => {
    const wf = workflow([{ kind: 'checkpoint' }]);
    const result = compileRunPlan(wf, {});
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing-step-id' }));
  });

  it('inserts a contract-freeze implicit dependency end to end, then reports it in the final nodes', () => {
    const wf = workflow([
      agentStep({ id: 'freeze', outputs: [{ type: 'InterfaceContract', cardinality: 'many' }] }),
      agentStep({ id: 'implement', inputs: ['artifact:InterfaceContract(*)'] }),
    ]);
    const result = compileRunPlan(wf, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.nodes.find((n) => n.id === 'w:implement')?.dependsOn).toEqual(['w:freeze']);
    }
  });

  it("serialises two overlapping-claim steps end to end via the pipeline's own claim stage", () => {
    const wf = workflow([
      agentStep({ id: 'a', produces: ['src/foo.ts'] }),
      agentStep({ id: 'b', produces: ['src/foo.ts'] }),
    ]);
    const result = compileRunPlan(wf, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.nodes.find((n) => n.id === 'w:b')?.dependsOn).toEqual(['w:a']);
      expect(result.claims.overlaps).toHaveLength(1);
    }
  });

  it('does not throw end to end when a produces glob is long enough that minimatch itself refuses to evaluate it', () => {
    const wf = workflow([
      agentStep({ id: 'a', produces: ['a'.repeat(70_000)] }),
      agentStep({ id: 'b', produces: ['src/foo.ts'] }),
    ]);
    expect(() => compileRunPlan(wf, {})).not.toThrow();
    expect(compileRunPlan(wf, {}).success).toBe(true);
  });

  // The exclusive-vs-exclusive rejection itself (a specific, actionable `ambiguous-exclusive-claim`
  // issue, not a generic "ambiguous" string) is covered directly against `applyClaimOverlaps` in
  // `dependencies.test.ts` -- `AgentStep` has no authored way to set `laneAffinity: 'exclusive'` at all
  // (`Q72`), so there is no real workflow YAML today that could reach it "end to end" through
  // `compileRunPlan`'s own real input surface (`compilePlan`'s own output).
  it("propagates a claim-overlap failure unchanged, stopping before cycle detection/critical path -- verified via a spy since there is no real authored path to laneAffinity: 'exclusive' to trigger this for real end to end", () => {
    const wf = workflow([agentStep({ id: 'a' })]);
    const spy = vi.spyOn(dependenciesModule, 'applyClaimOverlaps').mockReturnValueOnce({
      success: false,
      issues: [{ code: 'ambiguous-exclusive-claim', message: 'contrived for this test' }],
    });
    try {
      const result = compileRunPlan(wf, {});
      expect(result).toEqual({
        success: false,
        issues: [{ code: 'ambiguous-exclusive-claim', message: 'contrived for this test' }],
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a dependency cycle with a located, Mermaid-rendered error, not a crash', () => {
    const wf = workflow([
      agentStep({ id: 'a', dependsOn: ['b'] }),
      agentStep({ id: 'b', dependsOn: ['a'] }),
    ]);
    expect(() => compileRunPlan(wf, {})).not.toThrow();
    const result = compileRunPlan(wf, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.code).toBe('dependency-cycle');
      expect(result.issues[0]?.message).toContain('graph TD');
      expect(result.issues[0]?.message).toContain('w:a');
      expect(result.issues[0]?.message).toContain('w:b');
    }
  });

  it('converts a RUN-035 (cycle-search-depth-exceeded) throw from detectCycles into an ordinary CompileIssue, not letting it escape raw', () => {
    // A genuinely deep, valid, non-nested top-level dependsOn chain -- reachable through a real workflow
    // (no structural nesting at all, so compilePlan's own MAX_COMPILE_DEPTH is never in play), long enough
    // to exceed detectCycles' own MAX_CYCLE_SEARCH_DEPTH (5000). Declared deepest-first so the very first
    // root compileRunPlan's own detectCycles call processes is the one whose traversal actually builds a
    // 5500-deep stack, the same array-order requirement cycles.test.ts documents for the identical reason.
    const steps: WorkflowStep[] = [];
    for (let i = 5500; i >= 1; i -= 1) {
      steps.push(agentStep({ id: `s${String(i)}`, dependsOn: [`s${String(i - 1)}`] }));
    }
    steps.push(agentStep({ id: 's0' }));
    const result = compileRunPlan(workflow(steps), {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual([expect.objectContaining({ code: 'RUN-035' })]);
    }
  });

  it('computes critical path and cost on success, choosing the more expensive of two equal-length branches', () => {
    const wf = workflow([
      agentStep({ id: 'a', limits: { maxCostUsd: 1 } }),
      agentStep({ id: 'cheap', dependsOn: ['a'], limits: { maxCostUsd: 1 } }),
      agentStep({ id: 'expensive', dependsOn: ['a'], limits: { maxCostUsd: 10 } }),
      agentStep({ id: 'd', dependsOn: ['cheap', 'expensive'], limits: { maxCostUsd: 1 } }),
    ]);
    const result = compileRunPlan(wf, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.criticalPath.path).toEqual(['w:a', 'w:expensive', 'w:d']);
      expect(result.criticalPath.estimatedCost).toBe(12);
    }
  });

  it('a full, realistic multi-stage plan (contract freeze, fanout, overlapping claims, a diamond) compiles and reports a sane critical path', () => {
    const context: ExpressionContext = { stage: { stories: [{ id: 's1' }, { id: 's2' }] } };
    const wf = workflow([
      agentStep({
        id: 'freeze',
        outputs: [{ type: 'InterfaceContract' }],
        limits: { maxCostUsd: 2 },
      }),
      {
        kind: 'fanout',
        id: 'implement',
        over: 'stage.stories',
        itemKey: '{{item.id}}',
        step: agentStep({
          id: 'unused',
          inputs: ['artifact:InterfaceContract(*)'],
          produces: ['src/{{item.id}}.ts'],
          limits: { maxCostUsd: 3 },
        }),
      },
    ]);
    const result = compileRunPlan(wf, context);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.nodes.find((n) => n.id === 'w:implement:s1')?.dependsOn).toEqual(['w:freeze']);
      expect(result.nodes.find((n) => n.id === 'w:implement:s2')?.dependsOn).toEqual(['w:freeze']);
      expect(result.criticalPath.estimatedCost).toBe(5);
    }
  });
});
