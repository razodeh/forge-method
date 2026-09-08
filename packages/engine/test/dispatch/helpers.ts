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

import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '../../src/dispatch/facades.ts';
import type { ExecuteStepContext, LaneHandle } from '../../src/dispatch/types.ts';
import type { GateDefinition } from '../../src/gates/index.ts';
import type { StepNode, StepNodeKind } from '../../src/plan/index.ts';

export async function readFileInRepo(repo: string, relativePath: string): Promise<string> {
  return readFile(path.join(repo, relativePath), 'utf8');
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
    retainLaneWorktrees: overrides.retainLaneWorktrees ?? false,
    claimPolicy: overrides.claimPolicy ?? 'strict',
    signCommits: overrides.signCommits ?? false,
    now,
    laneRegistry: overrides.laneRegistry ?? new Map<string, LaneHandle>(),
    gateRegistry,
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
