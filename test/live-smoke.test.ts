/**
 * M7's own second exit test, `PLAN-M7.md`'s own closing section: "`FORGE_LIVE=1 pnpm test -- --grep
 * "live smoke"` — one real init + one story via `@forge/engine`'s already-built `runEngine`, artifacts
 * validated." One real, minimal workflow (a trivial `init` command step, a single, non-fanned-out
 * `agent` story step, a `merge` step, then a trivially-passing gate), driven end to end through the
 * real, already-built `runEngine` against a real `ClaudeCodeAdapter` -- the milestone's own explicit
 * checkpoint: *"Stop, run a genuine project through it, and let that experience inform M8+."*
 *
 * **The plan's own literal exit command does not work, in two independent ways -- both confirmed by
 * actually running them, not assumed.** `--grep` is not a real flag the real, installed
 * `vitest@4.1.11` CLI recognizes at all (`CACError: Unknown option --grep`, confirmed live); its real,
 * documented equivalent is `-t`/`--testNamePattern <pattern>` (confirmed against `vitest run --help`'s
 * own real output). Separately, the root `package.json`'s own `"test"` script is a three-command
 * `&&`-chain (the main suite, then the coverage ratchet, then a *second*, differently-configured
 * vitest run for boundary coverage) -- `pnpm test -- <args>` only ever appends `<args>` to the *last*
 * command in that chain, so `pnpm test -- --testNamePattern "live smoke"` would run the entire,
 * unfiltered main suite first (a fresh critic round confirmed this directly: it took several minutes
 * and was itself derailed by an unrelated flaky test elsewhere in the suite before the filtered command
 * ever ran) -- not the narrow, isolated run this recipe intends. The real, working command bypasses
 * `pnpm test`'s own wrapper and calls the underlying script directly:
 *
 * ```
 * FORGE_LIVE=1 node scripts/run-tests.mjs run --testNamePattern "live smoke"
 * ```
 *
 * verified directly (with `FORGE_LIVE` unset) to filter every other test file down to zero executed
 * tests, running only this file's own single, real, appropriately-named test in a few seconds -- a
 * real, two-part plan-vs-real-tooling mismatch, the same class this whole milestone has repeatedly
 * found and recorded rather than silently worked around (`SPEC-QUESTIONS.md` Q114, Q121); recorded
 * again here, in full, in Q122.
 *
 * Lives at the repository root, not inside `packages/engine/test/` or `packages/adapter-claude-code/
 * test/`: this is the one check in the whole milestone that needs both `@forge/engine` (`runEngine`
 * and its own dispatch facades) and `@forge/adapter-claude-code` (`ClaudeCodeAdapter`), and `02` §2.2
 * gives `@forge/engine` no edge to any concrete adapter package at all (confirmed directly against
 * `tools/eslint-plugin-forge-boundaries/src/graph.mjs`) — the identical "neither package can import
 * the other" reasoning `test/workflows.test.ts` already documents for the identical reason.
 *
 * **A fresh critic round found two structural bugs in an earlier draft, both of which would have
 * failed this test deterministically even on a perfect live run, unrelated to Claude Code's own real
 * behaviour** -- confirmed by actually compiling/running the workflow, not merely re-reasoned about:
 * (1) every compiled `StepNode.id` is qualified as `${workflowId}:${stepId}` by `compile.ts`'s own
 * `compileStepId`, applied uniformly to every step regardless of kind -- `finalState.stepStatuses.get(
 * 'init')` was always `undefined`; fixed to key by the real, qualified id, matching the established
 * convention `packages/engine/test/run/run-engine.test.ts` already uses. (2) an `agent`-kind step
 * always runs inside its own dedicated git-worktree lane, never `ctx.projectRoot` directly -- its own
 * produced file only ever reaches `projectRoot` once a `merge`-kind step actually runs
 * (`runMergeStep`/`ctx.mergeQueue.process`, `packages/engine/src/dispatch/steps.ts`); the original
 * three-step workflow (`init` → `implement` → `verify`, no `merge`) meant the story file's own real
 * location was `<projectRoot>/.forge/state/worktrees/<laneId>/live-smoke-story.txt`, never
 * `projectRoot` itself, so the original artifact-validation read would have thrown `ENOENT`
 * unconditionally. Fixed by adding a real `merge` step (`dependsOn: [implement]`, matching the exact
 * shape `packages/engine/test/e2e/fixture-workflow.ts`'s own proven pattern already establishes for a
 * single, non-fanned-out predecessor) between `implement` and `verify` -- both fixes verified together
 * directly (a real, temporary script driving this exact revised workflow through the real `runEngine`
 * against a scripted fake adapter, confirmed the qualified step ids and the story file's own real
 * presence at `projectRoot` after the merge) before being written into this file for real.
 *
 * Gated by the identical, already-built, already-tested `planLiveRuns` (`packages/adapter-claude-code/
 * test/conformance/live-gate.ts`, P9) rather than a second, independently-written gate: without
 * `FORGE_LIVE=1` and a real credential, this file registers one clearly-named, skipped test and
 * constructs nothing real at all. Per the coordinator's own explicit direction (`PLAN-M7.md`'s own
 * closing section: "that live run is a deliberate, explicit, jointly-supervised step... not something
 * this plan's own pieces attempt unsupervised"), this piece writes the gated code and verifies its own
 * skip path -- it does not set `FORGE_LIVE=1` itself, in this or any other environment, to actually
 * exercise the live branch. See `SPEC-QUESTIONS.md` Q121 for the confirmed, real reason: this exact
 * development machine carries a real, active Claude subscription login, so doing so here would
 * trigger a genuine, billed live run, not merely a rehearsal of the gating logic.
 *
 * @see specs/06 §6.10
 * @see specs/10 §10.1
 * @see specs/22 (M7's own Acceptance line)
 * @see SPEC-QUESTIONS.md Q121
 * @see PLAN-M7.md
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import {
  claudeCodeAdapterConfigSchema,
  ClaudeCodeAdapter,
  probeAuthAvailability,
} from '@forge/adapter-claude-code';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
} from '@forge/engine/dispatch';
import type { GateDefinition } from '@forge/engine/gates';
import { runEngine, type RunEngineContext } from '@forge/engine/run';
import type { ConcurrencyLimits } from '@forge/engine/scheduler';

import { planLiveRuns } from '../packages/adapter-claude-code/test/conformance/live-gate.ts';

const WORKFLOW_ID = 'forge-m7-live-smoke';
const GATE_ID = 'G-LiveSmokeAlways';
const STORY_MARKER = 'forge-m7-live-smoke-marker';
const STORY_RELATIVE_PATH = 'live-smoke-story.txt';

/** Every real, compiled `StepNode.id` this workflow produces -- qualified as `${WORKFLOW_ID}:${id}`
 * uniformly by `compile.ts`'s own `compileStepId`, confirmed directly (a real, temporary script ran
 * `parseWorkflow`/`compileRunPlan` against this exact source and printed the real node ids) rather
 * than assumed; used below to key `RunState.stepStatuses`, which only ever holds these exact strings. */
