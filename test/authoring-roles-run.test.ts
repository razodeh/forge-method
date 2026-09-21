/**
 * An authoring role writes its declared output and only that, end to end (`PLAN-M13.md` P15;
 * `SPEC-QUESTIONS.md` Q220; owner decision 2026-09-20).
 *
 * The runtime half of the separation-of-duties guard around the P15 grants (the definition half is
 * `test/authoring-roles-write.test.ts`). It is a real `forge init` project (the real resolved
 * `.forge/agents/*.yaml`, prompts, briefs and shipped workflows), the real `runWorkflow` (real prompt
 * assembly, the real per-step tool grant `resolveStepToolGrant`, the scheduler, a real git lane, the real
 * claim enforcement and the real output contract check), and a strict `FakePlatformAdapter` standing in for
 * the model. The steps are the REAL shipped steps of the shipped workflows (the project's own
 * `.forge/workflows/*.yaml`, and the fm-service and fm-mobile module workflows) run alone: the agent, brief,
 * `outputs` and `produces` of each are not fixtures. What the fake session writes (the artifacts and the
 * register entries) is the invented part, and it is scripted so that it writes ONLY if the grant it was
 * handed says `write: true` (a fake that writes regardless would prove nothing about the grant; the testkit
 * adapter also refuses a write without the grant on its own).
 *
 * All eleven roles that P15 let write are covered, one previously blocked step each (thirteen steps: `em`
 * has two, and `pm` runs the reassigned `write-prd`). Per step:
 *  - the session writes its declared output: the step succeeds, P7 is satisfied, the request carried
 *    `write: true`, nothing is reverted, and the output is in the step's own lane;
 *  - the session ALSO writes three things outside the claim: source code (`src/stray.ts`), a governance file
 *    no step claims (`reports/waivers.md`, a Waiver would bypass a gate) and its OWN agent definition
 *    (`.forge/agents/<role>.yaml`, a role widening its own grant): all three are reverted, the output is
 *    kept, and one `PolicyViolation` `out-of-claim-write` names them (the step is not asserted to fail: whether
 *    `strict` should fail the step is the owner call recorded as P31, `06` §6.7 vs Q212);
 *  - the session writes only a stray file: the step FAILS (`RUN-083`), loudly, and nothing is lost;
 *  - a write-forbidden agent (the shipped definition with `write: false`, i.e. what the role was before P15)
 *    gets no write from the same session and fails `RUN-084`: the negative control that shows the passing
 *    cases pass because of the grant.
 * The autonomy levels and an adopted project are covered for the step Q208 saw live (`retro:run-retro`), and
 * three register cases show that a wrong or missing subtype, and a re-run that adds nothing, do not satisfy the new
 * `HandoffRecord` outputs. NOT shown, and not true today: that another role's entry cannot satisfy them (P7 does not
 * compare an entry's `from` with the running agent; Q220 lists it).
 *
 * @see specs/05 §5.3
 * @see specs/06 §6.7
 * @see specs/20 §20.1
 * @see PLAN-M13.md P14, P15
 */
import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as YAML from 'yaml';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { SessionRequest } from '@forge/adapter-kit';
import { ProjectPaths } from '@forge/core';
import { configSchema, type ForgeConfig } from '@forge/schemas/config';
import { FakePlatformAdapter, type FakeSessionScript } from '@forge/testkit';

import { runWorkflow, type RunDeps } from '../packages/cli/src/commands/run/run.ts';
import { runInit } from '../packages/cli/src/init/run-init.ts';
import { OPERATING_CONTRACT } from '../packages/agents/src/prompt/index.ts';
import { readEvents, type ForgeEvent } from '../packages/telemetry/src/events.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const WORKFLOWS_ROOT = '.forge/workflows';
const AGENTS_ROOT = '.forge/agents';
const CHECKS_ROOT = '.forge/checks';
const BUILD_TARGET = 'ios-1-2-0';
const INTERFACE_NAME = 'orders-api';

const TIER_MODELS = {
  frugal: 'forge-fake-frugal',
  balanced: 'forge-fake-balanced',
  max: 'forge-fake-max',
} as const;

interface FileWrite {
  readonly relativePath: string;
  readonly content: string;
}

