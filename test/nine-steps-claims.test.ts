/**
 * The nine steps that once declared no claim now write inside one (`PLAN-M13.md` P36, `06` §6.7, `20` §20.2 point 2;
 * `SPEC-QUESTIONS.md` Q216 `KNOWN_EMPTY_CLAIM`, Q220 and the P36 entry).
 *
 * `debug:fix`, `harden:fix-findings`, `implement-story:{document,refactor}`, `migrate:{expand,contract}`,
 * `quick-fix:{write-failing-test,fix}` and `refactor:refactor-code` write code, tests or documents the story or the defect
 * decides at run time. With no claim an agent's session now has no write grant at all (`assembleAgentSession`), so each needs a
 * positive one: the per-story steps the story's own `files_expected`, the rest "the project, less the protected set"
 * (`['**', '!@protected']`, the set a `forge debug` FIX is held to).
 *
 * The real shipped workflow, compiled by the run's own compiler, dispatched through the real `executeStep` over the context
 * `forge run` builds (a real `forge init` project, real agents, strict `FakePlatformAdapter`), against a real git lane under
 * `supervised` autonomy (the `strict` claim policy). Each entry below is dispatched twice, into two distinctly-id'd clones of
 * the same real node (so each gets its own lane): once with only an in-claim write (succeeds under both policies), once with
 * every protected path added too (still reverted and traced under both -- a protected path is a denial, not a claim question
 * -- but since `PLAN-M14.md` P3, `06` §6.7 as amended, `SPEC-QUESTIONS.md` Q232 decision 1, `strict` now also fails the step
 * over it; `guided`'s own `warn` default still does not).
 *
 * `.git/` cannot be exercised here: git never lists its own directory as a lane change, so no session could stage a write to
 * it and nothing would be reverted. It is in the exclusion set (`NEVER_WRITABLE_GLOBS`, asserted in
 * `packages/engine/test/dispatch/empty-claim.test.ts`) for the day an adapter's tool layer allows the write.
 *
 * @see specs/06 §6.7
 * @see specs/20 §20.2
 * @see PLAN-M13.md P36
 * @see PLAN-M14.md P3
 */
import { execa } from 'execa';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as YAML from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SessionRequest } from '@forge/adapter-kit';
import { ProjectPaths } from '@forge/core';
import { executeStep, type ExecuteStepContext, type LaneHandle } from '@forge/engine/dispatch';
import { compileRunPlan } from '@forge/engine/plan';
import type { StepNode } from '@forge/engine/plan';
import { parseWorkflow } from '@forge/engine/workflow';
import { configSchema, type ForgeConfig } from '@forge/schemas/config';
import { FakePlatformAdapter } from '@forge/testkit';

import { buildRunEngineContext } from '../packages/cli/src/commands/run/context.ts';
import { runInit } from '../packages/cli/src/init/run-init.ts';
import { OPERATING_CONTRACT } from '../packages/agents/src/prompt/index.ts';
import { readEvents, type ForgeEvent } from '../packages/telemetry/src/events.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');

const FIXTURE_CONTEXT = {
  stage: { stories: [] },
  run: {
    findings: [{ id: 'defect-1' }],
    testPaths: ['test/story-1.test.ts'],
    filesExpected: ['src/story-1.ts', 'test/story-1.test.ts'],
  },
  vars: { integration_branch: 'forge/integration/stage-1' },
  stageId: 'stage-1',
  storyId: 'story-1',
  ownerRole: 'backend',
  defectId: 'defect-1',
  migrationGoal: 'expand the users table',
  goal: 'extract a shared helper',
} as const;

const TIERS = {
  frugal: 'forge-fake-frugal',
  balanced: 'forge-fake-balanced',
  max: 'forge-fake-max',
} as const;

/** Every path a project-wide step must not be able to write, each a real protected-set member. */
const PROTECTED = [
  '.forge/config.yaml',
  '.env',
  'app/.env',
  '.github/workflows/ci.yml',
  '.husky/pre-commit',
  'package.json',
  'vitest.config.ts',
  '.claude/settings.json',
  '.vscode/tasks.json',
  'docs/forge/kb/glossary.md',
  'docs/forge/specs/stories/STORY-001.md',
  'certs/server.pem',
] as const;

/** The protected paths a claim never reaches, whatever it names (`NEVER_WRITABLE_GLOBS`). */
const FLOOR: readonly string[] = ['.forge/config.yaml', '.env', 'app/.env'];

interface NineStep {
  readonly key: string;
  readonly workflow: string;
  readonly step: string;
  /** `project`: `**` less the protected set. `story`: the story's `files_expected`. */
  readonly scope: 'project' | 'story';
}

