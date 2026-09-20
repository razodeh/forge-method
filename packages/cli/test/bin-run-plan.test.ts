/**
 * `forge plan run-plan <stageId> [--json]` (`03` §3.2.3, `06` §6.2, `PLAN-M13.md` P10), invoked as a real
 * subprocess against a real `forge init`-written project, so the literal command line
 * `plan-stage.workflow.yaml`'s `derive-run-plan` step runs is proven to be accepted and to produce a plan.
 *
 * @see specs/03 §3.2.3
 * @see specs/06 §6.2
 * @see PLAN-M13.md P10
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { resolveTemplate, type ExpressionContext } from '@forge/engine/expr';
import { compilePlan, compileStageRunPlan } from '@forge/engine/plan';
import { parseWorkflow } from '@forge/engine/workflow';

import { readWorkflowFiles } from '../src/init/content.ts';

const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function forge(args: readonly string[], cwd: string): Result {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      cwd,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

/** A bare project directory holding the shipped workflows exactly where `forge init` materialises them
 * (`.forge/workflows/`). The command reads only those and the Epic/Story documents, so nothing else `init`
 * writes (config, agents, prompts) is needed, and the suite does not depend on it. */
async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-run-plan-'));
  dirs.push(dir);
  await mkdir(path.join(dir, '.forge/workflows'), { recursive: true });
  for (const file of await readWorkflowFiles()) {
    await writeFile(path.join(dir, '.forge/workflows', path.basename(file.relPath)), file.content);
  }
  return dir;
}

const BASE = {
  schemaVersion: 1,
  created: '2026-01-01',
  updated: '2026-01-01',
  revision: 1,
  author: 'po',
  changelog: [],
};

