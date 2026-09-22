/**
 * `validateStructure`/`validateWorkflow` — `PLAN-M5.md` P8's own Checks section, verbatim: a duplicate
 * step id, a static dependency cycle, a malformed glob, and a `gateEvidence` naming a nonexistent gate
 * each produce a distinct, correctly-located issue.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P8
 */
import { describe, expect, it } from 'vitest';

import type {
  ValidationIssue,
  Workflow,
  WorkflowExistenceOracle,
  WorkflowStep,
} from '../../src/workflow/types.ts';
import { validateStructure, validateWorkflow } from '../../src/workflow/validate.ts';

function workflow(steps: readonly WorkflowStep[], overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'w',
    name: 'W',
    version: '1.0.0',
    description: 'd',
    steps,
    ...overrides,
  };
}

/** An oracle that says everything exists — the baseline "everything is fine" fixture most tests start
 * from, overridden per-test for the one thing that shouldn't exist. */
function allowAllOracle(overrides: Partial<WorkflowExistenceOracle> = {}): WorkflowExistenceOracle {
  return {
    agentExists: () => true,
    briefExists: () => true,
    gateExists: () => true,
    artifactTypeExists: () => true,
    workflowExists: () => true,
    ...overrides,
  };
}

describe('validateStructure', () => {
  describe('unique step ids', () => {
    it('reports a duplicate step id', () => {
      const wf = workflow([
        { id: 'a', kind: 'checkpoint' },
        { id: 'a', kind: 'checkpoint' },
      ]);

      const issues = validateStructure(wf);

      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'duplicate-step-id', stepId: 'a', severity: 'error' }),
      );
    });

    it('does not report anything for a workflow with all-unique ids', () => {
      const wf = workflow([
        { id: 'a', kind: 'checkpoint' },
        { id: 'b', kind: 'checkpoint' },
      ]);

      expect(validateStructure(wf).filter((issue) => issue.code === 'duplicate-step-id')).toEqual(
        [],
      );
    });

    it('checks ids nested inside parallel/sequence groups too, since each child is individually addressable', () => {
      const wf = workflow([
        {
          id: 'group',
          kind: 'parallel',
          steps: [
            { id: 'a', kind: 'checkpoint' },
            { id: 'a', kind: 'checkpoint' },
          ],
        },
      ]);

      const issues = validateStructure(wf);

      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'duplicate-step-id', stepId: 'a' }),
      );
    });

    it("does not require a fanout child's own id to be unique against (or even present among) sibling ids", () => {
      const wf = workflow([
        {
          id: 'a',
          kind: 'fanout',
          over: 'stage.stories',
          step: { kind: 'command', run: 'echo hi' },
        },
        { id: 'b', kind: 'checkpoint' },
      ]);

      expect(validateStructure(wf).filter((issue) => issue.code === 'duplicate-step-id')).toEqual(
        [],
      );
    });

    it('does not require onComplete or an onFailure escalation\'s "do" step to have (or collide on) an id', () => {
      const wf = workflow([{ id: 'a', kind: 'checkpoint' }], {
        onComplete: [{ kind: 'command', run: 'echo done' }],
        onFailure: {
          default: 'block',
          escalations: [{ when: 'true', do: { kind: 'command', run: 'echo escalate' } }],
        },
      });

      expect(validateStructure(wf).filter((issue) => issue.code === 'duplicate-step-id')).toEqual(
        [],
      );
    });

    it("reports a duplicate id nested inside a parallel/sequence group that is itself onComplete's own top-level step", () => {
      // onComplete's own step still needs no id of its own (the test above), but if that step happens
      // to be a parallel/sequence group, its children are exactly as individually-addressable as any
      // other parallel/sequence children -- confirmed empirically that excluding onComplete's whole
      // subtree (not just the top-level step's own id) let this go completely undetected.
      const wf = workflow([{ id: 'a', kind: 'checkpoint' }], {
        onComplete: [
          {
            kind: 'parallel',
            steps: [
              { id: 'dup', kind: 'checkpoint' },
              { id: 'dup', kind: 'checkpoint' },
            ],
          },
        ],
      });

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'duplicate-step-id', stepId: 'dup' }),
      );
    });

    it('reports a duplicate id nested inside a parallel/sequence group that is itself an onFailure escalation\'s own "do" step', () => {
      const wf = workflow([{ id: 'a', kind: 'checkpoint' }], {
        onFailure: {
          default: 'block',
          escalations: [
            {
              when: 'true',
              do: {
                kind: 'sequence',
                steps: [
                  { id: 'dup', kind: 'checkpoint' },
                  { id: 'dup', kind: 'checkpoint' },
                ],
              },
            },
          ],
        },
      });

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'duplicate-step-id', stepId: 'dup' }),
      );
    });

    it('reports a duplicate id nested inside a parallel/sequence group that is itself nested inside a fanout child', () => {
      // A real, always-triggering defect: this duplicate reproduces identically for every item the
      // fanout expands to, not something plan-compilation-time expansion would ever resolve away.
      const wf = workflow([
        {
          id: 'fo',
          kind: 'fanout',
          over: 'stage.stories',
          step: {
            kind: 'parallel',
            steps: [
              { id: 'dup', kind: 'checkpoint' },
              { id: 'dup', kind: 'checkpoint' },
            ],
          },
        },
      ]);

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'duplicate-step-id', stepId: 'dup' }),
      );
    });
  });

  describe('every step must have an id', () => {
    it('reports a top-level step with no id -- otherwise structurally inert, nothing could ever dependsOn or name it', () => {
      const wf = workflow([{ kind: 'checkpoint' }]);

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'missing-step-id' }),
      );
    });

    it("names the offending step's own kind in the message -- the one distinguishing detail an id-less step actually has", () => {
      // Confirmed empirically that without this, several simultaneously-offending steps produce
      // byte-for-byte identical issue objects, with no way to tell "N real problems" from a duplicate.
      const wf = workflow([
        { kind: 'checkpoint' },
        { id: 'group', kind: 'parallel', steps: [{ kind: 'command', run: 'echo hi' }] },
      ]);

      const messages = validateStructure(wf)
        .filter((issue) => issue.code === 'missing-step-id')
        .map((issue) => issue.message);

      expect(messages).toHaveLength(2);
      expect(messages.some((message) => message.includes('"checkpoint"'))).toBe(true);
      expect(messages.some((message) => message.includes('"command"'))).toBe(true);
    });

    it('reports a parallel/sequence child with no id', () => {
      const wf = workflow([{ id: 'group', kind: 'parallel', steps: [{ kind: 'checkpoint' }] }]);

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'missing-step-id' }),
      );
    });

    it("does not report a fanout's own templated child for missing an id -- it is never supposed to have one", () => {
      const wf = workflow([
        {
          id: 'a',
          kind: 'fanout',
          over: 'stage.stories',
          step: { kind: 'command', run: 'echo hi' },
        },
      ]);

      expect(validateStructure(wf).filter((issue) => issue.code === 'missing-step-id')).toEqual([]);
    });

    it('does not report onComplete or an onFailure escalation\'s "do" step for missing an id either', () => {
      const wf = workflow([{ id: 'a', kind: 'checkpoint' }], {
        onComplete: [{ kind: 'command', run: 'echo done' }],
        onFailure: {
          default: 'block',
          escalations: [{ when: 'true', do: { kind: 'command', run: 'echo escalate' } }],
        },
      });

      expect(validateStructure(wf).filter((issue) => issue.code === 'missing-step-id')).toEqual([]);
    });
  });

  describe('dependency cycles', () => {
    it('reports a direct two-step cycle', () => {
      const wf = workflow([
        { id: 'a', kind: 'checkpoint', dependsOn: ['b'] },
        { id: 'b', kind: 'checkpoint', dependsOn: ['a'] },
      ]);

      const issues = validateStructure(wf);

      expect(issues).toContainEqual(expect.objectContaining({ code: 'dependency-cycle' }));
    });

    it('reports a longer, three-step cycle', () => {
      const wf = workflow([
        { id: 'a', kind: 'checkpoint', dependsOn: ['c'] },
        { id: 'b', kind: 'checkpoint', dependsOn: ['a'] },
        { id: 'c', kind: 'checkpoint', dependsOn: ['b'] },
      ]);

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'dependency-cycle' }),
      );
    });

    it('does not report a cycle for a genuine, acyclic DAG, including a diamond shape', () => {
      const wf = workflow([
        { id: 'a', kind: 'checkpoint' },
        { id: 'b', kind: 'checkpoint', dependsOn: ['a'] },
        { id: 'c', kind: 'checkpoint', dependsOn: ['a'] },
        { id: 'd', kind: 'checkpoint', dependsOn: ['b', 'c'] },
      ]);

      expect(validateStructure(wf).filter((issue) => issue.code === 'dependency-cycle')).toEqual(
        [],
      );
    });

    it('does not treat a templated, per-item dependsOn reference (10 §10.1\'s own "generate-tests:{{item.id}}" shape) as part of the static graph', () => {
      const wf = workflow([
        { id: 'generate-tests', kind: 'checkpoint' },
        { id: 'implement', kind: 'checkpoint', dependsOn: ['generate-tests:{{item.id}}'] },
      ]);

      // Must not throw, must not report a cycle -- the templated reference simply isn't a graph edge.
      expect(validateStructure(wf).filter((issue) => issue.code === 'dependency-cycle')).toEqual(
        [],
      );
    });

    it('does not crash or misfire on a self-loop', () => {
      const wf = workflow([{ id: 'a', kind: 'checkpoint', dependsOn: ['a'] }]);

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'dependency-cycle', stepId: 'a' }),
      );
    });

    it('skips an id-less top-level step for both id-uniqueness and cycle detection, rather than crashing', () => {
      // id is optional at the type level (types.ts's own WorkflowStepBase doc comment) -- a caller
      // constructing a Workflow directly, not through parseWorkflow, can genuinely omit it even on a
      // top-level step. Neither check may assume every "addressable" step actually has one.
      const wf = workflow([
        { kind: 'checkpoint' },
        { id: 'a', kind: 'checkpoint', dependsOn: ['a'] },
      ]);

      const issues = validateStructure(wf);

      expect(issues.filter((issue) => issue.code === 'duplicate-step-id')).toEqual([]);
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'dependency-cycle', stepId: 'a' }),
      );
    });

    it('reports a cycle entirely inside a parallel/sequence group nested inside a fanout child', () => {
      const wf = workflow([
        {
          id: 'fo',
          kind: 'fanout',
          over: 'stage.stories',
          step: {
            kind: 'parallel',
            steps: [
              { id: 'p1', kind: 'checkpoint', dependsOn: ['p2'] },
              { id: 'p2', kind: 'checkpoint', dependsOn: ['p1'] },
            ],
          },
        },
      ]);

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'dependency-cycle' }),
      );
    });

    it('reports an excessive-dependency-depth issue rather than crashing on an extremely long dependsOn chain', () => {
      const CHAIN_LENGTH = 2500;
      // Each step depends on the *next* one, not the previous: the top-level "start a DFS from every
      // unvisited addressable step" loop processes `addressable` in array order, so a chain pointing
      // backward (i depends on i-1) would have i-1 already marked 'done' from its own earlier pass by
      // the time i starts, keeping the real stack shallow no matter how long the chain is. Pointing
      // forward instead forces one single, genuinely deep cascade starting from s0.
      const steps: WorkflowStep[] = Array.from({ length: CHAIN_LENGTH }, (_unused, i) => ({
        id: `s${String(i)}`,
        kind: 'checkpoint',
        ...(i === CHAIN_LENGTH - 1 ? {} : { dependsOn: [`s${String(i + 1)}`] }),
      }));
      const wf = workflow(steps);

      let issues: readonly { code: string }[] = [];
      expect(() => {
        issues = validateStructure(wf);
      }).not.toThrow();
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'excessive-dependency-depth' }),
      );
    });

    it('reports only excessive-dependency-depth, never a fabricated non-closing dependency-cycle, when a long chain and a real cycle appear in the same graph', () => {
      // Confirmed empirically that abandoning an over-deep DFS's own stack without resetting the
      // 'visiting' state it leaves behind lets a *later* start's fresh DFS mistake a stale-'visiting'
      // step for one genuinely on its own current path -- reported as a "cycle" that doesn't even close
      // (its own first and last step differ), and en masse (one per remaining unvisited step) for an
      // ordinary flat chain past a couple thousand entries, not just pathologically nested input.
      const CHAIN_LENGTH = 2500;
      const steps: WorkflowStep[] = Array.from({ length: CHAIN_LENGTH }, (_unused, i) => ({
        id: `s${String(i)}`,
        kind: 'checkpoint',
        // The last step closes the chain back to the first, a genuine cycle spanning the whole chain --
        // exactly the shape that starts flooding fabricated non-closing "cycles" without this fix.
        dependsOn: [i === CHAIN_LENGTH - 1 ? 's0' : `s${String(i + 1)}`],
      }));
      const wf = workflow(steps);

      let issues: readonly ValidationIssue[] = [];
      expect(() => {
        issues = validateStructure(wf);
      }).not.toThrow();

      const depthIssues = issues.filter((issue) => issue.code === 'excessive-dependency-depth');
      const cycleIssues = issues.filter((issue) => issue.code === 'dependency-cycle');
      expect(depthIssues).toHaveLength(1);
      expect(cycleIssues).toEqual([]);
      // Every issue this function can return at all is honestly labelled -- no other code sneaks in.
      expect(issues.every((issue) => issue.code === 'excessive-dependency-depth')).toBe(true);
    });
  });

  describe('produces glob well-formedness', () => {
    it('reports an empty-string produces glob as malformed', () => {
      const wf = workflow([{ id: 'a', kind: 'agent', agent: 'engineer', produces: '' }]);

      const issues = validateStructure(wf);

      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'malformed-produces-glob', stepId: 'a' }),
      );
    });

    it('reports an empty-string entry inside a produces array as malformed', () => {
      const wf = workflow([
        { id: 'a', kind: 'agent', agent: 'engineer', produces: ['src/**/*.ts', ''] },
      ]);

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'malformed-produces-glob' }),
      );
    });

    it('does not report a real, ordinary glob as malformed, bare string or array alike', () => {
      const wf = workflow([
        { id: 'a', kind: 'agent', agent: 'engineer', produces: 'src/**/*.ts' },
        { id: 'b', kind: 'agent', agent: 'engineer', produces: ['src/a.ts', 'src/b.ts'] },
      ]);

      expect(
        validateStructure(wf).filter((issue) => issue.code === 'malformed-produces-glob'),
      ).toEqual([]);
    });

    it('checks produces globs nested inside a fanout child too', () => {
      const wf = workflow([
        {
          id: 'a',
          kind: 'fanout',
          over: 'stage.stories',
          step: { kind: 'agent', agent: 'engineer', produces: '' },
        },
      ]);

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'malformed-produces-glob' }),
      );
    });

    it('does not check produces on a step kind with no such field at all (no produces to be absent)', () => {
      const wf = workflow([{ id: 'a', kind: 'gate', gate: 'G-Always' }]);

      expect(
        validateStructure(wf).filter((issue) => issue.code === 'malformed-produces-glob'),
      ).toEqual([]);
    });

    // `06` §6.2's `StepNode.produces` is shared by every kind; `agent` and `command` are the two that
    // author it (`PLAN-M14.md` P2) -- both narrowed the same way here.
    it('checks a command step\'s own produces glob too, not only an agent step\'s', () => {
      const wf = workflow([{ id: 'a', kind: 'command', run: 'echo hi', produces: '' }]);

      expect(validateStructure(wf)).toContainEqual(
        expect.objectContaining({ code: 'malformed-produces-glob', stepId: 'a' }),
      );
    });

    it('does not flag a command step with a real, well-formed produces glob', () => {
      const wf = workflow([
        { id: 'a', kind: 'command', run: 'echo hi', produces: ['docs/forge/reports/x.json'] },
      ]);

      expect(
        validateStructure(wf).filter((issue) => issue.code === 'malformed-produces-glob'),
      ).toEqual([]);
    });

    it('does not check produces on a command step with no produces field at all', () => {
      const wf = workflow([{ id: 'a', kind: 'command', run: 'echo hi' }]);

      expect(
        validateStructure(wf).filter((issue) => issue.code === 'malformed-produces-glob'),
      ).toEqual([]);
    });
  });

  describe('excessive nesting depth', () => {
    it('reports one excessive-nesting-depth issue, rather than crashing, for an extremely deeply nested sequence of single-child parallel groups', () => {
      const NESTING_DEPTH = 3000;
      let innermost: WorkflowStep = { id: 'leaf', kind: 'checkpoint' };
      for (let i = 0; i < NESTING_DEPTH; i += 1) {
        innermost = { id: `group${String(i)}`, kind: 'parallel', steps: [innermost] };
      }
      const wf = workflow([innermost]);

      let issues: readonly { code: string }[] = [];
      expect(() => {
        issues = validateStructure(wf);
      }).not.toThrow();
      expect(issues).toContainEqual(expect.objectContaining({ code: 'excessive-nesting-depth' }));
    });
  });
});

