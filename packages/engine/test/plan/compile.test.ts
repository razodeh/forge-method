/**
 * `compilePlan`/`expandFanout`/`compileStepId` — `PLAN-M5.md` P10's own Checks section: `10` §10.1's own
 * generate-tests/implement example expands correctly with matching per-item cross-referencing
 * `dependsOn`; a non-array `over` fails compilation with a located issue, not a crash; expanded ids are
 * stable across a re-compile.
 *
 * @see specs/06 §6.2, §6.7, §6.8
 * @see specs/10 §10.1
 * @see PLAN-M5.md P10
 */
import { describe, expect, it } from 'vitest';

import type { ExpressionContext } from '../../src/expr/index.ts';
import { compilePlan, compileStepId, expandFanout } from '../../src/plan/compile.ts';
import type { CompileIssue, StepNode } from '../../src/plan/types.ts';
import type {
  AgentStep,
  CommandStep,
  FanoutStep,
  Workflow,
  WorkflowStep,
} from '../../src/workflow/types.ts';

function workflow(steps: readonly WorkflowStep[], overrides: Partial<Workflow> = {}): Workflow {
  return { id: 'w', name: 'W', version: '1.0.0', description: 'd', steps, ...overrides };
}

function agentStep(overrides: Partial<AgentStep> & { readonly id?: string } = {}): AgentStep {
  return { kind: 'agent', agent: 'engineer', ...overrides };
}

function expectOk(result: ReturnType<typeof compilePlan>): readonly StepNode[] {
  if (!result.success)
    throw new Error(
      `expected compilation to succeed, got issues: ${JSON.stringify(result.issues)}`,
    );
  return result.nodes;
}

function expectFail(result: ReturnType<typeof compilePlan>): readonly CompileIssue[] {
  if (result.success) throw new Error('expected compilation to fail');
  return result.issues;
}

function findNode(nodes: readonly StepNode[], id: string): StepNode {
  const node = nodes.find((n) => n.id === id);
  if (node === undefined)
    throw new Error(`expected a node with id "${id}", got: ${nodes.map((n) => n.id).join(', ')}`);
  return node;
}

describe('compilePlan -- gateEvidence for block [7] (05 §5.3)', () => {
  it("an agent step's evidence gates are the ones it names plus every gate step that directly depends on it, sorted and de-duplicated", () => {
    const nodes = expectOk(
      compilePlan(
        workflow([
          { ...agentStep({ id: 'a', brief: 'briefs/a.md' }), gateEvidence: ['G-Z', 'G-A'] },
          agentStep({ id: 'b', brief: 'briefs/b.md' }),
          { id: 'gate-1', kind: 'gate', gate: 'G-A', dependsOn: ['a', 'b'] },
          { id: 'gate-2', kind: 'gate', gate: 'G-M', dependsOn: ['b'] },
        ]),
        {},
      ),
    );
    expect(findNode(nodes, 'w:a').gateEvidence).toEqual(['G-A', 'G-Z']);
    expect(findNode(nodes, 'w:b').gateEvidence).toEqual(['G-A', 'G-M']);
  });

  it('an agent step no gate concerns carries no gateEvidence key at all', () => {
    const nodes = expectOk(compilePlan(workflow([agentStep({ id: 'a' })]), {}));
    expect('gateEvidence' in findNode(nodes, 'w:a')).toBe(false);
  });
});

describe('compilePlan -- run inputs for block [4] (M13 P5)', () => {
  it("an agent step carries the run's values for the workflow's declared inputs, and a fanout child also its item", () => {
    const nodes = expectOk(
      compilePlan(
        workflow(
          [
            agentStep({ id: 'plain', brief: 'briefs/a.md' }),
            {
              kind: 'fanout',
              id: 'each',
              over: 'stage.items',
              itemKey: '{{item.id}}',
              step: agentStep({ brief: 'briefs/b.md' }),
            },
          ],
          {
            inputs: [
              { name: 'stageId', type: 'string', required: true },
              { name: 'notSupplied', type: 'string', required: false },
            ],
          },
        ),
        { stageId: 'S-2', other: 'ignored', stage: { items: [{ id: 'i1' }] } } as ExpressionContext,
      ),
    );
    expect(findNode(nodes, 'w:plain').runInputs).toEqual({ stageId: 'S-2' });
    expect(findNode(nodes, 'w:each:i1').runInputs).toEqual({ stageId: 'S-2', item: { id: 'i1' } });
  });

  it('finds a declared input in vars (where forge run --epic/--story puts it) and names a required input the run did not supply', () => {
    const nodes = expectOk(
      compilePlan(
        workflow([agentStep({ id: 'a', brief: 'briefs/a.md' })], {
          inputs: [
            { name: 'story', type: 'string', required: true },
            { name: 'stageId', type: 'string', required: true },
            { name: 'goal', type: 'string', required: false },
          ],
        }),
        { vars: { story: 'STORY-1' } },
      ),
    );
    expect(findNode(nodes, 'w:a').runInputs).toEqual({ story: 'STORY-1' });
    expect(findNode(nodes, 'w:a').missingRunInputs).toEqual(['stageId']);
  });

  it('a workflow with no declared inputs and no fanout item carries no runInputs key', () => {
    const nodes = expectOk(
      compilePlan(workflow([agentStep({ id: 'a' })]), { stageId: 'x' } as ExpressionContext),
    );
    expect('runInputs' in findNode(nodes, 'w:a')).toBe(false);
  });
});

describe('compileStepId', () => {
  it('formats a plain step id as "workflowId:stepId"', () => {
    expect(compileStepId('w', 'implement')).toBe('w:implement');
  });

  it('formats a fanout-expanded item id as "workflowId:stepId:itemKey"', () => {
    expect(compileStepId('w', 'implement', 'story-014')).toBe('w:implement:story-014');
  });
});

