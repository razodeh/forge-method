/**
 * The shipped `build-stage` workflow compiles, and compiles to the right graph (`PLAN-M13.md` P13, `10` §10.1
 * and §10.4, `06` §6.2, `SPEC-QUESTIONS.md` Q211).
 *
 * `build-stage` is the workflow that turns a stage's planned stories into code. For a long time it did not
 * compile at all (`merge`'s per-item `dependsOn` could not resolve `item.id`, and `review` was not keyed by
 * story id), so `forge run build-stage` could not start and `forge plan run-plan` had no step plan. These
 * tests read the file that ships in `@forge/templates` (not a hand-written stand-in) and assert the exact
 * shape of what it compiles to for the stage inputs that matter: no stories, one, three, a story with a
 * dependency, and two stories claiming overlapping files. They assert node ids and `dependsOn` edges, not
 * only "it compiled", because a graph that compiles but waits on the wrong nodes (a merge before a review,
 * one story's steps waiting on another's) is the failure this file exists to catch.
 *
 * Lives at the repository root for the same reason `test/workflows.test.ts` does: it needs both
 * `@forge/engine` and `@forge/templates`, which cannot import each other.
 *
 * @see specs/06 §6.2
 * @see specs/10 §10.1, §10.4
 * @see PLAN-M13.md P13
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  compileStageRunPlan,
  type StageRunPlan,
  type StageStory,
  type StepNode,
} from '@forge/engine/plan';
import { parseWorkflow, type Workflow } from '@forge/engine/workflow';
import { WORKFLOW_INDEX } from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function shippedBuildStage(): Workflow {
  const source = readFileSync(
    path.join(repoRoot, 'packages', 'templates', WORKFLOW_INDEX['build-stage']),
    'utf8',
  );
  const parsed = parseWorkflow(source);
  if (!parsed.success)
    throw new Error(`build-stage does not parse: ${JSON.stringify(parsed.issues)}`);
  return parsed.workflow;
}

function story(
  id: string,
  dependsOn: readonly string[] = [],
  files: readonly string[] = [],
): StageStory {
  return {
    id,
    ownerRole: 'backend',
    dependsOn,
    blockedBy: [],
    filesExpected: files,
    testPaths: files.filter((f) => f.startsWith('tests/')),
  };
}

function plan(stories: readonly StageStory[]): StageRunPlan {
  return compileStageRunPlan(shippedBuildStage(), 'mvp', stories);
}

const P = 'build-stage:';
const edges = (p: StageRunPlan): Record<string, readonly string[]> =>
  Object.fromEntries(
    p.nodes.map((n) => [n.id.slice(P.length), n.dependsOn.map((d) => d.slice(P.length))]),
  );
const node = (p: StageRunPlan, id: string): StepNode => {
  const found = p.nodes.find((n) => n.id === `${P}${id}`);
  if (found === undefined)
    throw new Error(`no node ${id}; have ${p.nodes.map((n) => n.id).join(', ')}`);
  return found;
};

/** Every id a node transitively waits for. */
function ancestors(p: StageRunPlan, id: string): ReadonlySet<string> {
  const byId = new Map(p.nodes.map((n) => [n.id.slice(P.length), n]));
  const seen = new Set<string>();
  const walk = (current: string): void => {
    for (const dep of byId.get(current)?.dependsOn ?? []) {
      const short = dep.slice(P.length);
      if (!seen.has(short)) {
        seen.add(short);
        walk(short);
      }
    }
  };
  walk(id);
  return seen;
}

