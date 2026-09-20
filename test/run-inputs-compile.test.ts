/**
 * Every shipped workflow, planned by `forge run <workflow> [flags] --dry-run` through the real launcher
 * (`PLAN-M13.md` P21, `03` §3.2.4, `10` §10.1, `SPEC-QUESTIONS.md` Q218).
 *
 * Before P21 the context `forge run` built was `{stage: '<id>', vars: {epic, story}}`, and five of the twenty
 * shipped workflows could not compile against it (`plan-stage`, `build-stage`, `implement-story`, `quick-fix`,
 * `debug`: `stageId`, `ownerRole`, `defectId` and `vars.integration_branch` had no way to be supplied, and
 * `build-stage`'s fanouts need `stage.stories`). Nothing exercised the CLI's own context against the shipped
 * workflows: the engine tests hand-build their contexts, which is how the gap survived. So this drives the real
 * command, in a real (git) project holding the real workflow files and real Epic and Story documents, with the
 * flags a user would pass, and asserts which compile.
 *
 * Lives at the repository root because it needs `@forge/templates`, the modules and `@forge/cli` together.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.1
 * @see PLAN-M13.md P21
 */
import { mkdir, mkdtemp, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import * as YAML from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@forge/schemas/config';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = path.join(repoRoot, 'packages/cli/bin/forge.mjs');
const TEMPLATE_WORKFLOWS = path.join(repoRoot, 'packages/templates/templates/workflows');

interface Outcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

let dir = '';

async function forge(args: readonly string[]): Promise<Outcome> {
  const result = await execa(process.execPath, [LAUNCHER, ...args, '-C', dir], {
    reject: false,
    timeout: 120_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

interface Plan {
  readonly success: boolean;
  readonly nodes: readonly {
    readonly id: string;
    readonly kind: string;
    readonly run?: string;
    readonly agent?: string;
    readonly produces?: readonly string[];
    readonly dependsOn: readonly string[];
    readonly runInputs?: Readonly<Record<string, unknown>>;
    readonly missingRunInputs?: readonly string[];
  }[];
}

async function dryRun(workflow: string, flags: readonly string[]): Promise<Plan> {
  const result = await forge(['run', workflow, ...flags, '--dry-run', '--json']);
  expect(
    result.status,
    `${workflow} exit code; stderr: ${result.stderr}; stdout: ${result.stdout.slice(0, 1500)}`,
  ).toBe(0);
  // Warnings about the stage's documents are allowed (an overlap that is serialised); anything else is not.
  const unexpected = result.stderr
    .split('\n')
    .filter((l) => l !== '' && !l.startsWith('forge: warning: '));
  expect(unexpected, `${workflow} stderr`).toEqual([]);
  return (JSON.parse(result.stdout) as { plan: Plan }).plan;
}

interface Envelope {
  readonly v: number;
  readonly ok: boolean;
  readonly error: { code: string; message: string; remedy: string; exitCode: number };
}

const BASE = {
  schemaVersion: 1,
  created: '2026-01-01',
  updated: '2026-01-01',
  revision: 1,
  author: 'po',
  changelog: [],
};

async function writeDoc(rel: string, frontMatter: Record<string, unknown>): Promise<void> {
  const file = path.join(dir, 'docs/forge/specs', rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\n${YAML.stringify(frontMatter)}---\n\nBody.\n`, 'utf8');
}

async function writeEpic(n: number, stage: string, stories: readonly string[]): Promise<void> {
  const id = `EPIC-${String(n).padStart(3, '0')}`;
  await writeDoc(`epics/${id}.md`, {
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
  });
}

async function writeStory(
  n: number,
  epicN: number,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const id = `STORY-${String(n).padStart(3, '0')}`;
  await writeDoc(`stories/${id}.md`, {
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
    files_expected: [`src/s${String(n)}/**`],
    context_refs: [],
    acceptance: [],
    tests: [],
    dod_profile: 'backend-default',
    ...overrides,
  });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'forge-p21-'));
  const git = (...args: string[]): Promise<unknown> => execa('git', args, { cwd: dir });
  await git('init', '--quiet', '-b', 'main');
  await git('config', 'user.email', 'fixture@example.com');
  await git('config', 'user.name', 'Fixture');
  await mkdir(path.join(dir, '.forge/workflows'), { recursive: true });
  await mkdir(path.join(dir, '.forge/checks'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG));
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n');
  for (const file of await shippedWorkflowFiles()) {
    await copyFile(file, path.join(dir, '.forge/workflows', path.basename(file)));
  }
  // Stage STAGE-1: 002 depends on 001. Stage LOOP: two stories that depend on each other.
  await writeEpic(1, 'STAGE-1', ['STORY-001', 'STORY-002']);
  await writeStory(1, 1);
  await writeStory(2, 1, { depends_on: ['STORY-001'], owner_role: 'frontend' });
  await writeEpic(2, 'LOOP', ['STORY-010', 'STORY-011']);
  await writeStory(10, 2, { depends_on: ['STORY-011'] });
  await writeStory(11, 2, { depends_on: ['STORY-010'] });
  // Stage OV: overlapping claims `globsOverlap` cannot see, with no declared dependency between them.
  await writeEpic(3, 'OV', ['STORY-020', 'STORY-021']);
  await writeStory(20, 3, { files_expected: ['src/auth'] });
  await writeStory(21, 3, { files_expected: ['src/auth/login.ts'] });
  // Stage ORD: the dependency has the higher id.
  await writeEpic(4, 'ORD', ['STORY-030', 'STORY-031']);
  await writeStory(30, 4, { depends_on: ['STORY-031'] });
  await writeStory(31, 4);
  // Stages a run must refuse: a blocked story, no story at all, every story delivered.
  await writeEpic(5, 'BLK', ['STORY-040']);
  await writeStory(40, 5, { status: 'blocked', blocked_by: ['STORY-999'] });
  await writeEpic(6, 'EMPTY', []);
  await writeEpic(7, 'DONE', ['STORY-050']);
  await writeStory(50, 7, { status: 'done' });
  // A story whose owner is the test writer.
  await writeEpic(8, 'SEP', ['STORY-060']);
  await writeStory(60, 8, { owner_role: 'sdet' });
  await git('add', '-A');
  await git('commit', '--quiet', '-m', 'fixture');
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function shippedWorkflowFiles(): Promise<readonly string[]> {
  const files: string[] = [];
  for (const name of (await readdir(TEMPLATE_WORKFLOWS)).sort()) {
    if (name.endsWith('.workflow.yaml')) files.push(path.join(TEMPLATE_WORKFLOWS, name));
  }
  for (const module of (await readdir(path.join(repoRoot, 'modules'))).sort()) {
    const workflows = path.join(repoRoot, 'modules', module, 'workflows');
    let names: string[] = [];
    try {
      names = await readdir(workflows);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (name.endsWith('.workflow.yaml')) files.push(path.join(workflows, name));
    }
  }
  return files;
}

const workflowId = (file: string): string => path.basename(file).replace('.workflow.yaml', '');

/** The flags a user would reasonably pass for each shipped workflow, and the inputs it needs when they pass
 * none. A workflow added to the repository must be added here, on purpose: the test below fails until it is. */
const RUNS: Readonly<
  Record<string, { readonly flags: readonly string[]; readonly needs?: readonly string[] }>
> = {
  adopt: { flags: [] },
  'build-stage': { flags: ['--stage', 'STAGE-1'], needs: ['stageId'] },
  'contract-test-cycle': { flags: ['--input', 'interfaceName=Billing'], needs: ['interfaceName'] },
  debug: { flags: ['--input', 'defectId=DEF-001'], needs: ['defectId'] },
  'define-product': { flags: [] },
  'deliver-stage': { flags: ['--stage', 'STAGE-1'] },
  discover: { flags: [] },
  harden: { flags: ['--stage', 'STAGE-1'] },
  'implement-story': { flags: ['--story', 'STORY-001'], needs: ['storyId', 'ownerRole'] },
  'initialize-project': { flags: [] },
  intake: { flags: [] },
  migrate: { flags: ['--input', 'migrationGoal=Move to v2'], needs: ['migrationGoal'] },
  operate: { flags: [] },
  'plan-stage': { flags: ['--stage', 'STAGE-1'], needs: ['stageId'] },
  'plan-stages': { flags: [] },
  'quick-fix': { flags: ['--input', 'defectId=DEF-001'], needs: ['defectId'] },
  refactor: { flags: ['--input', 'goal=Simplify billing'], needs: ['goal'] },
  replan: { flags: ['--input', 'changeSummary=Scope cut'], needs: ['changeSummary'] },
  retro: { flags: ['--stage', 'STAGE-1'] },
  'shape-solution': { flags: [] },
  'store-release': { flags: ['--input', 'buildTarget=ios'], needs: ['buildTarget'] },
  'verify-stage': { flags: ['--stage', 'STAGE-1'] },
};

describe('every shipped workflow compiles under the context `forge run` builds', () => {
  it('the table names exactly the workflows that ship (a new one must be decided here)', async () => {
    const shipped = (await shippedWorkflowFiles()).map(workflowId).sort();
    expect(Object.keys(RUNS).sort()).toEqual(shipped);
    expect(shipped).toHaveLength(22);
  });

  it.each(Object.entries(RUNS))(
    '%s plans with its flags',
    async (id, run) => {
      const plan = await dryRun(id, run.flags);
      expect(plan.success).toBe(true);
      expect(plan.nodes.length).toBeGreaterThan(0);
    },
    120_000,
  );

  const needing = Object.entries(RUNS).filter(([, run]) => run.needs !== undefined);

  const standalone = Object.entries(RUNS).filter(([, run]) => run.needs === undefined);

  it.each(standalone)(
    '%s needs no input at all: it plans with no flags (docs/getting-started.md says so)',
    async (id) => {
      expect((await dryRun(id, [])).success).toBe(true);
    },
    120_000,
  );

  it.each(needing)(
    '%s without its inputs is refused, naming them and the flag that supplies them',
    async (id, run) => {
      const result = await forge(['run', id, '--dry-run']);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      for (const name of run.needs ?? []) expect(result.stderr).toContain(name);
      expect(result.stderr).toContain('--input');
      expect(result.stderr).not.toContain('template-resolution-failed');
      expect(result.stderr).not.toMatch(/\n\s+at /u);
    },
    120_000,
  );
});

describe('what the flags put in the context', () => {
  it('--stage also sets stageId: plan-stage runs `forge plan run-plan <stage>` for the named stage', async () => {
    const plan = await dryRun('plan-stage', ['--stage', 'whatever-stage']);
    const derive = plan.nodes.find((n) => n.id === 'plan-stage:derive-run-plan');
    expect(derive?.run).toBe('forge plan run-plan whatever-stage --json');
  });

  it('--input stageId=X is the same as --stage X', async () => {
    const viaInput = await dryRun('plan-stage', ['--input', 'stageId=S9']);
    const viaStage = await dryRun('plan-stage', ['--stage', 'S9']);
    expect(viaInput).toEqual(viaStage);
  });

  it('build-stage gets its stories, in dependency order, and its integration branch, from the stage documents', async () => {
    const plan = await dryRun('build-stage', ['--stage', 'STAGE-1']);
    const ids = plan.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'build-stage:implement:STORY-001',
        'build-stage:implement:STORY-002',
        'build-stage:review:STORY-001',
      ]),
    );
    expect(plan.nodes.find((n) => n.id === 'build-stage:prepare')?.run).toBe(
      'git switch -c forge/integration/STAGE-1 || git switch forge/integration/STAGE-1',
    );
    // STORY-002 depends on STORY-001, and the stage's per-story owner roles come from the Story documents.
    const implement2 = plan.nodes.find((n) => n.id === 'build-stage:implement:STORY-002');
    expect(implement2?.agent).toBe('frontend');
    const start2 = plan.nodes.filter(
      (n) => n.id.endsWith(':STORY-002') && !n.dependsOn.some((d) => d.endsWith(':STORY-002')),
    );
    expect(start2.length).toBeGreaterThan(0);
    for (const head of start2) {
      expect(head.dependsOn.some((d) => d.endsWith(':STORY-001'))).toBe(true);
    }
  });

  it('implement-story reads ownerRole from the Story document', async () => {
    const fromStory = await dryRun('implement-story', ['--story', 'STORY-002']);
    expect(fromStory.nodes.find((n) => n.kind === 'agent' && n.id.endsWith(':green'))?.agent).toBe(
      'frontend',
    );
    const agreeing = await dryRun('implement-story', [
      '--story',
      'STORY-002',
      '--input',
      'ownerRole=frontend',
    ]);
    expect(agreeing).toEqual(fromStory);
  });

  it('implement-story claims what the Story document says: green its files_expected, red only the test paths among them', async () => {
    const plan = await dryRun('implement-story', ['--story', 'STORY-001']);
    expect(plan.nodes.find((n) => n.id === 'implement-story:green')?.produces).toEqual([
      'src/s1/**',
    ]);
    // The fixture story claims no test path, so the test-writing step claims nothing (Q206 decision 5).
    expect(plan.nodes.find((n) => n.id === 'implement-story:red')?.produces ?? []).toEqual([]);
  });

  it('a supplied input reaches the agent prompt data (block [4]) instead of "NOT SUPPLIED"', async () => {
    const plan = await dryRun('quick-fix', ['--input', 'defectId=DEF-042']);
    const step = plan.nodes.find((n) => n.kind === 'agent');
    expect(step?.runInputs).toMatchObject({ defectId: 'DEF-042' });
    expect(step?.missingRunInputs).toBeUndefined();
  });

  it('is deterministic: the same command line plans byte-identically', async () => {
    const flags = ['--stage', 'STAGE-1'];
    const a = await forge(['run', 'build-stage', ...flags, '--dry-run', '--json']);
    const b = await forge(['run', 'build-stage', ...flags, '--dry-run', '--json']);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout.length).toBeGreaterThan(100);
  });
});

describe('refusals are typed, name the remedy, and have --json parity', () => {
  async function refuse(args: readonly string[]): Promise<{ plain: Outcome; env: Envelope }> {
    const plain = await forge(['run', ...args]);
    const json = await forge(['run', ...args, '--json']);
    expect(json.status).toBe(plain.status);
    expect(json.stderr).toBe(plain.stderr);
    expect(json.stdout.trim().split('\n')).toHaveLength(1);
    const env = JSON.parse(json.stdout) as Envelope;
    expect(env.v).toBe(1);
    expect(env.ok).toBe(false);
    expect(env.error.exitCode).toBe(json.status);
    expect(plain.stdout).toBe('');
    expect(plain.stderr).toContain(env.error.message);
    expect(plain.stderr).toContain(env.error.remedy);
    return { plain, env };
  }

  it.each([
    [['build-stage', '--dry-run', '--input', 'stageId'], 'RUN-088', 'no "="'],
    [['build-stage', '--dry-run', '--input', '=x'], 'RUN-088', 'name before'],
    [['build-stage', '--dry-run', '--input', 'stageId='], 'RUN-088', 'value is empty'],
    [['build-stage', '--dry-run', '--input', 'bad-name=x'], 'RUN-088', 'plain identifier'],
    [['build-stage', '--dry-run', '--input', 'vars=x'], 'RUN-088', 'reserved'],
    [['build-stage', '--dry-run', '--input', 'stage=x'], 'RUN-088', 'reserved'],
    [['build-stage', '--dry-run', '--input', 'a=1', '--input', 'a=2'], 'RUN-088', 'one value'],
    [
      ['build-stage', '--dry-run', '--stage', 'STAGE-1', '--input', 'stageId=OTHER'],
      'RUN-088',
      'disagree',
    ],
    [['build-stage', '--dry-run', '--input'], 'RUN-088', 'needs a value'],
    [['build-stage', '--dry-run', '--stage', 'NO-SUCH-STAGE'], 'RUN-082', 'no Epic declares'],
    [['build-stage', '--dry-run', '--stage', 'LOOP'], 'RUN-090', 'STORY-01'],
    [['implement-story', '--dry-run', '--story', 'STORY-999'], 'SPEC-024', 'STORY-999'],
    [['quick-fix', '--dry-run'], 'RUN-089', 'defectId'],
    [
      ['implement-story', '--dry-run', '--story', 'STORY-002', '--input', 'ownerRole=security'],
      'RUN-088',
      'owner_role',
    ],
    [['implement-story', '--dry-run', '--story', 'STORY-060'], 'RUN-091', 'sdet'],
    [['implement-story', '--dry-run', '--story', 'STORY-040'], 'RUN-092', 'blocked'],
    [['implement-story', '--dry-run', '--story', 'STORY-050'], 'RUN-092', 'already done'],
    [['build-stage', '--dry-run', '--stage', 'BLK'], 'RUN-090', 'story-blocked'],
    [['build-stage', '--dry-run', '--stage', 'EMPTY'], 'RUN-090', 'no story'],
    [['build-stage', '--dry-run', '--stage', 'DONE'], 'RUN-090', 'story-already-delivered'],
    [['plan-stage', '--dry-run', '--stage', 'x;y'], 'RUN-088', 'shell command'],
    [['build-stage', '--dry-run', '--stage', '$(id)'], 'RUN-088', 'shell command'],
    [['plan-stage', '--dry-run', '--input', 'stageId=--help'], 'RUN-088', 'shell command'],
    [
      ['quick-fix', '--dry-run', '--epic', ' ', '--input', 'defectId=D1'],
      'RUN-088',
      'needs a value',
    ],
    [['no-such-workflow', '--dry-run'], 'RUN-053', 'no-such-workflow'],
  ] as const)(
    '%j is %s (%s)',
    async (args, code, text) => {
      const { env } = await refuse(args);
      expect(env.error.code).toBe(code);
      expect(env.error.message + env.error.remedy).toContain(text);
    },
    120_000,
  );

  it('a stage whose stories form a cycle is refused by name, not with a compiler dump', async () => {
    const { plain } = await refuse(['build-stage', '--dry-run', '--stage', 'LOOP']);
    expect(plain.stderr).toContain('forge plan run-plan');
    expect(plain.stderr).not.toContain('fanout-over-not-array');
  }, 120_000);
});

describe('a run compiles what the plan compiles, and refuses what it must not start', () => {
  interface StepPlan {
    readonly nodes: readonly { readonly id: string; readonly dependsOn: readonly string[] }[];
  }
  const edges = (plan: StepPlan) =>
    Object.fromEntries(plan.nodes.map((n) => [n.id, [...n.dependsOn].sort()]));

  it.each(['STAGE-1', 'OV', 'ORD'])(
    'forge run build-stage --stage %s has the same steps and edges as forge plan run-plan',
    async (stage) => {
      const planned = await forge(['plan', 'run-plan', stage, '--json']);
      expect(planned.status).toBe(0);
      const viaPlan = JSON.parse(planned.stdout) as StepPlan & { stepPlan: string };
      expect(viaPlan.stepPlan).toBe('compiled');
      const viaRun = await dryRun('build-stage', ['--stage', stage]);
      expect(edges(viaRun)).toEqual(edges(viaPlan));
    },
    120_000,
  );

  it('orders overlapping claims that no dependency orders (src/auth vs src/auth/login.ts), lower id first', async () => {
    const plan = await dryRun('build-stage', ['--stage', 'OV']);
    const second = plan.nodes.filter((n) => n.id.endsWith(':STORY-021'));
    expect(second.some((n) => n.dependsOn.includes('build-stage:review:STORY-020'))).toBe(true);
    const first = plan.nodes.filter((n) => n.id.endsWith(':STORY-020'));
    expect(first.some((n) => n.dependsOn.some((d) => d.endsWith(':STORY-021')))).toBe(false);
  });

  it('feeds a story whose dependency has the higher id after that dependency', async () => {
    const plan = await dryRun('build-stage', ['--stage', 'ORD']);
    const dependent = plan.nodes.filter((n) => n.id.endsWith(':STORY-030'));
    expect(dependent.some((n) => n.dependsOn.includes('build-stage:review:STORY-031'))).toBe(true);
  });

  it('a hostile stage id never reaches a shell: refused, and nothing it names is created (dry-run or not)', async () => {
    const marker = path.join(dir, 'pwned-marker');
    for (const extra of [['--dry-run'], []]) {
      const result = await forge(['run', 'plan-stage', '--stage', `x; touch ${marker}`, ...extra]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('shell command');
    }
    const result = await forge(['run', 'build-stage', '--stage', `$(touch ${marker})`]);
    expect(result.status).toBe(2);
    await expect(readdir(dir)).resolves.not.toContain('pwned-marker');
  });

  it('forge implement supplies the same claim as forge run implement-story, read from the Story document', async () => {
    const viaImplement = await forge(['implement', 'STORY-001', '--dry-run', '--json']);
    expect(viaImplement.status).toBe(0);
    const implement = (JSON.parse(viaImplement.stdout) as { plan: Plan }).plan;
    const run = await dryRun('implement-story', ['--story', 'STORY-001']);
    expect(implement.nodes.find((n) => n.id === 'implement-story:green')?.produces).toEqual([
      'src/s1/**',
    ]);
    expect(implement.nodes.map((n) => [n.id, n.produces ?? []])).toEqual(
      run.nodes.map((n) => [n.id, n.produces ?? []]),
    );
  });

  it('forge implement applies the same refusals as forge run implement-story (an sdet-owned, a blocked, a delivered story)', async () => {
    for (const [story, code] of [
      ['STORY-060', 'RUN-091'],
      ['STORY-040', 'RUN-092'],
      ['STORY-050', 'RUN-092'],
    ] as const) {
      for (const extra of [['--dry-run'], []]) {
        const out = await forge(['implement', story, ...extra, '--json']);
        expect(out.status, `${story} ${extra.join(' ')}`).toBe(2);
        expect((JSON.parse(out.stdout) as Envelope).error.code).toBe(code);
      }
    }
  }, 120_000);

  it('warns on stderr, exit 0, about an --input the workflow neither declares nor reads', async () => {
    const result = await forge([
      'run',
      'quick-fix',
      '--dry-run',
      '--json',
      '--input',
      'defectId=D1',
      '--input',
      'defctId=D1',
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('--input defctId is not declared by workflow quick-fix');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
  });
});

describe('--json refusals are one envelope line on stdout, for every command that can refuse', () => {
  const parse = (out: Outcome): Envelope => {
    expect(out.stdout.trim().split('\n')).toHaveLength(1);
    const envelope = JSON.parse(out.stdout) as Envelope;
    expect(envelope.ok).toBe(false);
    expect(envelope.error.exitCode).toBe(out.status);
    expect(out.stderr).toContain(envelope.error.message);
    return envelope;
  };

  it('a dirty working tree refuses forge run, forge implement and forge plan alike (VCS-010, exit 5)', async () => {
    const stray = path.join(dir, 'stray-uncommitted.txt');
    await writeFile(stray, 'x');
    try {
      for (const args of [
        ['run', 'discover'],
        ['implement', 'STORY-001'],
        ['plan', 'stages'],
      ]) {
        const out = await forge([...args, '--json']);
        expect(out.status, args.join(' ')).toBe(5);
        expect(parse(out).error.code).toBe('VCS-010');
        expect(out.stderr).toContain('stray-uncommitted.txt');
      }
    } finally {
      await rm(stray, { force: true });
    }
  }, 120_000);

  it('a usage error thrown before the command runs (USR-002) is one too, and a crash is not', async () => {
    const usage = await forge(['run', 'discover', '--dry-run', '--epci', 'x', '--json']);
    expect(usage.status).toBe(2);
    expect(parse(usage).error.code).toBe('USR-002');
  });
});
