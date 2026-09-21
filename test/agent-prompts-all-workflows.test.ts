/**
 * Every agent step of every shipped workflow is dispatched with a real, complete prompt
 * (`PLAN-M13.md` P6; `SPEC-QUESTIONS.md` Q207).
 *
 * For twelve milestones a real agent step was sent a raw `briefs/x.md` path and an empty system prompt
 * while every test stayed green, because no test double ever read the prompt. This is the repository-wide
 * guard: it enumerates the workflows that ship (`@forge/templates`' `WORKFLOW_INDEX`, as laid down by a
 * real `forge init`, plus every `modules/*\/workflows/*.workflow.yaml`) instead of naming them, so a newly
 * added workflow is covered the day it lands, and pushes every `agent` and `session` step of each one
 * through the real dispatcher (`executeStep`, over the context `forge run` builds) against a strict
 * `FakePlatformAdapter` (`@forge/testkit`). Strict mode refuses any session whose user prompt is empty
 * or a bare path, or whose system prompt is not `05` §5.3's nine blocks with the verbatim operating
 * contract in block [1]; a refusal fails the step and this suite.
 *
 * Per agent step it also asserts what the strict adapter cannot see: the agent resolves to a real agent
 * file, the brief resolves to real text (not the path) that reaches block [4], the grant and model
 * resolve (the model through `models.tiers`, `05` §5.8), and the prompt record `05` §5.3 makes mandatory
 * sits on disk and equals what the adapter was sent.
 *
 * Lives at the repository root for the reason `test/workflows.test.ts` documents: it needs `@forge/engine`,
 * `@forge/templates`, `@forge/testkit`, the CLI's `init` and run-context constructors, and the bare
 * `modules/` directory, and no package may depend on all of them.
 *
 * @see specs/05 §5.3, §5.5, §5.8
 * @see specs/22 M13
 * @see PLAN-M13.md P6
 */
import { execa } from 'execa';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as YAML from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SessionRequest } from '@forge/adapter-kit';
import { ProjectPaths } from '@forge/core';
import {
  executeStep,
  outputGlob,
  outputPathCoveredBy,
  promptRecordDirName,
  resolveStepClaim,
  type ExecuteStepContext,
} from '@forge/engine/dispatch';
import { dispatchAgentStep } from '@forge/engine/interaction';
import { compileRunPlan } from '@forge/engine/plan';
import type { StepNode } from '@forge/engine/plan';
import { parseWorkflow, type Workflow, type WorkflowStep } from '@forge/engine/workflow';
import { configSchema, type ForgeConfig } from '@forge/schemas/config';
import { artifactTypeById } from '@forge/schemas/registry';
import { WORKFLOW_INDEX } from '@forge/templates';
import {
  checkSessionRequestPrompt,
  DEFAULT_OPERATING_CONTRACT_MARKER,
  FakePlatformAdapter,
  isPathShaped,
  OPERATING_CONTRACT_POINT_COUNT,
} from '@forge/testkit';

import { buildRunEngineContext } from '../packages/cli/src/commands/run/context.ts';
import { runInit } from '../packages/cli/src/init/run-init.ts';
import { OPERATING_CONTRACT } from '../packages/agents/src/prompt/index.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const WORKFLOWS_ROOT = '.forge/workflows';
const AGENTS_ROOT = '.forge/agents';
const CHECKS_ROOT = '.forge/checks';

/** One shared fixture context every workflow compiles against: a representative value for every
 * `fanout.over` target and every workflow-level input any shipped workflow references (the
 * `test/workflows.test.ts` precedent). A NEW workflow that needs another input fails its compile check
 * below with the unresolved placeholder named; add the input here. */
const FIXTURE_CONTEXT = {
  stage: {
    stories: [
      {
        id: 'story-1',
        owner_role: 'backend',
        test_paths: 'test/story-1.test.ts',
        files_expected: 'src/story-1.ts',
      },
    ],
  },
  run: {
    findings: [{ id: 'defect-1' }],
    testPaths: 'test/story-1.test.ts',
    filesExpected: 'src/story-1.ts',
  },
  vars: { integration_branch: 'forge/integration/stage-1' },
  stageId: 'stage-1',
  storyId: 'story-1',
  ownerRole: 'backend',
  defectId: 'defect-1',
  migrationGoal: 'expand the users table',
  changeSummary: 'add a new field',
  goal: 'extract a shared helper',
  interfaceName: 'orders-api',
  buildTarget: 'ios',
};

/**
 * Agent steps that declare no `brief:` at all, by `<workflowId>:<stepId>` (no fanout item suffix). Q203:
 * these two `swarm-review` reviewer steps are dispatched with a block [4] synthesized from their declared
 * inputs and outputs, because perspective briefs are the reviewer agent's own `prompt.briefs.<mode>`. Any
 * other agent step without a brief fails. The test fails if a listed step no longer exists or now has a
 * brief (the entry would be stale).
 */
const BRIEFLESS_AGENT_STEPS: ReadonlySet<string> = new Set([
  'build-stage:review',
  'implement-story:review',
]);

/**
 * Step kinds that carry no agent prompt and are therefore never dispatched to an adapter. Every kind a
 * shipped workflow uses must be here, or be `agent`/`session` (covered), or the test fails: a new step kind
 * that starts talking to an agent cannot slip past unnoticed.
 */
const NON_AGENT_KINDS: ReadonlySet<string> = new Set([
  'command',
  'gate',
  'merge',
  'checkpoint',
  // No adapter session: `elicit` asks a human, and `subworkflow` runs a nested workflow whose own
  // agent steps are covered under that workflow's id. Neither is executable yet (RUN-039).
  'elicit',
  'subworkflow',
]);