describe("compilePlan — 10 §10.1's own generate-tests/implement worked example", () => {
  const context: ExpressionContext = {
    stage: {
      stories: [
        {
          id: 'story-1',
          owner_role: 'engineer',
          test_paths: 'test/story-1.test.ts',
          files_expected: 'src/story-1.ts',
        },
        {
          id: 'story-2',
          owner_role: 'reviewer',
          test_paths: 'test/story-2.test.ts',
          files_expected: 'src/story-2.ts',
        },
      ],
    },
  };

  const contractsGate: WorkflowStep = { kind: 'gate', id: 'contracts-gate', gate: 'G-Design' };
  const generateTests: FanoutStep = {
    kind: 'fanout',
    id: 'generate-tests',
    over: 'stage.stories',
    itemKey: '{{item.id}}',
    dependsOn: ['contracts-gate'],
    step: {
      kind: 'agent',
      agent: 'sdet',
      brief: 'briefs/write-failing-tests.md',
      produces: ['{{item.test_paths}}'],
    },
  };
  const implement: FanoutStep = {
    kind: 'fanout',
    id: 'implement',
    over: 'stage.stories',
    itemKey: '{{item.id}}',
    dependsOn: ['generate-tests:{{item.id}}'],
    step: {
      kind: 'agent',
      agent: '{{item.owner_role}}',
      brief: 'briefs/implement-story.md',
      produces: '{{item.files_expected}}',
    },
  };

  it('expands into exactly one node per story for each fanout', () => {
    const nodes = expectOk(
      compilePlan(workflow([contractsGate, generateTests, implement]), context),
    );
    const implementNodes = nodes.filter((n) => n.id.startsWith('w:implement:'));
    const generateNodes = nodes.filter((n) => n.id.startsWith('w:generate-tests:'));
    expect(implementNodes).toHaveLength(2);
    expect(generateNodes).toHaveLength(2);
  });

  it("resolves each implement node's dependsOn to the matching story's own generate-tests id, not a different story's", () => {
    const nodes = expectOk(
      compilePlan(workflow([contractsGate, generateTests, implement]), context),
    );
    expect(findNode(nodes, 'w:implement:story-1').dependsOn).toEqual(['w:generate-tests:story-1']);
    expect(findNode(nodes, 'w:implement:story-2').dependsOn).toEqual(['w:generate-tests:story-2']);
  });

  it('resolves the per-item agent template ("{{item.owner_role}}") independently for each item', () => {
    const nodes = expectOk(
      compilePlan(workflow([contractsGate, generateTests, implement]), context),
    );
    expect(findNode(nodes, 'w:implement:story-1').agent).toBe('engineer');
    expect(findNode(nodes, 'w:implement:story-2').agent).toBe('reviewer');
  });

  it('resolves a per-item produces template, both the bare-string and array forms the worked example shows', () => {
    const nodes = expectOk(
      compilePlan(workflow([contractsGate, generateTests, implement]), context),
    );
    expect(findNode(nodes, 'w:generate-tests:story-1').produces).toEqual(['test/story-1.test.ts']);
    expect(findNode(nodes, 'w:implement:story-1').produces).toEqual(['src/story-1.ts']);
  });

  it('compiling the same workflow against the same context twice produces byte-identical ids', () => {
    const first = expectOk(
      compilePlan(workflow([contractsGate, generateTests, implement]), context),
    )
      .map((n) => n.id)
      .sort();
    const second = expectOk(
      compilePlan(workflow([contractsGate, generateTests, implement]), context),
    )
      .map((n) => n.id)
      .sort();
    expect(first).toEqual(second);
  });
});

describe('compilePlan — dependsOn qualification', () => {
  it('qualifies a bare authored dependsOn reference with the workflow id, matching the compiled id format every other reference already uses', () => {
    const nodes = expectOk(
      compilePlan(
        workflow([
          { kind: 'checkpoint', id: 'a' },
          { kind: 'checkpoint', id: 'b', dependsOn: ['a'] },
        ]),
        {},
      ),
    );
    expect(findNode(nodes, 'w:b').dependsOn).toEqual(['w:a']);
  });

  it('does not throw when a dependsOn template fails to resolve -- reports a located compile issue instead, and still reports independent issues elsewhere in the same plan', () => {
    const wf = workflow([
      agentStep({ id: 'a', dependsOn: ['{{vars.missing}}'] }),
      agentStep({ id: 'b', onFailure: 'not-a-real-value' }),
    ]);
    expect(() => compilePlan(wf, {})).not.toThrow();
    const issues = expectFail(compilePlan(wf, {}));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'template-resolution-failed', stepId: 'w:a' }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-on-failure-value', stepId: 'w:b' }),
    );
  });
});

