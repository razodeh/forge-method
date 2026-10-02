/**
 * `deriveStoryId` (`specs/22` M15 P11): which story a compiled `StepNode` belongs to, read off
 * `StepNode.runInputs` alone. Two real, independently-sufficient sources — a fanout's own `item.id`
 * (`build-stage.workflow.yaml`'s per-story steps) and a declared `storyId` workflow input
 * (`implement-story.workflow.yaml`) — plus `undefined` for a step scoped to neither.
 *
 * @see specs/22 M15 P11
 * @see PLAN-M15.md P11
 */
import { describe, expect, it } from 'vitest';

import { compilePlan } from '../../src/plan/compile.ts';
import { deriveStoryId, type StepNode } from '../../src/plan/index.ts';
import { parseWorkflow } from '../../src/workflow/parse.ts';

function compile(yaml: string, context: Record<string, unknown> = {}): readonly StepNode[] {
  const parsed = parseWorkflow(yaml);
  if (!parsed.success) throw new Error(parsed.issues.map((i) => i.message).join('; '));
  const compiled = compilePlan(parsed.workflow, context, {});
  if (!compiled.success) throw new Error(compiled.issues.map((i) => i.message).join('; '));
  return compiled.nodes;
}

const FANOUT_WORKFLOW = `
id: wf-fanout
name: Fanout fixture
version: 1.0.0
description: a per-story fanout, the build-stage.workflow.yaml shape
levels: [L0]
steps:
  - id: implement
    kind: fanout
    over: 'stage.stories'
    itemKey: '{{item.id}}'
    step:
      kind: agent
      agent: '{{item.owner_role}}'
      brief: briefs/implement-story.md
  - id: freeze-contracts
    kind: agent
    agent: architect
    brief: briefs/freeze-contracts.md
`;

const DECLARED_INPUT_WORKFLOW = `
id: wf-declared
name: Declared-input fixture
version: 1.0.0
description: a declared storyId input, the implement-story.workflow.yaml shape
levels: [L0]
inputs:
  - name: storyId
    type: string
    required: true
steps:
  - id: plan
    kind: agent
    agent: dev
    brief: briefs/plan-story.md
`;

describe('deriveStoryId', () => {
  it("reads a fanout item's own id (build-stage.workflow.yaml's own shape)", () => {
    const nodes = compile(FANOUT_WORKFLOW, {
      stage: {
        stories: [
          { id: 'STORY-001', owner_role: 'dev' },
          { id: 'STORY-002', owner_role: 'dev' },
        ],
      },
    });
    const implementNodes = nodes.filter((node) => node.id.startsWith('wf-fanout:implement:'));
    expect(implementNodes).toHaveLength(2);
    expect(implementNodes.map((node) => deriveStoryId(node)).sort()).toEqual([
      'STORY-001',
      'STORY-002',
    ]);
  });

  it('reads a declared storyId workflow input (implement-story.workflow.yaml own shape)', () => {
    const nodes = compile(DECLARED_INPUT_WORKFLOW, { storyId: 'STORY-042' });
    const planNode = nodes.find((node) => node.id === 'wf-declared:plan');
    expect(planNode).toBeDefined();
    expect(deriveStoryId(planNode!)).toBe('STORY-042');
  });

  it('is undefined for a step scoped to no particular story (freeze-contracts, no item, no storyId)', () => {
    const nodes = compile(FANOUT_WORKFLOW, {
      stage: { stories: [{ id: 'STORY-001', owner_role: 'dev' }] },
    });
    const freeze = nodes.find((node) => node.id === 'wf-fanout:freeze-contracts');
    expect(freeze).toBeDefined();
    expect(deriveStoryId(freeze!)).toBeUndefined();
  });

  it('is undefined for a hand-built StepNode with no runInputs at all', () => {
    const node = { runInputs: undefined } as unknown as StepNode;
    expect(deriveStoryId(node)).toBeUndefined();
  });

  it('is undefined for an item object with no real string id', () => {
    const node = { runInputs: { item: { ownerRole: 'dev' } } } as unknown as StepNode;
    expect(deriveStoryId(node)).toBeUndefined();
  });

  it('is undefined for an item.id or storyId that is blank', () => {
    const blankItem = { runInputs: { item: { id: '   ' } } } as unknown as StepNode;
    expect(deriveStoryId(blankItem)).toBeUndefined();
    const blankStoryId = { runInputs: { storyId: '' } } as unknown as StepNode;
    expect(deriveStoryId(blankStoryId)).toBeUndefined();
  });

  it('prefers item.id over a sibling storyId when (hypothetically) both are present', () => {
    const node = {
      runInputs: { item: { id: 'FROM-ITEM' }, storyId: 'FROM-DECLARED' },
    } as unknown as StepNode;
    expect(deriveStoryId(node)).toBe('FROM-ITEM');
  });
});
