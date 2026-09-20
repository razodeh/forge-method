/**
 * The pieces a stage run's context is built from (`PLAN-M13.md` P21, `03` §3.2.4, `06` §6.2, `09` §9.3): the
 * workflow's own `vars:` resolved over the run inputs, `stage.stories` in the order stories are declared to the
 * workflow, which workflows read the stage's collections at all, and the declared story dependencies applied to
 * a compiled run plan (a story starts after the ones it depends on end, whether or not their claims overlap).
 *
 * @see specs/06 §6.2
 * @see specs/09 §9.3
 */
import { describe, expect, it } from 'vitest';

import type { ExpressionContext } from '../../src/expr/index.ts';
import { compileRunPlan } from '../../src/plan/run-plan.ts';
import {
  buildStageRunContext,
  compileStageRunPlan,
  orderedStageStories,
  resolveWorkflowVars,
  workflowReadsStageCollections,
  type StageStory,
} from '../../src/plan/stage-plan.ts';
import { parseWorkflow, type Workflow } from '../../src/workflow/index.ts';

interface StageIdContext extends ExpressionContext {
  readonly stageId: string;
}
const withStageId = (stageId: string): StageIdContext => ({ stageId });

function load(source: string): Workflow {
  const parsed = parseWorkflow(source);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.issues));
  return parsed.workflow;
}

const STAGE_WORKFLOW = `id: stagewf
name: Stage workflow
version: 1.0.0
description: Two fanouts over the stage's stories.
inputs:
  - name: stageId
    type: string
    required: true
vars:
  integration_branch: 'forge/integration/{{stageId}}'
  worktree: 'wt-{{vars.integration_branch}}'
steps:
  - id: prepare
    kind: command
    run: 'git switch -c {{vars.integration_branch}}'
    inline: true
  - id: implement
    kind: fanout
    over: 'stage.stories'
    itemKey: '{{item.id}}'
    dependsOn: [prepare]
    step:
      kind: agent
      agent: '{{item.owner_role}}'
      brief: briefs/implement-story.md
      produces: '{{item.files_expected}}'
  - id: review
    kind: fanout
    over: 'stage.stories'
    itemKey: '{{item.id}}'
    dependsOn: ['implement:{{item.id}}']
    step:
      kind: agent
      agent: reviewer
      brief: briefs/review.md
`;

function story(id: string, overrides: Partial<StageStory> = {}): StageStory {
  return {
    id,
    ownerRole: 'backend',
    dependsOn: [],
    blockedBy: [],
    filesExpected: [`src/${id.toLowerCase()}/**`],
    testPaths: [],
    ...overrides,
  };
}

describe('resolveWorkflowVars', () => {
  it('resolves each var over the run inputs, in declaration order, so a later one may read an earlier one', () => {
    expect(resolveWorkflowVars(load(STAGE_WORKFLOW), withStageId('mvp'))).toEqual({
      integration_branch: 'forge/integration/mvp',
      worktree: 'wt-forge/integration/mvp',
    });
  });

  it('leaves out a var whose input is missing rather than throwing, and keeps the rest', () => {
    const wf = load(`${STAGE_WORKFLOW.split('vars:')[0] ?? ''}vars:
  needs_input: 'x-{{nothing}}'
  constant: 'fixed'
steps:
  - id: only
    kind: command
    run: 'true'
    inline: true
`);
    expect(resolveWorkflowVars(wf, {})).toEqual({ constant: 'fixed' });
  });

  it('lets a var read the vars the caller already supplied (--epic / --story)', () => {
    const wf = load(`id: v
name: v
version: 1.0.0
description: d
vars:
  label: 'epic-{{vars.epic}}'
steps:
  - id: only
    kind: command
    run: 'true'
    inline: true
`);
    expect(resolveWorkflowVars(wf, { vars: { epic: 'E1' } })).toEqual({ label: 'epic-E1' });
  });

  it('is an empty object for a workflow with no vars block', () => {
    const wf = load(`id: v
name: v
version: 1.0.0
description: d
steps:
  - id: only
    kind: command
    run: 'true'
    inline: true
`);
    expect(resolveWorkflowVars(wf, withStageId('x'))).toEqual({});
  });
});