interface ShippedWorkflow {
  readonly origin: string;
  readonly workflow: Workflow;
}

let projectDir = '';
let config: ForgeConfig;
let adapter: FakePlatformAdapter;
let ctx: ExecuteStepContext;
const requests: SessionRequest[] = [];
/** The grant each dispatched agent step carried, to show the grant is not uniformly empty. */
const grants: {
  agentId: string;
  write: boolean;
  exec: boolean;
  execPatterns: string;
}[] = [];
/** Interaction-mode participant sessions checked read-only below (`PLAN-M13.md` P15: the ordinary agent steps
 * no longer include a read-only one, every role that authors a document writes, so the read-only side of the
 * grant is what these prove). */
let readOnlyParticipants = 0;
let shipped: readonly ShippedWorkflow[] = [];

async function listWorkflowFiles(dir: string): Promise<readonly string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.workflow.yaml'))
    .sort()
    .map((name) => path.join(dir, name));
}

async function loadShippedWorkflows(): Promise<readonly ShippedWorkflow[]> {
  const files: string[] = [...(await listWorkflowFiles(path.join(projectDir, WORKFLOWS_ROOT)))];
  const moduleNames = (await readdir(modulesDir)).sort();
  for (const moduleName of moduleNames) {
    files.push(...(await listWorkflowFiles(path.join(modulesDir, moduleName, 'workflows'))));
  }
  const loaded: ShippedWorkflow[] = [];
  for (const file of files) {
    const parsed = parseWorkflow(await readFile(file, 'utf8'));
    if (!parsed.success) {
      throw new Error(`${file} failed to parse: ${JSON.stringify(parsed.issues)}`);
    }
    // Project files are labelled by their place in the initialised project, not by a temp path.
    const origin = file.startsWith(projectDir)
      ? `forge init: ${path.relative(projectDir, file)}`
      : path.relative(repoRoot, file);
    loaded.push({ origin, workflow: parsed.workflow });
  }
  return loaded;
}

/** Three distinct models, one per tier, so "the model resolved for this agent's tier" and "any valid
 * model" (or `ctx.model`, the adapter's first listed one) can be told apart. */
const TIER_MODELS = {
  frugal: 'forge-fake-frugal',
  balanced: 'forge-fake-balanced',
  max: 'forge-fake-max',
} as const;

/** `models.tiers`, with `TIER_MODELS` written into any tier `forge init` left unmapped for the fake
 * adapter. `PLAN-M13.md` P5b makes `forge init` write the tier map from the selected adapter's own
 * `defaultTierModels()`/`listModels()`; `FakePlatformAdapter` declares no tier defaults, so a fresh
 * project on it has every tier unmapped (which is what makes each agent step fail RUN-078), and this
 * setup writes the map the way a user would edit it into `.forge/config.yaml`. What init did write is kept
 * as is; only the gap it left is filled. */
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

beforeAll(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), 'forge-p6-all-workflows-'));
  adapter = new FakePlatformAdapter(
    {},
    {
      strict: { operatingContract: OPERATING_CONTRACT },
      models: Object.values(TIER_MODELS),
    },
  );
  // Records every request the strict check accepted (a matcher that never matches keeps the default
  // script). Refused requests never reach a matcher, so they show up in `adapter.strictViolations`.
  adapter.script((request) => {
    requests.push(request);
    return false;
  }, {});
  // A swarm-review perspective returns the structured review object (`PLAN-M13.md` P17): a swarm-review step
  // whose perspectives return nothing readable fails, so these sessions must answer for the step to succeed.
  adapter.script(
    (request) => /:review:(design|security|testing|performance)$/.test(request.stepId),
    {
      text: ['review done'],
      structured: { findings: [], checked: ['the fixture change'] },
    },
  );

  // A real `forge init`, cwd = the temp dir: `init` writes into cwd and ignores -C, so it is never run
  // against the repository itself.
  const result = await runInit(
    projectDir,
    { name: 'P6 All Workflows', yes: true, level: 'L0' },
    { candidateAdapters: [adapter], env: {}, modulesDir },
  );
  expect(result.kind).toBe('initialized');
  // `integrationBase` is `main` (`buildRunEngineContext`); a lane branches from a real commit on it.
  await execa('git', ['checkout', '-q', '-B', 'main'], { cwd: projectDir });
  // An empty commit: lanes branch from `main`, and prompt assembly reads the project root, not a lane, so
  // tracking the hundreds of init files would only slow seventy worktree creations.
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
  config = withFakeTiers(written, adapter.id);
  // The same constructor `forge run` uses for its context, so the assembly under test is production's.
  ctx = {
    ...(await buildRunEngineContext({
      paths: new ProjectPaths(projectDir),
      projectRoot: projectDir,
      config,
      runId: 'run-p6',
      adapter,
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    })),
    // Worktrees of 70 steps are not needed after each; the prompt record lives under `.forge/state`.
    retainLaneWorktrees: false,
  };
  // No `modules/` directory is copied into the project: a real `forge init` project has none, and the session
  // roster (who may decide) is read from `.forge/agents`, like dispatch (`PLAN-M13.md` P27, Q215).
  expect(await stat(path.join(projectDir, 'modules')).catch(() => undefined)).toBeUndefined();
  shipped = await loadShippedWorkflows();
}, 300_000);

afterAll(async () => {
  if (projectDir !== '') await rm(projectDir, { recursive: true, force: true });
});

interface FlatStep {
  readonly id: string;
  readonly kind: string;
  readonly brief: string | undefined;
  /** `agent` steps only: the `05` §5.7 interaction mode the step declares, if any. */
  readonly mode: string | undefined;
  readonly perspectives: readonly string[] | undefined;
}