describe('compilePlan -- a merge over a collection depends on every item of the fanout it names (10 §10.1 build-stage)', () => {
  const stories = [{ id: 'story-2' }, { id: 'story-1' }, { id: 'story-3' }];
  const review: FanoutStep = {
    kind: 'fanout',
    id: 'review',
    over: 'stage.stories',
    itemKey: '{{item.id}}',
    step: agentStep({ agent: 'reviewer' }),
  };
  const merge = (overrides: Record<string, unknown> = {}): WorkflowStep => ({
    kind: 'merge',
    id: 'merge',
    over: 'stage.stories',
    dependsOn: ['review:{{item.id}}'],
    policy: { conflict: 'agent' },
    ...overrides,
  });

  it('resolves the per-item dependsOn once per item, in collection order, into ONE merge node', () => {
    const nodes = expectOk(compilePlan(workflow([review, merge()]), { stage: { stories } }));
    expect(nodes.filter((n) => n.kind === 'merge').map((n) => n.id)).toEqual(['w:merge']);
    expect(findNode(nodes, 'w:merge').dependsOn).toEqual([
      'w:review:story-2',
      'w:review:story-1',
      'w:review:story-3',
    ]);
  });

  it('does not depend on anything of a different fanout', () => {
    const other: FanoutStep = { ...review, id: 'other' };
    const nodes = expectOk(compilePlan(workflow([review, other, merge()]), { stage: { stories } }));
    expect(findNode(nodes, 'w:merge').dependsOn.some((d) => d.startsWith('w:other'))).toBe(false);
    expect(findNode(nodes, 'w:merge').dependsOn).toHaveLength(3);
  });

  it('puts inherited (sequence) and static dependencies ahead of the per-item ones, each once', () => {
    const wf = workflow([
      agentStep({ id: 'gate-ish' }),
      agentStep({ id: 'early' }),
      review,
      {
        kind: 'sequence',
        id: 'tail',
        dependsOn: ['early'],
        steps: [merge({ dependsOn: ['gate-ish', 'review:{{item.id}}'] })],
      },
    ]);
    const nodes = expectOk(compilePlan(wf, { stage: { stories: [{ id: 'a' }, { id: 'b' }] } }));
    expect(findNode(nodes, 'w:merge').dependsOn).toEqual([
      'w:early',
      'w:gate-ish',
      'w:review:a',
      'w:review:b',
    ]);
  });

  it('an empty collection: the merge waits for whatever the empty fanout would have waited for, so it is never an unordered root', () => {
    // gate -> review (per item) -> merge -> tail. With no stories `review` has no instances; a merge that
    // simply dropped its per-item dependency would become a root and `tail` could start before `gate` ends.
    const guarded: FanoutStep = { ...review, dependsOn: ['gate'] };
    const nodes = expectOk(
      compilePlan(
        workflow([
          agentStep({ id: 'gate' }),
          guarded,
          merge(),
          agentStep({ id: 'tail', dependsOn: ['merge'] }),
        ]),
        { stage: { stories: [] } },
      ),
    );
    expect(nodes.map((n) => n.id)).toEqual(['w:gate', 'w:merge', 'w:tail']);
    expect(findNode(nodes, 'w:merge').dependsOn).toEqual(['w:gate']);
    expect(findNode(nodes, 'w:tail').dependsOn).toEqual(['w:merge']);
  });

  it('an empty collection follows a chain of empty fanouts back to the first thing they wait for, and keeps static entries', () => {
    const first: FanoutStep = { ...review, id: 'first', dependsOn: ['gate'] };
    const second: FanoutStep = { ...review, id: 'second', dependsOn: ['first:{{item.id}}'] };
    const nodes = expectOk(
      compilePlan(
        workflow([
          agentStep({ id: 'gate' }),
          agentStep({ id: 'other' }),
          first,
          second,
          merge({ dependsOn: ['other', 'second:{{item.id}}'] }),
        ]),
        { stage: { stories: [] } },
      ),
    );
    expect(findNode(nodes, 'w:merge').dependsOn).toEqual(['w:other', 'w:gate']);
  });

  it('an empty collection still reports a genuine error in a dependency instead of swallowing it', () => {
    const issues = expectFail(
      compilePlan(
        workflow([review, merge({ dependsOn: ['{{vars.typo}}', 'review:{{item.id}}'] })]),
        {
          stage: { stories: [] },
        },
      ),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'template-resolution-failed', stepId: 'w:merge' }),
    );
  });

  it('an empty collection whose per-item target is no known fanout is refused, not silently dropped', () => {
    const issues = expectFail(
      compilePlan(workflow([merge({ dependsOn: ['nowhere:{{item.id}}'] })]), {
        stage: { stories: [] },
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'template-resolution-failed', stepId: 'w:merge' }),
    );
  });

  it('a merge whose over is not a parseable expression keeps compiling as it always did (over was never read before)', () => {
    for (const over of ['all lanes', 'lane-1, lane-2', 'the lanes of stage 1', 'stage.stories |']) {
      const nodes = expectOk(
        compilePlan(workflow([agentStep({ id: 'a' }), merge({ over, dependsOn: ['a'] })]), {
          stage: { stories },
        }),
      );
      expect(findNode(nodes, 'w:merge').dependsOn).toEqual(['w:a']);
    }
  });

  it('an empty merge over a stage whose named fanout is NOT empty is a mismatch, not a merge that skips real reviews', () => {
    const elsewhere: FanoutStep = { ...review, over: 'stage.other', dependsOn: ['gate'] };
    const issues = expectFail(
      compilePlan(workflow([agentStep({ id: 'gate' }), elsewhere, merge()]), {
        stage: { stories: [], other: [{ id: 'x' }] },
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'merge-over-mismatch', stepId: 'w:merge' }),
    );
  });

  it('an empty merge finds the fanout it names when that fanout sits inside a sequence or parallel group', () => {
    const guarded: FanoutStep = { ...review, dependsOn: ['gate'] };
    for (const kind of ['sequence', 'parallel'] as const) {
      const wf = workflow([
        agentStep({ id: 'gate' }),
        { kind, id: 'group', steps: [guarded] },
        merge(),
      ]);
      const empty = expectOk(compilePlan(wf, { stage: { stories: [] } }));
      expect(findNode(empty, 'w:merge').dependsOn).toEqual(['w:gate']);
    }
  });

  it('an empty merge over a diamond of fanouts (two paths to the same fanout) waits on the shared start once', () => {
    const start: FanoutStep = { ...review, id: 'start', dependsOn: ['gate'] };
    const left: FanoutStep = { ...review, id: 'left', dependsOn: ['start:{{item.id}}'] };
    const right: FanoutStep = { ...review, id: 'right', dependsOn: ['start:{{item.id}}'] };
    const join: FanoutStep = {
      ...review,
      id: 'join',
      dependsOn: ['left:{{item.id}}', 'right:{{item.id}}'],
    };
    const wf = workflow([
      agentStep({ id: 'gate' }),
      start,
      left,
      right,
      join,
      merge({ dependsOn: ['join:{{item.id}}'] }),
    ]);
    expect(
      findNode(expectOk(compilePlan(wf, { stage: { stories: [] } })), 'w:merge').dependsOn,
    ).toEqual(['w:gate']);
    expect(
      findNode(expectOk(compilePlan(wf, { stage: { stories: [{ id: 'a' }] } })), 'w:merge')
        .dependsOn,
    ).toEqual(['w:join:a']);
  });

  it('a merge and the fanout it waits on that disagree on how many items there are is a mismatch either way', () => {
    const wider: FanoutStep = { ...review, over: 'stage.wider' };
    const issues = expectFail(
      compilePlan(workflow([wider, merge()]), {
        stage: { stories: [{ id: 'a' }], wider: [{ id: 'a' }, { id: 'b' }] },
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'merge-over-mismatch', stepId: 'w:merge' }),
    );
  });

  it('says why when the named fanout could not be evaluated (not that it is "not empty")', () => {
    const broken: FanoutStep = { ...review, over: 'stage.nothing' };
    const issues = expectFail(compilePlan(workflow([broken, merge()]), { stage: { stories: [] } }));
    const mismatch = issues.find((i) => i.code === 'merge-over-mismatch');
    expect(mismatch?.message).toContain('stage.nothing');
    expect(mismatch?.message).not.toContain('is not empty');
  });

  it('a whitespaced placeholder ({{ item.id }}) behaves the same for an empty and a non-empty collection', () => {
    const spaced = merge({ dependsOn: ['review:{{ item.id }}'] });
    const guarded: FanoutStep = { ...review, dependsOn: ['gate'] };
    const wf = workflow([agentStep({ id: 'gate' }), guarded, spaced]);
    expect(
      findNode(expectOk(compilePlan(wf, { stage: { stories: [] } })), 'w:merge').dependsOn,
    ).toEqual(['w:gate']);
    expect(
      findNode(expectOk(compilePlan(wf, { stage: { stories: [{ id: 'a' }] } })), 'w:merge')
        .dependsOn,
    ).toEqual(['w:review:a']);
  });

  it('lists a dependency named both by an enclosing sequence and by the merge itself once', () => {
    const wf = workflow([
      agentStep({ id: 'early' }),
      review,
      {
        kind: 'sequence',
        id: 'tail',
        dependsOn: ['early'],
        steps: [merge({ dependsOn: ['early', 'review:{{item.id}}'] })],
      },
    ]);
    const nodes = expectOk(compilePlan(wf, { stage: { stories: [{ id: 'a' }] } }));
    expect(findNode(nodes, 'w:merge').dependsOn).toEqual(['w:early', 'w:review:a']);
  });

  it('a failing static dependency is reported once, not once per item', () => {
    const issues = expectFail(
      compilePlan(
        workflow([review, merge({ dependsOn: ['{{vars.typo}}', 'review:{{item.id}}'] })]),
        { stage: { stories } },
      ),
    );
    expect(issues.filter((i) => i.stepId === 'w:merge')).toHaveLength(1);
  });

  it('still refuses a per-item dependency the fanout was not keyed for, item by item (no silent dangling merge)', () => {
    const unkeyed: FanoutStep = {
      kind: 'fanout',
      id: 'review',
      over: 'stage.stories',
      step: agentStep({ agent: 'reviewer' }),
    };
    const issues = expectFail(compilePlan(workflow([unkeyed, merge()]), { stage: { stories } }));
    expect(issues.filter((i) => i.code === 'dangling-dependency')).toHaveLength(3);
  });

  it('reports an item that cannot name itself at the merge step, once (the same problem is not repeated per item)', () => {
    const issues = expectFail(
      compilePlan(workflow([review, merge()]), { stage: { stories: [{ id: 'ok' }, {}, {}] } }),
    );
    const own = issues.filter((i) => i.stepId === 'w:merge');
    expect(own).toHaveLength(1);
    expect(own[0]?.code).toBe('template-resolution-failed');
  });

  it('a merge whose over is not a collection keeps the old single resolution: static dependencies compile, an item reference is still refused', () => {
    // Not annotated: a workflow input such as `storyId` sits at the context root, which `ExpressionContext` does
    // not name (the same shape `test/workflows.test.ts`'s fixture context takes).
    const withStoryId = { storyId: 'S-1', stage: { stories } };
    const ok = expectOk(
      compilePlan(
        workflow([agentStep({ id: 'commit' }), merge({ over: 'storyId', dependsOn: ['commit'] })]),
        withStoryId,
      ),
    );
    expect(findNode(ok, 'w:merge').dependsOn).toEqual(['w:commit']);
    const issues = expectFail(
      compilePlan(workflow([review, merge({ over: 'storyId' })]), {
        ...withStoryId,
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'template-resolution-failed', stepId: 'w:merge' }),
    );
  });

  it('is deterministic: the same inputs give the same nodes twice', () => {
    const wf = workflow([review, merge()]);
    const a = expectOk(compilePlan(wf, { stage: { stories } }));
    const b = expectOk(compilePlan(wf, { stage: { stories } }));
    expect(b).toEqual(a);
  });
});