const NINE: readonly NineStep[] = [
  { key: 'debug:fix', workflow: 'debug', step: 'fix', scope: 'project' },
  { key: 'harden:fix-findings', workflow: 'harden', step: 'fix-findings', scope: 'project' },
  {
    key: 'implement-story:document',
    workflow: 'implement-story',
    step: 'document',
    scope: 'story',
  },
  {
    key: 'implement-story:refactor',
    workflow: 'implement-story',
    step: 'refactor',
    scope: 'story',
  },
  { key: 'migrate:expand', workflow: 'migrate', step: 'expand', scope: 'project' },
  { key: 'migrate:contract', workflow: 'migrate', step: 'contract', scope: 'project' },
  {
    key: 'quick-fix:write-failing-test',
    workflow: 'quick-fix',
    step: 'write-failing-test',
    scope: 'project',
  },
  { key: 'quick-fix:fix', workflow: 'quick-fix', step: 'fix', scope: 'project' },
  { key: 'refactor:refactor-code', workflow: 'refactor', step: 'refactor-code', scope: 'project' },
];

let projectDir = '';
/** One engine context per autonomy level: `supervised` resolves to the `strict` claim policy (an out-of-claim write is
 * reverted), `guided` to `warn` (kept and flagged; only an excluded path is reverted). */
const ctxs = new Map<'supervised' | 'guided', ExecuteStepContext>();
let adapter: FakePlatformAdapter;
const requests: SessionRequest[] = [];
let nodes = new Map<string, StepNode>();
/** Every lane a context's own `createLane` produced, keyed by `${runId}:${stepId}` — captured at creation
 * rather than read back from `ctx.laneRegistry` (`PLAN-M14.md` P3, `SPEC-QUESTIONS.md` Q232 decision 1):
 * a step whose claim was violated under `strict` now fails and is never registered there, but its lane
 * (and what survived claim enforcement on it) is still real and still worth inspecting. */
const capturedLanes = new Map<string, LaneHandle>();

beforeAll(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), 'forge-p36-nine-'));
  adapter = new FakePlatformAdapter(
    {},
    { strict: { operatingContract: OPERATING_CONTRACT }, models: Object.values(TIERS) },
  );
  const result = await runInit(
    projectDir,
    { name: 'P36 Nine Steps', yes: true, level: 'L0' },
    { candidateAdapters: [adapter], env: {}, modulesDir },
  );
  expect(result.kind).toBe('initialized');
  await execa('git', ['checkout', '-q', '-B', 'main'], { cwd: projectDir });
  await execa(
    'git',
    [
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=T',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'init',
    ],
    { cwd: projectDir },
  );
  const written = configSchema.parse(
    YAML.parse(await readFile(path.join(projectDir, '.forge/config.yaml'), 'utf8')),
  );
  const tiers = { ...written.models.tiers };
  for (const tier of ['frugal', 'balanced', 'max'] as const) {
    tiers[tier] = { ...tiers[tier], [adapter.id]: TIERS[tier] };
  }
  for (const autonomy of ['supervised', 'guided'] as const) {
    const config: ForgeConfig = {
      ...written,
      execution: { ...written.execution, autonomy },
      models: { ...written.models, tiers },
    };
    const runId = `run-p36-nine-${autonomy}`;
    const base = await buildRunEngineContext({
      paths: new ProjectPaths(projectDir),
      projectRoot: projectDir,
      config,
      runId,
      adapter,
      checksRoot: '.forge/checks',
      agentsRoot: '.forge/agents',
    });
    const built: ExecuteStepContext = {
      ...base,
      retainLaneWorktrees: false,
      vcs: {
        ...base.vcs,
        createLane: async (stepId, sha) => {
          const lane = await base.vcs.createLane(stepId, sha);
          capturedLanes.set(`${runId}:${stepId}`, lane);
          return lane;
        },
      },
    };
    expect(built.claimPolicy).toBe(autonomy === 'supervised' ? 'strict' : 'warn');
    ctxs.set(autonomy, built);
  }

  // The workflows a project holds are the shipped ones, laid down by `forge init`.
  nodes = new Map();
  for (const name of new Set(NINE.map((entry) => entry.workflow))) {
    const parsed = parseWorkflow(
      await readFile(path.join(projectDir, '.forge/workflows', `${name}.workflow.yaml`), 'utf8'),
    );
    if (!parsed.success) throw new Error(`${name}: ${JSON.stringify(parsed.issues)}`);
    const compiled = compileRunPlan(parsed.workflow, FIXTURE_CONTEXT);
    if (!compiled.success) throw new Error(`${name}: ${JSON.stringify(compiled.issues)}`);
    for (const node of compiled.nodes) nodes.set(node.id, node);
  }
}, 300_000);