const STEP_IDS = {
  init: `${WORKFLOW_ID}:init`,
  implement: `${WORKFLOW_ID}:implement`,
  merge: `${WORKFLOW_ID}:merge`,
  verify: `${WORKFLOW_ID}:verify`,
} as const;

const WORKFLOW_SOURCE = `
id: ${WORKFLOW_ID}
name: M7 live smoke
version: 1.0.0
description: One real init step and one real Claude Code story, driven end to end via runEngine.

steps:
  - id: init
    kind: command
    run: "true"
    inline: true

  - id: implement
    kind: agent
    agent: engineer
    dependsOn: [ init ]
    brief: >
      Create a file named ${STORY_RELATIVE_PATH} in the current working directory containing exactly
      this text, with no extra whitespace, quotes, or trailing newline: ${STORY_MARKER}
    produces: [ "${STORY_RELATIVE_PATH}" ]

  - id: merge
    kind: merge
    # Required by the schema but never actually read by a real merge step's own implementation
    # (confirmed against packages/engine/test/e2e/fixture-workflow.ts's own identical placeholder,
    # and against the real, temporary verification run this file's own doc comment describes) -- a
    # single, non-fanned-out predecessor still needs some non-blank value here.
    over: "stage.items"
    dependsOn: [ implement ]
    policy: { conflict: abort }

  - id: verify
    kind: gate
    gate: ${GATE_ID}
    dependsOn: [ merge ]
`;

/** Trivially passing -- this smoke test's own job is proving the real end-to-end wiring, not
 * exercising the gate mechanism itself (`06` §6.6 already has its own dedicated coverage). */