describe('compilePlan — plan-wide consistency: dangling dependencies and duplicate ids', () => {
  it("reports a dangling-dependency compile issue for a plain typo'd dependsOn reference, rather than silently succeeding", () => {
    const issues = expectFail(
      compilePlan(workflow([agentStep({ id: 'a', dependsOn: ['nonexistent'] })]), {}),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'dangling-dependency', stepId: 'w:a' }),
    );
  });

  it('reports a dangling-dependency compile issue when a fanout cross-reference\'s itemKey scheme does not match the fanout it targets -- the shipped build-stage\'s "review" fanout was once unkeyed, unlike "generate-tests"/"implement"', () => {
    // B (the target) omits itemKey, so its real compiled ids are positional: w:B:0, w:B:1. C's own
    // dependsOn templates against item.id instead, producing "w:B:story-1" -- an id nothing was ever
    // compiled with. This must not silently succeed with a permanently-unsatisfiable dependency.
    const target: FanoutStep = {
      kind: 'fanout',
      id: 'B',
      over: 'stage.stories',
      step: agentStep({ agent: 'reviewer' }),
    };
    const referencing: FanoutStep = {
      kind: 'fanout',
      id: 'C',
      over: 'stage.stories',
      dependsOn: ['B:{{item.id}}'],
      step: agentStep({ agent: 'closer' }),
    };
    const context: ExpressionContext = {
      stage: { stories: [{ id: 'story-1' }, { id: 'story-2' }] },
    };
    expect(() => compilePlan(workflow([target, referencing]), context)).not.toThrow();
    const issues = expectFail(compilePlan(workflow([target, referencing]), context));
    expect(issues.filter((i) => i.code === 'dangling-dependency')).toHaveLength(2);
  });

  it('does not report a dangling dependency for a correct fanout cross-reference (itemKey schemes match)', () => {
    const target: FanoutStep = {
      kind: 'fanout',
      id: 'B',
      over: 'stage.stories',
      itemKey: '{{item.id}}',
      step: agentStep(),
    };
    const referencing: FanoutStep = {
      kind: 'fanout',
      id: 'C',
      over: 'stage.stories',
      itemKey: '{{item.id}}',
      dependsOn: ['B:{{item.id}}'],
      step: agentStep(),
    };
    const context: ExpressionContext = { stage: { stories: [{ id: 'story-1' }] } };
    const nodes = expectOk(compilePlan(workflow([target, referencing]), context));
    expect(findNode(nodes, 'w:C:story-1').dependsOn).toEqual(['w:B:story-1']);
  });

  it('reports a duplicate-compiled-step-id issue when two different steps compile to the identical id, rather than silently producing two indistinguishable nodes', () => {
    const wf = workflow([
      { kind: 'parallel', id: 'p1', steps: [agentStep({ id: 'x', agent: 'first' })] },
      { kind: 'parallel', id: 'p2', steps: [agentStep({ id: 'x', agent: 'second' })] },
    ]);
    expect(() => compilePlan(wf, {})).not.toThrow();
    const issues = expectFail(compilePlan(wf, {}));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate-compiled-step-id', stepId: 'w:x' }),
    );
  });

  it('does not run the dangling-dependency check against an already-incomplete node list -- one real fanout error is reported once, not compounded with confusing cascade issues', () => {
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'f',
      over: 'stage.notAnArray',
      dependsOn: ['nonexistent'],
      step: agentStep(),
    };
    const issues = expectFail(compilePlan(workflow([fanout]), { stage: { notAnArray: 'nope' } }));
    expect(issues).toEqual([expect.objectContaining({ code: 'fanout-over-not-array' })]);
  });

  it("does not report a dangling dependency for a reference to a parallel group's own bare id -- a verify round found this silently regressed a documented, intentional design (deferred to P11), and disagreed with validateStructure, which already accepts the identical construct", () => {
    const wf = workflow([
      { kind: 'parallel', id: 'p', steps: [agentStep({ id: 'x' })] },
      { kind: 'checkpoint', id: 'after', dependsOn: ['p'] },
    ]);
    const nodes = expectOk(compilePlan(wf, {}));
    expect(findNode(nodes, 'w:after').dependsOn).toEqual(['w:p']);
  });

  it("does not report a dangling dependency for a reference to a sequence group's own bare id, the identical case for the other group kind", () => {
    const wf = workflow([
      { kind: 'sequence', id: 's', steps: [agentStep({ id: 'x' }), agentStep({ id: 'y' })] },
      { kind: 'checkpoint', id: 'after', dependsOn: ['s'] },
    ]);
    const nodes = expectOk(compilePlan(wf, {}));
    expect(findNode(nodes, 'w:after').dependsOn).toEqual(['w:s']);
  });

  it("recognises a group's own id even when the group is nested inside another group", () => {
    const wf = workflow([
      {
        kind: 'sequence',
        id: 'outer',
        steps: [{ kind: 'parallel', id: 'inner', steps: [agentStep({ id: 'x' })] }],
      },
      { kind: 'checkpoint', id: 'after', dependsOn: ['inner'] },
    ]);
    const nodes = expectOk(compilePlan(wf, {}));
    expect(findNode(nodes, 'w:after').dependsOn).toEqual(['w:inner']);
  });

  it('an id-less group contributes no group id -- a reference to what its id would have been still reports dangling', () => {
    const wf = workflow([
      { kind: 'parallel', steps: [agentStep({ id: 'x' })] },
      agentStep({ id: 'y', dependsOn: ['no-such-group'] }),
    ]);
    const issues = expectFail(compilePlan(wf, {}));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'dangling-dependency', stepId: 'w:y' }),
    );
  });

  it('still reports a dangling dependency for a reference that matches neither a real node id nor a known group id -- the group-id fix does not overcorrect into accepting everything', () => {
    const wf = workflow([
      { kind: 'parallel', id: 'p', steps: [agentStep({ id: 'x' })] },
      agentStep({ id: 'y', dependsOn: ['still-nonexistent'] }),
    ]);
    const issues = expectFail(compilePlan(wf, {}));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'dangling-dependency', stepId: 'w:y' }),
    );
  });
});

