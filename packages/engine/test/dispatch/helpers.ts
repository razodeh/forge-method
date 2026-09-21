/**
 * Shared fixtures for `@forge/engine/dispatch`'s own tests — a real `ExecuteStepContext` built from the
 * real facades and a `StepNode` builder. Each test file builds its own tmp-dir git repository directly
 * (matching `@forge/vcs`'s own test convention, `packages/vcs/test/lanes.test.ts`) rather than sharing one
 * `createTempRepo` from here: `node:os`'s `tmpdir` is R10-restricted in production code, and the test-file
 * exemption in `eslint.config.js` only covers files literally named `*.test.ts`, not a shared helper module
 * like this one.
 *
 * @see PLAN-M5.md P15
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';
import type { PlatformAdapter, ToolGrant } from '@forge/adapter-kit';
import { ProjectPaths, type AbsolutePath } from '@forge/core';
import type { AgentDefinition } from '@forge/agents/schema';

import { listProjectAgents } from '../../src/dispatch/assembly-context.ts';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '../../src/dispatch/facades.ts';
import type {
  ExecuteStepContext,
  KbAccess,
  LaneHandle,
  PromptAssemblyContext,
} from '../../src/dispatch/types.ts';
import type { GateDefinition } from '../../src/gates/index.ts';
import type { StepNode, StepNodeKind } from '../../src/plan/index.ts';

export async function readFileInRepo(repo: string, relativePath: string): Promise<string> {
  return readFile(path.join(repo, relativePath), 'utf8');
}

/** A small, valid `AgentDefinition` for tests that dispatch an agent step without caring which agent it
 * is. `id` is whatever the workflow step names, so a fixture never has to pre-register one. */
export function fixtureAgent(
  id: string,
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    id,
    name: `Fixture ${id}`,
    version: '1.0.0',
    tier: 'core',
    mandate: `Do the ${id} job.`,
    decisions_owned: [`${id}.decisions`],
    persona: { voice: 'terse', stance: 'pragmatic', disagreement_style: 'direct' },
    inputs: { required: [] },
    outputs: [{ type: 'Note', schema: 'note.schema.json', path: 'docs/note.md' }],
    kb_write: [],
    tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: { max_turns: 10, wall_clock_ms: 600_000, max_cost_usd: 5 },
    parallel_safety: { file_ownership: ['**'], exclusive: false },
    gates: { produces_evidence_for: [], may_approve: [] },
    skills: [],
    prompt: { system: 'prompts/fixture.system.md' },
    ...overrides,
  };
}

/** A KB with no entries and an index that finds nothing -- the state of every fresh project. */
export function emptyKbAccess(): KbAccess {
  return {
    backend: {
      upsertEntry: () => undefined,
      upsertLinks: () => undefined,
      search: () => [],
      expand: () => [],
      clear: () => undefined,
      close: () => undefined,
    },
    tree: { entries: [], errors: [] },
    parseErrorCount: 0,
    close: () => undefined,
  };
}

/** The engine-test default for `ExecuteStepContext.assembly`: every agent id resolves to a fixture agent
 * (never a legacy pass-through -- the same real compile/record path runs), a brief reference
 * resolves to fixture text naming it (any other reference, and inline prose, is returned as is) so a test can keep writing inline briefs, and the model tier table maps every
 * tier to the fake adapter's one model. Tests that assert on assembly itself build their own with real
 * files (`assembly.test.ts`). */
