/**
 * The expression context `forge run` builds (`03` §3.2.4, `06` §6.2, `10` §10.1, `PLAN-M13.md` P21): what
 * `--stage`, `--epic`, `--story` and `--input` put where a workflow's templates read them, what is derived from the
 * project's own Epic and Story documents, and what is refused (naming the input and the flag that supplies it).
 * In-process, against a real temp git project and the shipped `build-stage` / `implement-story`; the
 * whole-shipped-set proof through the real launcher is `test/run-inputs-compile.test.ts`.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.1
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { ForgeError } from '@forge/core/errors';
import { compileRunPlan } from '@forge/engine/plan';
import { parseWorkflow } from '@forge/engine/workflow';

import { readWorkflowFiles } from '../../../src/init/content.ts';
import { buildRunExpressionContext } from '../../../src/commands/run/expression-context.ts';
import { planRunPlan } from '../../../src/commands/run/run-plan.ts';
import type { RunInputFlags } from '../../../src/commands/run/expression-context.ts';
import {
  cleanupAll,
  createTestProject,
  testRunDeps,
  WORKFLOWS_ROOT,
  type TestProject,
} from './helpers.ts';

const SPECS_ROOT = 'docs/forge/specs';
/** `store-release.workflow.yaml` is an fm-mobile module workflow, not one of the 20 `WORKFLOW_INDEX` ids
 * `readWorkflowFiles()` (below) copies into every project fixture here — so tests that need the real
 * shipped file copy it themselves, from the module tree directly. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const STORE_RELEASE_SOURCE = path.join(
  repoRoot,
  'modules',
  'fm-mobile',
  'workflows',
  'store-release.workflow.yaml',
);

let project: TestProject;
beforeEach(async () => {
  project = await createTestProject();
  for (const file of await readWorkflowFiles()) {
    await writeFile(path.join(project.dir, WORKFLOWS_ROOT, file.relPath), file.content);
  }
});
afterEach(cleanupAll);

async function workflow(id: string, body: string): Promise<void> {
  await writeFile(
    path.join(project.dir, WORKFLOWS_ROOT, `${id}.workflow.yaml`),
    `id: ${id}\nname: ${id}\nversion: 1.0.0\ndescription: fixture\n${body}`,
  );
}

const BASE = {
  schemaVersion: 1,
  created: '2026-01-01',
  updated: '2026-01-01',
  revision: 1,
  author: 'po',
  changelog: [],
};

async function doc(rel: string, frontMatter: Record<string, unknown>): Promise<void> {
  const file = path.join(project.dir, SPECS_ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\n${YAML.stringify(frontMatter)}---\n\nBody.\n`, 'utf8');
}

const id3 = (n: number): string => String(n).padStart(3, '0');

async function epic(n: number, stage: string, stories: readonly string[]): Promise<void> {
  await doc(`epics/EPIC-${id3(n)}.md`, {
    ...BASE,
    id: `EPIC-${id3(n)}`,
    type: 'Epic',
    title: 'Epic',
    status: 'ready',
    capability: 'CAP-001',
    stage,
    goal: 'g',
    scope_in: [],
    scope_out: [],
    stories: [...stories],
    interfaces: [],
    data: [],
    exit_criteria: [],
  });
}

async function story(
  n: number,
  epicN: number,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await doc(`stories/STORY-${id3(n)}.md`, {
    ...BASE,
    id: `STORY-${id3(n)}`,
    type: 'Story',
    title: 'Story',
    status: 'ready',
    epic: `EPIC-${id3(epicN)}`,
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

function build(id: string, flags: RunInputFlags = {}) {
  return buildRunExpressionContext(testRunDeps(project), id, flags, SPECS_ROOT);
}

async function refusal(promise: Promise<unknown>): Promise<ForgeError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ForgeError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('a workflow that declares no inputs', () => {
  beforeEach(async () => {
    await workflow(
      'plain',
      'steps:\n  - id: a\n    kind: command\n    run: "true"\n    inline: true\n',
    );
  });

  it('gets the context `forge run` always built: --stage as a string, --epic and --story in vars', async () => {
    const { context, warnings } = await build('plain', { stage: 'S1', epic: 'E1', story: 'ST1' });
    expect(context).toEqual({
      stage: 'S1',
      stageId: 'S1',
      storyId: 'ST1',
      vars: { epic: 'E1', story: 'ST1' },
    });
    expect(warnings).toEqual([]);
  });

  it('is an empty context when no flag is given', async () => {
    expect((await build('plain')).context).toEqual({});
  });

  it('does not read a Story document just because --story was given', async () => {
    // No Story STORY-404 exists: a workflow that needs neither ownerRole nor a claim never asks.
    const { context } = await build('plain', { story: 'STORY-404' });
    expect(context['storyId']).toBe('STORY-404');
  });
});

describe('--input', () => {
  beforeEach(async () => {
    await workflow(
      'typed',
      `inputs:
  - { name: count, type: integer, required: true }
  - { name: ratio, type: number, required: false }
  - { name: dry, type: boolean, required: false }
  - { name: label, type: string, required: true }
steps:
  - id: a
    kind: command
    run: "echo {{label}} {{count}}"
    inline: true
`,
    );
  });

  it('lands each value at the context root, typed by the declared input type', async () => {
    const { context } = await build('typed', {
      inputs: ['count=3', 'ratio=0.5', 'dry=true', 'label=007', 'extra=undeclared'],
    });
    expect(context).toEqual({ count: 3, ratio: 0.5, dry: true, label: '007', extra: 'undeclared' });
  });

  it('refuses a value the declared type does not accept (RUN-088), before anything runs', async () => {
    const error = await refusal(build('typed', { inputs: ['count=3.5', 'label=x'] }));
    expect(error.code).toBe('RUN-088');
    expect(error.message).toContain('whole number');
  });

  it('names every missing required input at once, with the flag that supplies them (RUN-089)', async () => {
    const error = await refusal(build('typed', {}));
    expect(error.code).toBe('RUN-089');
    expect(error.message).toContain('count, label');
    expect(error.remedy).toContain('--input <name>=<value>');
    expect(error.exitCode).toBe(2);
  });

  it('is independent of the order --input was given in (deterministic key order)', async () => {
    const a = await build('typed', { inputs: ['count=3', 'label=x', 'zeta=1', 'alpha=2'] });
    const b = await build('typed', { inputs: ['alpha=2', 'zeta=1', 'label=x', 'count=3'] });
    expect(JSON.stringify(a.context)).toBe(JSON.stringify(b.context));
  });

  it('building twice gives the identical context', async () => {
    const flags = { inputs: ['count=3', 'label=x'] };
    expect(JSON.stringify((await build('typed', flags)).context)).toBe(
      JSON.stringify((await build('typed', flags)).context),
    );
  });

  it('refuses an empty --stage or --story instead of treating it as a stage named ""', async () => {
    await workflow(
      'needs-stage',
      `inputs:
  - { name: stageId, type: string, required: true }
steps:
  - id: a
    kind: command
    run: "echo {{stageId}}"
    inline: true
`,
    );
    for (const flags of [{ stage: '' }, { stage: '  ' }, { story: '' }]) {
      const error = await refusal(build('needs-stage', flags));
      expect(error.code).toBe('RUN-088');
      expect(error.message).toContain('needs a value');
    }
  });

  it('refuses --stage and --input stageId that disagree, accepts them when they agree', async () => {
    await workflow(
      'staged',
      `inputs:
  - { name: stageId, type: string, required: true }
steps:
  - id: a
    kind: command
    run: "echo {{stageId}}"
    inline: true
`,
    );
    const error = await refusal(build('staged', { stage: 'A', inputs: ['stageId=B'] }));
    expect(error.code).toBe('RUN-088');
    expect(error.message).toContain('disagree');
    expect((await build('staged', { stage: 'A', inputs: ['stageId=A'] })).context['stageId']).toBe(
      'A',
    );
  });
});

describe('build-stage (the shipped workflow)', () => {
  beforeEach(async () => {
    await epic(1, 'STAGE-1', ['STORY-001', 'STORY-002', 'STORY-003']);
    await story(1, 1);
    await story(2, 1, { depends_on: ['STORY-001'], owner_role: 'frontend' });
    await story(3, 1, { status: 'done' });
  });

  it('builds stageId, vars.integration_branch and the ordered, undelivered stories from the documents', async () => {
    const { context, warnings } = await build('build-stage', { stage: 'STAGE-1', epic: 'E-7' });
    expect(context['stageId']).toBe('STAGE-1');
    expect(context.vars).toEqual({
      epic: 'E-7',
      integration_branch: 'forge/integration/STAGE-1',
    });
    expect(context.stage).toEqual({
      id: 'STAGE-1',
      stories: [
        {
          id: 'STORY-001',
          owner_role: 'backend',
          depends_on: [],
          files_expected: ['src/s1/**', 'tests/s1/**'],
          test_paths: ['tests/s1/**'],
          runs_after: [],
        },
        {
          id: 'STORY-002',
          owner_role: 'frontend',
          depends_on: ['STORY-001'],
          files_expected: ['src/s2/**', 'tests/s2/**'],
          test_paths: ['tests/s2/**'],
          runs_after: ['STORY-001'],
        },
      ],
    });
    // The delivered story is not scheduled; that is worth a line, not a refusal.
    expect(warnings.join('\n')).toContain('STORY-003');
    expect(warnings.join('\n')).toContain('story-already-delivered');
  });

  it('is the same context `forge plan run-plan` plans: byte-identical on every build, whatever order files were read in', async () => {
    const a = JSON.stringify((await build('build-stage', { stage: 'STAGE-1' })).context);
    const b = JSON.stringify((await build('build-stage', { inputs: ['stageId=STAGE-1'] })).context);
    expect(a).toBe(b);
  });

  it('refuses a stage no Epic declares with RUN-082', async () => {
    const error = await refusal(build('build-stage', { stage: 'NOPE' }));
    expect(error.code).toBe('RUN-082');
  });

  it('refuses a missing stageId naming it and both ways to supply it (RUN-089)', async () => {
    const error = await refusal(build('build-stage', {}));
    expect(error.code).toBe('RUN-089');
    expect(error.message).toContain('stageId');
    expect(error.remedy).toContain('--stage <id>');
    expect(error.remedy).toContain('--input stageId=');
  });

  it('refuses inconsistent stage documents (RUN-090), listing the first five findings and counting the rest', async () => {
    await epic(2, 'BROKEN', ['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6', 'S-7']);
    const error = await refusal(build('build-stage', { stage: 'BROKEN' }));
    expect(error.code).toBe('RUN-090');
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('story-missing');
    expect(error.message).toContain('and 2 more');
    expect(error.remedy).toContain('forge plan run-plan');
  });

  it('does not require the stage’s documents for a workflow that only names the stage id (plan-stage writes them)', async () => {
    const { context } = await build('plan-stage', { stage: 'BRAND-NEW' });
    expect(context['stageId']).toBe('BRAND-NEW');
    expect(context.stage).toBe('BRAND-NEW');
  });
});

describe('implement-story (the shipped workflow)', () => {
  beforeEach(async () => {
    await epic(1, 'STAGE-1', ['STORY-001']);
    await story(1, 1, { owner_role: 'frontend' });
  });

  it('reads ownerRole and the claim (run.filesExpected, run.testPaths) from the Story document', async () => {
    const { context } = await build('implement-story', { story: 'STORY-001' });
    expect(context['storyId']).toBe('STORY-001');
    expect(context['ownerRole']).toBe('frontend');
    expect(context.run).toEqual({
      filesExpected: ['src/s1/**', 'tests/s1/**'],
      testPaths: ['tests/s1/**'],
    });
  });

  it('refuses an --input ownerRole that disagrees with the Story document (the Story decides), accepts one that agrees', async () => {
    const error = await refusal(
      build('implement-story', { story: 'STORY-001', inputs: ['ownerRole=security'] }),
    );
    expect(error.code).toBe('RUN-088');
    expect(error.message).toContain('owner_role');
    expect(error.message).toContain('frontend');
    const same = await build('implement-story', {
      story: 'STORY-001',
      inputs: ['ownerRole=frontend'],
    });
    expect(same.context['ownerRole']).toBe('frontend');
  });

  it('refuses a story owned by sdet or reviewer: the tests or the review and the implementation would share one role (RUN-091)', async () => {
    await story(3, 1, { owner_role: 'sdet' });
    const error = await refusal(build('implement-story', { story: 'STORY-003' }));
    expect(error.code).toBe('RUN-091');
    expect(error.message).toContain('sdet');
    expect(error.message).toContain('implement-story:red');
    expect(error.message).toContain('implement-story:green');
    await story(4, 1, { owner_role: 'Reviewer ' });
    expect((await refusal(build('implement-story', { story: 'STORY-004' }))).code).toBe('RUN-091');
  });

  it('refuses an unknown story with SPEC-024 and a Story with no owner role with SPEC-025', async () => {
    expect((await refusal(build('implement-story', { story: 'STORY-404' }))).code).toBe('SPEC-024');
    await story(2, 1, { owner_role: '' });
    expect((await refusal(build('implement-story', { story: 'STORY-002' }))).code).toBe('SPEC-025');
  });

  it('without --story, names storyId and ownerRole', async () => {
    const error = await refusal(build('implement-story', {}));
    expect(error.code).toBe('RUN-089');
    expect(error.message).toContain('storyId, ownerRole');
  });
});

describe('a workflow that still cannot compile', () => {
  it('names an undeclared placeholder it reads at the root of the context (RUN-089), not the compiler’s issue list', async () => {
    await workflow(
      'reads-mystery',
      'steps:\n  - id: a\n    kind: command\n    run: "echo {{mystery}}"\n    inline: true\n',
    );
    const error = await refusal(build('reads-mystery', {}));
    expect(error.code).toBe('RUN-089');
    expect(error.message).toContain('mystery');
    expect(error.message).not.toContain('template-resolution-failed');
    expect((await build('reads-mystery', { inputs: ['mystery=x'] })).context['mystery']).toBe('x');
  });

  it('leaves a compile failure that is not a missing input to the run’s own report', async () => {
    await workflow(
      'reads-run',
      'steps:\n  - id: a\n    kind: command\n    run: "echo {{run.nothing}}"\n    inline: true\n',
    );
    // `run.*` is not a run input: the context is returned and `runEngine`/`--dry-run` say what is wrong.
    await expect(build('reads-run', {})).resolves.toBeDefined();
  });

  it('gives an unparseable workflow the plain context, so the run’s own RUN-045 explains it', async () => {
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, 'broken.workflow.yaml'),
      'id: broken\nsteps: [\n',
    );
    const { context } = await build('broken', { stage: 'S' });
    expect(context).toEqual({ stage: 'S' });
  });

  it('refuses an unknown workflow with RUN-053', async () => {
    expect((await refusal(build('no-such-workflow', {}))).code).toBe('RUN-053');
  });
});

describe('a stage the run must not start on', () => {
  it('refuses a blocked story, and a story waiting on an undelivered story of another stage (they would be scheduled and run)', async () => {
    await epic(1, 'BLK', ['STORY-001', 'STORY-002']);
    await story(1, 1, { status: 'blocked', blocked_by: ['STORY-999'] });
    await story(2, 1);
    const error = await refusal(build('build-stage', { stage: 'BLK' }));
    expect(error.code).toBe('RUN-090');
    expect(error.message).toContain('story-blocked');
    await story(1, 1);
    await epic(2, 'OTHER', ['STORY-050']);
    await story(50, 2);
    await story(2, 1, { depends_on: ['STORY-050'] });
    const waiting = await refusal(build('build-stage', { stage: 'BLK' }));
    expect(waiting.code).toBe('RUN-090');
    expect(waiting.message).toContain('dependency-outside-stage');
  });

  it('refuses a stage with no story left to build, an empty one and one whose stories are all delivered', async () => {
    await epic(1, 'EMPTY', []);
    const empty = await refusal(build('build-stage', { stage: 'EMPTY' }));
    expect(empty.code).toBe('RUN-090');
    expect(empty.message).toContain('no story');
    await epic(2, 'DONE', ['STORY-001']);
    await story(1, 2, { status: 'done' });
    const delivered = await refusal(build('build-stage', { stage: 'DONE' }));
    expect(delivered.code).toBe('RUN-090');
    expect(delivered.message).toContain('story-already-delivered');
    expect(delivered.message).toContain('no-story-to-build');
  });
});

describe('a run orders the stage’s stories as `forge plan run-plan` does', () => {
  const edges = (nodes: readonly { id: string; dependsOn: readonly string[] }[]) =>
    Object.fromEntries(nodes.map((n) => [n.id, [...n.dependsOn].sort()]));

  it('builds the same step graph the plan reports, for overlapping claims, a dependency on a higher id and independent stories', async () => {
    await epic(1, 'MIX', ['STORY-001', 'STORY-002', 'STORY-003', 'STORY-004', 'STORY-005']);
    await story(1, 1, { depends_on: ['STORY-005'], files_expected: ['a/**'] });
    await story(2, 1, { files_expected: ['src/auth'] });
    await story(3, 1, { files_expected: ['src/auth/login.ts'] });
    await story(4, 1, { files_expected: ['b/**'] });
    await story(5, 1, { files_expected: ['c/**'] });
    const { context } = await build('build-stage', { stage: 'MIX' });
    const parsed = parseWorkflow(
      await readFile(path.join(project.dir, WORKFLOWS_ROOT, 'build-stage.workflow.yaml'), 'utf8'),
    );
    if (!parsed.success) throw new Error('build-stage does not parse');
    const run = compileRunPlan(parsed.workflow, context);
    if (!run.success) throw new Error(JSON.stringify(run.issues));
    const report = await planRunPlan(
      { paths: project.paths, workflowsRoot: WORKFLOWS_ROOT, specsRoot: SPECS_ROOT },
      'MIX',
    );
    expect(report.stepPlan).toBe('compiled');
    expect(edges(run.nodes)).toEqual(edges(report.nodes));
    /** Some step of `story` waits, directly, for the review of `other`. */
    const waitsFor = (story: string, other: string): boolean =>
      run.nodes
        .filter((n) => n.id.endsWith(`:${story}`))
        .some((n) => n.dependsOn.includes(`build-stage:review:${other}`));
    // 001 depends on 005 (a higher id): the dependency comes first.
    expect(waitsFor('STORY-001', 'STORY-005')).toBe(true);
    // 002 and 003 claim src/auth and src/auth/login.ts: the lower id goes first, in the run as in the plan.
    expect(waitsFor('STORY-003', 'STORY-002')).toBe(true);
    // independent stories are not ordered against each other.
    expect(waitsFor('STORY-004', 'STORY-005')).toBe(false);
    expect(waitsFor('STORY-005', 'STORY-004')).toBe(false);
  });
});