async function writeDoc(
  dir: string,
  rel: string,
  frontMatter: Record<string, unknown>,
): Promise<void> {
  const file = path.join(dir, 'docs/forge/specs', rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\n${YAML.stringify(frontMatter)}---\n\nBody.\n`, 'utf8');
}

function epicFrontMatter(
  n: number,
  stage: string,
  stories: readonly string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const id = `EPIC-${String(n).padStart(3, '0')}`;
  return {
    ...BASE,
    id,
    type: 'Epic',
    title: `Epic ${String(n)}`,
    status: 'ready',
    capability: 'CAP-001',
    stage,
    goal: 'A goal.',
    scope_in: [],
    scope_out: [],
    stories: [...stories],
    interfaces: [],
    data: [],
    exit_criteria: [],
    ...overrides,
  };
}

async function writeEpic(
  dir: string,
  n: number,
  stage: string,
  stories: readonly string[],
): Promise<void> {
  await writeDoc(
    dir,
    `epics/EPIC-${String(n).padStart(3, '0')}.md`,
    epicFrontMatter(n, stage, stories),
  );
}

async function writeStory(
  dir: string,
  n: number,
  epicN: number,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const id = `STORY-${String(n).padStart(3, '0')}`;
  await writeDoc(dir, `stories/${id}.md`, {
    ...BASE,
    id,
    type: 'Story',
    title: `Story ${String(n)}`,
    status: 'ready',
    epic: `EPIC-${String(epicN).padStart(3, '0')}`,
    capability: 'CAP-001',
    storyType: 'feature',
    size: 'M',
    owner_role: 'backend',
    depends_on: [],
    blocked_by: [],
    interfaces: [],
    data: [],
    files_expected: [`src/s${String(n)}/**`, `tests/s${String(n)}/**`],
    context_refs: [],
    acceptance: [],
    tests: [],
    dod_profile: 'backend-default',
    ...overrides,
  });
}

/** A `build-stage` that does compile: the shipped one's `merge`/`review` steps are what currently block it. */
const COMPILABLE_STAGE_WORKFLOW = `id: build-stage
name: Compilable stage
version: 1.0.0
description: Fanout over the stage's stories.
inputs:
  - name: stageId
    type: string
    required: true
steps:
  - id: implement
    kind: fanout
    over: 'stage.stories'
    itemKey: '{{item.id}}'
    step:
      kind: agent
      agent: '{{item.owner_role}}'
      brief: briefs/implement-story.md
      produces: '{{item.files_expected}}'
`;

async function useCompilableWorkflow(dir: string): Promise<void> {
  await writeFile(
    path.join(dir, '.forge/workflows/build-stage.workflow.yaml'),
    COMPILABLE_STAGE_WORKFLOW,
  );
}

interface StageContext extends ExpressionContext {
  readonly stageId: string;
}

interface Envelope {
  readonly v: number;
  readonly ok: boolean;
  readonly stageId: string;
  readonly workflowId: string;
  readonly waves: readonly (readonly string[])[];
  readonly findings: readonly { readonly code: string; readonly severity: string }[];
  readonly criticalPath: { readonly path: readonly string[]; readonly estimatedCost: number };
  readonly nodes: readonly { readonly id: string; readonly dependsOn: readonly string[] }[];
  readonly stories: readonly { readonly id: string }[];
  readonly storyCriticalPath: readonly string[];
  readonly stepPlan: string;
  readonly errors: number;
  readonly warnings: number;
}

describe('forge plan run-plan (real subprocess)', () => {
  it('prints the standard v1 envelope for a stage, with dependency-respecting waves and the compiled steps', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002', 'STORY-003']);
    await writeStory(dir, 1, 1);
    await writeStory(dir, 2, 1);
    await writeStory(dir, 3, 1, { depends_on: ['STORY-001'] });

    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.v).toBe(1);
    expect(plan.ok).toBe(true);
    expect(plan.stageId).toBe('mvp');
    expect(plan.workflowId).toBe('build-stage');
    expect(plan.waves).toEqual([['STORY-001', 'STORY-002'], ['STORY-003']]);
    expect(plan.stories.map((s) => s.id)).toEqual(['STORY-001', 'STORY-002', 'STORY-003']);
    expect(plan.storyCriticalPath).toEqual(['STORY-001', 'STORY-003']);
    // Whether the shipped build-stage compiles to steps is a separate matter (it does not today); either
    // way the story-level plan is the plan, and the output says which one it is.
    expect(plan.errors).toBe(0);
    expect(typeof plan.warnings).toBe('number');
  });

  it('adds the step-level graph, with story dependencies on the steps, when the stage workflow compiles', async () => {
    const dir = await project();
    await writeFile(
      path.join(dir, '.forge/workflows/build-stage.workflow.yaml'),
      COMPILABLE_STAGE_WORKFLOW,
    );
    await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002']);
    await writeStory(dir, 1, 1);
    await writeStory(dir, 2, 1, { depends_on: ['STORY-001'] });
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.findings).toEqual([]);
    expect(plan.stepPlan).toBe('compiled');
    expect(plan.nodes.find((n) => n.id === 'build-stage:implement:STORY-002')?.dependsOn).toContain(
      'build-stage:implement:STORY-001',
    );
    expect(plan.criticalPath.path).toEqual([
      'build-stage:implement:STORY-001',
      'build-stage:implement:STORY-002',
    ]);
  });

  it('is deterministic: the same inputs print byte-identical output', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002']);
    await writeStory(dir, 1, 1, { files_expected: ['src/shared/**'] });
    await writeStory(dir, 2, 1, { files_expected: ['src/shared/a.ts'] });
    const first = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    const second = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(first.status).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    const human1 = forge(['plan', 'run-plan', 'mvp'], dir);
    const human2 = forge(['plan', 'run-plan', 'mvp'], dir);
    expect(human2.stdout).toBe(human1.stdout);
  });

  it('serialises stories whose file claims overlap and reports it as a warning, exit 0', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002']);
    await writeStory(dir, 1, 1, { files_expected: ['src/shared/**'] });
    await writeStory(dir, 2, 1, { files_expected: ['src/shared/a.ts'] });
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.waves).toEqual([['STORY-001'], ['STORY-002']]);
    expect(plan.findings).toContainEqual(
      expect.objectContaining({ code: 'file-claim-overlap', severity: 'warning' }),
    );
  });

  it('reports a story dependency cycle as findings with ok:false and exit 1 (not a crash)', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002']);
    await writeStory(dir, 1, 1, { depends_on: ['STORY-002'] });
    await writeStory(dir, 2, 1, { depends_on: ['STORY-001'] });
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(1);
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.ok).toBe(false);
    expect(plan.findings).toContainEqual(
      expect.objectContaining({ code: 'dependency-cycle', severity: 'error' }),
    );
  });

  it('reports a story an Epic lists but that does not exist, and a story that fails its schema', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002', 'STORY-003']);
    await writeStory(dir, 1, 1);
    await writeStory(dir, 2, 1, { size: 'XL' });
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(1);
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(['story-invalid', 'story-missing']),
    );
  });

  it('plans an empty stage (an Epic with no stories) as an empty, ok plan', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', []);
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.ok).toBe(true);
    expect(plan.waves).toEqual([]);
    expect(plan.stories).toEqual([]);
  });

  it('only plans the named stage (another stage’s stories do not leak in)', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeEpic(dir, 2, 'next', ['STORY-002']);
    await writeStory(dir, 1, 1);
    await writeStory(dir, 2, 2);
    const plan = JSON.parse(forge(['plan', 'run-plan', 'mvp', '--json'], dir).stdout) as Envelope;
    expect(plan.stories.map((s) => s.id)).toEqual(['STORY-001']);
  });

  it('exits 2 with the typed RUN-082 error for a stage no Epic declares', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', []);
    const result = forge(['plan', 'run-plan', 'nope', '--json'], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('nope');
    expect(result.stderr).toContain('forge plan stage');
  });

  it('exits 2 for a missing stage id and for an extra positional', async () => {
    const dir = await project();
    expect(forge(['plan', 'run-plan'], dir).status).toBe(2);
    expect(forge(['plan', 'run-plan', 'a', 'b'], dir).status).toBe(2);
  });

  it('exits non-zero, typed, when the project has no build-stage workflow to compile', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', []);
    await rm(path.join(dir, '.forge/workflows/build-stage.workflow.yaml'));
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('build-stage');
  });

  it('accepts the exact command line the shipped plan-stage workflow’s derive-run-plan step runs', async () => {
    const files = await readWorkflowFiles();
    const file = files.find((f) => f.relPath.endsWith('plan-stage.workflow.yaml'));
    if (file === undefined) throw new Error('fixture gap: no shipped plan-stage workflow');
    const parsed = parseWorkflow(file.content);
    if (!parsed.success) throw new Error('shipped plan-stage does not parse');
    const step = parsed.workflow.steps.find(
      (s) => s.kind === 'command' && s.id === 'derive-run-plan',
    );
    if (step?.kind !== 'command') throw new Error('no derive-run-plan step');
    const context: StageContext = { stageId: 'mvp' };
    const line = resolveTemplate(step.run, context);
    const [bin, ...args] = line.split(/\s+/);
    expect(bin).toBe('forge');

    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeStory(dir, 1, 1);
    const result = forge(args, dir);
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as Envelope).ok).toBe(true);
  });

  it('renders a readable plan without --json', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002']);
    await writeStory(dir, 1, 1);
    await writeStory(dir, 2, 1, { depends_on: ['STORY-001'] });
    const result = forge(['plan', 'run-plan', 'mvp'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Run plan for stage mvp');
    expect(result.stdout).toContain('1. STORY-001');
    expect(result.stdout).toContain('2. STORY-002');
    expect(result.stdout).toContain('Longest story chain: STORY-001 -> STORY-002');
  });

  it('says the step plan is unavailable, with a null critical path and a warning, when the workflow cannot compile', async () => {
    const dir = await project();
    await writeFile(
      path.join(dir, '.forge/workflows/build-stage.workflow.yaml'),
      COMPILABLE_STAGE_WORKFLOW.replace("'stage.stories'", "'stage.nothing'"),
    );
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeStory(dir, 1, 1);
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout) as Envelope & { readonly criticalPath: unknown };
    expect(plan.stepPlan).toBe('unavailable');
    expect(plan.criticalPath).toBeNull();
    expect(plan.nodes).toEqual([]);
    expect(plan.warnings).toBe(1);
    expect(plan.findings[0]).toMatchObject({ code: 'step-plan-unavailable', severity: 'warning' });
    const human = forge(['plan', 'run-plan', 'mvp'], dir);
    expect(human.stdout).toContain('no step-level plan');
    expect(human.stdout).toContain('read the warnings above');
  });

  it('refuses to plan a story id that two files declare, and lists it once', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeStory(dir, 1, 1, { files_expected: ['src/a/**'] });
    await writeDoc(dir, 'stories/aaa-duplicate.md', {
      ...BASE,
      id: 'STORY-001',
      type: 'Story',
      title: 'Duplicate',
      status: 'ready',
      epic: 'EPIC-001',
      capability: 'CAP-001',
      storyType: 'feature',
      size: 'M',
      owner_role: 'backend',
      depends_on: [],
      blocked_by: [],
      interfaces: [],
      data: [],
      files_expected: ['src/zzz/**'],
      context_refs: [],
      acceptance: [],
      tests: [],
      dod_profile: 'backend-default',
    });
    const first = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(first.status).toBe(1);
    const plan = JSON.parse(first.stdout) as Envelope;
    expect(plan.stories).toEqual([]);
    expect(
      plan.findings.filter((f) => f.code === 'duplicate-story-id' && f.severity === 'error'),
    ).toHaveLength(1);
  });

  it('leaves delivered stories out of the schedule and treats a dependency on one as met, across stages', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeEpic(dir, 2, 'next', ['STORY-002', 'STORY-003']);
    await writeStory(dir, 1, 1, { status: 'done' });
    await writeStory(dir, 2, 2, { depends_on: ['STORY-001'] });
    await writeStory(dir, 3, 2, { status: 'done', files_expected: ['src/old/**'] });
    const result = forge(['plan', 'run-plan', 'next', '--json'], dir);
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.stories.map((s) => s.id)).toEqual(['STORY-002']);
    expect(plan.waves).toEqual([['STORY-002']]);
    expect(plan.findings.map((f) => f.code)).toEqual(['story-already-delivered']);
  });

  it('warns, without failing, on a dependency on an undelivered story of another stage; errors on an unknown one', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeEpic(dir, 2, 'next', ['STORY-002', 'STORY-003']);
    await writeStory(dir, 1, 1);
    await writeStory(dir, 2, 2, { depends_on: ['STORY-001'] });
    await writeStory(dir, 3, 2, { depends_on: ['STORY-404'] });
    const result = forge(['plan', 'run-plan', 'next', '--json'], dir);
    expect(result.status).toBe(1);
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.findings.map((f) => `${f.severity}:${f.code}`)).toEqual([
      'warning:dependency-outside-stage',
      'error:unknown-dependency',
    ]);
    expect(plan.errors).toBe(1);
    expect(plan.warnings).toBe(1);
  });

  it('stops with a typed, non-zero error naming the file when a document under the specs root has broken front matter', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', []);
    const broken = path.join(dir, 'docs/forge/specs/stories/STORY-900.md');
    await mkdir(path.dirname(broken), { recursive: true });
    await writeFile(broken, '---\nid: [unclosed\n---\n\nBody.\n', 'utf8');
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).not.toBe(0);
    expect(result.status).not.toBe(1);
    expect(result.stderr).toContain('STORY-900.md');
  });

  it('strips terminal escape bytes that a story file smuggles into the human rendering', async () => {
    const dir = await project();
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeStory(dir, 1, 1, { depends_on: ['\u001b[31mSTORY-666\u001b]0;pwn\u0007'] });
    const result = forge(['plan', 'run-plan', 'mvp'], dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('unknown-dependency');
    // No escape byte may reach the terminal.
    expect(result.stdout.includes('\u001b')).toBe(false);
  });

  it('ships derive-run-plan as an inline step, so it runs in the supervisor and not in a lane worktree branched from main', async () => {
    const files = await readWorkflowFiles();
    const file = files.find((f) => f.relPath.endsWith('plan-stage.workflow.yaml'));
    if (file === undefined) throw new Error('fixture gap: no shipped plan-stage workflow');
    const parsed = parseWorkflow(file.content);
    if (!parsed.success) throw new Error('shipped plan-stage does not parse');
    const context: StageContext = { stageId: 'mvp' };
    const compiled = compilePlan(parsed.workflow, context);
    if (!compiled.success) throw new Error(JSON.stringify(compiled.issues));
    expect(compiled.nodes.find((n) => n.id === 'plan-stage:derive-run-plan')?.laneAffinity).toBe(
      'inline',
    );
  });

  /** The same tree written with every document under a different file name (so a different walk order). */
  async function permutedTrees(): Promise<readonly [string, string]> {
    const build = async (names: readonly string[]): Promise<string> => {
      const dir = await project();
      await useCompilableWorkflow(dir);
      await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002', 'STORY-003', 'STORY-004']);
      await writeEpic(dir, 2, 'next', ['STORY-005']);
      const story = (n: number, epic: number, over: Record<string, unknown> = {}) =>
        writeDocAs(dir, names[n] ?? String(n), n, epic, over);
      await story(1, 1, { size: 'XL' });
      await story(2, 1, { size: 'XL' });
      await story(3, 1, { depends_on: ['STORY-005'], files_expected: ['src/x/**'] });
      await story(4, 1, { files_expected: ['src/x/y.ts'] });
      await story(5, 2, { status: 'done' });
      await story(5, 2, { status: 'ready' });
      return dir;
    };
    return [
      await build(['', 'z1', 'z2', 'z3', 'z4', 'z5']),
      await build(['', 'a5', 'a4', 'a3', 'a2', 'a1']),
    ];
  }

  async function writeDocAs(
    dir: string,
    name: string,
    n: number,
    epic: number,
    over: Record<string, unknown>,
  ): Promise<void> {
    const id = `STORY-${String(n).padStart(3, '0')}`;
    await writeDoc(dir, `stories/${name}${over['status'] === 'done' ? 'done' : ''}.md`, {
      ...BASE,
      id,
      type: 'Story',
      title: id,
      status: 'ready',
      epic: `EPIC-${String(epic).padStart(3, '0')}`,
      capability: 'CAP-001',
      storyType: 'feature',
      size: 'M',
      owner_role: 'backend',
      depends_on: [],
      blocked_by: [],
      interfaces: [],
      data: [],
      files_expected: [`src/s${String(n)}/**`],
      context_refs: [],
      acceptance: [],
      tests: [],
      dod_profile: 'backend-default',
      ...over,
    });
  }

  it('prints byte-identical output for the same project whatever its documents are named (invalid stories, cross-stage duplicates)', async () => {
    const [one, two] = await permutedTrees();
    const a = forge(['plan', 'run-plan', 'mvp', '--json'], one);
    const b = forge(['plan', 'run-plan', 'mvp', '--json'], two);
    expect(a.status).toBe(1);
    expect(b.stdout).toBe(a.stdout);
    const plan = JSON.parse(a.stdout) as Envelope;
    expect(plan.findings.filter((f) => f.code === 'story-invalid')).toHaveLength(2);
    // STORY-005 exists twice in stage "next", once done and once ready: undelivered wins, whatever the order.
    expect(plan.findings).toContainEqual(
      expect.objectContaining({ code: 'dependency-outside-stage', severity: 'warning' }),
    );
  });

  it('refuses a story id declared twice in the stage even when one copy is done', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeDocAs(dir, 'one', 1, 1, { status: 'done' });
    await writeDocAs(dir, 'two', 1, 1, {});
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(1);
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.findings.map((f) => f.code)).toContain('duplicate-story-id');
    expect(plan.stories).toEqual([]);
  });

  it('reports, and does not plan, a story that a stage Epic lists but that names an Epic of another stage', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeEpic(dir, 2, 'next', []);
    await writeDocAs(dir, 'one', 1, 2, {});
    const mvp = JSON.parse(forge(['plan', 'run-plan', 'mvp', '--json'], dir).stdout) as Envelope;
    expect(mvp.findings.map((f) => f.code)).toContain('story-epic-mismatch');
    expect(mvp.stories).toEqual([]);
    const next = JSON.parse(forge(['plan', 'run-plan', 'next', '--json'], dir).stdout) as Envelope;
    // Its own `epic` field is authoritative: it belongs to the stage of the Epic it names.
    expect(next.stories.map((story) => story.id)).toEqual(['STORY-001']);
  });

  it('does not call a dependency on a story that failed its schema "unknown"', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002']);
    await writeDocAs(dir, 'one', 1, 1, { size: 'XL' });
    await writeDocAs(dir, 'two', 2, 1, { depends_on: ['STORY-001'] });
    const plan = JSON.parse(forge(['plan', 'run-plan', 'mvp', '--json'], dir).stdout) as Envelope;
    expect(plan.findings.map((f) => f.code).sort()).toEqual([
      'dependency-outside-stage',
      'story-invalid',
    ]);
  });

  it('lists blocked stories as planned-but-not-startable, and warns on an empty stage', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeDocAs(dir, 'one', 1, 1, { blocked_by: ['OQ-001'] });
    const plan = JSON.parse(
      forge(['plan', 'run-plan', 'mvp', '--json'], dir).stdout,
    ) as Envelope & {
      readonly blocked: readonly string[];
    };
    expect(plan.blocked).toEqual(['STORY-001']);
    expect(plan.waves).toEqual([['STORY-001']]);
    const human = forge(['plan', 'run-plan', 'mvp'], dir);
    expect(human.stdout).toContain('Planned but not startable yet (blocked): STORY-001');

    const empty = await project();
    await useCompilableWorkflow(empty);
    await writeEpic(empty, 1, 'mvp', []);
    const emptyPlan = JSON.parse(
      forge(['plan', 'run-plan', 'mvp', '--json'], empty).stdout,
    ) as Envelope;
    expect(emptyPlan.ok).toBe(true);
    expect(emptyPlan.findings.map((f) => f.code)).toEqual(['stage-has-no-stories']);
  });

  it('prints a forged multi-line dependency name as one line', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeDocAs(dir, 'one', 1, 1, { depends_on: ['X\n\nPlan is schedulable.'] });
    const human = forge(['plan', 'run-plan', 'mvp'], dir).stdout;
    expect(human.split('\n').some((line) => line.startsWith('Plan is schedulable.'))).toBe(false);
    expect(human).toContain('unknown-dependency');
  });

  // KNOWN GAP (`SPEC-QUESTIONS.md`, M13 P10): the shipped build-stage does not compile to steps, so a
  // real stage gets no step graph, critical path or cost. `it.fails` keeps this suite green while that is
  // true and turns red the day the workflow is fixed, which is the cue to delete the `.fails`.
  it.fails('compiles the shipped build-stage to a step plan', async () => {
    const files = await readWorkflowFiles();
    const file = files.find((f) => f.relPath.endsWith('build-stage.workflow.yaml'));
    const parsed = parseWorkflow(file?.content ?? '');
    if (!parsed.success) throw new Error('shipped build-stage does not parse');
    const plan = compileStageRunPlan(parsed.workflow, 'mvp', [
      {
        id: 'STORY-001',
        ownerRole: 'backend',
        dependsOn: [],
        blockedBy: [],
        filesExpected: ['src/a/**'],
        testPaths: [],
      },
    ]);
    expect(plan.stepPlan).toBe('compiled');
  });

  it('strips DEL and C1 control bytes from --json too, which JSON.stringify writes raw', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeDocAs(dir, 'one', 1, 1, {
      depends_on: ['X\u009b2J\u007f'],
      files_expected: ['src/\u009d0;pwn\u0007/**'],
    });
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.stdout).toContain('unknown-dependency');
    expect(/[\u007f-\u009f]/.test(result.stdout)).toBe(false);
    expect((JSON.parse(result.stdout) as Envelope).v).toBe(1);
  });

  it('reports an invalid Epic, a duplicate Epic id, and an Epic whose stage is numeric', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeDoc(
      dir,
      'epics/EPIC-001.md',
      epicFrontMatter(1, 'mvp', ['STORY-001'], { goal: '' }),
    );
    await writeDoc(dir, 'epics/EPIC-001-copy.md', epicFrontMatter(1, 'other', ['STORY-002']));
    await writeDocAs(dir, 'one', 1, 1, {});
    const plan = JSON.parse(forge(['plan', 'run-plan', 'mvp', '--json'], dir).stdout) as Envelope;
    expect(plan.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(['epic-invalid', 'duplicate-epic-id']),
    );

    const numeric = await project();
    await useCompilableWorkflow(numeric);
    await writeDoc(numeric, 'epics/EPIC-001.md', {
      ...epicFrontMatter(1, 'x', []),
      stage: 1,
    });
    const result = forge(['plan', 'run-plan', '1', '--json'], numeric);
    expect(result.status).toBe(1);
    expect((JSON.parse(result.stdout) as Envelope).findings.map((f) => f.code)).toContain(
      'epic-invalid',
    );
  });

  it('reports a document that looks like a Story of the stage but has no usable id or type', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001']);
    await writeDocAs(dir, 'one', 1, 1, {});
    await writeDoc(dir, 'stories/typo.md', {
      ...BASE,
      id: 'STORY-002',
      type: 'story',
      epic: 'EPIC-001',
    });
    await writeDoc(dir, 'stories/noid.md', { ...BASE, type: 'Story', epic: 'EPIC-001' });
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(1);
    const plan = JSON.parse(result.stdout) as Envelope;
    expect(plan.findings.filter((f) => f.code === 'story-invalid')).toHaveLength(2);
  });

  it('warns about a story that is already under way, one its Epic does not list, and lists a blocked status as blocked', async () => {
    const dir = await project();
    await useCompilableWorkflow(dir);
    await writeEpic(dir, 1, 'mvp', ['STORY-001', 'STORY-002']);
    await writeDocAs(dir, 'one', 1, 1, { status: 'in-review' });
    await writeDocAs(dir, 'two', 2, 1, { status: 'blocked', files_expected: ['src/b/**'] });
    await writeDocAs(dir, 'three', 3, 1, { files_expected: ['src/c/**'] });
    await writeDocAs(dir, 'four', 4, 1, { status: 'verified', files_expected: ['src/d/**'] });
    const result = forge(['plan', 'run-plan', 'mvp', '--json'], dir);
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout) as Envelope & { readonly blocked: readonly string[] };
    expect(plan.findings.map((f) => f.code).sort()).toEqual([
      'story-already-delivered',
      'story-blocked',
      'story-in-progress',
      'story-not-listed',
    ]);
    expect(plan.blocked).toEqual(['STORY-002']);
    expect(plan.stories.map((story) => story.id)).toEqual(['STORY-001', 'STORY-002', 'STORY-003']);
  });

  it('parses the shipped build-stage (so the known-gap test below fails for the stated reason only)', async () => {
    const files = await readWorkflowFiles();
    const file = files.find((f) => f.relPath.endsWith('build-stage.workflow.yaml'));
    expect(parseWorkflow(file?.content ?? '').success).toBe(true);
  });
});