export function createFixtureAssembly(
  projectRoot: string,
  overrides: Partial<PromptAssemblyContext> = {},
): PromptAssemblyContext {
  const tier = { 'forge-fake-adapter': FAKE_MODEL_ID };
  return {
    paths: new ProjectPaths(projectRoot),
    loadAgent: (agentId) => Promise.resolve(fixtureAgent(agentId)),
    // The session roster is the project's real `.forge/agents` (production's reader), so a session test
    // seats exactly the agents it writes there; a project with none has an empty roster.
    listAgents: () => listProjectAgents(new ProjectPaths(projectRoot), '.forge/agents'),
    // A `briefs/` reference (block [4]) resolves to sentence-shaped text that still names the reference,
    // never to the bare path: handing the path back as its own "content" would let a regression that
    // skips real brief resolution pass the strict adapter's block [4] check. Inline prose (most tests pass
    // their brief as text) and every other reference (role prompts) are returned unchanged.
    loadContent: (reference) =>
      Promise.resolve(
        /^briefs\/[^\s/\\]+\.md$/.test(reference)
          ? `Fixture content resolved from ${reference}.`
          : reference,
      ),
    openKb: () => Promise.resolve(emptyKbAccess()),
    models: { tiers: { frugal: tier, balanced: tier, max: tier }, overrides: {} },
    escalations: [],
    autonomy: 'guided',
    kbPackBudgetTokens: 10_000,
    skillsPackBudgetTokens: 8_000,
    templatesPackageRoot: projectRoot as AbsolutePath,
    pinnedCore: {},
    ...overrides,
  };
}

const DEFAULT_TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };

/** A monotonically increasing integer clock — deterministic, and trivial to assert ordering against
 * (event A happened before event B iff A's own recorded `now()` value is smaller), matching this whole
 * milestone's own "inject the clock" determinism discipline (`21` §21.1) rather than real wall-clock
 * timestamps a test would have no reliable way to order. */
export function createTestClock(): () => number {
  let tick = 0;
  return () => {
    const value = tick;
    tick += 1;
    return value;
  };
}

export function createTestContext(
  overrides: Partial<ExecuteStepContext> & {
    readonly projectRoot: string;
    readonly adapter?: PlatformAdapter;
  },
): ExecuteStepContext {
  const runId = overrides.runId ?? 'run-test';
  const now = overrides.now ?? createTestClock();
  const gateRegistry: ReadonlyMap<string, GateDefinition> = overrides.gateRegistry ?? new Map();
  return {
    adapter: overrides.adapter ?? new FakePlatformAdapter(),
    vcs: overrides.vcs ?? createVcsFacade(overrides.projectRoot, runId),
    telemetry: overrides.telemetry ?? createTelemetryFacade(overrides.projectRoot, runId, now),
    gates: overrides.gates ?? createGateEvaluator(gateRegistry),
    mergeQueue:
      overrides.mergeQueue ??
      createMergeQueueFacade(overrides.integrationPath ?? overrides.projectRoot, undefined),
    runId,
    projectRoot: overrides.projectRoot,
    integrationBase: overrides.integrationBase ?? 'main',
    integrationPath: overrides.integrationPath ?? overrides.projectRoot,
    model: overrides.model ?? FAKE_MODEL_ID,
    tools: overrides.tools ?? DEFAULT_TOOLS,
    assembly: overrides.assembly ?? createFixtureAssembly(overrides.projectRoot),
    retainLaneWorktrees: overrides.retainLaneWorktrees ?? false,
    claimPolicy: overrides.claimPolicy ?? 'strict',
    signCommits: overrides.signCommits ?? false,
    now,
    laneRegistry: overrides.laneRegistry ?? new Map<string, LaneHandle>(),
    gateRegistry,
    ...(overrides.sessionBounds === undefined ? {} : { sessionBounds: overrides.sessionBounds }),
    ...(overrides.docRoots === undefined ? {} : { docRoots: overrides.docRoots }),
    ...(overrides.ask === undefined ? {} : { ask: overrides.ask }),
    ...(overrides.answers === undefined ? {} : { answers: overrides.answers }),
  };
}

export function node(
  overrides: Partial<StepNode> & { readonly id: string; readonly kind: StepNodeKind },
): StepNode {
  return {
    inputs: [],
    outputs: [],
    dependsOn: [],
    produces: [],
    consumes: [],
    retry: { maxAttempts: 1, backoffMs: [1000, 30_000], retryOn: [] },
    limits: { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 1 },
    idempotencyKey: overrides.id,
    onFailure: 'block',
    ...overrides,
  };
}
