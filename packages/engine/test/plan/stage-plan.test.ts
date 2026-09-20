/**
 * `compileStageRunPlan` — the run plan for one stage (`03` §3.2.3, `06` §6.2, `09` §9.3), from the
 * stage's stories. Ordering, overlap serialisation, cycles, unknown dependencies and the empty stage are
 * asserted against what the specs say a run plan is, not against how the module computes it.
 *
 * @see specs/06 §6.2
 * @see specs/09 §9.3
 * @see PLAN-M13.md P10
 */
import { describe, expect, it } from 'vitest';

import { compilePlan } from '../../src/plan/compile.ts';
import { compileStageRunPlan, type StageStory } from '../../src/plan/stage-plan.ts';
import { parseWorkflow } from '../../src/workflow/index.ts';

const STAGE_WORKFLOW = `id: stagewf
name: Stage workflow
version: 1.0.0
description: A fanout over the stage's stories, shaped like build-stage.
inputs:
  - name: stageId
    type: string
    required: true
steps:
  - id: tests
    kind: fanout
    over: 'stage.stories'
    itemKey: '{{item.id}}'
    step:
      kind: agent
      agent: sdet
      brief: briefs/write-failing-tests.md
  - id: implement
    kind: fanout
    over: 'stage.stories'
    itemKey: '{{item.id}}'
    dependsOn: ['tests:{{item.id}}']
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

function workflow() {
  const parsed = parseWorkflow(STAGE_WORKFLOW);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.issues));
  return parsed.workflow;
}

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

function node(plan: ReturnType<typeof compileStageRunPlan>, id: string) {
  const found = plan.nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`no node ${id}: ${plan.nodes.map((n) => n.id).join()}`);
  return found;
}

describe('compileStageRunPlan', () => {
  it('puts independent stories in one wave and a dependent story in a later one', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-003', { dependsOn: ['STORY-001'] }),
      story('STORY-002'),
      story('STORY-001'),
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.waves).toEqual([['STORY-001', 'STORY-002'], ['STORY-003']]);
    // Every story appears exactly once in the plan's implement steps.
    expect(
      plan.nodes.filter((n) => n.id.startsWith('stagewf:implement:')).map((n) => n.id),
    ).toEqual(['STORY-001', 'STORY-002', 'STORY-003'].map((id) => `stagewf:implement:${id}`));
  });

  it('makes a dependent story start only after the story it depends on has finished its own steps', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001'),
      story('STORY-002', { dependsOn: ['STORY-001'] }),
    ]);
    // B's first step waits for A's last per-story step; the steps in between follow B's own chain.
    expect(node(plan, 'stagewf:tests:STORY-002').dependsOn).toContain('stagewf:review:STORY-001');
    expect(node(plan, 'stagewf:implement:STORY-002').dependsOn).toEqual([
      'stagewf:tests:STORY-002',
    ]);
    expect(node(plan, 'stagewf:review:STORY-002').dependsOn).toEqual([
      'stagewf:implement:STORY-002',
    ]);
    expect(node(plan, 'stagewf:tests:STORY-001').dependsOn).toEqual([]);
  });

  it('counts a multi-glob files_expected as that many claims (the list is spliced, not refused)', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001', { filesExpected: ['src/a/**', 'tests/a/**'] }),
    ]);
    expect(plan.ok).toBe(true);
    expect(node(plan, 'stagewf:implement:STORY-001').produces).toEqual(['src/a/**', 'tests/a/**']);
  });

  it('serialises overlapping claims that no dependency orders, lower id first, and reports it', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-002', { filesExpected: ['src/shared/**'] }),
      story('STORY-001', { filesExpected: ['src/shared/index.ts'] }),
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.waves).toEqual([['STORY-001'], ['STORY-002']]);
    expect(plan.storyOverlaps).toEqual([
      expect.objectContaining({
        storyA: 'STORY-001',
        storyB: 'STORY-002',
        ordering: 'serialised',
      }),
    ]);
    expect(plan.findings).toContainEqual(
      expect.objectContaining({
        code: 'file-claim-overlap',
        severity: 'warning',
        subjects: ['STORY-001', 'STORY-002'],
      }),
    );
    expect(node(plan, 'stagewf:implement:STORY-002').dependsOn).toContain(
      'stagewf:implement:STORY-001',
    );
  });

  it('does not invent a cycle when a declared dependency runs against id order for overlapping claims', () => {
    // STORY-001 depends on STORY-002, and they overlap: the dependency wins, no contradiction.
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001', { dependsOn: ['STORY-002'], filesExpected: ['src/x/**'] }),
      story('STORY-002', { filesExpected: ['src/x/**'] }),
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.waves).toEqual([['STORY-002'], ['STORY-001']]);
    expect(plan.storyOverlaps[0]?.ordering).toBe('already-ordered');
    expect(node(plan, 'stagewf:implement:STORY-001').dependsOn).toContain(
      'stagewf:implement:STORY-002',
    );
  });

  it('reports a dependency cycle as an error finding naming the stories, without throwing', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001', { dependsOn: ['STORY-002'] }),
      story('STORY-002', { dependsOn: ['STORY-003'] }),
      story('STORY-003', { dependsOn: ['STORY-001'] }),
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.waves).toEqual([]);
    expect(plan.findings).toContainEqual(
      expect.objectContaining({
        code: 'dependency-cycle',
        severity: 'error',
        subjects: ['STORY-001', 'STORY-002', 'STORY-003'],
      }),
    );
  });

  it('reports a self dependency and a dependency on a story the project does not have', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001', { dependsOn: ['STORY-001', 'STORY-099'] }),
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(['self-dependency', 'unknown-dependency']),
    );
    // The stage's own stories are still all in the plan (nothing is silently dropped).
    expect(plan.nodes.some((n) => n.id === 'stagewf:implement:STORY-001')).toBe(true);
  });

  it('warns about a blocked story and a story with no file claims, and still plans them', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001', { blockedBy: ['OQ-001'] }),
      story('STORY-002', { filesExpected: [] }),
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.findings.map((f) => f.code).sort()).toEqual([
      'story-blocked',
      'story-without-file-claims',
    ]);
    expect(plan.waves).toEqual([['STORY-001', 'STORY-002']]);
  });

  it('reports a duplicate story id and plans one copy, chosen by content', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [story('STORY-001'), story('STORY-001')]);
    expect(plan.ok).toBe(false);
    expect(plan.findings).toContainEqual(expect.objectContaining({ code: 'duplicate-story-id' }));
    expect(plan.nodes.filter((n) => n.id.startsWith('stagewf:implement:'))).toHaveLength(1);
  });

  it('plans an empty stage: no waves, no fanout steps, ok', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', []);
    expect(plan.ok).toBe(true);
    expect(plan.waves).toEqual([]);
    expect(plan.nodes).toEqual([]);
    expect(plan.findings).toEqual([]);
  });

  it('is independent of the order the stories are supplied in, and repeatable', () => {
    const stories = [
      story('STORY-004', { dependsOn: ['STORY-002'] }),
      story('STORY-001', { filesExpected: ['src/shared/**'] }),
      story('STORY-003', { filesExpected: ['src/shared/a.ts'] }),
      story('STORY-002'),
    ];
    const a = compileStageRunPlan(workflow(), 'mvp', stories);
    const b = compileStageRunPlan(workflow(), 'mvp', [...stories].reverse());
    const c = compileStageRunPlan(workflow(), 'mvp', stories);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });

  it('computes a critical path over the plan including story dependencies', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001'),
      story('STORY-002', { dependsOn: ['STORY-001'] }),
    ]);
    expect(plan.criticalPath.path).toEqual([
      'stagewf:tests:STORY-001',
      'stagewf:implement:STORY-001',
      'stagewf:review:STORY-001',
      'stagewf:tests:STORY-002',
      'stagewf:implement:STORY-002',
      'stagewf:review:STORY-002',
    ]);
    expect(plan.criticalPath.estimatedCost).toBeGreaterThan(0);
  });

  it('reports a workflow that does not compile as a warning and still returns the story plan', () => {
    const parsed = parseWorkflow(STAGE_WORKFLOW.replace("'stage.stories'", "'stage.nothing'"));
    if (!parsed.success) throw new Error('fixture');
    const plan = compileStageRunPlan(parsed.workflow, 'mvp', [
      story('STORY-001'),
      story('STORY-002', { dependsOn: ['STORY-001'] }),
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.nodes).toEqual([]);
    expect(plan.waves).toEqual([['STORY-001'], ['STORY-002']]);
    expect(plan.findings).toHaveLength(1);
    expect(plan.findings[0]).toMatchObject({ code: 'step-plan-unavailable', severity: 'warning' });
    expect(plan.findings[0]?.message).toContain('fanout-over-not-array');
  });

  it('resolves the workflow’s own vars against the stage id before compiling', () => {
    const parsed = parseWorkflow(
      STAGE_WORKFLOW.replace(
        'steps:',
        "vars:\n  branch: 'forge/integration/{{stageId}}'\nsteps:\n  - id: prepare\n    kind: command\n    run: 'git switch {{vars.branch}}'",
      ),
    );
    if (!parsed.success) throw new Error(JSON.stringify(parsed.issues));
    const plan = compileStageRunPlan(parsed.workflow, 'mvp', [story('STORY-001')]);
    expect(plan.findings).toEqual([]);
    expect(plan.nodes.some((n) => n.id === 'stagewf:prepare')).toBe(true);
  });

  it('names the longest dependency chain, ties to the lowest id', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001'),
      story('STORY-002', { dependsOn: ['STORY-001'] }),
      story('STORY-003', { dependsOn: ['STORY-002'] }),
      story('STORY-004', { dependsOn: ['STORY-001'] }),
    ]);
    expect(plan.storyCriticalPath).toEqual(['STORY-001', 'STORY-002', 'STORY-003']);
    expect(compileStageRunPlan(workflow(), 'mvp', []).storyCriticalPath).toEqual([]);
  });
});

describe('compileStageRunPlan — review findings', () => {
  const overlaps = (a: readonly string[], b: readonly string[]) => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001', { filesExpected: a }),
      story('STORY-002', { filesExpected: b }),
    ]);
    return plan.overlapCount > 0;
  };

  it.each([
    ['src/auth', 'src/auth/login.ts'],
    ['src/**/*.ts', 'src/billing/**'],
    ['src/**/x.ts', 'src/a/**'],
    ['src/{a,b}/**', 'src/{b,c}/**'],
    ['./src/a/**', 'src/a/**'],
    ['SRC/a/**', 'src/a/**'],
    ['**', '.github/ci.yml'],
    ['src/**', 'src/.hidden/x'],
    ['src/../lib/**', 'lib/a.ts'],
    ['src/a/..', 'src/b/x'],
    ['src/[ab]/**', 'src/a/x.ts'],
  ])('sees %s and %s as possibly overlapping, so they are never planned in parallel', (a, b) => {
    expect(overlaps([a], [b])).toBe(true);
  });

  it.each([
    ['src/a/**', 'src/b/**'],
    ['src/auth', 'src/authz/x.ts'],
    ['src/foo.ts', 'src/foo.test.ts'],
    ['src/a/**', 'tests/a/**'],
  ])('leaves %s and %s parallel', (a, b) => {
    expect(overlaps([a], [b])).toBe(false);
  });

  it('treats a claim too long or bracket-heavy for glob analysis as overlapping where prefixes nest', () => {
    expect(overlaps([`src/${'a'.repeat(700)}/**`], [`src/${'a'.repeat(700)}/x.ts`])).toBe(true);
    expect(overlaps([`src/${'['.repeat(100)}/**`], ['src/x.ts'])).toBe(true);
  });

  it('plans duplicate story ids identically whatever order they arrive in, and lists them once', () => {
    const a = story('STORY-001', { filesExpected: ['src/a/**'] });
    const b = story('STORY-001', { filesExpected: ['src/zzz/**'] });
    const one = compileStageRunPlan(workflow(), 'mvp', [a, b]);
    const two = compileStageRunPlan(workflow(), 'mvp', [b, a]);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(one.stories).toHaveLength(1);
    expect(one.ok).toBe(false);
  });

  it('meets a dependency on a delivered story of another stage, warns on an undelivered one, errors on an unknown one', () => {
    const outsideStage = new Map<string, 'satisfied' | 'pending'>([
      ['STORY-090', 'satisfied'],
      ['STORY-091', 'pending'],
    ]);
    const plan = (dep: string) =>
      compileStageRunPlan(workflow(), 'next', [story('STORY-001', { dependsOn: [dep] })], {
        outsideStage,
      });
    expect(plan('STORY-090').findings).toEqual([]);
    expect(plan('STORY-090').ok).toBe(true);
    const pending = plan('STORY-091');
    expect(pending.ok).toBe(true);
    expect(pending.findings).toEqual([
      expect.objectContaining({ code: 'dependency-outside-stage', severity: 'warning' }),
    ]);
    expect(plan('STORY-404').ok).toBe(false);
  });

  it('lists blocked stories, and stories waiting on an undelivered outside-stage story, as not startable', () => {
    const plan = compileStageRunPlan(
      workflow(),
      'next',
      [
        story('STORY-001', { blockedBy: ['OQ-001'] }),
        story('STORY-002', { dependsOn: ['STORY-091'] }),
        story('STORY-003'),
      ],
      { outsideStage: new Map([['STORY-091', 'pending']]) },
    );
    expect(plan.blocked).toEqual(['STORY-001', 'STORY-002']);
    expect(plan.waves).toEqual([['STORY-001', 'STORY-002', 'STORY-003']]);
  });

  it('orders a dependent story on the steps even when neither story claims any files', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001', { filesExpected: [] }),
      story('STORY-002', { dependsOn: ['STORY-001'], filesExpected: [] }),
    ]);
    expect(node(plan, 'stagewf:tests:STORY-002').dependsOn).toContain('stagewf:review:STORY-001');
    expect(plan.criticalPath.path).toHaveLength(6);
  });

  it('says the step plan is unavailable when the workflow does not key its per-story steps by story id', () => {
    const unkeyed = parseWorkflow(
      STAGE_WORKFLOW.replaceAll("itemKey: '{{item.id}}'", "itemKey: 'k-{{item.id}}'")
        .replace("['tests:{{item.id}}']", "['tests:k-{{item.id}}']")
        .replace("['implement:{{item.id}}']", "['implement:k-{{item.id}}']"),
    );
    if (!unkeyed.success) throw new Error(JSON.stringify(unkeyed.issues));
    const plan = compileStageRunPlan(unkeyed.workflow, 'mvp', [
      story('STORY-001'),
      story('STORY-002', { dependsOn: ['STORY-001'] }),
    ]);
    expect(plan.stepPlan).toBe('unavailable');
    expect(plan.nodes).toEqual([]);
    expect(plan.findings).toContainEqual(
      expect.objectContaining({
        code: 'step-plan-unavailable',
        subjects: ['STORY-001', 'STORY-002'],
      }),
    );
    expect(plan.waves).toEqual([['STORY-001'], ['STORY-002']]);
  });

  it('offers no step graph, cost or critical path when the stories have a cycle', () => {
    const plan = compileStageRunPlan(workflow(), 'mvp', [
      story('STORY-001', { dependsOn: ['STORY-002'] }),
      story('STORY-002', { dependsOn: ['STORY-001'] }),
    ]);
    expect(plan.stepPlan).toBe('unavailable');
    expect(plan.nodes).toEqual([]);
    expect(plan.findings[0]?.message).toContain('-->');
  });

  it('marks the step plan compiled or unavailable', () => {
    expect(compileStageRunPlan(workflow(), 'mvp', [story('STORY-001')]).stepPlan).toBe('compiled');
    const parsed = parseWorkflow(STAGE_WORKFLOW.replace("'stage.stories'", "'stage.nothing'"));
    if (!parsed.success) throw new Error('fixture');
    expect(compileStageRunPlan(parsed.workflow, 'mvp', [story('STORY-001')]).stepPlan).toBe(
      'unavailable',
    );
  });

  it('survives a 6000-story dependency chain declared against id order without overflowing the stack', () => {
    const count = 6000;
    const id = (n: number) => `STORY-${String(n).padStart(5, '0')}`;
    // STORY-00000 depends on STORY-00001 depends on ..., the reverse of id order.
    const chain = Array.from({ length: count }, (_, n) =>
      story(id(n), {
        dependsOn: n + 1 < count ? [id(n + 1)] : [],
        filesExpected: [`src/c${String(n)}/**`],
      }),
    );
    const parsed = parseWorkflow(STAGE_WORKFLOW.replace("'stage.stories'", "'stage.nothing'"));
    if (!parsed.success) throw new Error('fixture');
    const plan = compileStageRunPlan(parsed.workflow, 'mvp', chain);
    expect(plan.waves).toHaveLength(count);
    expect(plan.storyCriticalPath).toHaveLength(count);
    expect(plan.ok).toBe(true);
  });

  it('caps the overlap listing for a stage where every story claims the same file, yet orders them all', () => {
    const count = 150;
    const same = Array.from({ length: count }, (_, n) =>
      story(`STORY-${String(n).padStart(3, '0')}`, { filesExpected: ['src/index.ts'] }),
    );
    const plan = compileStageRunPlan(workflow(), 'mvp', same);
    expect(plan.overlapCount).toBe((count * (count - 1)) / 2);
    expect(plan.storyOverlaps).toHaveLength(100);
    expect(plan.findings.filter((f) => f.code === 'file-claim-overlap')).toHaveLength(100);
    expect(plan.findings.some((f) => f.code === 'file-claim-overlap-truncated')).toBe(true);
    expect(plan.waves).toHaveLength(count);
  });

  it('never orders overlapping stories inside one wave (property over random stages)', () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const areas = ['a', 'b', 'c', 'd'];
    for (let round = 0; round < 60; round += 1) {
      const count = 3 + Math.floor(random() * 8);
      const stories = Array.from({ length: count }, (_, n) =>
        story(`STORY-${String(n).padStart(3, '0')}`, {
          dependsOn:
            n > 0 && random() < 0.3
              ? [`STORY-${String(Math.floor(random() * n)).padStart(3, '0')}`]
              : [],
          // The same area written two ways: `src/a/**` and `src/a/f.ts` still overlap.
          filesExpected: [
            `src/${areas[Math.floor(random() * areas.length)] ?? 'a'}/${random() < 0.5 ? '**' : 'f.ts'}`,
          ],
        }),
      );
      const plan = compileStageRunPlan(workflow(), 'mvp', stories);
      const wave = new Map<string, number>();
      plan.waves.forEach((ids, index) => {
        ids.forEach((id) => wave.set(id, index));
      });
      expect(wave.size).toBe(count);
      for (const a of stories) {
        for (const dep of a.dependsOn) {
          expect(wave.get(a.id) ?? 0).toBeGreaterThan(wave.get(dep) ?? Number.MAX_SAFE_INTEGER);
          // The step plan carries it too: a's first step waits for dep's last.
          expect(node(plan, `stagewf:tests:${a.id}`).dependsOn).toContain(`stagewf:review:${dep}`);
        }
        for (const b of stories) {
          if (
            a.id < b.id &&
            a.filesExpected[0]?.split('/')[1] === b.filesExpected[0]?.split('/')[1]
          ) {
            expect(wave.get(a.id)).not.toBe(wave.get(b.id));
          }
        }
      }
    }
  });
});

describe('compilePlan — a whole-entry placeholder naming a list of globs', () => {
  const wf = (produces: string) => {
    const parsed = parseWorkflow(
      STAGE_WORKFLOW.replace("produces: '{{item.files_expected}}'", `produces: ${produces}`),
    );
    if (!parsed.success) throw new Error(JSON.stringify(parsed.issues));
    return parsed.workflow;
  };
  const withFiles = (files: unknown) => ({
    stage: { stories: [{ id: 'S1', owner_role: 'backend', files_expected: files }] },
  });

  it('splices a string array into that many claims', () => {
    const result = compilePlan(wf("'{{item.files_expected}}'"), withFiles(['a/**', 'b/**']));
    expect(
      result.success && result.nodes.find((n) => n.id === 'stagewf:implement:S1')?.produces,
    ).toEqual(['a/**', 'b/**']);
  });

  it('still refuses an array with a non-string in it, and leaves scalars and embedded placeholders alone', () => {
    const bad = compilePlan(wf("'{{item.files_expected}}'"), withFiles(['a/**', 3]));
    expect(bad.success).toBe(false);
    const scalar = compilePlan(wf("'{{item.files_expected}}'"), withFiles('only/**'));
    expect(
      scalar.success && scalar.nodes.find((n) => n.id === 'stagewf:implement:S1')?.produces,
    ).toEqual(['only/**']);
    const embedded = compilePlan(wf("'src/{{item.id}}/**'"), withFiles([]));
    expect(
      embedded.success && embedded.nodes.find((n) => n.id === 'stagewf:implement:S1')?.produces,
    ).toEqual(['src/S1/**']);
  });
});