describe('compilePlan — produces/inputs template resolution against a resolvable context', () => {
  it('resolves item.test_paths/item.files_expected when the context actually has them', () => {
    const context: ExpressionContext = {
      stage: {
        stories: [{ id: 's1', test_paths: 'test/s1.test.ts', files_expected: ['src/s1.ts'] }],
      },
    };
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'gen',
      over: 'stage.stories',
      itemKey: '{{item.id}}',
      step: {
        kind: 'agent',
        agent: 'sdet',
        produces: '{{item.test_paths}}',
        inputs: ['artifact:Story({{item.id}})'],
      },
    };
    const nodes = expectOk(compilePlan(workflow([fanout]), context));
    expect(nodes[0]?.produces).toEqual(['test/s1.test.ts']);
    expect(nodes[0]?.inputs).toEqual(['artifact:Story(s1)']);
  });

  it('a `!` in front of a whole-entry placeholder splices an EXCLUSION per listed path (M13 P36, 06 6.7)', () => {
    const context: ExpressionContext = {
      run: { filesExpected: ['src/s1.ts', 'test/s1.test.ts'], testPaths: ['test/s1.test.ts'] },
    };
    const step: AgentStep = {
      kind: 'agent',
      id: 'refactor',
      agent: 'backend',
      produces: ['{{run.filesExpected}}', '!{{run.testPaths}}'],
    };
    const nodes = expectOk(compilePlan(workflow([step]), context));
    expect(nodes[0]?.produces).toEqual(['src/s1.ts', 'test/s1.test.ts', '!test/s1.test.ts']);
    // an empty list contributes nothing; a scalar is a single negated path
    const empty = expectOk(
      compilePlan(workflow([step]), { run: { filesExpected: ['src/s1.ts'], testPaths: [] } }),
    );
    expect(empty[0]?.produces).toEqual(['src/s1.ts']);
    const scalar = expectOk(
      compilePlan(workflow([step]), {
        run: { filesExpected: 'src/s1.ts', testPaths: 'test/s1.test.ts' },
      }),
    );
    expect(scalar[0]?.produces).toEqual(['src/s1.ts', '!test/s1.test.ts']);
  });

  // `06` §6.2's `StepNode.produces` is shared by every kind; `agent` and `command` are the two that
  // author it (`PLAN-M14.md` P2) -- a `command` step's own `produces` goes through the identical
  // `toResourceClaims`/`resolveClaimEntry` derivation an `agent` step's already does above, literal
  // strings, a whole-entry placeholder splice and a `!`-exclusion alike, never a second, narrower path.
  it("a non-inline command step's own literal produces array compiles to the identical claim, unchanged", () => {
    const step: CommandStep = {
      kind: 'command',
      id: 'run-tests',
      run: 'forge test run --json',
      produces: ['docs/forge/reports/test-results.json', 'docs/forge/reports/flaky.json'],
    };
    const nodes = expectOk(compilePlan(workflow([step]), {}));
    expect(nodes[0]?.produces).toEqual([
      'docs/forge/reports/test-results.json',
      'docs/forge/reports/flaky.json',
    ]);
  });

  it("a command step's own produces resolves a whole-entry placeholder splice and a `!`-exclusion, exactly as an agent step's does", () => {
    const context: ExpressionContext = {
      run: { filesExpected: ['src/s1.ts', 'test/s1.test.ts'], testPaths: ['test/s1.test.ts'] },
    };
    const step: CommandStep = {
      kind: 'command',
      id: 'check',
      run: 'forge check',
      produces: ['{{run.filesExpected}}', '!{{run.testPaths}}'],
    };
    const nodes = expectOk(compilePlan(workflow([step]), context));
    expect(nodes[0]?.produces).toEqual(['src/s1.ts', 'test/s1.test.ts', '!test/s1.test.ts']);
  });

  it('an inline command step may also declare produces (accepted at compile time; the inline execution path never reads it -- @forge/engine/dispatch\'s own concern, not this one\'s)', () => {
    const step: CommandStep = {
      kind: 'command',
      id: 'c',
      run: 'echo hi',
      inline: true,
      produces: ['x.txt'],
    };
    const nodes = expectOk(compilePlan(workflow([step]), {}));
    expect(nodes[0]?.produces).toEqual(['x.txt']);
    expect(nodes[0]?.laneAffinity).toBe('inline');
  });
});

describe('compilePlan — fanout "over" errors', () => {
  it('fails with a located, actionable issue when "over" does not resolve to an array, not a runtime crash', () => {
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'f',
      over: 'stage.notAnArray',
      step: agentStep(),
    };
    const context: ExpressionContext = { stage: { notAnArray: 'nope' } };
    expect(() => compilePlan(workflow([fanout]), context)).not.toThrow();
    const issues = expectFail(compilePlan(workflow([fanout]), context));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'fanout-over-not-array', stepId: 'w:f' }),
    );
  });

  it('fails with a located issue when "over" fails to parse as an expression, not a runtime crash', () => {
    const fanout: FanoutStep = { kind: 'fanout', id: 'f', over: 'stage..bad', step: agentStep() };
    expect(() => compilePlan(workflow([fanout]), {})).not.toThrow();
    const issues = expectFail(compilePlan(workflow([fanout]), {}));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'fanout-over-invalid-expression', stepId: 'w:f' }),
    );
  });

  it('fails when a fanout step itself has no id', () => {
    const fanout: FanoutStep = { kind: 'fanout', over: 'stage.stories', step: agentStep() };
    const issues = expectFail(compilePlan(workflow([fanout]), { stage: { stories: [] } }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'missing-step-id' }));
  });

  it('reports a located compile issue, not a raw, uncaught ForgeError, when "over" parses cleanly but blows evaluate\'s own separate depth guard', () => {
    // A flat, non-nested-looking && chain parses cleanly (parseAnd is iterative) but still builds a
    // left-deep AST that trips evaluate's own MAX_EVALUATION_DEPTH (200, SPEC-QUESTIONS.md Q71) when
    // walked -- a critic round found this call unwrapped, so `over` shaped exactly like this crashed
    // compilePlan/expandFanout outright instead of returning a CompileResult.
    const over = Array.from({ length: 300 }, () => 'true').join(' && ');
    const fanout: FanoutStep = { kind: 'fanout', id: 'f', over, step: agentStep() };
    expect(() => compilePlan(workflow([fanout]), {})).not.toThrow();
    const issues = expectFail(compilePlan(workflow([fanout]), {}));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'fanout-over-evaluation-failed', stepId: 'w:f' }),
    );
  });
});