/** Every leaf step of `steps`: a `parallel`/`sequence` group is replaced by its members, and a fanout is
 * reported under its own id with its child's kind and brief (the child has no id of its own; compiled
 * nodes are `<workflow>:<fanout id>:<item>`). */
function flatSteps(steps: readonly WorkflowStep[], inheritedId?: string): readonly FlatStep[] {
  return steps.flatMap((step): readonly FlatStep[] => {
    const id = inheritedId ?? step.id ?? '';
    if (step.kind === 'parallel' || step.kind === 'sequence') return flatSteps(step.steps);
    if (step.kind === 'fanout') return flatSteps([step.step], id);
    const agentFields = step as { brief?: string; mode?: string; perspectives?: readonly string[] };
    return [
      {
        id,
        kind: step.kind,
        brief: agentFields.brief,
        mode: agentFields.mode,
        perspectives: agentFields.perspectives,
      },
    ];
  });
}

/** Every `agent`/`session` step a workflow declares, fanout children included, read from the parsed source
 * and not from the compiled plan: the compiled plan is what is under test, so its count must match this
 * independent one. (Each fixture fanout has exactly one item.) */
function declaredPromptSteps(workflow: Workflow): readonly FlatStep[] {
  return flatSteps(workflow.steps).filter(
    (step) => step.kind === 'agent' || step.kind === 'session',
  );
}

/** Every shipped workflow must compile whole against `FIXTURE_CONTEXT`: there is no exclusion list. It used to
 * carry one entry, `build-stage:merge` (a `merge` step's per-item `dependsOn` could not resolve `item.id`,
 * Q71/Q88), which compiled the rest of `build-stage` without that step; the compiler now folds a merge's
 * per-item dependencies (Q211, `PLAN-M13.md` P13), so a workflow that fails to compile is a real failure. */
function compileForTest(workflow: Workflow): readonly StepNode[] {
  const attempt = compileRunPlan(workflow, FIXTURE_CONTEXT);
  if (attempt.success) return attempt.nodes;
  throw new Error(
    `${workflow.id} fails to compile against FIXTURE_CONTEXT: ${JSON.stringify(attempt.issues)}. ` +
      'Add the input it references to FIXTURE_CONTEXT, or fix the workflow or the compiler: nothing ' +
      'is excluded from compilation.',
  );
}

/** `<workflowId>:<stepId>` from a compiled node id, dropping a fanout item suffix. */
function stepKey(node: StepNode, workflow: Workflow): string {
  const rest = node.id.slice(workflow.id.length + 1);
  return `${workflow.id}:${rest.split(':')[0] ?? rest}`;
}