describe('inputs that reach a shell command', () => {
  it.each([
    ['x; touch /tmp/pwned'],
    ['$(id)'],
    ['a b'],
    ['`id`'],
    ['--help'],
    ['a&&b'],
    ['a|b'],
    ['a\nb'],
  ])(
    'refuses --stage %j: plan-stage and build-stage put the stage id into a shell string',
    async (value) => {
      for (const id of ['plan-stage', 'build-stage']) {
        const error = await refusal(build(id, { stage: value }));
        expect(error.code).toBe('RUN-088');
        expect(error.message).toContain('shell command');
      }
    },
  );

  it('refuses the same values through --input and --story, for every input a command step reads (storyId, a custom target)', async () => {
    // `implement-story` runs `forge story verify {{storyId}} --json`: the story id is refused before it is looked up.
    const story = await refusal(build('implement-story', { story: 'x;y' }));
    expect(story.code).toBe('RUN-088');
    expect(story.message).toContain('shell command');
    await workflow(
      'shelled',
      `inputs:
  - { name: target, type: string, required: true }
steps:
  - id: a
    kind: command
    run: "pnpm test -- {{target}}"
    inline: true
`,
    );
    expect((await refusal(build('shelled', { inputs: ['target=$(id)'] }))).code).toBe('RUN-088');
    expect((await build('shelled', { inputs: ['target=test/a.test.ts'] })).context['target']).toBe(
      'test/a.test.ts',
    );
    // `defectId` is only read by an `inputs:` reference, never by a shell string, so it is not restricted.
    expect(
      (await build('quick-fix', { inputs: ['defectId=free text (ok)'] })).context['defectId'],
    ).toBe('free text (ok)');
  });

  it('accepts ordinary ids and does not restrict free-text inputs that never reach a shell (goal)', async () => {
    expect((await build('plan-stage', { stage: 'stage-1.a/b_c:d@e+f,g' })).context['stageId']).toBe(
      'stage-1.a/b_c:d@e+f,g',
    );
    expect(
      (await build('refactor', { inputs: ['goal=Split the billing module; then rename (safely)'] }))
        .context['goal'],
    ).toBe('Split the billing module; then rename (safely)');
  });
});