// ---------------------------------------------------------------------------------------------------------
// What the fake session writes for each step: a valid artifact of each declared output type.
// ---------------------------------------------------------------------------------------------------------

const BASE_KEYS = (id: string, type: string, author: string): string[] => [
  `id: ${id}`,
  `type: ${type}`,
  'schemaVersion: 1',
  `title: ${type} ${id}`,
  'status: draft',
  'created: 2026-01-15',
  'updated: 2026-01-15',
  'revision: 1',
  `author: ${author}`,
  'changelog: []',
];

const epic = (): string =>
  [
    '---',
    ...BASE_KEYS('EPIC-001', 'Epic', 'po'),
    'capability: CAP-001',
    'stage: stage-1',
    'goal: Ship the thing',
    'scope_in: []',
    'scope_out: []',
    'stories: []',
    'interfaces: []',
    'data: []',
    'exit_criteria: []',
    '---',
    '',
    'One paragraph.',
    '',
  ].join('\n');

const capability = (): string =>
  [
    '---',
    ...BASE_KEYS('CAP-001', 'Capability', 'pm'),
    'statement: Users can see their invoice total',
    'priority: must',
    'stage: stage-1',
    'depends_on: []',
    'nfrs: []',
    'metrics: []',
    'acceptance_summary: The total is shown and correct',
    'epics: []',
    '---',
    '',
    'The capability.',
    '',
  ].join('\n');

const nfr = (): string =>
  [
    '---',
    ...BASE_KEYS('NFR-0001', 'NFR', 'pm'),
    'category: performance',
    'statement: The invoice page responds quickly',
    'metric: p95 latency',
    'target: < 300ms',
    'verification:',
    '  kind: benchmark',
    '  ref: bench/invoice',
    'applies_to: []',
    '---',
    '',
    'The requirement.',
    '',
  ].join('\n');

const dataModel = (): string =>
  ['---', ...BASE_KEYS('DM-001', 'DataModel', 'data-architect'), '---', '', 'Entities.', ''].join(
    '\n',
  );

const contract = (): string =>
  [
    ...BASE_KEYS('INT-001', 'InterfaceContract', 'integration-architect'),
    'openapi: 3.1.0',
    '',
  ].join('\n');

const sessionRecord = (): string =>
  [
    '---',
    ...BASE_KEYS('SESSION-001', 'SessionRecord', 'em'),
    'sessionType: retro',
    'technique: []',
    'question: What did we learn',
    'constraints_applied: []',
    'participants: []',
    "started: '2026-01-15T10:00:00Z'",
    "ended: '2026-01-15T11:00:00Z'",
    'cost_usd: 0',
    '---',
    '',
    ...[
      'Frame',
      'Diverge',
      'Converge',
      'Decisions',
      'Non-decisions',
      'Actions',
      'KB write-back',
    ].flatMap((heading) => [`## ${heading}`, '', 'text', '']),
  ].join('\n');

/** A `handoffs.md` register with one entry. `delivered` starts with the `subtype:` line the briefs ask for. */
function handoffs(
  from: string,
  to: string,
  step: string,
  subtypeLine: string | undefined,
  extra = 'constraints_for_receiver: []',
): string {
  return [
    '---',
    'type: HandoffRecord',
    'handoffs:',
    '  - id: HO-0001',
    `    from: ${from}`,
    `    to: ${to}`,
    `    step: ${step}`,
    "    timestamp: '2026-01-15T10:00:00Z'",
    `    delivered: [${[...(subtypeLine === undefined ? [] : [`'subtype: ${subtypeLine}'`]), "'the deliverable'"].join(', ')}]`,
    '    open_questions: []',
    '    assumptions: []',
    `    ${extra}`,
    '    acceptance_for_receiver: []',
    '---',
    '',
  ].join('\n');
}

const REGISTER = 'docs/forge/reports/handoffs.md';

interface Case {
  readonly label: string;
  /** The role, as `.forge/agents/<id>.yaml`. */
  readonly agent: string;
  /** The shipped workflow: an id in the project's `.forge/workflows`, or a module workflow file. */
  readonly workflow: string;
  readonly moduleFile?: string;
  readonly step: string;
  readonly context?: Readonly<Record<string, string>>;
  /** Every file a well-behaved session writes for the step; `subtype` is the one the real step declares. */
  readonly files: (subtype: string | undefined) => readonly FileWrite[];
}