describe('compilePlan — itemKey', () => {
  it('falls back to the positional index when itemKey is omitted, still producing distinct, stable ids', () => {
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'review',
      over: 'stage.stories',
      step: agentStep({ agent: 'reviewer' }),
    };
    const context: ExpressionContext = { stage: { stories: [{ id: 'a' }, { id: 'b' }] } };
    const nodes = expectOk(compilePlan(workflow([fanout]), context));
    expect(nodes.map((n) => n.id).sort()).toEqual(['w:review:0', 'w:review:1']);
  });
});

describe('compilePlan — missing step id', () => {
  it('fails when a top-level step has no id', () => {
    const issues = expectFail(compilePlan(workflow([{ kind: 'checkpoint' }]), {}));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'missing-step-id' }));
  });

  it("fails when a parallel group's own child has no id", () => {
    const wf = workflow([{ kind: 'parallel', id: 'p', steps: [{ kind: 'checkpoint' }] }]);
    const issues = expectFail(compilePlan(wf, {}));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'missing-step-id' }));
  });

  it("does not require an id on a fanout's own templated child", () => {
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'f',
      over: 'stage.stories',
      step: agentStep(),
    };
    const nodes = expectOk(compilePlan(workflow([fanout]), { stage: { stories: [{ id: 'x' }] } }));
    expect(nodes).toHaveLength(1);
  });
});

describe('compilePlan — parallel and sequence flattening', () => {
  it("parallel: every child independently inherits the group's own incoming dependency, no ordering between siblings", () => {
    const wf = workflow([
      { kind: 'agent', id: 'before', agent: 'a', dependsOn: [] },
      {
        kind: 'parallel',
        id: 'p',
        dependsOn: ['before'],
        steps: [agentStep({ id: 'x' }), agentStep({ id: 'y' })],
      },
    ]);
    const nodes = expectOk(compilePlan(wf, {}));
    expect(findNode(nodes, 'w:x').dependsOn).toEqual(['w:before']);
    expect(findNode(nodes, 'w:y').dependsOn).toEqual(['w:before']);
  });

  it('sequence: each child depends on the previous child, chained in array order', () => {
    const wf = workflow([
      { kind: 'checkpoint', id: 'before' },
      {
        kind: 'sequence',
        id: 's',
        dependsOn: ['before'],
        steps: [agentStep({ id: 'x' }), agentStep({ id: 'y' }), agentStep({ id: 'z' })],
      },
    ]);
    const nodes = expectOk(compilePlan(wf, {}));
    expect(findNode(nodes, 'w:x').dependsOn).toEqual(['w:before']);
    expect(findNode(nodes, 'w:y').dependsOn).toEqual(['w:x']);
    expect(findNode(nodes, 'w:z').dependsOn).toEqual(['w:y']);
  });

  it("sequence: a child's own explicit dependsOn is additive, not replaced by the chain", () => {
    const wf = workflow([
      { kind: 'checkpoint', id: 'outside' },
      {
        kind: 'sequence',
        id: 's',
        steps: [agentStep({ id: 'x' }), agentStep({ id: 'y', dependsOn: ['outside'] })],
      },
    ]);
    const nodes = expectOk(compilePlan(wf, {}));
    expect([...findNode(nodes, 'w:y').dependsOn].sort()).toEqual(['w:outside', 'w:x']);
  });

  it('a fanout nested inside a parallel group compiles its own per-item children correctly', () => {
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'f',
      over: 'stage.stories',
      itemKey: '{{item.id}}',
      step: agentStep(),
    };
    const wf = workflow([
      { kind: 'checkpoint', id: 'before' },
      { kind: 'parallel', id: 'p', dependsOn: ['before'], steps: [fanout] },
    ]);
    const nodes = expectOk(compilePlan(wf, { stage: { stories: [{ id: 'a' }, { id: 'b' }] } }));
    expect(nodes.map((n) => n.id).sort()).toEqual(['w:before', 'w:f:a', 'w:f:b']);
    expect(findNode(nodes, 'w:f:a').dependsOn).toEqual(['w:before']);
  });

  it('sequence: a child that compiles to zero nodes (an empty nested group) does not erase the chain for the next sibling', () => {
    // A critic round found `nextDependsOn = outcome.exitIds` replacing the chain unconditionally: an
    // empty group's own exitIds is [] by construction, so the sibling *after* it silently lost every
    // dependency the sequence had already accumulated, instead of correctly skipping the empty step.
    const wf = workflow([
      { kind: 'checkpoint', id: 'before' },
      {
        kind: 'sequence',
        id: 's',
        dependsOn: ['before'],
        steps: [
          agentStep({ id: 'x' }),
          { kind: 'sequence', id: 'empty', steps: [] },
          agentStep({ id: 'y' }),
        ],
      },
    ]);
    const nodes = expectOk(compilePlan(wf, {}));
    expect(findNode(nodes, 'w:x').dependsOn).toEqual(['w:before']);
    expect(findNode(nodes, 'w:y').dependsOn).toEqual(['w:x']);
  });

  it('sequence: a child that compiles to zero nodes because its own fanout "over" is an empty array does not erase the chain either', () => {
    const emptyFanout: FanoutStep = {
      kind: 'fanout',
      id: 'ef',
      over: 'stage.stories',
      step: agentStep(),
    };
    const wf = workflow([
      {
        kind: 'sequence',
        id: 's',
        steps: [agentStep({ id: 'x' }), emptyFanout, agentStep({ id: 'y' })],
      },
    ]);
    const nodes = expectOk(compilePlan(wf, { stage: { stories: [] } }));
    expect(findNode(nodes, 'w:y').dependsOn).toEqual(['w:x']);
  });
});