describe('inputs and comments', () => {
  it('a placeholder that only appears in a YAML comment is not something the workflow reads', async () => {
    await workflow(
      'commented',
      `# old: {{oldInput}} and {{run.filesExpected}}
steps:
  - id: a
    kind: command
    run: "true"
    inline: true
    dependsOn: [nope]
`,
    );
    // The compile error is the dangling dependency: RUN-089 must not blame `oldInput`, and a comment must not
    // send the builder off to read a Story it never needed.
    const { context } = await build('commented', { story: 'STORY-404' });
    expect(context['storyId']).toBe('STORY-404');
  });

  it('warns about an --input the workflow neither declares nor reads (a typo), and still accepts it', async () => {
    await workflow(
      'typo',
      `inputs:
  - { name: goal, type: string, required: true }
steps:
  - id: a
    kind: command
    run: "echo {{goal}}"
    inline: true
`,
    );
    const { context, warnings } = await build('typo', { inputs: ['goal=x', 'gaol=y'] });
    expect(context['gaol']).toBe('y');
    expect(warnings).toEqual([
      '--input gaol is not declared by workflow typo and nothing in it reads {{gaol}}, so it is ignored.',
    ]);
  });

  it('judges a malformed --input before it judges the workflow (a broken workflow still refuses the pair)', async () => {
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, 'broken2.workflow.yaml'),
      'id: broken2\nsteps: [\n',
    );
    expect((await refusal(build('broken2', { inputs: ['garbage'] }))).code).toBe('RUN-088');
  });

  it('refuses an empty --epic like an empty --stage', async () => {
    await workflow(
      'plain2',
      'steps:\n  - id: a\n    kind: command\n    run: "true"\n    inline: true\n',
    );
    expect((await refusal(build('plain2', { epic: ' ' }))).code).toBe('RUN-088');
  });
});