const handoffCase =
  (agent: string, to: string, step: string, more: readonly FileWrite[] = []): Case['files'] =>
  (subtype) => [
    { relativePath: REGISTER, content: handoffs(agent, to, `${step} → next`, subtype) },
    ...more,
  ];

const CASES: readonly Case[] = [
  {
    label: 'analyst: adopt:gap-analysis (HandoffRecord)',
    agent: 'analyst',
    workflow: 'adopt',
    step: 'gap-analysis',
    files: handoffCase('analyst', 'human', 'gap-analysis'),
  },
  {
    label: 'pm: replan:propose-change (HandoffRecord)',
    agent: 'pm',
    workflow: 'replan',
    step: 'propose-change',
    files: handoffCase('pm', 'architect', 'propose-change'),
  },
  {
    label: 'pm: define-product:write-prd (Capability + NFR, reassigned from po)',
    agent: 'pm',
    workflow: 'define-product',
    step: 'write-prd',
    files: () => [
      { relativePath: 'docs/forge/specs/capabilities/CAP-001.md', content: capability() },
      { relativePath: 'docs/forge/specs/nfr/NFR-0001.md', content: nfr() },
    ],
  },
  {
    label: 'po: plan-stage:write-epics (Epic)',
    agent: 'po',
    workflow: 'plan-stage',
    step: 'write-epics',
    files: () => [{ relativePath: 'docs/forge/specs/epics/EPIC-001.md', content: epic() }],
  },
  {
    label: 'ux: define-product:write-ux-spec (HandoffRecord + the spec document)',
    agent: 'ux',
    workflow: 'define-product',
    step: 'write-ux-spec',
    files: handoffCase('ux', 'architect', 'write-ux-spec', [
      { relativePath: 'docs/forge/kb/product/ux-spec.md', content: '# UX spec\n\nScreens.\n' },
    ]),
  },
  {
    label: 'architect: replan:impact-analysis (HandoffRecord)',
    agent: 'architect',
    workflow: 'replan',
    step: 'impact-analysis',
    files: handoffCase('architect', 'pm', 'impact-analysis'),
  },
  {
    label: 'data-architect: shape-solution:model-data (DataModel)',
    agent: 'data-architect',
    workflow: 'shape-solution',
    step: 'model-data',
    files: () => [{ relativePath: 'docs/forge/specs/data/DM-001-orders.md', content: dataModel() }],
  },
  {
    label:
      'integration-architect: fm-service contract-test-cycle:draft-contract (InterfaceContract)',
    agent: 'integration-architect',
    workflow: 'contract-test-cycle',
    moduleFile: path.join(
      modulesDir,
      'fm-service',
      'workflows',
      'contract-test-cycle.workflow.yaml',
    ),
    step: 'draft-contract',
    context: { interfaceName: INTERFACE_NAME },
    files: () => [
      { relativePath: `docs/forge/specs/interfaces/${INTERFACE_NAME}.yaml`, content: contract() },
    ],
  },
  {
    label: 'security: shape-solution:threat-model (HandoffRecord + the threat model)',
    agent: 'security',
    workflow: 'shape-solution',
    step: 'threat-model',
    files: handoffCase('security', 'architect', 'threat-model', [
      {
        relativePath: 'docs/forge/kb/architecture/threat-model.md',
        content: '# Threat model\n\nSTRIDE.\n',
      },
    ]),
  },
  {
    label: 'test-architect: plan-stage:write-test-plan (HandoffRecord + the plan document)',
    agent: 'test-architect',
    workflow: 'plan-stage',
    step: 'write-test-plan',
    files: handoffCase('test-architect', 'sdet', 'write-test-plan', [
      { relativePath: 'docs/forge/specs/test-plan.md', content: '# Test plan\n\nThe plan.\n' },
    ]),
  },
  {
    label: 'em: retro:run-retro (SessionRecord, the step Q208 saw live)',
    agent: 'em',
    workflow: 'retro',
    step: 'run-retro',
    files: () => [
      { relativePath: 'docs/forge/sessions/SESSION-001-retro.md', content: sessionRecord() },
    ],
  },
  {
    label: 'em: plan-stages:review-stages (HandoffRecord, checked since P15)',
    agent: 'em',
    workflow: 'plan-stages',
    step: 'review-stages',
    files: handoffCase('em', 'pm', 'review-stages'),
  },
  {
    label: 'release: fm-mobile store-release:prepare-store-submission (HandoffRecord + the record)',
    agent: 'release',
    workflow: 'store-release',
    moduleFile: path.join(modulesDir, 'fm-mobile', 'workflows', 'store-release.workflow.yaml'),
    step: 'prepare-store-submission',
    context: { buildTarget: BUILD_TARGET },
    files: handoffCase('release', 'human', 'prepare-store-submission', [
      {
        relativePath: `docs/forge/kb/delivery/release/store-submission-${BUILD_TARGET}.md`,
        content: '# Store submission\n',
      },
    ]),
  },
];