describe('the shipped build-stage compiles to a step plan', () => {
  it.each([
    ['no stories', []],
    ['one story', [story('STORY-001', [], ['src/a/**'])]],
    [
      'three stories',
      [
        story('STORY-001', [], ['src/a/**']),
        story('STORY-002', [], ['src/b/**']),
        story('STORY-003', [], ['src/c/**']),
      ],
    ],
    [
      'a story with a dependency',
      [story('STORY-001', [], ['src/a/**']), story('STORY-002', ['STORY-001'], ['src/b/**'])],
    ],
    [
      'overlapping claims',
      [story('STORY-001', [], ['src/a/**']), story('STORY-002', [], ['src/a/x.ts'])],
    ],
  ] as const)(
    '%s: stepPlan is compiled, with a critical path and no error findings',
    (_name, stories) => {
      const p = plan(stories);
      expect(p.stepPlan).toBe('compiled');
      expect(p.findings.filter((f) => f.severity === 'error')).toEqual([]);
      expect(p.findings.map((f) => f.code)).not.toContain('step-plan-unavailable');
      expect(p.criticalPath.path.length).toBeGreaterThan(0);
      expect(p.criticalPath.estimatedCost).toBeGreaterThan(0);
    },
  );

  it('with no stories keeps every stage-wide step and no per-story ones, and the merge still waits for the design gate', () => {
    const p = plan([]);
    expect(Object.keys(edges(p))).toEqual([
      'prepare',
      'freeze-contracts',
      'contracts-gate',
      'standup',
      'merge',
      'verify',
      'deliver',
    ]);
    // Not an unordered root: with no story to review, the merge waits for what the (empty) per-story chain
    // would have waited for, so G-Verify and `deliver` can never start before G-Design has passed.
    expect(edges(p)['merge']).toEqual(['contracts-gate']);
    expect(ancestors(p, 'deliver').has('prepare')).toBe(true);
    expect(edges(p)['verify']).toEqual(['merge']);
    expect(edges(p)['deliver']).toEqual(['verify']);
    expect(ancestors(p, 'deliver').has('freeze-contracts')).toBe(true);
    expect(ancestors(p, 'deliver').has('contracts-gate')).toBe(true);
  });

  it('with one story chains tests, implementation, review and merge for it', () => {
    expect(edges(plan([story('STORY-001', [], ['src/a/**'])]))).toEqual({
      prepare: [],
      'freeze-contracts': ['prepare'],
      'contracts-gate': ['freeze-contracts'],
      standup: ['contracts-gate'],
      'generate-tests:STORY-001': ['contracts-gate'],
      'implement:STORY-001': ['generate-tests:STORY-001', 'freeze-contracts'],
      'review:STORY-001': ['implement:STORY-001'],
      merge: ['review:STORY-001'],
      verify: ['merge'],
      deliver: ['verify'],
    });
  });

  it('with three independent stories: per-story chains, no cross-story edges, merge waits for every review', () => {
    const p = plan([
      story('STORY-003', [], ['src/c/**']),
      story('STORY-001', [], ['src/a/**']),
      story('STORY-002', [], ['src/b/**']),
    ]);
    const e = edges(p);
    for (const id of ['STORY-001', 'STORY-002', 'STORY-003']) {
      expect(e[`generate-tests:${id}`]).toEqual(['contracts-gate']);
      expect(e[`implement:${id}`]).toEqual([`generate-tests:${id}`, 'freeze-contracts']);
      expect(e[`review:${id}`]).toEqual([`implement:${id}`]);
    }
    // Collection order (stories sorted by id), not a set: resume and diffs of the plan depend on it.
    expect(e['merge']).toEqual(['review:STORY-001', 'review:STORY-002', 'review:STORY-003']);
    expect(e['verify']).toEqual(['merge']);
    expect(e['deliver']).toEqual(['verify']);
  });

  it("a story's dependency orders its whole chain after the other story's review, and only that story's", () => {
    const p = plan([
      story('STORY-001', [], ['src/a/**']),
      story('STORY-002', ['STORY-001'], ['src/b/**']),
      story('STORY-003', [], ['src/c/**']),
    ]);
    const e = edges(p);
    expect(e['generate-tests:STORY-002']).toEqual(['contracts-gate', 'review:STORY-001']);
    expect(e['generate-tests:STORY-001']).toEqual(['contracts-gate']);
    expect(e['generate-tests:STORY-003']).toEqual(['contracts-gate']);
    expect(ancestors(p, 'review:STORY-003').has('review:STORY-001')).toBe(false);
    expect(ancestors(p, 'review:STORY-001').has('generate-tests:STORY-002')).toBe(false);
    // The dependency is on the other story's LAST per-story step, never the stage-wide merge, or the
    // stage would serialise.
    expect(ancestors(p, 'generate-tests:STORY-002').has('merge')).toBe(false);
    expect(p.criticalPath.path.filter((id) => id.includes('STORY'))).toEqual([
      `${P}generate-tests:STORY-001`,
      `${P}implement:STORY-001`,
      `${P}review:STORY-001`,
      `${P}generate-tests:STORY-002`,
      `${P}implement:STORY-002`,
      `${P}review:STORY-002`,
    ]);
  });

  it('two stories claiming overlapping files are serialised, lower id first, and say so', () => {
    const p = plan([story('STORY-002', [], ['src/a/x.ts']), story('STORY-001', [], ['src/a/**'])]);
    expect(edges(p)['implement:STORY-002']).toContain('implement:STORY-001');
    expect(edges(p)['implement:STORY-001']).not.toContain('implement:STORY-002');
    expect(ancestors(p, 'implement:STORY-001').has('implement:STORY-002')).toBe(false);
    expect(p.findings.map((f) => f.code)).toEqual(['file-claim-overlap']);
    expect(p.stepOverlaps).toContainEqual(
      expect.objectContaining({
        stepIdA: `${P}implement:STORY-001`,
        stepIdB: `${P}implement:STORY-002`,
      }),
    );
  });

  it('review is a per-story step: one reviewer node per story, each fed only its own implement', () => {
    const p = plan([story('STORY-001', [], ['src/a/**']), story('STORY-002', [], ['src/b/**'])]);
    const reviews = p.nodes.filter((n) => n.id.startsWith(`${P}review:`));
    expect(reviews.map((n) => n.id)).toEqual([`${P}review:STORY-001`, `${P}review:STORY-002`]);
    for (const r of reviews) {
      expect(String(r.agent)).toBe('reviewer');
      const id = r.id.slice(`${P}review:`.length);
      expect(r.dependsOn).toEqual([`${P}implement:${id}`]);
      expect(r.inputs).toContain(`artifact:Story(${id})`);
    }
  });

  it('keeps the separation of duties: tests are written first by the sdet, and nothing merges unreviewed or unbuilt', () => {
    const stories = [story('STORY-001', [], ['src/a/**']), story('STORY-002', [], ['src/b/**'])];
    const p = plan(stories);
    for (const s of stories) {
      expect(String(node(p, `generate-tests:${s.id}`).agent)).toBe('sdet');
      expect(String(node(p, `implement:${s.id}`).agent)).toBe('backend');
      expect(String(node(p, `review:${s.id}`).agent)).toBe('reviewer');
      expect(ancestors(p, `implement:${s.id}`).has(`generate-tests:${s.id}`)).toBe(true);
      const merge = ancestors(p, 'merge');
      for (const step of ['generate-tests', 'implement', 'review']) {
        expect(merge.has(`${step}:${s.id}`)).toBe(true);
      }
    }
    expect(ancestors(p, 'merge').has('contracts-gate')).toBe(true);
    // The fan-in gate: verify (G-Verify) follows the merge, deliver follows verify, nothing skips them.
    expect(node(p, 'verify').gate).toBe('G-Verify');
    expect(node(p, 'contracts-gate').gate).toBe('G-Design');
    expect(ancestors(p, 'deliver').has('merge')).toBe(true);
    expect(node(p, 'merge').kind).toBe('merge');
  });

  it('has one root, prepare, at every story count: the integration branch exists before anything else, and nothing after the design gate can start unordered', () => {
    for (const count of [0, 1, 3]) {
      const stories = Array.from({ length: count }, (_v, i) =>
        story(`STORY-${String(i + 1).padStart(3, '0')}`, [], [`src/s${String(i)}/**`]),
      );
      const p = plan(stories);
      const roots = p.nodes
        .filter((n) => n.dependsOn.length === 0)
        .map((n) => n.id.slice(P.length));
      expect(roots).toEqual(['prepare']);
      for (const later of ['freeze-contracts', 'contracts-gate', 'merge', 'verify', 'deliver']) {
        expect(ancestors(p, later).has('prepare')).toBe(true);
      }
      for (const gated of ['merge', 'verify', 'deliver']) {
        expect(ancestors(p, gated).has('contracts-gate')).toBe(true);
      }
    }
  });

  it('refuses a story owned by the role that writes its tests or the role that reviews it', () => {
    for (const role of ['sdet', 'reviewer']) {
      const p = plan([{ ...story('STORY-001', [], ['src/a/**']), ownerRole: role }]);
      expect(p.ok).toBe(false);
      expect(p.findings).toContainEqual(
        expect.objectContaining({
          code: 'owner-role-breaks-separation',
          severity: 'error',
          subjects: ['STORY-001'],
        }),
      );
    }
  });

  it('a story that claims test files gives its test step a claim, and the implementer claim follows the story', () => {
    const p = plan([story('STORY-001', [], ['src/a/**', 'tests/a/**'])]);
    expect(node(p, 'generate-tests:STORY-001').produces).toEqual(['tests/a/**']);
    expect(edges(p)['implement:STORY-001']).toContain('generate-tests:STORY-001');
    expect(edges(p)['review:STORY-001']).toEqual(['implement:STORY-001']);
  });

  it('is deterministic: the same stories give the same nodes, whatever order they are supplied in', () => {
    const stories = [
      story('STORY-001', [], ['src/a/**']),
      story('STORY-002', ['STORY-001'], ['src/b/**']),
      story('STORY-003', [], ['src/c/**']),
    ];
    const a = plan(stories);
    const b = plan(stories);
    const c = plan([...stories].reverse());
    expect(b.nodes).toEqual(a.nodes);
    // Same order too, not only the same sets: the input order of stories must not reach the output.
    expect(c.nodes.map((n) => [n.id, n.dependsOn])).toEqual(
      a.nodes.map((n) => [n.id, n.dependsOn]),
    );
    expect(new Set(a.nodes.map((n) => n.id)).size).toBe(a.nodes.length);
  });

  it('has no dangling dependency and no error finding (cycles are one) at any story count', () => {
    for (const count of [0, 1, 3, 8]) {
      const stories = Array.from({ length: count }, (_v, i) =>
        story(
          `STORY-${String(i + 1).padStart(3, '0')}`,
          i > 0 && i % 3 === 0 ? [`STORY-${String(i).padStart(3, '0')}`] : [],
          [`src/s${String(i)}/**`],
        ),
      );
      const p = plan(stories);
      expect(p.stepPlan).toBe('compiled');
      const ids = new Set(p.nodes.map((n) => n.id));
      for (const n of p.nodes) for (const d of n.dependsOn) expect(ids.has(d)).toBe(true);
      expect(p.findings.filter((f) => f.severity === 'error')).toEqual([]);
    }
  });
});