describe('round-2 refusals', () => {
  it('refuses --stage, --epic and --story values a command step reads through {{stage}}, {{vars.epic}} and {{vars.story}}', async () => {
    await workflow(
      'flags-in-shell',
      'steps:\n  - id: a\n    kind: command\n    run: "echo {{stage}} {{vars.epic}} {{vars.story}}"\n    inline: true\n',
    );
    for (const flags of [{ stage: 'x; touch p' }, { epic: 'a$(id)' }, { story: 'b c' }]) {
      const error = await refusal(build('flags-in-shell', flags));
      expect(error.code).toBe('RUN-088');
      expect(error.message).toContain('shell command');
    }
    expect(
      (await build('flags-in-shell', { stage: 'ok-1', epic: 'E.1', story: 'S/2' })).context,
    ).toMatchObject({
      stage: 'ok-1',
    });
    // The same values are fine where no command reads them.
    await workflow(
      'flags-elsewhere',
      'steps:\n  - id: a\n    kind: command\n    run: "true"\n    inline: true\n',
    );
    await expect(build('flags-elsewhere', { stage: 'x; y', epic: 'a b' })).resolves.toBeDefined();
  });

  it('refuses a command step under onFailure.escalations that reads an unsafe input', async () => {
    await workflow(
      'escalating',
      `inputs:
  - { name: who, type: string, required: true }
onFailure:
  default: escalate
  escalations:
    - when: "failure.class == 'x'"
      do: { id: notify, kind: command, run: "notify {{who}}", inline: true }
steps:
  - id: a
    kind: command
    run: "true"
    inline: true
`,
    );
    expect((await refusal(build('escalating', { inputs: ['who=a;b'] }))).code).toBe('RUN-088');
  });

  it('refuses a stage-reading workflow whose plan does not compile to per-story steps (its ordering would silently not apply)', async () => {
    await epic(1, 'S1', ['STORY-001', 'STORY-002']);
    await story(1, 1);
    await story(2, 1, { depends_on: ['STORY-001'] });
    await workflow(
      'unkeyed',
      `steps:
  - id: implement
    kind: fanout
    over: 'stage.stories'
    step:
      kind: command
      run: "true"
      inline: true
`,
    );
    const error = await refusal(build('unkeyed', { stage: 'S1' }));
    expect(error.code).toBe('RUN-090');
    expect(error.message).toContain('step-plan-unavailable');
  });

  it.each([
    ['blocked', { status: 'blocked', blocked_by: ['STORY-999'] }, 'blocked by STORY-999'],
    ['delivered', { status: 'done' }, 'already done'],
    ['verified', { status: 'verified' }, 'already verified'],
    ['a blocked_by entry', { blocked_by: ['STORY-998'] }, 'blocked by STORY-998'],
  ])('refuses implement-story for a %s Story (RUN-092)', async (_name, overrides, state) => {
    await epic(1, 'S1', ['STORY-001']);
    await story(1, 1, overrides);
    const error = await refusal(build('implement-story', { story: 'STORY-001' }));
    expect(error.code).toBe('RUN-092');
    expect(error.message).toContain(state);
  });

  it('derives ownerRole for a workflow that reads {{ownerRole}} without declaring it (the loop fixture shape)', async () => {
    await epic(1, 'S1', ['STORY-001']);
    await story(1, 1, { owner_role: 'frontend' });
    await workflow(
      'undeclared-owner',
      'steps:\n  - id: a\n    kind: agent\n    agent: "{{ownerRole}}"\n    brief: b.md\n',
    );
    expect((await build('undeclared-owner', { story: 'STORY-001' })).context['ownerRole']).toBe(
      'frontend',
    );
  });

  it('refuses hostile text as one clean line (no newline, CR, bidi control or escape survives)', async () => {
    await workflow(
      'plain3',
      'steps:\n  - id: a\n    kind: command\n    run: "true"\n    inline: true\n',
    );
    const error = await refusal(build('plain3', { inputs: ['evil\nforge: ok\rX\u202EY'] }));
    expect(error.code).toBe('RUN-088');
    expect(error.message).toContain('evil');
    expect(error.message).not.toMatch(/[\n\r\u202E]/u);
  });
});