afterAll(async () => {
  if (projectDir !== '') await rm(projectDir, { recursive: true, force: true });
});

async function laneTree(ctx: ExecuteStepContext, stepId: string): Promise<string[]> {
  const lane = capturedLanes.get(`${ctx.runId}:${stepId}`);
  if (lane === undefined) throw new Error(`step ${stepId} never created a lane`);
  return (await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: lane.path })).stdout
    .split('\n')
    .filter((line) => line !== '');
}

async function violationsOf(ctx: ExecuteStepContext, stepId: string): Promise<string[]> {
  const found: string[] = [];
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(projectDir, ctx.runId)) events.push(event);
  for (const event of events) {
    if (event.type === 'PolicyViolation' && event.stepId === stepId) {
      found.push(...(event.payload as { paths: string[] }).paths);
    }
  }
  return found;
}

/** Runs the node once with a session that writes `paths`, returns what the session was granted and what survived. */
async function dispatch(ctx: ExecuteStepContext, node: StepNode, paths: readonly string[]) {
  adapter.script(
    (request) => {
      if (request.stepId !== node.id || request.runId !== ctx.runId) return false;
      requests.push(request);
      return true;
    },
    {
      text: ['done'],
      writeFiles: paths.map((relativePath) => ({ relativePath, content: 'x\n' })),
    },
  );
  const outcome = await executeStep(node, ctx);
  const request = requests
    .filter((candidate) => candidate.stepId === node.id && candidate.runId === ctx.runId)
    .at(-1);
  return { outcome, request };
}

/** The story's test file: `run.testPaths`, inside `files_expected`, and NOT the implementer's to write (`10` §10.6). */
const STORY_TEST = 'test/story-1.test.ts';