const GATE_REGISTRY: ReadonlyMap<string, GateDefinition> = new Map([
  [
    GATE_ID,
    { id: GATE_ID, checks: { deterministic: [], advisory: [] }, openQuestionsPolicy: 'warn' },
  ],
]);

/** This workflow is strictly linear (`init` → `implement` → `merge` → `verify`, each depending on the
 * last) -- never more than one step is ever ready to run at once, so `global: 1` genuinely never
 * throttles anything real here; named for what it actually is, not "unlimited". */
const SEQUENTIAL_CONCURRENCY_LIMITS: ConcurrencyLimits = {
  global: 1,
  perAgent: new Map(),
  perResourceClass: new Map(),
};

async function createRealTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-m7-live-smoke-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

const liveEnv = process.env;
const auth = await probeAuthAvailability(liveEnv);
const runs = planLiveRuns(liveEnv, auth);

if (runs.length === 0) {
  describe('M7 live smoke (07 §7.6 exit test)', () => {
    it(
      liveEnv['FORGE_LIVE'] !== '1'
        ? 'skipped: FORGE_LIVE is not set to "1"'
        : 'skipped: FORGE_LIVE=1 but no real credential (ANTHROPIC_API_KEY or a claude subscription login) is available',
      (testCtx) => {
        testCtx.skip();
      },
    );
  });
} else {
  describe('M7 live smoke (07 §7.6 exit test)', () => {
    it.each(runs)(
      'one real init + one real story, driven end to end via runEngine against a real ClaudeCodeAdapter ($reason)',
      async (run) => {
        const projectRoot = await createRealTempRepo();
        try {
          const runId = 'm7-live-smoke-run';
          const config = claudeCodeAdapterConfigSchema.parse({ bare: run.bare });
          const env: Record<string, string> = {};
          if (liveEnv['PATH'] !== undefined) env['PATH'] = liveEnv['PATH'];
          if (liveEnv['HOME'] !== undefined) env['HOME'] = liveEnv['HOME'];
          if (run.bare && liveEnv['ANTHROPIC_API_KEY'] !== undefined) {
            env['ANTHROPIC_API_KEY'] = liveEnv['ANTHROPIC_API_KEY'];
          }
          const adapter = new ClaudeCodeAdapter({ config, env, now: () => Date.now() });

          const ctx: RunEngineContext = {
            adapter,
            vcs: createVcsFacade(projectRoot, runId),
            telemetry: createTelemetryFacade(projectRoot, runId, () => Date.now()),
            gates: createGateEvaluator(GATE_REGISTRY),
            mergeQueue: createMergeQueueFacade(projectRoot, undefined),
            runId,
            projectRoot,
            integrationBase: 'main',
            integrationPath: projectRoot,
            model: 'claude-sonnet-5',
            tools: { read: true, write: true, exec: false, network: 'none' },
            retainLaneWorktrees: false,
            claimPolicy: 'strict',
            signCommits: false,
            now: () => Date.now(),
            laneRegistry: new Map(),
            gateRegistry: GATE_REGISTRY,
            limits: SEQUENTIAL_CONCURRENCY_LIMITS,
            seed: 'm7-live-smoke-seed',
          };

          const finalState = await runEngine(WORKFLOW_SOURCE, {}, ctx);

          expect(finalState.stepStatuses.get(STEP_IDS.init)).toBe('succeeded');
          expect(finalState.stepStatuses.get(STEP_IDS.implement)).toBe('succeeded');
          expect(finalState.stepStatuses.get(STEP_IDS.merge)).toBe('succeeded');
          expect(finalState.stepStatuses.get(STEP_IDS.verify)).toBe('succeeded');

          // Artifacts validated: the real story file the real agent step was asked to produce
          // genuinely exists, with the exact requested content, in the real project root -- not
          // merely "the step reported ok." Only reachable here because the `merge` step above
          // actually ran: an agent step's own produced file lives in its own lane worktree
          // (`<projectRoot>/.forge/state/worktrees/<laneId>/...`) until a real merge moves it into
          // `projectRoot` itself (confirmed directly; see this file's own top-of-file doc comment).
          const storyContent = await readFile(path.join(projectRoot, STORY_RELATIVE_PATH), 'utf8');
          expect(storyContent).toBe(STORY_MARKER);
        } finally {
          await rm(projectRoot, { recursive: true, force: true });
        }
      },
      120_000,
    );
  });
}