// ---------------------------------------------------------------------------------------------------------

let projectDir = '';
let config: ForgeConfig;
let originalAgent: ReadonlyMap<string, string> = new Map();
const cleanups: string[] = [];

function withFakeTiers(base: ForgeConfig, adapterId: string): ForgeConfig {
  const tiers = { ...base.models.tiers };
  for (const tier of ['frugal', 'balanced', 'max'] as const) {
    const existing = tiers[tier];
    if (existing[adapterId] === undefined || existing[adapterId].trim() === '') {
      tiers[tier] = { ...existing, [adapterId]: TIER_MODELS[tier] };
    }
  }
  return { ...base, models: { ...base.models, tiers } };
}

const gitEnv = ['-c', 'user.email=t@example.com', '-c', 'user.name=T'];

interface RawStep {
  id?: string;
  outputs?: { type?: string; subtype?: string }[];
  [key: string]: unknown;
}

const miniId = (testCase: Case): string => `p15-${testCase.workflow}-${testCase.step}`;
const stepNodeId = (testCase: Case): string => `${miniId(testCase)}:${testCase.step}`;
/** The subtype the real step declares for its first output (`undefined` for a step with none). */
const subtypes = new Map<string, string | undefined>();

beforeAll(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), 'forge-p15-run-'));
  const adapter = new FakePlatformAdapter({}, { models: Object.values(TIER_MODELS) });
  const result = await runInit(
    projectDir,
    { name: 'P15 Run', yes: true, level: 'L0' },
    { candidateAdapters: [adapter], env: {}, modulesDir },
  );
  expect(result.kind).toBe('initialized');
  await execa('git', ['checkout', '-q', '-B', 'main'], { cwd: projectDir });
  const written = configSchema.parse(
    YAML.parse(await readFile(path.join(projectDir, '.forge/config.yaml'), 'utf8')),
  );
  config = withFakeTiers(written, adapter.id);
  await writeFile(path.join(projectDir, '.forge/config.yaml'), YAML.stringify(config));
  await writeMiniWorkflows();
  const agents = new Map<string, string>();
  for (const testCase of CASES) {
    agents.set(
      testCase.agent,
      await readFile(path.join(projectDir, AGENTS_ROOT, `${testCase.agent}.yaml`), 'utf8'),
    );
  }
  originalAgent = agents;
  await execa('git', ['add', '-A'], { cwd: projectDir });
  await execa('git', [...gitEnv, 'commit', '-q', '-m', 'init'], { cwd: projectDir });
}, 300_000);

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

afterAll(async () => {
  if (projectDir !== '') await rm(projectDir, { recursive: true, force: true });
}, 300_000);