describe('compilePlan — retry policy defaults and validation', () => {
  it('defaults maxAttempts to 3 for an agent step with no retry declared', () => {
    const nodes = expectOk(compilePlan(workflow([agentStep({ id: 'a' })]), {}));
    expect(nodes[0]?.retry.maxAttempts).toBe(3);
  });

  it('defaults maxAttempts to 1 for a gate step', () => {
    const nodes = expectOk(
      compilePlan(workflow([{ kind: 'gate', id: 'g', gate: 'G-Verify' }]), {}),
    );
    expect(nodes[0]?.retry.maxAttempts).toBe(1);
  });

  it('uses the authored maxAttempts when present', () => {
    const nodes = expectOk(
      compilePlan(
        workflow([agentStep({ id: 'a', retry: { maxAttempts: 5, retryOn: ['transient'] } })]),
        {},
      ),
    );
    expect(nodes[0]?.retry.maxAttempts).toBe(5);
    expect(nodes[0]?.retry.retryOn).toEqual(['transient']);
  });

  it('defaults retryOn to the full closed set when omitted', () => {
    const nodes = expectOk(compilePlan(workflow([agentStep({ id: 'a' })]), {}));
    expect(nodes[0]?.retry.retryOn.slice().sort()).toEqual([
      'test-failure',
      'timeout',
      'tool-error',
      'transient',
      'validation',
    ]);
  });

  it('flags an invalid retryOn value as a compile issue rather than silently accepting it', () => {
    const issues = expectFail(
      compilePlan(
        workflow([
          agentStep({ id: 'a', retry: { maxAttempts: 1, retryOn: ['not-a-real-class'] } }),
        ]),
        {},
      ),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-retry-on-value', stepId: 'w:a' }),
    );
  });
});

describe('compilePlan — limits defaults', () => {
  it("uses the authored maxTurns/maxCostUsd when present, and this piece's own placeholder default for wallClockMs", () => {
    const nodes = expectOk(
      compilePlan(
        workflow([agentStep({ id: 'a', limits: { maxTurns: 25, maxCostUsd: 1.5 } })]),
        {},
      ),
    );
    expect(nodes[0]?.limits).toEqual({ maxTurns: 25, maxCostUsd: 1.5, wallClockMs: 600_000 });
  });

  it("falls back to this piece's own default limits entirely when none are authored", () => {
    const nodes = expectOk(compilePlan(workflow([agentStep({ id: 'a' })]), {}));
    expect(nodes[0]?.limits).toEqual({ maxTurns: 20, maxCostUsd: 2.0, wallClockMs: 600_000 });
  });
});

describe('compilePlan — onFailure', () => {
  it("uses the step's own onFailure when it is one of the four valid values", () => {
    const nodes = expectOk(
      compilePlan(workflow([agentStep({ id: 'a', onFailure: 'escalate' })]), {}),
    );
    expect(nodes[0]?.onFailure).toBe('escalate');
  });

  it("falls back to the workflow's own onFailure.default when the step declares none", () => {
    const nodes = expectOk(
      compilePlan(workflow([agentStep({ id: 'a' })], { onFailure: { default: 'continue' } }), {}),
    );
    expect(nodes[0]?.onFailure).toBe('continue');
  });

  it('falls back to "block" when neither the step nor the workflow declares one', () => {
    const nodes = expectOk(compilePlan(workflow([agentStep({ id: 'a' })]), {}));
    expect(nodes[0]?.onFailure).toBe('block');
  });

  it('flags an invalid step-level onFailure value as a compile issue rather than silently falling back', () => {
    const issues = expectFail(
      compilePlan(workflow([agentStep({ id: 'a', onFailure: 'retry-forever' })]), {}),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-on-failure-value', stepId: 'w:a' }),
    );
  });

  it('flags an invalid workflow-level onFailure.default too', () => {
    const issues = expectFail(
      compilePlan(workflow([agentStep({ id: 'a' })], { onFailure: { default: 'nonsense' } }), {}),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-on-failure-value', stepId: 'w:a' }),
    );
  });
});