describe('validateWorkflow', () => {
  it('reports an unknown agent', () => {
    const wf = workflow([{ id: 'a', kind: 'agent', agent: 'nonexistent-role' }]);

    const issues = validateWorkflow(wf, allowAllOracle({ agentExists: () => false }));

    expect(issues).toContainEqual(expect.objectContaining({ code: 'unknown-agent', stepId: 'a' }));
  });

  it('reports an unknown brief', () => {
    const wf = workflow([
      { id: 'a', kind: 'agent', agent: 'engineer', brief: 'briefs/does-not-exist.md' },
    ]);

    const issues = validateWorkflow(wf, allowAllOracle({ briefExists: () => false }));

    expect(issues).toContainEqual(expect.objectContaining({ code: 'unknown-brief', stepId: 'a' }));
  });

  it('reports a gateEvidence entry naming a nonexistent gate', () => {
    const wf = workflow([
      { id: 'a', kind: 'agent', agent: 'engineer', gateEvidence: ['G-DoesNotExist'] },
    ]);

    const issues = validateWorkflow(wf, allowAllOracle({ gateExists: () => false }));

    expect(issues).toContainEqual(expect.objectContaining({ code: 'unknown-gate', stepId: 'a' }));
  });

  it("reports a gate step's own gate field naming a nonexistent gate, not just gateEvidence", () => {
    const wf = workflow([{ id: 'a', kind: 'gate', gate: 'G-DoesNotExist' }]);

    const issues = validateWorkflow(wf, allowAllOracle({ gateExists: () => false }));

    expect(issues).toContainEqual(expect.objectContaining({ code: 'unknown-gate', stepId: 'a' }));
  });

  it('reports an outputs[].type naming a nonexistent artifact type', () => {
    const wf = workflow([
      { id: 'a', kind: 'agent', agent: 'engineer', outputs: [{ type: 'NotARealType' }] },
    ]);

    const issues = validateWorkflow(wf, allowAllOracle({ artifactTypeExists: () => false }));

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'unknown-artifact-type', stepId: 'a' }),
    );
  });

  it('reports a subworkflow step naming a nonexistent workflow', () => {
    const wf = workflow([{ id: 'a', kind: 'subworkflow', workflow: 'not-a-real-workflow' }]);

    const issues = validateWorkflow(wf, allowAllOracle({ workflowExists: () => false }));

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'unknown-workflow', stepId: 'a' }),
    );
  });

  it('reports nothing when everything referenced genuinely exists', () => {
    const wf = workflow([
      {
        id: 'a',
        kind: 'agent',
        agent: 'engineer',
        brief: 'briefs/real.md',
        gateEvidence: ['G-Design'],
        outputs: [{ type: 'InterfaceContract' }],
      },
      { id: 'b', kind: 'gate', gate: 'G-Verify' },
      { id: 'c', kind: 'subworkflow', workflow: 'deliver-stage' },
    ]);

    expect(validateWorkflow(wf, allowAllOracle())).toEqual([]);
  });

  it('reports a workflow.requires.gates_passed entry naming a nonexistent gate', () => {
    const wf = workflow([{ id: 'a', kind: 'checkpoint' }], {
      requires: { gates_passed: ['G-DoesNotExist'] },
    });

    const issues = validateWorkflow(wf, allowAllOracle({ gateExists: () => false }));

    expect(issues).toContainEqual(expect.objectContaining({ code: 'unknown-gate' }));
  });

  it('reports a workflow.requires.artifacts entry naming a nonexistent artifact type', () => {
    const wf = workflow([{ id: 'a', kind: 'checkpoint' }], {
      requires: { artifacts: ['ArtifactDoesNotExist'] },
    });

    const issues = validateWorkflow(wf, allowAllOracle({ artifactTypeExists: () => false }));

    expect(issues).toContainEqual(expect.objectContaining({ code: 'unknown-artifact-type' }));
  });

  it('reports nothing for workflow.requires when both gates_passed and artifacts genuinely exist', () => {
    const wf = workflow([{ id: 'a', kind: 'checkpoint' }], {
      requires: { gates_passed: ['G-Ready'], artifacts: ['StagePlan'] },
    });

    expect(validateWorkflow(wf, allowAllOracle())).toEqual([]);
  });

  it('checks referential integrity inside a fanout child too, not just top-level steps', () => {
    const wf = workflow([
      {
        id: 'a',
        kind: 'fanout',
        over: 'stage.stories',
        step: { kind: 'agent', agent: 'nonexistent-role' },
      },
    ]);

    const issues = validateWorkflow(wf, allowAllOracle({ agentExists: () => false }));

    expect(issues).toContainEqual(expect.objectContaining({ code: 'unknown-agent' }));
  });

  it('checks referential integrity inside onComplete and an onFailure escalation\'s "do" step too', () => {
    const wf = workflow([{ id: 'a', kind: 'checkpoint' }], {
      onComplete: [{ kind: 'agent', agent: 'nonexistent-role' }],
      onFailure: {
        default: 'block',
        escalations: [{ when: 'true', do: { kind: 'agent', agent: 'also-nonexistent' } }],
      },
    });

    const issues = validateWorkflow(wf, allowAllOracle({ agentExists: () => false }));

    expect(issues.filter((issue) => issue.code === 'unknown-agent')).toHaveLength(2);
  });

  it('does not check anything for a step kind with no referential fields, e.g. checkpoint', () => {
    const wf = workflow([{ id: 'a', kind: 'checkpoint' }]);

    expect(
      validateWorkflow(wf, allowAllOracle({ agentExists: () => false, gateExists: () => false })),
    ).toEqual([]);
  });

  describe('an unidentified step (no id, e.g. a fanout child)', () => {
    it('labels an unknown-brief/unknown-gate(evidence)/unknown-artifact-type message "(unidentified)" rather than crashing on a missing id', () => {
      const wf = workflow([
        {
          id: 'a',
          kind: 'fanout',
          over: 'stage.stories',
          step: {
            kind: 'agent',
            agent: 'engineer',
            brief: 'briefs/does-not-exist.md',
            gateEvidence: ['G-DoesNotExist'],
            outputs: [{ type: 'NotARealType' }],
          },
        },
      ]);

      const issues = validateWorkflow(
        wf,
        allowAllOracle({
          briefExists: () => false,
          gateExists: () => false,
          artifactTypeExists: () => false,
        }),
      );

      expect(issues.find((issue) => issue.code === 'unknown-brief')).not.toHaveProperty('stepId');
      expect(issues.find((issue) => issue.code === 'unknown-brief')?.message).toContain(
        '"(unidentified)"',
      );
      expect(issues.find((issue) => issue.code === 'unknown-gate')?.message).toContain(
        '"(unidentified)"',
      );
      expect(issues.find((issue) => issue.code === 'unknown-artifact-type')?.message).toContain(
        '"(unidentified)"',
      );
    });

    it('labels an unknown-gate message "(unidentified)" for a nested gate step too, not just gateEvidence', () => {
      const wf = workflow([
        {
          id: 'a',
          kind: 'fanout',
          over: 'stage.stories',
          step: { kind: 'gate', gate: 'G-DoesNotExist' },
        },
      ]);

      const issues = validateWorkflow(wf, allowAllOracle({ gateExists: () => false }));

      expect(issues.find((issue) => issue.code === 'unknown-gate')?.message).toContain(
        '"(unidentified)"',
      );
    });

    it('labels an unknown-workflow message "(unidentified)" for a nested subworkflow step too', () => {
      const wf = workflow([
        {
          id: 'a',
          kind: 'fanout',
          over: 'stage.stories',
          step: { kind: 'subworkflow', workflow: 'not-a-real-workflow' },
        },
      ]);

      const issues = validateWorkflow(wf, allowAllOracle({ workflowExists: () => false }));

      expect(issues.find((issue) => issue.code === 'unknown-workflow')?.message).toContain(
        '"(unidentified)"',
      );
    });
  });

  it('reports an excessive-nesting-depth issue rather than crashing, on the same pathologically deep input validateStructure guards against', () => {
    const NESTING_DEPTH = 3000;
    let innermost: WorkflowStep = { id: 'leaf', kind: 'checkpoint' };
    for (let i = 0; i < NESTING_DEPTH; i += 1) {
      innermost = { id: `group${String(i)}`, kind: 'parallel', steps: [innermost] };
    }
    const wf = workflow([innermost]);

    let issues: readonly { code: string }[] = [];
    expect(() => {
      issues = validateWorkflow(wf, allowAllOracle());
    }).not.toThrow();
    expect(issues).toContainEqual(expect.objectContaining({ code: 'excessive-nesting-depth' }));
  });
});