/** One mini workflow per case: the real shipped step, alone, without its `dependsOn` and `gateEvidence`. */
async function writeMiniWorkflows(): Promise<void> {
  for (const testCase of CASES) {
    const source = await readFile(
      testCase.moduleFile ??
        path.join(projectDir, WORKFLOWS_ROOT, `${testCase.workflow}.workflow.yaml`),
      'utf8',
    );
    const workflow = YAML.parse(source) as { steps: RawStep[] };
    const found = workflow.steps.find((step) => step.id === testCase.step);
    if (found === undefined) throw new Error(`${testCase.workflow} has no step ${testCase.step}`);
    subtypes.set(miniId(testCase), found.outputs?.[0]?.subtype);
    const step = Object.fromEntries(
      Object.entries(found).filter(([key]) => key !== 'dependsOn' && key !== 'gateEvidence'),
    );
    const mini = {
      id: miniId(testCase),
      name: `P15 ${testCase.label}`,
      version: '1.0.0',
      description: `The shipped step ${testCase.workflow}:${testCase.step}, run alone.`,
      steps: [step],
    };
    await writeFile(
      path.join(projectDir, WORKFLOWS_ROOT, `${miniId(testCase)}.workflow.yaml`),
      YAML.stringify(mini),
    );
  }
}

const filesOf = (testCase: Case): readonly FileWrite[] =>
  testCase.files(subtypes.get(miniId(testCase)));

interface Fresh {
  readonly dir: string;
  readonly deps: (adapter: FakePlatformAdapter) => RunDeps;
}

/** A fresh clone of the initialised project, so runs never see each other's merged files. */
async function freshProject(
  autonomy: 'supervised' | 'guided' | 'autonomous',
  adopted: boolean,
  setup?: (dir: string) => Promise<void>,
): Promise<Fresh> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p15-clone-'));
  cleanups.push(dir);
  await execa('git', ['clone', '-q', projectDir, dir]);
  await execa('git', ['checkout', '-q', '-B', 'main'], { cwd: dir });
  if (setup !== undefined) {
    await setup(dir);
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', [...gitEnv, 'commit', '-q', '-m', 'p15 setup'], { cwd: dir });
  }
  const cloneConfig: ForgeConfig = {
    ...config,
    execution: { ...config.execution, autonomy, retainLaneWorktrees: 'always' },
    project: { ...config.project, adopted },
  };
  return {
    dir,
    deps: (adapter) => ({
      paths: new ProjectPaths(dir),
      projectRoot: dir,
      config: cloneConfig,
      adapter,
      workflowsRoot: WORKFLOWS_ROOT,
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    }),
  };
}

/** A strict fake whose scripted session writes only if the grant it was handed says `write: true`. */
function honestAdapter(
  testCase: Case,
  files: readonly FileWrite[],
  seen: SessionRequest[],
): FakePlatformAdapter {
  const adapter = new FakePlatformAdapter(
    {},
    { strict: { operatingContract: OPERATING_CONTRACT }, models: Object.values(TIER_MODELS) },
  );
  const script: FakeSessionScript = { text: [`did the ${testCase.step} work`], writeFiles: files };
  // A matcher that records every request and matches only a session holding the write grant. A session with
  // no write grant falls through to the default script, which writes nothing (an honest read-only agent).
  adapter.script((request) => {
    seen.push(request);
    return request.stepId.endsWith(`:${testCase.step}`) && request.tools.write;
  }, script);
  return adapter;
}

async function events(dir: string, runId: string): Promise<ForgeEvent[]> {
  const found: ForgeEvent[] = [];
  for await (const event of readEvents(dir, runId)) found.push(event);
  return found;
}

interface RunOptions {
  readonly autonomy?: 'supervised' | 'guided' | 'autonomous';
  readonly adopted?: boolean;
  readonly setup?: (dir: string) => Promise<void>;
  /** Overrides the write of the agent definition (the negative control). */
  readonly project?: Fresh;
}

async function run(
  testCase: Case,
  adapter: FakePlatformAdapter,
  runId: string,
  options: RunOptions = {},
) {
  const project =
    options.project ??
    (await freshProject(options.autonomy ?? 'guided', options.adopted ?? false, options.setup));
  const result = await runWorkflow(project.deps(adapter), {
    workflowId: miniId(testCase),
    expressionContext: testCase.context ?? {},
    runId,
    host: 'test-host',
  });
  if (result.kind !== 'run') throw new Error('expected a real run');
  return { result, events: await events(project.dir, runId), dir: project.dir };
}

const eventsFor = (all: readonly ForgeEvent[], type: string, stepId: string): ForgeEvent[] =>
  all.filter((event) => event.type === type && event.stepId === stepId);