describe('compilePlan — kind-specific fields', () => {
  it('carries a command step\'s own "run" text, and sets laneAffinity "inline" when inline: true', () => {
    const nodes = expectOk(
      compilePlan(workflow([{ kind: 'command', id: 'c', run: 'echo hi', inline: true }]), {}),
    );
    expect(nodes[0]?.run).toBe('echo hi');
    expect(nodes[0]?.laneAffinity).toBe('inline');
  });

  it('leaves laneAffinity undefined for a non-inline command step', () => {
    const nodes = expectOk(
      compilePlan(workflow([{ kind: 'command', id: 'c', run: 'echo hi' }]), {}),
    );
    expect(nodes[0]?.laneAffinity).toBeUndefined();
  });

  it('resolves templates inside a command step\'s own "run" text -- 10 §10.1\'s own literal first worked-example step', () => {
    const step: WorkflowStep = {
      kind: 'command',
      id: 'prepare',
      run: 'git switch -c {{vars.integration_branch}} || git switch {{vars.integration_branch}}',
      inline: true,
    };
    const nodes = expectOk(
      compilePlan(workflow([step]), { vars: { integration_branch: 'forge/integration/stage-1' } }),
    );
    expect(nodes[0]?.run).toBe(
      'git switch -c forge/integration/stage-1 || git switch forge/integration/stage-1',
    );
  });

  it('reports a template-resolution-failed compile issue, not a broken literal run string, when a run template does not resolve', () => {
    const step: WorkflowStep = { kind: 'command', id: 'c', run: '{{vars.missing}}', inline: true };
    expect(() => compilePlan(workflow([step]), {})).not.toThrow();
    const issues = expectFail(compilePlan(workflow([step]), {}));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'template-resolution-failed', stepId: 'w:c' }),
    );
  });

  it('carries a gate step\'s own "gate" id', () => {
    const nodes = expectOk(
      compilePlan(workflow([{ kind: 'gate', id: 'g', gate: 'G-Verify' }]), {}),
    );
    expect(nodes[0]?.gate).toBe('G-Verify');
  });

  it('carries a subworkflow step\'s own "workflow" id', () => {
    const nodes = expectOk(
      compilePlan(workflow([{ kind: 'subworkflow', id: 's', workflow: 'deliver-stage' }]), {}),
    );
    expect(nodes[0]?.workflow).toBe('deliver-stage');
  });

  it("carries a merge step's own policy", () => {
    const nodes = expectOk(
      compilePlan(
        workflow([
          { kind: 'merge', id: 'm', over: 'stage.stories', policy: { conflict: 'agent' } },
        ]),
        { stage: { stories: [] } },
      ),
    );
    expect(nodes[0]?.mergePolicy).toEqual({ conflict: 'agent' });
  });

  it("carries an elicit step's own questions", () => {
    const questions = [{ name: 'q1', prompt: 'What?' }];
    const nodes = expectOk(compilePlan(workflow([{ kind: 'elicit', id: 'e', questions }]), {}));
    expect(nodes[0]?.questions).toEqual(questions);
  });

  it("carries a session step's own sessionType", () => {
    const nodes = expectOk(
      compilePlan(workflow([{ kind: 'session', id: 's', sessionType: 'brainstorm' }]), {}),
    );
    expect(nodes[0]?.sessionType).toBe('brainstorm');
  });

  // `PLAN-M10.md` P14: a `session` step's own `question` folds into the same shared `StepNode.brief`
  // field `runSessionStep`'s own FRAME phase already reads (`node.brief ?? ''`) — not a new, separate
  // compiled field — so a workflow-authored session step's question actually reaches the session
  // machinery with zero further plumbing.
  it("carries a session step's own question onto the shared brief field", () => {
    const nodes = expectOk(
      compilePlan(
        workflow([
          { kind: 'session', id: 's', sessionType: 'retro', question: 'What did we learn?' },
        ]),
        {},
      ),
    );
    expect(nodes[0]?.brief).toBe('What did we learn?');
  });

  it("an agent step's own brief takes priority over a nonexistent session question (never both set)", () => {
    const nodes = expectOk(
      compilePlan(workflow([{ kind: 'agent', id: 'a', agent: 'pm', brief: 'briefs/x.md' }]), {}),
    );
    expect(nodes[0]?.brief).toBe('briefs/x.md');
  });

  it("carries a session step's own when trigger expression verbatim, uninterpreted", () => {
    const nodes = expectOk(
      compilePlan(
        workflow([
          {
            kind: 'session',
            id: 's',
            sessionType: 'standup',
            when: 'run.elapsedMs > 3600000 || run.blockedLaneCount >= 2',
          },
        ]),
        {},
      ),
    );
    expect(nodes[0]?.when).toBe('run.elapsedMs > 3600000 || run.blockedLaneCount >= 2');
  });

  it('leaves when undefined for a session step that declares none, and for every other kind', () => {
    const nodes = expectOk(
      compilePlan(
        workflow([
          { kind: 'session', id: 's', sessionType: 'retro' },
          { kind: 'checkpoint', id: 'c', dependsOn: ['s'] },
        ]),
        {},
      ),
    );
    expect(nodes[0]?.when).toBeUndefined();
    expect(nodes[1]?.when).toBeUndefined();
  });

  it("leaves every other kind's own kind-specific fields undefined", () => {
    const nodes = expectOk(compilePlan(workflow([{ kind: 'checkpoint', id: 'c' }]), {}));
    const node = nodes[0];
    expect(node?.run).toBeUndefined();
    expect(node?.gate).toBeUndefined();
    expect(node?.workflow).toBeUndefined();
    expect(node?.mergePolicy).toBeUndefined();
    expect(node?.questions).toBeUndefined();
    expect(node?.sessionType).toBeUndefined();
  });

  it('every compiled node carries autonomy: undefined and consumes: [] -- no authored-DSL source exists for either in M5', () => {
    const nodes = expectOk(compilePlan(workflow([agentStep({ id: 'a' })]), {}));
    expect(nodes[0]?.autonomy).toBeUndefined();
    expect(nodes[0]?.consumes).toEqual([]);
  });

  it('sets idempotencyKey equal to the compiled id', () => {
    const nodes = expectOk(compilePlan(workflow([agentStep({ id: 'a' })]), {}));
    expect(nodes[0]?.idempotencyKey).toBe(nodes[0]?.id);
  });
});

describe('compilePlan — onComplete/onFailure.escalations are not compiled', () => {
  it('ignores workflow.onComplete and workflow.onFailure.escalations entirely', () => {
    const wf = workflow([agentStep({ id: 'a' })], {
      onComplete: [{ kind: 'command', run: 'echo done', inline: true }],
      onFailure: {
        default: 'block',
        escalations: [{ when: 'failures.x > 2', do: { kind: 'agent', agent: 'diagnostician' } }],
      },
    });
    const nodes = expectOk(compilePlan(wf, {}));
    expect(nodes).toHaveLength(1);
  });
});

describe('expandFanout — standalone entry point', () => {
  it('expands a fanout given directly, without going through compilePlan', () => {
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'implement',
      over: 'stage.stories',
      itemKey: '{{item.id}}',
      step: agentStep({ agent: '{{item.owner_role}}' }),
    };
    const context: ExpressionContext = {
      stage: { stories: [{ id: 'story-014', owner_role: 'engineer' }] },
    };
    const result = expandFanout(fanout, 'w', context);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]?.id).toBe('w:implement:story-014');
      expect(result.nodes[0]?.agent).toBe('engineer');
    }
  });

  it('reports a non-array "over" the same way compilePlan does', () => {
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'f',
      over: 'stage.notArray',
      step: agentStep(),
    };
    const result = expandFanout(fanout, 'w', { stage: { notArray: 42 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'fanout-over-not-array' }),
      );
    }
  });

  it('defaults to onFailure "block" when no workflow onFailure.default is passed, matching a fanout with no surrounding workflow', () => {
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'f',
      over: 'stage.stories',
      itemKey: '{{item.id}}',
      step: agentStep(),
    };
    const result = expandFanout(fanout, 'w', { stage: { stories: [{ id: 'a' }] } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.nodes[0]?.onFailure).toBe('block');
  });

  it("agrees with compilePlan's own compiled onFailure for the identical fanout when the workflow's own onFailure.default is passed through", () => {
    // A critic round found this hardcoded to undefined unconditionally, so calling expandFanout directly
    // on a fanout that sits inside a workflow with its own onFailure.default disagreed with what
    // compilePlan produces for the exact same step -- directly contradicting this function's own doc
    // comment, which promises the two agree.
    const fanout: FanoutStep = {
      kind: 'fanout',
      id: 'f',
      over: 'stage.stories',
      itemKey: '{{item.id}}',
      step: agentStep(),
    };
    const context: ExpressionContext = { stage: { stories: [{ id: 'a' }] } };
    const viaCompilePlan = expectOk(
      compilePlan(workflow([fanout], { onFailure: { default: 'continue' } }), context),
    );
    const viaExpandFanout = expandFanout(fanout, 'w', context, 'continue');
    expect(viaExpandFanout.success).toBe(true);
    if (viaExpandFanout.success) {
      expect(viaExpandFanout.nodes[0]?.onFailure).toBe('continue');
      expect(viaExpandFanout.nodes[0]?.onFailure).toBe(viaCompilePlan[0]?.onFailure);
    }
  });
});

describe('compilePlan — defense-in-depth compile-depth guard', () => {
  it('fails cleanly, not with a raw RangeError, on pathologically deep nesting', () => {
    let innermost: WorkflowStep = agentStep({ id: 'leaf' });
    for (let i = 0; i < 2000; i += 1) {
      innermost = { kind: 'sequence', id: `s${String(i)}`, steps: [innermost] };
    }
    expect(() => compilePlan(workflow([innermost]), {})).not.toThrow();
    const issues = expectFail(compilePlan(workflow([innermost]), {}));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'excessive-compile-depth' }));
  });
});