describe('enumeration is real', () => {
  it('the workflow files on disk, the module manifests and the enumeration all agree', async () => {
    // Independent of `WORKFLOW_INDEX` (which `forge init` copies from): the directory listing must match it,
    // and the workflows every module.yaml says it provides must be exactly the ones enumerated.
    const dir = path.join(repoRoot, 'packages', 'templates', 'templates', 'workflows');
    const onDisk = (await listWorkflowFiles(dir)).map((file) =>
      path.basename(file, '.workflow.yaml'),
    );
    expect(onDisk.sort()).toEqual(Object.keys(WORKFLOW_INDEX).sort());

    const provided: string[] = [];
    for (const name of await readdir(modulesDir)) {
      const manifest: unknown = YAML.parse(
        await readFile(path.join(modulesDir, name, 'module.yaml'), 'utf8'),
      );
      const list = (manifest as { provides?: { workflows?: readonly string[] } }).provides
        ?.workflows;
      provided.push(...(list ?? []));
    }
    expect(provided.length).toBeGreaterThan(0);
    expect(provided.sort()).toEqual(shipped.map((entry) => entry.workflow.id).sort());
  });

  it("an agent id shipped by several modules is installed as the last (alphabetical) module's own copy", async () => {
    // `loadAgentRegistry`: "a later entry with the same id wins". The module workflows below run against
    // `.forge/agents`, so those files must be the module-owned versions, not fm-core's older copies.
    const owners = new Map<string, string[]>();
    for (const moduleName of (await readdir(modulesDir)).sort()) {
      const dir = path.join(modulesDir, moduleName, 'agents');
      for (const file of await readdir(dir).catch(() => [] as string[])) {
        if (!file.endsWith('.agent.yaml')) continue;
        const id = file.slice(0, -'.agent.yaml'.length);
        owners.set(id, [...(owners.get(id) ?? []), moduleName]);
      }
    }
    const shared = [...owners].filter(([, modulesOf]) => modulesOf.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const [id, modulesOf] of shared) {
      const winner = modulesOf.at(-1) ?? '';
      const own: unknown = YAML.parse(
        await readFile(path.join(modulesDir, winner, 'agents', `${id}.agent.yaml`), 'utf8'),
      );
      const installed = await readRawAgent(id);
      expect(
        installed.mandate.trim(),
        `${id}: installed mandate differs from ${winner}'s own`,
      ).toBe((own as RawAgent).mandate.trim());
    }
  });

  it('finds every workflow @forge/templates ships, laid down by forge init, and the modules', () => {
    const fromInit = shipped.filter((entry) => entry.origin.startsWith('forge init:'));
    const fromModules = shipped.filter((entry) => entry.origin.startsWith('modules'));
    expect(fromInit.map((entry) => entry.workflow.id).sort()).toEqual(
      Object.keys(WORKFLOW_INDEX).sort(),
    );
    expect(Object.keys(WORKFLOW_INDEX).length).toBeGreaterThan(0);
    // Every module that has a workflows directory contributes at least one workflow.
    expect(fromModules.length).toBeGreaterThan(0);
    const ids = shipped.map((entry) => entry.workflow.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every module with a workflows directory was enumerated', async () => {
    const moduleNames = await readdir(modulesDir);
    const withWorkflows: string[] = [];
    for (const name of moduleNames) {
      const dir = path.join(modulesDir, name, 'workflows');
      const found = await stat(dir).then(
        (info) => info.isDirectory(),
        () => false,
      );
      if (found && (await listWorkflowFiles(dir)).length > 0) withWorkflows.push(name);
    }
    for (const name of withWorkflows) {
      expect(shipped.some((entry) => entry.origin.startsWith(path.join('modules', name)))).toBe(
        true,
      );
    }
  });

  it('every shipped workflow compiles WHOLE against the fixture context: none skipped, none trimmed', async () => {
    const templatesDir = path.join(repoRoot, 'packages', 'templates', 'templates', 'workflows');
    let onDisk = (await listWorkflowFiles(templatesDir)).length;
    for (const name of await readdir(modulesDir)) {
      const dir = path.join(modulesDir, name, 'workflows');
      const found = await stat(dir).then(
        (info) => info.isDirectory(),
        () => false,
      );
      if (found) onDisk += (await listWorkflowFiles(dir)).length;
    }
    expect(shipped.length).toBe(onDisk);
    for (const { origin, workflow } of shipped) {
      const result = compileRunPlan(workflow, FIXTURE_CONTEXT);
      expect(
        result.success,
        `${origin} does not compile: ${JSON.stringify(result.success ? [] : result.issues)}`,
      ).toBe(true);
    }
    // The step that used to be cut out to make `build-stage` compile is there, and depends on the reviews.
    const buildStage = shipped.find((entry) => entry.workflow.id === 'build-stage');
    const whole = compileRunPlan(buildStage!.workflow, FIXTURE_CONTEXT);
    if (!whole.success) throw new Error('build-stage does not compile');
    const merge = whole.nodes.find((node) => node.kind === 'merge');
    expect(merge, 'build-stage compiled without its merge step').toBeDefined();
    expect(merge?.dependsOn).toEqual(['build-stage:review:story-1']);
  });

  it('the remaining exclusion set names only things that still exist and are still true', () => {
    for (const key of BRIEFLESS_AGENT_STEPS) {
      const [workflowId, stepId] = key.split(':') as [string, string];
      const entry = shipped.find((candidate) => candidate.workflow.id === workflowId);
      expect(
        entry,
        `BRIEFLESS_AGENT_STEPS names "${key}", but ${workflowId} no longer ships`,
      ).toBeDefined();
      const step = flatSteps(entry?.workflow.steps ?? []).find(
        (candidate) => candidate.id === stepId,
      );
      expect(step, `BRIEFLESS_AGENT_STEPS names "${key}", which no longer exists`).toBeDefined();
      expect(step?.kind).toBe('agent');
      expect(
        step?.brief,
        `${key} now has a brief; remove it from BRIEFLESS_AGENT_STEPS`,
      ).toBeUndefined();
    }
  });

  it('every step kind a shipped workflow uses is either dispatched here or explicitly non-agent', () => {
    const kinds = new Set(
      shipped.flatMap((entry) => flatSteps(entry.workflow.steps).map((step) => step.kind)),
    );
    for (const kind of kinds) {
      expect(
        kind === 'agent' || kind === 'session' || NON_AGENT_KINDS.has(kind),
        `step kind "${kind}" is new: dispatch it here or add it to NON_AGENT_KINDS with a reason`,
      ).toBe(true);
    }
    expect(kinds.has('agent')).toBe(true);
    expect(kinds.has('session')).toBe(true);
    for (const kind of NON_AGENT_KINDS) {
      expect(
        kinds.has(kind),
        `NON_AGENT_KINDS names "${kind}", which no shipped workflow uses`,
      ).toBe(true);
    }
  });
});

describe('the strict adapter is wired to the real operating contract and block names', () => {
  it("testkit's default contract marker is the verbatim opening of OPERATING_CONTRACT", () => {
    expect(OPERATING_CONTRACT.startsWith(DEFAULT_OPERATING_CONTRACT_MARKER)).toBe(true);
  });

  it("testkit's expected point count is the number of numbered points OPERATING_CONTRACT has", () => {
    const points = [...OPERATING_CONTRACT.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
    expect(points).toEqual(Array.from({ length: OPERATING_CONTRACT_POINT_COUNT }, (_, i) => i + 1));
  });
});

/** Interaction modes (`05` §5.7) whose dispatch is the ordinary single agent session `executeStep` already
 * ran; a step declaring one of these needs nothing further. */
const SINGLE_SESSION_MODES: ReadonlySet<string> = new Set(['solo', 'fan-out', 'relay']);

/** Modes that dispatch one participant session per perspective (`dispatchAgentStep`), which `executeStep`
 * never reaches for a workflow `agent` step (`StepNode` drops `mode`, Q203 D2), so this test drives them.
 * A shipped step declaring any other mode fails the test until its coverage is added. */
const PERSPECTIVE_MODES: ReadonlySet<string> = new Set(['swarm-review', 'panel']);

interface RawAgent {
  readonly mandate: string;
  readonly outputs?: readonly { readonly type: string; readonly path: string }[];
  readonly decisions_owned: readonly string[];
  readonly prompt: { readonly system: string };
  readonly model: { readonly tier: 'frugal' | 'balanced' | 'max' };
  readonly tools: {
    readonly read: boolean;
    readonly write: boolean;
    readonly exec?: readonly string[] | false;
    readonly network: boolean | 'none' | 'allowlist' | 'full';
  };
}

/** The agent file as written into the project by `forge init`, read as plain YAML: what the expectations
 * below are derived from, deliberately not through the resolvers production uses. */
async function readRawAgent(agentId: string): Promise<RawAgent> {
  const raw: unknown = YAML.parse(
    await readFile(path.join(projectDir, AGENTS_ROOT, `${agentId}.yaml`), 'utf8'),
  );
  return raw as RawAgent;
}

/** The grant a session must carry, derived by hand from the agent file: with no overlay and no escalation
 * (this project has neither) `resolveStepToolGrant` returns the agent's own `tools` verbatim, network
 * `false` meaning `none`. Deliberately not computed by calling the resolver. */
function expectedGrant(raw: RawAgent): {
  read: boolean;
  write: boolean;
  exec: readonly string[] | false;
  network: string;
} {
  const exec = Array.isArray(raw.tools.exec) && raw.tools.exec.length > 0 ? raw.tools.exec : false;
  const network =
    raw.tools.network === false
      ? 'none'
      : raw.tools.network === true
        ? 'allowlist'
        : raw.tools.network;
  return { read: raw.tools.read, write: raw.tools.write, exec, network };
}

/** The nine blocks of a compiled prompt, by number. */
function blocksOf(systemPrompt: string): ReadonlyMap<number, string> {
  const parts = systemPrompt.split(/^## \[(\d+)\] .*$/m);
  const blocks = new Map<number, string>();
  for (let i = 1; i < parts.length; i += 2) blocks.set(Number(parts[i]), parts[i + 1] ?? '');
  return blocks;
}

/** What ties a prompt to *this* agent: its mandate and decisions in block [2], its authored role prompt
 * (read from the project file), and the grant it was resolved to in block [6]. */
async function agentPromptProblems(
  request: SessionRequest,
  raw: RawAgent,
  agentId: string,
  where: string,
): Promise<string[]> {
  const problems: string[] = [];
  const blocks = blocksOf(request.systemPrompt.text);
  const role = blocks.get(2) ?? '';
  if (!role.includes(raw.mandate.trim())) {
    problems.push(`${where} [${request.stepId}]: block [2] lacks ${agentId}'s mandate`);
  }
  for (const decision of raw.decisions_owned) {
    if (!role.includes(decision)) {
      problems.push(
        `${where} [${request.stepId}]: block [2] lacks ${agentId}'s decision "${decision}"`,
      );
    }
  }
  // The project file carries a `forge:generated` banner comment that prompt assembly strips.
  const roleText = (await readFile(path.join(projectDir, '.forge', raw.prompt.system), 'utf8'))
    .replace(/^<!--.*?-->\s*/s, '')
    .trim();
  if (roleText === '' || !role.includes(roleText)) {
    problems.push(`${where} [${request.stepId}]: block [2] lacks ${agentId}'s role prompt text`);
  }
  const constraints = blocks.get(6) ?? '';
  const grant = request.tools;
  if (!constraints.includes(`- write: ${String(grant.write)}`)) {
    problems.push(
      `${where} [${request.stepId}]: block [6] does not state write: ${String(grant.write)}`,
    );
  }
  return problems;
}

/** Whether the "Role instructions" of `request`'s block [2] are, verbatim, one of the role prompt files
 * `forge init` wrote into the project (banner comment stripped), and long enough to be authored content. */
async function roleInstructionsAreAuthored(request: SessionRequest): Promise<boolean> {
  const role = blocksOf(request.systemPrompt.text).get(2) ?? '';
  const marker = 'Role instructions:\n';
  const at = role.indexOf(marker);
  if (at === -1) return false;
  const instructions = role.slice(at + marker.length).trim();
  if (instructions.length < 500) return false;
  const dir = path.join(projectDir, '.forge', 'prompts');
  for (const name of await readdir(dir)) {
    const text = (await readFile(path.join(dir, name), 'utf8'))
      .replace(/^<!--.*?-->\s*/s, '')
      .trim();
    if (text === instructions) return true;
  }
  return false;
}

/** The model `models.tiers` names for `tier` on the fake adapter, indexed by hand. */
function tierModel(tier: 'frugal' | 'balanced' | 'max'): string | undefined {
  return config.models.tiers[tier][adapter.id];
}

async function recordProblems(request: SessionRequest, where: string): Promise<readonly string[]> {
  // The mandatory prompt record (`05` §5.3) exists and is exactly what this session was sent.
  const record = new ProjectPaths(projectDir).resolveState(
    path.posix.join('runs', ctx.runId, 'steps', promptRecordDirName(request.stepId), 'prompt.md'),
  );
  const onDisk = await readFile(record, 'utf8').catch(() => undefined);
  if (onDisk === undefined)
    return [`${where}: no prompt record for ${request.stepId} at ${record}`];
  if (onDisk.trimEnd() !== request.systemPrompt.text.trimEnd()) {
    return [`${where}: prompt record for ${request.stepId} differs from the system prompt sent`];
  }
  return [];
}

/** What every request of every step must satisfy, whatever session type sent it. */
async function checkAnyRequest(request: SessionRequest, where: string): Promise<string[]> {
  const problems: string[] = [];
  const found = checkSessionRequestPrompt(request, { operatingContract: OPERATING_CONTRACT });
  if (found.length > 0) problems.push(`${where} [${request.stepId}]: ${found.join('; ')}`);
  const tierModels: readonly string[] = Object.values(TIER_MODELS);
  if (!tierModels.includes(request.model) || request.model === ctx.model) {
    problems.push(
      `${where} [${request.stepId}]: model "${request.model}" is not one resolved through ` +
        `models.tiers (ctx.model is "${ctx.model}")`,
    );
  }
  problems.push(...(await recordProblems(request, where)));
  return problems;
}

describe('every agent and session step of every shipped workflow is dispatched with a real prompt', () => {
  it('starts from a project whose tier map is what the expectations below assume', () => {
    expect(config.models.overrides).toEqual({});
    for (const tier of ['frugal', 'balanced', 'max'] as const) {
      expect(tierModel(tier), `no model for tier ${tier}`).toBeDefined();
    }
  });

  it('dispatches each step through the real dispatcher and the strict adapter refuses none', async () => {
    expect(shipped.length).toBeGreaterThan(0);
    let dispatched = 0;
    let refusalsSeen = 0;
    let agentSteps = 0;
    let sessionSteps = 0;
    const modelsUsed = new Set<string>();
    const problems: string[] = [];

    const noteRefusals = (where: string): boolean => {
      if (adapter.strictViolations.length <= refusalsSeen) return false;
      for (const record of adapter.strictViolations.slice(refusalsSeen)) {
        problems.push(`${where}: strict adapter refused: ${JSON.stringify(record)}`);
      }
      refusalsSeen = adapter.strictViolations.length;
      // Reported here as a failure of this test; the global hook must not report it a second time.
      adapter.acknowledgeStrictViolations();
      return true;
    };

    for (const { origin, workflow } of shipped) {
      const nodes = compileForTest(workflow);
      const promptNodes = nodes.filter((node) => node.kind === 'agent' || node.kind === 'session');
      const declared = declaredPromptSteps(workflow);
      // Independent count from the parsed source: nothing may be silently dropped between the YAML and
      // the dispatch loop.
      expect(promptNodes.length, `${origin}: compiled prompt-step count`).toBe(declared.length);

      for (const node of promptNodes) {
        const before = requests.length;
        const outcome = await executeStep(node, ctx);
        const sent = requests.slice(before);
        const where = `${origin} :: ${node.id}`;

        if (noteRefusals(where)) continue;
        // What is under test is the prompt a session is *sent*, so a step that fails for a reason of its own
        // after an accepted session does not fail this test (the scripted fake writes no files, so a later
        // check that a step produced its declared outputs, `PLAN-M13.md` P7, fails every such step). A step
        // refused by prompt assembly or by the adapter, or one that never reached the adapter, does.
        const failedSource = outcome.failure?.source;
        if (failedSource === 'prompt' || failedSource === 'adapter') {
          problems.push(
            `${where}: step failed before a clean session: ${failedSource} ${outcome.failure?.message ?? ''}`,
          );
          continue;
        }
        if (sent.length === 0) {
          problems.push(
            `${where}: no session reached the adapter (${failedSource ?? 'no failure reported'})`,
          );
          continue;
        }
        dispatched += sent.length;
        for (const request of sent) {
          problems.push(...(await checkAnyRequest(request, where)));
          modelsUsed.add(request.model);
        }

        if (node.kind === 'session') {
          sessionSteps += 1;
          const participants = sent.filter((request) => request.stepId.includes(':panel:'));
          if (participants.length === 0) {
            problems.push(`${where}: no participant session was dispatched`);
          }
          for (const request of participants) {
            // Participants read the primary author's tree and never write (`runParticipantSession`).
            if (request.tools.write || request.tools.exec !== false) {
              problems.push(`${where} [${request.stepId}]: participant is not read-only`);
            }
            // The role block carries real authored role text. (Whose role it is is fixed by prompt assembly,
            // not by this test: a participant currently carries the role block of the agent that dispatched
            // the session -- for a session, the synthetic facilitator -- not its own, Q203 D9.)
            if (!(await roleInstructionsAreAuthored(request))) {
              problems.push(
                `${where} [${request.stepId}]: block [2] carries no authored role prompt from .forge/prompts`,
              );
            }
          }
          // Reaching every phase: the machine was driven through DIVERGE, CONVERGE and DECIDE.
          for (const phase of ['diverge', 'converge', 'decide']) {
            if (!sent.some((request) => request.stepId.split(':').includes(phase))) {
              problems.push(`${where}: the session never dispatched its ${phase} phase`);
            }
          }
          continue;
        }

        agentSteps += 1;
        const flat = declared.find((step) => step.id === stepKey(node, workflow).split(':')[1]);
        const mode = flat?.mode;
        // A `swarm-review` step is dispatched by `executeStep` itself as one read-only session per perspective
        // and the engine persists the report in its lane (`PLAN-M13.md` P17): there is no session carrying the
        // step's own id, so its requests are the perspectives' (checked below), and the step must succeed
        // (the engine-written report satisfies the output check even though these fake sessions write nothing).
        const engineDispatched = mode === 'swarm-review';
        if (engineDispatched) {
          if (outcome.status !== 'succeeded') {
            problems.push(
              `${where}: the swarm-review step failed: ${outcome.failure?.source ?? ''} ${outcome.failure?.message ?? ''}`,
            );
          }
        } else {
          problems.push(...(await checkAgentStep(node, workflow, sent, where)));
        }

        // A step that declares an interaction mode with perspectives dispatches one participant session per
        // perspective (for the modes other than `swarm-review`, through a path `executeStep` does not take
        // for a workflow step).
        if (mode !== undefined && !SINGLE_SESSION_MODES.has(mode)) {
          if (!PERSPECTIVE_MODES.has(mode)) {
            problems.push(
              `${where}: interaction mode "${mode}" has no offline coverage in this test`,
            );
            continue;
          }
          const perspectives = flat?.perspectives ?? [];
          if (perspectives.length === 0)
            problems.push(`${where}: mode ${mode} declares no perspectives`);
          let modeSent: readonly SessionRequest[] = sent;
          if (!engineDispatched) {
            const modeBefore = requests.length;
            const agent = await ctx.assembly.loadAgent(String(node.agent));
            await dispatchAgentStep(node, agent, ctx, mode as 'swarm-review' | 'panel', {
              perspectives,
            });
            modeSent = requests.slice(modeBefore);
            if (noteRefusals(where)) continue;
            dispatched += modeSent.length;
          }
          // Exactly one session per perspective for an engine-dispatched review: no ordinary step session.
          if (
            engineDispatched
              ? modeSent.length !== perspectives.length
              : modeSent.length < perspectives.length
          ) {
            problems.push(
              `${where}: mode ${mode} dispatched ${String(modeSent.length)} session(s) for ${String(perspectives.length)} perspective(s)`,
            );
          }
          for (const request of modeSent) {
            if (engineDispatched) {
              // Each request is the session of ONE declared perspective: its own id names it and its block [4]
              // asks for exactly that one.
              const perspective = perspectives.find((name) =>
                request.stepId.endsWith(`:review:${name}`),
              );
              const blockFour = blocksOf(request.systemPrompt.text).get(4) ?? '';
              if (
                perspective === undefined ||
                !blockFour.includes(`Review the change from the "${perspective}" perspective.`)
              ) {
                problems.push(
                  `${where} [${request.stepId}]: block [4] does not ask for this session's own perspective`,
                );
              }
            }
            problems.push(...(await checkAnyRequest(request, `${where} (mode ${mode})`)));
            if (request.tools.write || request.tools.exec !== false) {
              problems.push(`${where} [${request.stepId}]: ${mode} participant is not read-only`);
            } else {
              readOnlyParticipants += 1;
            }
          }
        }
      }
    }

    expect(problems).toEqual([]);
    expect(agentSteps).toBeGreaterThan(0);
    expect(sessionSteps).toBeGreaterThan(0);
    expect(dispatched).toBeGreaterThanOrEqual(agentSteps + sessionSteps);
    // The tier map is really consulted: agents on different tiers reach different models.
    expect(modelsUsed.size).toBeGreaterThan(1);
    // ...and so is the grant: some agents write, some may exec, and they are not all identical. Since P15 every
    // agent that runs an ordinary step holds `write` (the roles that only judge, `reviewer` and `critic`, run
    // no ordinary step: the engine writes the review report), so the read-only side is proven by the
    // participant sessions, which each carried a grant with neither `write` nor `exec`, and the ordinary
    // agents' grants are told apart by their exec allowlists.
    expect(grants.some((grant) => grant.write)).toBe(true);
    expect(grants.some((grant) => grant.exec)).toBe(true);
    expect(readOnlyParticipants).toBeGreaterThan(0);
    expect(new Set(grants.map((grant) => grant.execPatterns)).size).toBeGreaterThan(1);
    expect(adapter.strictViolations).toEqual([]);
  }, 600_000);
});

async function checkAgentStep(
  node: StepNode,
  workflow: Workflow,
  sent: readonly SessionRequest[],
  where: string,
): Promise<readonly string[]> {
  const problems: string[] = [];
  const assembly = ctx.assembly;

  if (node.agent === undefined) return [`${where}: agent step names no agent`];
  const request = sent.find((candidate) => candidate.stepId === node.id);
  if (request === undefined) return [`${where}: no request carried the step's own id`];

  // The agent resolves to a real file in the project, and its grant and model reach the request.
  try {
    const agent = await assembly.loadAgent(String(node.agent));
    if (agent.id !== String(node.agent)) problems.push(`${where}: resolved agent id "${agent.id}"`);
    const raw = await readRawAgent(agent.id);
    const want = expectedGrant(raw);
    const got = request.tools;
    if (
      got.read !== want.read ||
      got.write !== want.write ||
      JSON.stringify(got.exec) !== JSON.stringify(want.exec) ||
      got.network !== want.network
    ) {
      problems.push(
        `${where}: ${agent.id}'s request grant ${JSON.stringify(got)} is not its declared ${JSON.stringify(want)}`,
      );
    }
    grants.push({
      agentId: agent.id,
      write: got.write,
      exec: got.exec !== false,
      execPatterns: JSON.stringify(got.exec),
    });
    problems.push(...(await agentPromptProblems(request, raw, agent.id, where)));
    const expected = tierModel(raw.model.tier);
    if (request.model !== expected) {
      problems.push(
        `${where}: ${agent.id} is tier ${raw.model.tier} (model "${String(expected)}") but the request used "${request.model}"`,
      );
    }
  } catch (cause) {
    problems.push(`${where}: agent "${String(node.agent)}" does not resolve: ${String(cause)}`);
  }

  // The brief is real text that reached block [4] -- never the path -- and it is the brief the workflow
  // YAML names, read from the file `forge init` wrote, not through the resolver production uses.
  const declaredStep = declaredPromptSteps(workflow).find(
    (step) => step.id === stepKey(node, workflow).split(':')[1],
  );
  if (declaredStep === undefined) {
    problems.push(`${where}: no declared step in the workflow YAML`);
  } else if (declaredStep.brief !== node.brief) {
    problems.push(
      `${where}: the workflow declares brief ${String(declaredStep.brief)} but the step carries ${String(node.brief)}`,
    );
  }
  if (node.brief === undefined) {
    if (!BRIEFLESS_AGENT_STEPS.has(stepKey(node, workflow))) {
      problems.push(`${where}: declares no brief and is not in BRIEFLESS_AGENT_STEPS`);
    }
  } else {
    const briefText = (await readFile(path.join(projectDir, '.forge', node.brief), 'utf8'))
      .replace(/^<!--.*?-->\s*/s, '')
      .trim();
    if (briefText === '') problems.push(`${where}: brief ${node.brief} resolved to nothing`);
    // Authored content, not a stub: the shortest shipped brief is over two kilobytes.
    else if (briefText.length < 500) {
      problems.push(
        `${where}: brief ${node.brief} is ${String(briefText.length)} characters, a stub`,
      );
    }
    if (isPathShaped(briefText)) {
      problems.push(`${where}: brief ${node.brief} resolved to a path, not text`);
    }
    // The whole brief, not a line of it, is in block [4] (only heading look-alikes are rewritten).
    const blockFour = blocksOf(request.systemPrompt.text).get(4) ?? '';
    if (!blockFour.includes(briefText)) {
      problems.push(`${where}: the text of ${node.brief} is not in block [4] of the system prompt`);
    }
  }

  // The other blocks carry what the agent needs, not placeholders: its output contract (block [5]), the
  // project it works in (block [3]), the definition of done (block [7]) and the grant it runs under
  // (block [6]).
  const blocks = blocksOf(request.systemPrompt.text);
  const raw = await readRawAgent(String(node.agent));
  const contract = blocks.get(5) ?? '';
  // Block [5] states what the engine enforces for THIS step (`PLAN-M13.md` P18, Q224): the declared outputs, each at the
  // registry path the output check looks in (with its subtype), and the step's own `produces` (positive entries as the
  // claim, `!` entries as refusals, never as permissions). It lists nothing else: not the role's other outputs.
  const declaredTypes = node.outputs.map((declared) => declared.type);
  const lines = contract.split('\n').filter((line) => line.startsWith('- '));
  const typedLines = lines.filter(
    (line) =>
      !line.startsWith('- Files: ') &&
      !line.startsWith('- Never write ') &&
      !line.startsWith('- This step declares no'),
  );
  const listedTypes = typedLines.map((line) => /^- (\w+):/.exec(line)?.[1] ?? '');
  if (listedTypes.sort().join(',') !== [...declaredTypes].sort().join(',')) {
    problems.push(
      `${where}: block [5] lists ${listedTypes.join(', ') || 'no type'} but the step declares ${declaredTypes.join(', ') || 'none'}`,
    );
  }
  const claim = resolveStepClaim(node, config.paths, 'strict');
  for (const declared of node.outputs) {
    const definition = artifactTypeById(declared.type);
    if (definition === undefined) {
      problems.push(`${where}: declares the unregistered output type ${declared.type}`);
      continue;
    }
    const wantPath = outputGlob(definition.id, config.paths);
    const line = typedLines.find((candidate) => candidate.startsWith(`- ${declared.type}: `));
    // The line for a declared type states the path per line (not anywhere in the block), the subtype, and, for a
    // Diagram, the sidecar the check demands.
    if (line?.includes(`path \`${wantPath}\``) !== true) {
      problems.push(
        `${where}: block [5] does not state the declared ${declared.type} output at the registry path ${wantPath}`,
      );
    }
    if (
      declared.subtype !== undefined &&
      line?.includes(`(subtype: ${declared.subtype})`) !== true
    ) {
      problems.push(
        `${where}: block [5] omits the subtype ${declared.subtype} of ${declared.type}`,
      );
    }
    if (definition.id === 'Diagram' && line?.includes(`\`${wantPath}.yaml\``) !== true) {
      problems.push(`${where}: block [5] omits the sidecar of the declared Diagram`);
    }
    if (!outputPathCoveredBy(definition.id, config.paths, claim.globs)) {
      problems.push(`${where}: ${declared.type} at ${wantPath} is outside the step's claim`);
    }
  }
  const positives = node.produces.map(String).filter((glob) => !glob.startsWith('!'));
  const refusals = node.produces.map(String).filter((glob) => glob.startsWith('!'));
  const filesLine = lines.find((line) => line.startsWith('- Files: '));
  if (positives.length > 0) {
    if (filesLine === undefined || positives.some((glob) => !filesLine.includes(`\`${glob}\``))) {
      problems.push(`${where}: block [5] does not state the claim ${positives.join(', ')}`);
    }
  } else if (filesLine !== undefined) {
    problems.push(`${where}: block [5] states a claim the step does not have`);
  }
  // A refusal is never rendered as a permission: no backticked `!...` anywhere in the block.
  if (contract.includes('`!')) problems.push(`${where}: block [5] renders a "!" entry as a path`);
  if (refusals.length > 0 && !lines.some((line) => line.startsWith('- Never write '))) {
    problems.push(`${where}: block [5] omits the refusals ${refusals.join(', ')}`);
  }
  if (
    declaredTypes.length === 0 &&
    positives.length === 0 &&
    !contract.includes('names no paths to write')
  ) {
    problems.push(`${where}: block [5] of a step with no outputs and no claim does not say so`);
  }
  if (!(blocks.get(3) ?? '').includes(config.project.name)) {
    problems.push(`${where}: block [3] does not name the project "${config.project.name}"`);
  }
  const done = blocks.get(7) ?? '';
  const gateIds = node.gateEvidence ?? [];
  if (
    gateIds.length === 0
      ? !done.includes('none declared')
      : gateIds.some((id) => !done.includes(id))
  ) {
    problems.push(
      `${where}: block [7] does not list the checks of gates ${JSON.stringify(gateIds)} (or the explicit "none declared")`,
    );
  }
  const want = expectedGrant(raw);
  const constraints = blocks.get(6) ?? '';
  if (!constraints.includes(`- network: ${want.network}`)) {
    problems.push(`${where}: block [6] does not state network: ${want.network}`);
  }
  for (const pattern of want.exec === false ? [] : want.exec) {
    if (!constraints.includes(pattern)) {
      problems.push(`${where}: block [6] lacks the exec pattern ${pattern}`);
    }
  }
  return problems;
}