describe.each(['supervised', 'guided'] as const)(
  'the nine former KNOWN_EMPTY_CLAIM steps under %s',
  (autonomy) => {
    const context = (): ExecuteStepContext => {
      const found = ctxs.get(autonomy);
      if (found === undefined) throw new Error(autonomy);
      return found;
    };
    const strict = autonomy === 'supervised';

    it('are all found in the shipped workflows a project holds', () => {
      for (const entry of NINE) {
        expect(nodes.has(`${entry.workflow}:${entry.step}`), entry.key).toBe(true);
      }
    });

    for (const entry of NINE) {
      const id = `${entry.workflow}:${entry.step}`;

      if (entry.scope === 'project') {
        it(`${entry.key}: keeps ordinary source and tests when the session stays inside the claim`, async () => {
          const node = nodes.get(id);
          if (node === undefined) throw new Error(id);
          expect(node.produces).toEqual(['**', '!@protected']);
          const cleanNode: StepNode = { ...node, id: `${id}:clean-${autonomy}` };
          const { outcome, request } = await dispatch(context(), cleanNode, [
            'src/fix.ts',
            'test/fix.test.ts',
            'migrations/002_expand.sql',
          ]);
          expect(request?.tools.write, `${entry.key} kept its write grant`).toBe(true);
          expect(outcome.status).toBe('succeeded');
          const tree = await laneTree(context(), cleanNode.id);
          for (const kept of ['src/fix.ts', 'test/fix.test.ts', 'migrations/002_expand.sql']) {
            expect(tree, kept).toContain(kept);
          }
        });

        it(`${entry.key}: a protected write is reverted and traced (PolicyViolation); under strict it also fails the step (PLAN-M14.md P3)`, async () => {
          const node = nodes.get(id);
          if (node === undefined) throw new Error(id);
          const protectedNode: StepNode = { ...node, id: `${id}:protected-${autonomy}` };
          const { outcome, request } = await dispatch(context(), protectedNode, [
            'src/fix.ts',
            'test/fix.test.ts',
            'migrations/002_expand.sql',
            ...PROTECTED,
          ]);
          expect(request?.tools.write, `${entry.key} kept its write grant`).toBe(true);
          const tree = await laneTree(context(), protectedNode.id);
          for (const kept of ['src/fix.ts', 'test/fix.test.ts', 'migrations/002_expand.sql']) {
            expect(tree, kept).toContain(kept);
          }
          // Reverted at both policies: a protected path is a denial, not a claim question.
          for (const protectedPath of PROTECTED)
            expect(tree, protectedPath).not.toContain(protectedPath);
          expect((await violationsOf(context(), protectedNode.id)).sort()).toEqual(
            [...PROTECTED].sort(),
          );
          if (strict) {
            expect(outcome.status).toBe('failed');
            expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
          } else {
            expect(outcome.status).toBe('succeeded');
          }
        });
      } else {
        it(`${entry.key}: writes inside the story's files_expected when the session stays inside the claim`, async () => {
          const node = nodes.get(id);
          if (node === undefined) throw new Error(id);
          expect(node.produces).toEqual(['src/story-1.ts', STORY_TEST, `!${STORY_TEST}`]);
          const cleanNode: StepNode = { ...node, id: `${id}:clean-${autonomy}` };
          const { outcome, request } = await dispatch(context(), cleanNode, ['src/story-1.ts']);
          expect(request?.tools.write).toBe(true);
          expect(outcome.status).toBe('succeeded');
          const tree = await laneTree(context(), cleanNode.id);
          expect(tree).toContain('src/story-1.ts');
        });

        it(`${entry.key}: the test, strays and protected paths are reverted and traced; under strict the step also fails (PLAN-M14.md P3)`, async () => {
          const node = nodes.get(id);
          if (node === undefined) throw new Error(id);
          const stray = ['src/other-story.ts', 'README.md'];
          const dirtyNode: StepNode = { ...node, id: `${id}:dirty-${autonomy}` };
          const { outcome, request } = await dispatch(context(), dirtyNode, [
            'src/story-1.ts',
            STORY_TEST,
            ...stray,
            ...PROTECTED,
          ]);
          expect(request?.tools.write).toBe(true);
          const tree = await laneTree(context(), dirtyNode.id);
          expect(tree).toContain('src/story-1.ts');
          // `red` wrote the test and the implementer is not to edit it (10 §10.6), and `.git`, `.forge` and `.env` are never
          // writable: excluded, so reverted at both policies.
          for (const gone of [STORY_TEST, ...FLOOR]) expect(tree, gone).not.toContain(gone);
          // Outside the claim, not excluded (a story-scoped step is not project-wide, so CI configuration and the rest of the
          // protected set are ordinary out-of-claim paths for it): reverted under `strict`, kept and flagged under `warn`.
          for (const path of [...stray, ...PROTECTED.filter((entry) => !FLOOR.includes(entry))]) {
            if (strict) expect(tree, path).not.toContain(path);
            else expect(tree, path).toContain(path);
          }
          expect((await violationsOf(context(), dirtyNode.id)).sort()).toEqual(
            [STORY_TEST, ...stray, ...PROTECTED].sort(),
          );
          if (strict) {
            expect(outcome.status).toBe('failed');
            expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
          } else {
            expect(outcome.status).toBe('succeeded');
          }
        });
      }
    }

    it('a per-story step whose story lists no files gets no write grant (an empty claim means no write)', async () => {
      const node = nodes.get('implement-story:refactor');
      if (node === undefined) throw new Error('implement-story:refactor');
      const bare: StepNode = {
        ...node,
        id: `implement-story:refactor:bare-${autonomy}`,
        produces: [],
      };
      const { request } = await dispatch(context(), bare, ['src/anything.ts']);
      expect(request?.tools.write).toBe(false);
      expect(await laneTree(context(), bare.id)).not.toContain('src/anything.ts');
    });
  },
);

describe('build-stage: the implementer of a story may not edit its tests either (10 §10.6, enforced by claim)', () => {
  it('each implement:<story> claim is the story files less the story test paths', async () => {
    const parsed = parseWorkflow(
      await readFile(path.join(projectDir, '.forge/workflows/build-stage.workflow.yaml'), 'utf8'),
    );
    if (!parsed.success) throw new Error(JSON.stringify(parsed.issues));
    const compiled = compileRunPlan(parsed.workflow, {
      ...FIXTURE_CONTEXT,
      stage: {
        id: 'stage-1',
        stories: [
          {
            id: 'story-1',
            owner_role: 'backend',
            depends_on: [],
            files_expected: ['src/a/**', 'test/a/**'],
            test_paths: ['test/a/**'],
          },
          {
            id: 'story-2',
            owner_role: 'frontend',
            depends_on: [],
            files_expected: ['web/b/**'],
            test_paths: [],
          },
        ],
      },
    });
    if (!compiled.success) throw new Error(JSON.stringify(compiled.issues));
    const claim = (id: string): readonly string[] | undefined =>
      compiled.nodes.find((node) => node.id === `build-stage:implement:${id}`)?.produces;
    expect(claim('story-1')).toEqual(['src/a/**', 'test/a/**', '!test/a/**']);
    expect(claim('story-2')).toEqual(['web/b/**']);
  });
});