describe('what reaches a shell, followed all the way', () => {
  it('follows vars that read vars, so a chained var still restricts the input it is built from', async () => {
    await workflow(
      'chained',
      `inputs:
  - { name: goal, type: string, required: true }
vars:
  a: '{{vars.b}}'
  b: 'x-{{goal}}'
steps:
  - id: s
    kind: command
    run: "echo {{vars.a}}"
    inline: true
`,
    );
    expect((await refusal(build('chained', { inputs: ['goal=x;touch p'] }))).code).toBe('RUN-088');
    expect((await build('chained', { inputs: ['goal=fine-1'] })).context['goal']).toBe('fine-1');
  });

  it('leaves free text alone when the var it feeds is only read by an agent', async () => {
    await workflow(
      'agent-var',
      `inputs:
  - { name: goal, type: string, required: true }
vars:
  note: 'x-{{goal}}'
steps:
  - id: s
    kind: command
    run: "true"
    inline: true
  - id: t
    kind: agent
    agent: pm
    brief: "{{vars.note}}"
`,
    );
    expect((await build('agent-var', { inputs: ['goal=free text; ok'] })).context['goal']).toBe(
      'free text; ok',
    );
  });

  it('checks a command in onComplete and inside a group, and an ownerRole derived from the Story', async () => {
    await workflow(
      'nested-shell',
      `inputs:
  - { name: a, type: string, required: true }
  - { name: b, type: string, required: true }
steps:
  - id: grp
    kind: parallel
    steps:
      - id: g
        kind: command
        run: "echo {{a}}"
        inline: true
onComplete:
  - id: done
    kind: command
    run: "echo {{b}}"
    inline: true
`,
    );
    expect((await refusal(build('nested-shell', { inputs: ['a=x y', 'b=ok'] }))).code).toBe(
      'RUN-088',
    );
    expect((await refusal(build('nested-shell', { inputs: ['a=ok', 'b=$(id)'] }))).code).toBe(
      'RUN-088',
    );
    await epic(1, 'S1', ['STORY-001']);
    await story(1, 1, { owner_role: 'x;y' });
    await workflow(
      'owner-in-shell',
      `inputs:
  - { name: storyId, type: string, required: true }
steps:
  - id: s
    kind: command
    run: "echo {{ownerRole}}"
    inline: true
`,
    );
    const error = await refusal(build('owner-in-shell', { story: 'STORY-001' }));
    expect(error.code).toBe('RUN-088');
    expect(error.message).toContain('ownerRole');
  });
});