describe('workflowReadsStageCollections', () => {
  it('is true for a workflow that fans out over stage.stories', () => {
    expect(workflowReadsStageCollections(load(STAGE_WORKFLOW))).toBe(true);
  });

  it('looks through groups and fanout bodies, and reads a merge over a stage collection', () => {
    const grouped = load(`id: g
name: g
version: 1.0.0
description: d
steps:
  - id: grp
    kind: parallel
    steps:
      - id: inner
        kind: fanout
        over: 'stage.stories'
        step:
          kind: command
          run: 'true'
          inline: true
`);
    expect(workflowReadsStageCollections(grouped)).toBe(true);
    const merged = load(`id: m
name: m
version: 1.0.0
description: d
steps:
  - id: m
    kind: merge
    over: 'stage.stories'
    policy: { conflict: abort }
`);
    expect(workflowReadsStageCollections(merged)).toBe(true);
  });

  it('is false for a workflow that only names the stage id (plan-stage writes the Epics, so it must not need them), and for lookalike names', () => {
    const planStage = load(`id: p
name: p
version: 1.0.0
description: d
inputs:
  - name: stageId
    type: string
    required: true
steps:
  - id: derive
    kind: command
    run: 'forge plan run-plan {{stageId}} --json'
    inline: true
  - id: fan
    kind: fanout
    over: 'stages'
    step:
      kind: command
      run: 'true'
      inline: true
  - id: fan2
    kind: fanout
    over: 'stageId'
    step:
      kind: command
      run: 'true'
      inline: true
`);
    expect(workflowReadsStageCollections(planStage)).toBe(false);
  });
});

describe('orderedStageStories and buildStageRunContext', () => {
  const a = story('A');
  const b = story('B', { dependsOn: ['A'] });
  const c = story('C');

  it('lists stories wave by wave (ids ascending within a wave), not by id', () => {
    const plan = { stories: [a, b, c], waves: [['A', 'C'], ['B']] };
    expect(orderedStageStories(plan).map((s) => s.id)).toEqual(['A', 'C', 'B']);
  });

  it('falls back to the plan’s own list when there are no waves (a story cycle has no order)', () => {
    expect(orderedStageStories({ stories: [b, a], waves: [] }).map((s) => s.id)).toEqual([
      'B',
      'A',
    ]);
  });

  it('builds stageId, the resolved vars and stage.stories with the fields the workflow templates on', () => {
    const context = buildStageRunContext(load(STAGE_WORKFLOW), 'mvp', [b]);
    expect(context).toEqual({
      stageId: 'mvp',
      vars: {
        integration_branch: 'forge/integration/mvp',
        worktree: 'wt-forge/integration/mvp',
      },
      stage: {
        id: 'mvp',
        stories: [
          {
            id: 'B',
            owner_role: 'backend',
            depends_on: ['A'],
            files_expected: ['src/b/**'],
            test_paths: [],
          },
        ],
      },
    });
  });

  it('is the context the stage plan itself compiles against: the plan and a run see the same steps', () => {
    const wf = load(STAGE_WORKFLOW);
    const plan = compileStageRunPlan(wf, 'mvp', [a, b, c]);
    const viaRun = compileRunPlan(wf, buildStageRunContext(wf, 'mvp', orderedStageStories(plan)));
    expect(viaRun.success).toBe(true);
    if (!viaRun.success) return;
    const byId = (nodes: readonly { id: string; dependsOn: readonly string[] }[]) =>
      Object.fromEntries(nodes.map((n) => [n.id, [...n.dependsOn].sort()]));
    expect(byId(viaRun.nodes)).toEqual(byId(plan.nodes));
  });
});