const isRevert = (event: ForgeEvent): boolean =>
  event.type === 'LaneCommitted' &&
  (event.payload as { reason?: string } | undefined)?.reason === 'claim-revert';

/** The step's own lane worktree (the integration worktree is not it). */
async function laneDir(dir: string): Promise<string> {
  const lanes = (
    await readdir(path.join(dir, '.forge/state/worktrees')).catch(() => [] as string[])
  ).filter((name) => !name.startsWith('integration'));
  expect(lanes.length, 'the step ran in its own lane').toBe(1);
  return path.join(dir, '.forge/state/worktrees', lanes[0] ?? '');
}

async function tracked(dir: string): Promise<string[]> {
  return (await execa('git', ['ls-files'], { cwd: dir })).stdout.split('\n');
}

describe('P15: the real shipped steps are the ones under test', () => {
  it('covers every one of the eleven roles P15 gave write', () => {
    expect(new Set(CASES.map((testCase) => testCase.agent))).toEqual(
      new Set([
        'analyst',
        'pm',
        'po',
        'ux',
        'architect',
        'data-architect',
        'integration-architect',
        'security',
        'test-architect',
        'em',
        'release',
      ]),
    );
  });

  it.each(CASES)(
    '$label: the step exists, its agent is the role named, it declares outputs, and the resolved agent holds write',
    async (testCase) => {
      const source = YAML.parse(
        await readFile(
          testCase.moduleFile ??
            path.join(projectDir, WORKFLOWS_ROOT, `${testCase.workflow}.workflow.yaml`),
          'utf8',
        ),
      ) as { steps: RawStep[] };
      const step = source.steps.find((entry) => entry.id === testCase.step);
      expect(step?.['agent']).toBe(testCase.agent);
      expect(step?.outputs?.length, `${testCase.step} declares outputs`).toBeGreaterThan(0);
      const agent = YAML.parse(
        await readFile(path.join(projectDir, AGENTS_ROOT, `${testCase.agent}.yaml`), 'utf8'),
      ) as { tools: { write: boolean } };
      expect(agent.tools.write).toBe(true);
    },
  );
});

const STRAY_SOURCE: FileWrite = {
  relativePath: 'src/stray.ts',
  content: 'export const leak = 1;\n',
};
const STRAY_GOVERNANCE: FileWrite = {
  relativePath: 'docs/forge/reports/waivers.md',
  content: '---\ntype: Waiver\nwaivers: []\n---\n',
};
const strayAgent = (testCase: Case): FileWrite => ({
  relativePath: `${AGENTS_ROOT}/${testCase.agent}.yaml`,
  content: `${originalAgent.get(testCase.agent) ?? ''}\n# widened by the agent itself\n`,
});