describe('config.paths.release (PLAN-M14.md P12, SPEC-QUESTIONS.md Q216 / Q232 decision 4)', () => {
  beforeEach(async () => {
    await workflow(
      'reads-release',
      `inputs:
  - { name: buildTarget, type: string, required: true }
steps:
  - id: a
    kind: agent
    agent: mobile
    brief: b.md
    produces:
      - 'test/device-matrix/**'
      - '{{config.paths.release}}'
`,
    );
    await workflow(
      'no-release-ref',
      'steps:\n  - id: a\n    kind: command\n    run: "true"\n    inline: true\n',
    );
    // The real shipped file, for "the real shipped store-release workflow" below — not one of the 20
    // `WORKFLOW_INDEX` ids the outer `beforeEach` already copied.
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, 'store-release.workflow.yaml'),
      await readFile(STORE_RELEASE_SOURCE, 'utf8'),
    );
  });

  it('is absent from the context (and nothing else of config is exposed) when paths.release is empty and the workflow never reads it', async () => {
    const { context } = await build('no-release-ref', {});
    expect(Object.hasOwn(context, 'config')).toBe(false);
  });

  it('refuses with RUN-106, naming the key and the forge config set remedy, before compileRunPlan runs', async () => {
    const error = await refusal(build('reads-release', { inputs: ['buildTarget=ios'] }));
    expect(error.code).toBe('RUN-106');
    expect(error.message).toContain('config.paths.release');
    expect(error.message).toContain('reads-release');
    expect(error.remedy).toContain('forge config set paths.release');
    expect(error.exitCode).toBe(2);
  });

  it('does not refuse a workflow that never reads config.paths.release, whatever paths.release is', async () => {
    const { context } = await build('no-release-ref', {});
    expect(context.config).toBeUndefined();
  });

  it('is present, and exposes exactly {paths: {release}} and nothing else of the config object, once set', async () => {
    const deps = {
      ...testRunDeps(project),
      config: {
        ...project.config,
        paths: { ...project.config.paths, release: ['apps/mobile/**', 'app.json'] },
      },
    };
    const { context } = await buildRunExpressionContext(
      deps,
      'reads-release',
      { inputs: ['buildTarget=ios'] },
      SPECS_ROOT,
    );
    expect(context.config).toEqual({ paths: { release: ['apps/mobile/**', 'app.json'] } });
    // Nothing else of the real `ForgeConfig` (project name, secrets config, ...) crosses into the
    // expression language: `config` carries exactly `paths.release`, never the whole config object.
    expect(Object.keys(context.config as object)).toEqual(['paths']);
    expect(Object.keys((context.config as { paths: object }).paths)).toEqual(['release']);
  });

  it('compiles the claim: test/device-matrix/** plus one entry per configured path, once set', async () => {
    const deps = {
      ...testRunDeps(project),
      config: {
        ...project.config,
        paths: { ...project.config.paths, release: ['apps/mobile/**', 'app.json'] },
      },
    };
    const { context } = await buildRunExpressionContext(
      deps,
      'reads-release',
      { inputs: ['buildTarget=ios'] },
      SPECS_ROOT,
    );
    const source = await readFile(
      path.join(project.dir, WORKFLOWS_ROOT, 'reads-release.workflow.yaml'),
      'utf8',
    );
    const parsed = parseWorkflow(source);
    if (!parsed.success) throw new Error('reads-release does not parse');
    const compiled = compileRunPlan(parsed.workflow, context);
    if (!compiled.success) throw new Error(JSON.stringify(compiled.issues));
    const step = compiled.nodes.find((n) => n.id === 'reads-release:a');
    expect(step?.produces).toEqual(['test/device-matrix/**', 'apps/mobile/**', 'app.json']);
  });

  describe('the real shipped store-release workflow', () => {
    it('refuses with RUN-106 when paths.release is unset (the default project has an empty list)', async () => {
      const error = await refusal(build('store-release', { inputs: ['buildTarget=ios'] }));
      expect(error.code).toBe('RUN-106');
    });

    it('compiles once paths.release is set, splicing the configured entries into the claim', async () => {
      const deps = {
        ...testRunDeps(project),
        config: {
          ...project.config,
          paths: { ...project.config.paths, release: ['apps/mobile/**', 'app.json'] },
        },
      };
      const { context } = await buildRunExpressionContext(
        deps,
        'store-release',
        { inputs: ['buildTarget=ios'] },
        SPECS_ROOT,
      );
      const source = await readFile(
        path.join(project.dir, WORKFLOWS_ROOT, 'store-release.workflow.yaml'),
        'utf8',
      );
      const parsed = parseWorkflow(source);
      if (!parsed.success) throw new Error('store-release does not parse');
      const compiled = compileRunPlan(parsed.workflow, context);
      if (!compiled.success) throw new Error(JSON.stringify(compiled.issues));
      const step = compiled.nodes.find((n) => n.id === 'store-release:prepare-release-build');
      expect(step?.produces).toEqual(['test/device-matrix/**', 'apps/mobile/**', 'app.json']);
    });
  });
});
