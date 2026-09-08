/**
 * The fixture workflow `PLAN-M5.md` P20's own Surface bullet asks for: "at least one of every step kind
 * this milestone handles: `agent` (fanned-out over a small collection), `command` (inline), `gate` (a
 * trivial always-evaluable gate), `merge`." Test-local, per `SPEC-QUESTIONS.md` Q62 part 3 — real
 * workflow *content* is a later milestone's own concern; this exists only to drive the engine end to end
 * through every step kind this milestone actually built a real handler for.
 *
 * Two fanout items (not one) deliberately: a fanout of exactly one would never actually exercise real
 * concurrent execution (`06` §6.3's own scheduling), and the `merge` step's own `dependsOn` needs more
 * than one predecessor lane to prove it processes "a *set* of lanes," not just a 1:1 pairing (`10` §10.1's
 * own wording, already load-bearing for `runMergeStep`, `@forge/engine/dispatch` P15).
 *
 * @see specs/06 §6.3
 * @see specs/10 §10.1
 * @see PLAN-M5.md P20
 */
import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';
import type { AdapterCapabilities, PlatformAdapter, ToolGrant } from '@forge/adapter-kit';

import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '../../src/dispatch/facades.ts';
import type { LaneHandle } from '../../src/dispatch/types.ts';
import { compileRunPlan, type StepNode } from '../../src/plan/index.ts';
import type { RunEngineContext } from '../../src/run/run-engine.ts';
import type { ConcurrencyLimits } from '../../src/scheduler/types.ts';
import { parseWorkflow } from '../../src/workflow/parse.ts';
import type { GateDefinition } from '../../src/gates/index.ts';
import type { ExpressionContext } from '../../src/expr/index.ts';

export const FIXTURE_WORKFLOW_ID = 'e2e-fixture';
export const FIXTURE_GATE_ID = 'G-Always';

export const FIXTURE_WORKFLOW_SOURCE = `
id: ${FIXTURE_WORKFLOW_ID}
name: E2E fixture
version: 1.0.0
description: Exercises every M5 step kind for the crash-resume/determinism capstone.

steps:
  - id: prepare
    kind: command
    run: "true"
    inline: true

  - id: implement
    kind: fanout
    over: "stage.items"
    itemKey: "{{item.id}}"
    dependsOn: [ prepare ]
    step:
      kind: agent
      agent: engineer
      brief: "implement {{item.id}}"
      produces: [ "{{item.id}}.txt" ]

  - id: merge
    kind: merge
    over: "stage.items"
    # Literal compiled ids, not "implement:{{item.id}}": compile.ts's own doc comment documents that a
    # merge step (an ordinary leaf, not itself a fanout) has no "item" binding in scope, so a templated
    # per-item dependency the way 10 §10.1's own worked example writes one is a real, known,
    # deliberately-undone gap ("a real, separate feature... left undone deliberately", buildLeafNode's
    # own doc comment) -- not something this fixture should route around by depending on it working.
    # "over" itself is still required by the schema even though this leaf never actually reads it.
    dependsOn: [ "implement:story-1", "implement:story-2" ]
    policy: { conflict: abort }

  - id: verify
    kind: gate
    gate: ${FIXTURE_GATE_ID}
    dependsOn: [ merge ]
`;

export const FIXTURE_ITEM_IDS = ['story-1', 'story-2'] as const;

export function fixtureExpressionContext(): ExpressionContext {
  return { stage: { items: FIXTURE_ITEM_IDS.map((id) => ({ id })) } };
}

/** Trivially passing (`deterministic: []`/`advisory: []` -- no real check ever runs), matching
 * `runGateStep`'s own test suite's identical minimal fixture. */
export function fixtureGateRegistry(): ReadonlyMap<string, GateDefinition> {
  return new Map([
    [
      FIXTURE_GATE_ID,
      {
        id: FIXTURE_GATE_ID,
        checks: { deterministic: [], advisory: [] },
        openQuestionsPolicy: 'warn',
      },
    ],
  ]);
}

export const UNLIMITED_CONCURRENCY: ConcurrencyLimits = {
  global: 100,
  perAgent: new Map(),
  perResourceClass: new Map(),
};

const FIXTURE_TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };

/** A fresh, fully-scripted `FakePlatformAdapter` for the fixture's own two fanout instances --
 * deterministic and stable across repeated calls (no wall clock, no randomness), so a control run and a
 * later crash-killed-then-resumed run of the identical seed produce byte-identical scripted content.
 * Matched on `request.stepId`, not `request.prompt`: `StepNode.brief` is never template-resolved by
 * `compileStep` (only `inputs`/`produces`/`run`/`agent` are — confirmed directly against
 * `compile.ts`'s own `buildLeafNode`), so every fanout instance's own `prompt` is the identical, still-
 * literal `"implement {{item.id}}"` string; `stepId` is the one thing that actually varies per instance. */
export function fixtureAdapter(
  capabilityOverrides: Partial<AdapterCapabilities> = {},
): PlatformAdapter {
  const adapter = new FakePlatformAdapter(capabilityOverrides);
  for (const itemId of FIXTURE_ITEM_IDS) {
    adapter.script((request) => request.stepId.includes(itemId), {
      text: [`implemented ${itemId}`],
      writeFiles: [{ relativePath: `${itemId}.txt`, content: `${itemId}\n` }],
    });
  }
  return adapter;
}

/** Everything `runEngine`/`resumeRun` need beyond the fixture workflow itself, built from real facades
 * bound to a real tmp-dir repository -- the one shared context both the real-child-process fixture
 * script and the E2E tests construct identically, so "the same seed produces the same run" is actually
 * true of the exact same wiring, not two subtly different approximations of it. */
export function fixtureRunEngineContext(
  projectRoot: string,
  runId: string,
  seed: string,
  overrides: Partial<RunEngineContext> = {},
): RunEngineContext {
  // A monotonically increasing counter, not Date.now() (R10: even test code takes the clock injected,
  // never ambient) -- deterministic and trivial to order, matching dispatch/test/helpers.ts's own
  // createTestClock for the identical reason.
  let tick = 0;
  const now = overrides.now ?? (() => (tick += 1));
  const gateRegistry = overrides.gateRegistry ?? fixtureGateRegistry();
  return {
    adapter: overrides.adapter ?? fixtureAdapter(),
    vcs: overrides.vcs ?? createVcsFacade(projectRoot, runId),
    telemetry: overrides.telemetry ?? createTelemetryFacade(projectRoot, runId, now),
    gates: overrides.gates ?? createGateEvaluator(gateRegistry),
    mergeQueue:
      overrides.mergeQueue ??
      createMergeQueueFacade(overrides.integrationPath ?? projectRoot, undefined),
    runId,
    projectRoot,
    integrationBase: overrides.integrationBase ?? 'main',
    integrationPath: overrides.integrationPath ?? projectRoot,
    model: overrides.model ?? FAKE_MODEL_ID,
    tools: overrides.tools ?? FIXTURE_TOOLS,
    retainLaneWorktrees: overrides.retainLaneWorktrees ?? false,
    claimPolicy: overrides.claimPolicy ?? 'strict',
    signCommits: overrides.signCommits ?? false,
    now,
    laneRegistry: overrides.laneRegistry ?? new Map<string, LaneHandle>(),
    gateRegistry,
    limits: overrides.limits ?? UNLIMITED_CONCURRENCY,
    seed,
  };
}

/** The fixture's own compiled `StepNode[]`, keyed by id -- `@forge/engine/resume`'s own `ResumeContext.
 * steps` (P19), which `resumeRun` needs to turn a bare, reconstructed stepId back into a real node.
 * Re-parses/re-compiles fresh every call rather than caching: this is test-only, called at most a
 * handful of times per test, and re-compiling fresh is exactly what a real caller does too (`RunState`
 * itself never carries a compiled plan, `run-engine.ts`'s own doc comment has the fuller reasoning). */
export function fixtureCompiledSteps(): ReadonlyMap<string, StepNode> {
  const parsed = parseWorkflow(FIXTURE_WORKFLOW_SOURCE);
  if (!parsed.success)
    throw new Error(`fixture workflow failed to parse: ${JSON.stringify(parsed.issues)}`);
  const compiled = compileRunPlan(parsed.workflow, fixtureExpressionContext());
  if (!compiled.success)
    throw new Error(`fixture workflow failed to compile: ${JSON.stringify(compiled.issues)}`);
  return new Map(compiled.nodes.map((node) => [node.id, node]));
}