describe('P15: an authoring role writes its declared output and only that (real init, real runWorkflow)', () => {
  for (const testCase of CASES) {
    describe(testCase.label, () => {
      it('writes its output: the step succeeds, P7 is satisfied, the request carried write:true, nothing is reverted', async () => {
        const seen: SessionRequest[] = [];
        const {
          result,
          events: all,
          dir,
        } = await run(
          testCase,
          honestAdapter(testCase, filesOf(testCase), seen),
          `p15-ok-${testCase.step}`,
        );
        const stepRequests = seen.filter((request) => request.stepId.endsWith(`:${testCase.step}`));
        expect(stepRequests.length, 'the step ran a session').toBeGreaterThan(0);
        expect(stepRequests.every((request) => request.tools.write)).toBe(true);
        expect(eventsFor(all, 'StepSucceeded', stepNodeId(testCase)).length).toBe(1);
        expect(eventsFor(all, 'StepFailed', stepNodeId(testCase))).toEqual([]);
        expect(result.runState.runStatus).toBe('completed');
        expect(all.filter((event) => event.type === 'PolicyViolation')).toEqual([]);
        expect(all.filter(isRevert)).toEqual([]);
        const lane = await tracked(await laneDir(dir));
        for (const file of filesOf(testCase)) expect(lane).toContain(file.relativePath);
      });

      it('a session that also writes source code, a Waiver and its own agent definition: all three are reverted, the output is kept, PolicyViolation names them', async () => {
        const strays = [STRAY_SOURCE, STRAY_GOVERNANCE, strayAgent(testCase)];
        const { events: all, dir } = await run(
          testCase,
          honestAdapter(testCase, [...filesOf(testCase), ...strays], []),
          `p15-stray-${testCase.step}`,
        );
        // Not asserted here: whether the step then succeeds. `strict` reverts and traces and does not fail
        // the step today, `06` §6.7 says it fails it: an owner call (P31) this test must not decide.
        expect(all.filter(isRevert).some((event) => event.stepId === stepNodeId(testCase))).toBe(
          true,
        );
        const violation = all.find(
          (event) => event.type === 'PolicyViolation' && event.stepId === stepNodeId(testCase),
        );
        const payload = violation?.payload as
          { paths?: string[]; totalReverted?: number } | undefined;
        expect(violation?.payload).toMatchObject({ kind: 'out-of-claim-write', policy: 'strict' });
        expect([...(payload?.paths ?? [])].sort()).toEqual(
          strays.map((stray) => stray.relativePath).sort(),
        );
        expect(payload?.totalReverted).toBe(3);
        const lane = await laneDir(dir);
        const files = await tracked(lane);
        expect(files, 'the source stray survived').not.toContain(STRAY_SOURCE.relativePath);
        expect(files, 'the Waiver survived').not.toContain(STRAY_GOVERNANCE.relativePath);
        expect(
          await readFile(path.join(lane, AGENTS_ROOT, `${testCase.agent}.yaml`), 'utf8'),
          'the agent definition was rewritten',
        ).toBe(originalAgent.get(testCase.agent));
        for (const file of filesOf(testCase))
          expect(files, `lost ${file.relativePath}`).toContain(file.relativePath);
      });

      it('a session that writes ONLY a stray file fails RUN-083: loudly, with nothing legitimate lost', async () => {
        const { events: all } = await run(
          testCase,
          honestAdapter(testCase, [STRAY_SOURCE], []),
          `p15-only-stray-${testCase.step}`,
        );
        const failed = eventsFor(all, 'StepFailed', stepNodeId(testCase));
        expect(failed.length).toBe(1);
        // RUN-083 today (the output check); a stricter `strict` (P31) may fail the step earlier with a claim code.
        expect(JSON.stringify(failed[0]?.payload)).toMatch(/RUN-083|claim-violation/i);
        expect(eventsFor(all, 'StepSucceeded', stepNodeId(testCase))).toEqual([]);
      });

      it('negative control: the same role with the pre-P15 definition (write:false) gets no write and fails RUN-084', async () => {
        const seen: SessionRequest[] = [];
        const project = await freshProject('guided', false, async (dir) => {
          const agentFile = path.join(dir, AGENTS_ROOT, `${testCase.agent}.yaml`);
          const agent = YAML.parse(await readFile(agentFile, 'utf8')) as {
            tools: { write: boolean };
            ceiling?: { tools: { write: boolean } };
          };
          agent.tools.write = false;
          if (agent.ceiling !== undefined) agent.ceiling.tools.write = false;
          await writeFile(agentFile, YAML.stringify(agent));
        });
        const { events: all } = await run(
          testCase,
          honestAdapter(testCase, filesOf(testCase), seen),
          `p15-control-${testCase.step}`,
          { project },
        );
        const stepRequests = seen.filter((request) => request.stepId.endsWith(`:${testCase.step}`));
        expect(stepRequests.every((request) => !request.tools.write)).toBe(true);
        const failed = eventsFor(all, 'StepFailed', stepNodeId(testCase));
        expect(failed.length).toBe(1);
        expect(JSON.stringify(failed[0]?.payload)).toMatch(/RUN-084/);
      });
    });
  }
});