describe('a run orders stories exactly as the stage plan does (runsAfter)', () => {
  const wf = load(STAGE_WORKFLOW);
  const edges = (nodes: readonly { id: string; dependsOn: readonly string[] }[]) =>
    Object.fromEntries(nodes.map((n) => [n.id, [...n.dependsOn].sort()]));

  it('carries claim-overlap serialisation into the run, not only declared depends_on (src/auth vs src/auth/login.ts)', () => {
    // `globsOverlap` (literal against pattern) does not see these two as overlapping; the plan's prefix rule does
    // and puts the lower id first. The run must compile the same edges, or the two stories write the same files at once.
    const stories = [
      story('A', { filesExpected: ['src/auth'] }),
      story('B', { filesExpected: ['src/auth/login.ts'] }),
    ];
    const plan = compileStageRunPlan(wf, 'mvp', stories);
    expect(plan.runsAfter).toEqual({ A: [], B: ['A'] });
    const run = compileRunPlan(
      wf,
      buildStageRunContext(
        wf,
        'mvp',
        orderedStageStories(plan),
        new Map(Object.entries(plan.runsAfter)),
      ),
    );
    expect(run.success).toBe(true);
    if (!run.success) return;
    expect(run.nodes.find((n) => n.id === 'stagewf:implement:B')?.dependsOn).toContain(
      'stagewf:review:A',
    );
    expect(edges(run.nodes)).toEqual(edges(plan.nodes));
    // Without the plan's ordering, only declared dependencies apply: the overlap is invisible to the run.
    const declaredOnly = compileRunPlan(
      wf,
      buildStageRunContext(wf, 'mvp', orderedStageStories(plan)),
    );
    expect(declaredOnly.success).toBe(true);
    if (!declaredOnly.success) return;
    expect(declaredOnly.nodes.find((n) => n.id === 'stagewf:implement:B')?.dependsOn).not.toContain(
      'stagewf:review:A',
    );
  });

  it('gives the run and the plan identical steps and edges for a mixed stage (dependency on a higher id, overlap, independent)', () => {
    const stories = [
      story('S1', { dependsOn: ['S9'] }),
      story('S9'),
      story('S3', { filesExpected: ['lib'] }),
      story('S4', { filesExpected: ['lib/x.ts'] }),
      story('S5'),
    ];
    const plan = compileStageRunPlan(wf, 'mvp', stories);
    const context = buildStageRunContext(
      wf,
      'mvp',
      orderedStageStories(plan),
      new Map(Object.entries(plan.runsAfter)),
    );
    const run = compileRunPlan(wf, context);
    expect(run.success).toBe(true);
    if (!run.success) return;
    expect(edges(run.nodes)).toEqual(edges(plan.nodes));
    // S1 depends on S9, whose id is higher: the order the run is fed is by wave, not by id.
    expect(
      orderedStageStories(plan)
        .map((s) => s.id)
        .indexOf('S9'),
    ).toBeLessThan(
      orderedStageStories(plan)
        .map((s) => s.id)
        .indexOf('S1'),
    );
    expect(run.nodes.find((n) => n.id === 'stagewf:implement:S1')?.dependsOn).toContain(
      'stagewf:review:S9',
    );
  });

  it('a cycle that only the story ordering creates is a plan-dependency-cycle error, not a quiet warning', () => {
    // On its own this workflow is acyclic: `second:A` waits for `gate-x`, which waits for `first:B`. Ordering B after
    // A makes B's first step wait for A's last (`second:A`): a cycle through `gate-x`.
    const gated = load(`id: gated
name: gated
version: 1.0.0
description: d
steps:
  - id: first
    kind: fanout
    over: 'stage.stories'
    itemKey: '{{item.id}}'
    step:
      kind: command
      run: 'true'
      inline: true
  - id: gate-x
    kind: command
    run: 'true'
    inline: true
    dependsOn: ['first:B']
  - id: second
    kind: fanout
    over: 'stage.stories'
    itemKey: '{{item.id}}'
    dependsOn: ['first:{{item.id}}', 'gate-x']
    step:
      kind: command
      run: 'true'
      inline: true
`);
    const independent = compileStageRunPlan(gated, 'mvp', [story('A'), story('B')]);
    expect(independent.stepPlan).toBe('compiled');
    const plan = compileStageRunPlan(gated, 'mvp', [story('A'), story('B', { dependsOn: ['A'] })]);
    expect(plan.ok).toBe(false);
    expect(plan.stepPlan).toBe('unavailable');
    expect(plan.findings.filter((f) => f.severity === 'error').map((f) => f.code)).toEqual([
      'plan-dependency-cycle',
    ]);
  });
});

describe('a run honours declared story dependencies (compileRunPlan over stage.stories)', () => {
  const wf = load(STAGE_WORKFLOW);
  const compile = (stories: readonly StageStory[]) => {
    const result = compileRunPlan(wf, buildStageRunContext(wf, 'mvp', stories));
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    return Object.fromEntries(result.nodes.map((n) => [n.id.replace('stagewf:', ''), n.dependsOn]));
  };

  it('starts a dependent story only after the story it depends on has ended, with disjoint file claims', () => {
    const edges = compile([story('A'), story('B', { dependsOn: ['A'] })]);
    // B's first step waits for A's last per-story step (its review), which is what "depends on" means.
    expect(edges['implement:B']).toContain('stagewf:review:A');
    // and A's own steps do not wait for B.
    expect(edges['implement:A']).not.toContain('stagewf:review:B');
    expect(edges['review:A']).not.toContain('stagewf:implement:B');
  });

  it('leaves two independent stories unordered', () => {
    const edges = compile([story('A'), story('B')]);
    expect(edges['implement:B']).toEqual(['stagewf:prepare']);
  });

  it('ignores a dependency on a story outside the collection and a story depending on itself', () => {
    const edges = compile([story('A', { dependsOn: ['ELSEWHERE', 'A'] })]);
    expect(edges['implement:A']).toEqual(['stagewf:prepare']);
  });

  it('reports a declared dependency cycle as a dependency-cycle issue, not a hang', () => {
    const result = compileRunPlan(
      wf,
      buildStageRunContext(wf, 'mvp', [
        story('A', { dependsOn: ['B'] }),
        story('B', { dependsOn: ['A'] }),
      ]),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map((i) => i.code)).toContain('dependency-cycle');
  });

  it('does nothing for a context that has no stage stories', () => {
    const plain = load(`id: plain
name: plain
version: 1.0.0
description: d
steps:
  - id: a
    kind: command
    run: 'true'
    inline: true
  - id: b
    kind: command
    run: 'true'
    inline: true
    dependsOn: [a]
`);
    const result = compileRunPlan(plain, { stage: 'a-string', vars: {} });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.nodes.find((n) => n.id === 'plain:b')?.dependsOn).toEqual(['plain:a']);
  });
});