describe('P15: the autonomy levels and an adopted project, for the step Q208 saw live', () => {
  const retro = CASES.find((testCase) => testCase.step === 'run-retro');
  if (retro === undefined) throw new Error('retro case missing');
  for (const [autonomy, adopted] of [
    ['supervised', false],
    ['autonomous', false],
    ['guided', true],
  ] as const) {
    it(`under ${autonomy}${adopted ? ' + adopted' : ''}: the output is kept, the strays are reverted and traced`, async () => {
      const strays = [STRAY_SOURCE, STRAY_GOVERNANCE, strayAgent(retro)];
      const { events: all, dir } = await run(
        retro,
        honestAdapter(retro, [...filesOf(retro), ...strays], []),
        `p15-retro-${autonomy}-${String(adopted)}`,
        { autonomy, adopted },
      );
      // The output is in the step's own lane (whether the step then succeeds is the P31 owner call).
      const lane = await tracked(await laneDir(dir));
      for (const file of filesOf(retro)) expect(lane).toContain(file.relativePath);
      expect(lane).not.toContain(STRAY_SOURCE.relativePath);
      expect(all.some(isRevert)).toBe(true);
      const violation = all.find((event) => event.type === 'PolicyViolation');
      expect(violation?.payload).toMatchObject({
        kind: 'out-of-claim-write',
        policy: 'strict',
        totalReverted: 3,
      });
    });
  }
});

describe('P15: the new HandoffRecord outputs are not satisfied by a wrong or missing subtype, or by a re-run that adds nothing', () => {
  const reviewStages = CASES.find((testCase) => testCase.step === 'review-stages');
  const storeSubmission = CASES.find((testCase) => testCase.step === 'prepare-store-submission');
  if (reviewStages === undefined || storeSubmission === undefined) throw new Error('case missing');

  it('review-stages: editing the stage-plan entry pm left in the register (subtype stage-plan), without writing a verdict, fails RUN-083', async () => {
    // pm's own `decompose-stages` entry names `review-stages` as the NEXT step in its `step` value.
    const pmEntry = handoffs('pm', 'em', 'decompose-stages → review-stages', 'stage-plan');
    const edited = pmEntry.replace(
      'constraints_for_receiver: []',
      "constraints_for_receiver: ['x']",
    );
    const { events: all } = await run(
      reviewStages,
      honestAdapter(reviewStages, [{ relativePath: REGISTER, content: edited }], []),
      'p15-adv-review-stages',
      {
        setup: async (dir) => {
          await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
          await writeFile(path.join(dir, REGISTER), pmEntry);
        },
      },
    );
    const failed = eventsFor(all, 'StepFailed', stepNodeId(reviewStages));
    expect(failed.length).toBe(1);
    expect(JSON.stringify(failed[0]?.payload)).toMatch(/RUN-083/);
    expect(JSON.stringify(failed[0]?.payload)).toMatch(/stage-plan-review/);
  });

  it('prepare-store-submission: an entry that names the step but carries no subtype line fails RUN-083', async () => {
    const { events: all } = await run(
      storeSubmission,
      honestAdapter(
        storeSubmission,
        [
          {
            relativePath: REGISTER,
            content: handoffs('release', 'human', 'prepare-store-submission → submit', undefined),
          },
          {
            relativePath: `docs/forge/kb/delivery/release/store-submission-${BUILD_TARGET}.md`,
            content: '# Store submission\n',
          },
        ],
        [],
      ),
      'p15-adv-store-submission',
    );
    const failed = eventsFor(all, 'StepFailed', stepNodeId(storeSubmission));
    expect(failed.length).toBe(1);
    expect(JSON.stringify(failed[0]?.payload)).toMatch(/RUN-083/);
    expect(JSON.stringify(failed[0]?.payload)).toMatch(/store-submission-record/);
  });

  it('review-stages: a re-run whose register already holds a stage-plan-review entry, and which writes nothing, fails RUN-083', async () => {
    const existing = handoffs('em', 'pm', 'review-stages → plan-stage', 'stage-plan-review');
    const { events: all } = await run(
      reviewStages,
      honestAdapter(reviewStages, [], []),
      'p15-rerun-review-stages',
      {
        setup: async (dir) => {
          await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
          await writeFile(path.join(dir, REGISTER), existing);
        },
      },
    );
    const failed = eventsFor(all, 'StepFailed', stepNodeId(reviewStages));
    expect(failed.length).toBe(1);
    expect(JSON.stringify(failed[0]?.payload)).toMatch(/RUN-083/);
  });
});
