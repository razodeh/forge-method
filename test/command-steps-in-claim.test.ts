/**
 * Every shipped non-inline `command` step that writes a tracked file in its lane declares `produces`
 * naming it (`PLAN-M14.md` P2, `SPEC-QUESTIONS.md` Q212/Q216/Q232 decision 1). `resolveStepClaim`
 * (`packages/engine/src/dispatch/outputs.ts`) gives a `command` step `globs: produces` and the run's
 * default claim policy; under `strict` (`supervised`/`autonomous`/an adopted project) a write outside
 * that claim is reverted, and since `PLAN-M14.md` P3 the step fails outright too. This file is the
 * guard: for each of the fifteen non-inline command steps the nine named workflows ship, it proves the
 * command's own documented write (read from its real source, not guessed) lies inside the step's real,
 * compiled `produces` claim.
 *
 * **Enumeration.** `kind: command` steps that are not `inline: true`, parsed straight off the shipped
 * YAML the same way `test/command-steps.test.ts` does (an independent re-derivation, not a shared
 * walker) — checked against a pinned list of fifteen and against `test/non-forge-steps.ts`'s own
 * `NON_FORGE_STEPS` (shared with that file; every one of which is `inline: true`, confirmed here rather
 * than assumed, so the two files' claims about the same workflows cannot quietly diverge).
 *
 * **Unwired today.** Three of the fifteen commands (`forge adopt inventory`, `forge migrate run`,
 * `forge spec re-derive`) are not wired into `bin.ts` at all yet — each is rejected by the real CLI
 * (`test/command-steps.test.ts`'s own `KNOWN_UNACCEPTED`, Q213). That is why the write determination
 * below is by reading source, not by running the command: shelling any of the three for real would
 * only ever prove "the CLI refuses an unrecognised command," never exercise claim enforcement. The
 * three are not equivalent, though: `forge adopt inventory` has a real, named handler function
 * (`writeInventoryReport`, called by `adopt()`'s own full pipeline, `adopt.ts:413`) this piece can
 * read and declare a claim for now, correct today and already in place for whenever a later piece
 * wires the subcommand; `forge migrate run` and `forge spec re-derive` have no handler anywhere in
 * this codebase to read at all (`03` defines no `forge migrate` command; `09` §9.7 names no command
 * that re-derives specs) — nothing to declare until a later piece both wires and implements them.
 *
 * **What each step writes**, determined by reading the real command it runs:
 * - `adopt:inventory-codebase` (`forge adopt inventory --json`) — `writeInventoryReport`
 *   (`packages/cli/src/commands/adopt.ts:226-231`) writes `reports/adoption/inventory.json`
 *   (`INVENTORY_REPORT_RELATIVE_PATH`, line 86).
 * - `debug:prove-fix`, `migrate:verify-migration`, `quick-fix:verify`, `refactor:verify-invariants`,
 *   `verify-stage:run-tests` (all `forge test run --json`, no `--rule`) — `runDefaultRule`
 *   (`packages/cli/src/commands/loop/test/run.ts`) calls `writeNormalizedReport` unconditionally once
 *   the project's ecosystem is detected (`docs/forge/reports/test-results.json`, `reporter.ts`), and
 *   `writeFlakyState` (`docs/forge/reports/flaky.json`, `flaky.ts`) whenever a layer was configured and
 *   this run's own collection was clean. Both are real writes an ordinary onboarded project's own run of
 *   this step makes — undeclared before this piece, so `strict` silently discarded them.
 * - `deliver-stage:deploy`/`rehearse-rollback` (`forge deploy --dry-run|--rollback-check --json`) —
 *   `deploy-evidence.ts`'s own doc comment: "FORGE has no deploy executor... these commands never
 *   deploy... They read the records the pipeline leaves". Read-only; no `produces`.
 * - `deliver-stage:smoke-test` (`forge test run --rule smoke --json`) — `layer.ts`'s own doc comment:
 *   "Writes nothing under the project." Read-only; no `produces`.
 * - `implement-story:self-verify` (`forge story verify {{storyId}} --json`) — `story.ts`'s own doc
 *   comment: "leaves the project's `test-results.json` and `flaky.json` alone (`persistState: false`...)".
 *   Writes nothing; no `produces`.
 * - `implement-story:done-check` (`forge story verify {{storyId}} --phase done --json`, M14 P25) — the
 *   identical `story.ts` command, a different `--phase`: the same `persistState: false` doc comment
 *   applies. Writes nothing; no `produces`.
 * - `migrate:migrate-data` (`forge migrate run --phase expand --json`) and `replan:re-derive`'s approved
 *   branch (`forge spec re-derive --json`) — unwired and unimplemented (see "Unwired today" above):
 *   refused before either could write anything. No `produces` until a later piece wires and implements
 *   the command; this file's own enumeration test would need updating then too.
 * - `verify-stage:check-coverage` (`forge test coverage --json`, no `--rule`) — `runDefaultCoverage`
 *   (`coverage.ts`) only reads `coverage-summary.json`; the ratchet baseline is written only by
 *   `--rule ratchet`, which this step never passes. Read-only; no `produces`.
 * - `verify-stage:verify-traceability` (`forge spec matrix --json`) — `specMatrix` (`spec.ts`) builds and
 *   returns a `SpecGraph`; no write anywhere in the call chain. Read-only; no `produces`.
 *
 * **Why a stand-in write, not a real subprocess** (beyond the three unwired commands above, which could
 * not run for real at all): every step here is driven through `runLaneLifecycle` (`@forge/engine/dispatch`)
 * directly — the same real git lane, the same real `resolveStepClaim`/`enforceClaim`
 * `packages/engine/test/dispatch/{command,output-claim}.test.ts` already use — with a `runWork` callback
 * that writes exactly the path(s) the command's own source documents, standing in for the real shell
 * invocation. This proves the one thing in this piece's scope: the *declared claim* covers the
 * *documented write*, independent of whether the command is wired. `enforceClaim`'s own return value
 * (`outOfClaim`/`reverted`), not the durable event log, is what each test reads — a thin `VcsFacade`
 * wrapper around the real one records it (the root `test/` tree has no dependency on `@forge/telemetry`
 * to read events back with, and does not need one: `outOfClaim`/`reverted` are the exact values
 * `runLaneLifecycle` derives the `PolicyViolation` event from).
 *
 * Lives at the repository root for the reason `test/command-steps.test.ts`/`test/workflows.test.ts`
 * already give: it needs both `@forge/engine` and `@forge/templates`, and `02` §2.2 lets neither import
 * the other.
 *
 * @see specs/06 §6.7
 * @see specs/18 §18.4
 * @see specs/10 §10.1
 * @see PLAN-M14.md P2, P3
 * @see SPEC-QUESTIONS.md Q212, Q216, Q232
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';

import { ProjectPaths } from '@forge/core/fs';
import {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
  runLaneLifecycle,
  type ExecuteStepContext,
  type LaneHandle,
  type PromptAssemblyContext,
  type StepOutcomeDetail,
  type VcsFacade,
} from '@forge/engine/dispatch';
import type { GateDefinition } from '@forge/engine/gates';
import { compileRunPlan, type StepNode } from '@forge/engine/plan';
import { parseWorkflow } from '@forge/engine/workflow';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { WORKFLOW_INDEX } from '@forge/templates';
import { FakePlatformAdapter } from '@forge/testkit';
import type { ToolGrant } from '@forge/adapter-kit';

import { NON_FORGE_STEPS } from './non-forge-steps.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');

// ---------------------------------------------------------------------------------------------------
// Enumeration: the shipped non-inline `command` steps, re-derived independently of `command-steps.test.ts`
// (a plain parse-level walk of every shipped workflow, template and module alike).
// ---------------------------------------------------------------------------------------------------

interface RawCommandStep {
  readonly key: string;
  readonly inline: boolean;
}

function walkRawCommandSteps(prefix: string, node: unknown, into: RawCommandStep[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkRawCommandSteps(prefix, item, into);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  if (record['kind'] === 'command') {
    const id = typeof record['id'] === 'string' ? record['id'] : '(unnamed)';
    into.push({ key: `${prefix}:${id}`, inline: record['inline'] === true });
  }
  for (const value of Object.values(record)) walkRawCommandSteps(prefix, value, into);
}

function shippedRawCommandSteps(): readonly RawCommandStep[] {
  const found: RawCommandStep[] = [];
  const add = (prefix: string, source: string): void => {
    const parsed = parseWorkflow(source);
    if (!parsed.success) throw new Error(`shipped workflow ${prefix} does not parse`);
    walkRawCommandSteps(prefix, parsed.workflow.steps, found);
    // `onComplete`/`onFailure` escalation steps are steps too (`test/command-steps.test.ts`'s own reasoning).
    walkRawCommandSteps(prefix, { ...parsed.workflow, steps: [] }, found);
  };
  for (const [id, relative] of Object.entries(WORKFLOW_INDEX)) {
    add(id, readFileSync(path.join(templatesPackageRoot, relative), 'utf8'));
  }
  for (const moduleName of readdirSync(modulesDir)) {
    const workflowsDir = path.join(modulesDir, moduleName, 'workflows');
    let files: string[];
    try {
      files = readdirSync(workflowsDir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files) {
      add(`${moduleName}/${file}`, readFileSync(path.join(workflowsDir, file), 'utf8'));
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------
// What each of the fifteen steps writes, per the header comment's own citations.
// ---------------------------------------------------------------------------------------------------

interface KnownWrite {
  readonly relativePath: string;
  readonly content: string;
}

/** `forge test run --json` (no `--rule`): both files `runDefaultRule` (`loop/test/run.ts`) can write. */
const TEST_RUN_WRITES: readonly KnownWrite[] = [
  { relativePath: 'docs/forge/reports/test-results.json', content: '{"v":1,"outcomes":[]}\n' },
  { relativePath: 'docs/forge/reports/flaky.json', content: '{"v":1,"tests":{}}\n' },
];

/** Keyed by the compiled step id (`${workflowId}:${stepId}`). Empty means the header comment's reading of
 * the real command found no write at all — the step is still exercised below (with nothing to write),
 * so all fifteen are covered by one table, not just the six that need `produces`. */
const STEP_FIXTURES: Readonly<Record<string, readonly KnownWrite[]>> = {
  'adopt:inventory-codebase': [
    { relativePath: 'reports/adoption/inventory.json', content: '{}\n' },
  ],
  'debug:prove-fix': TEST_RUN_WRITES,
  'deliver-stage:deploy': [],
  'deliver-stage:rehearse-rollback': [],
  'deliver-stage:smoke-test': [],
  'implement-story:self-verify': [],
  'implement-story:done-check': [],
  'migrate:migrate-data': [],
  'migrate:verify-migration': TEST_RUN_WRITES,
  'quick-fix:verify': TEST_RUN_WRITES,
  'refactor:verify-invariants': TEST_RUN_WRITES,
  'replan:re-derive': [],
  'verify-stage:check-coverage': [],
  'verify-stage:run-tests': TEST_RUN_WRITES,
  'verify-stage:verify-traceability': [],
};

const EXPECTED_STEPS = Object.keys(STEP_FIXTURES);

describe('the shipped non-inline command steps are exactly the pinned fifteen (PLAN-M14 P2, P25)', () => {
  it('a plain parse-level walk of every shipped workflow finds exactly these, no more and no fewer', () => {
    const nonInline = shippedRawCommandSteps()
      .filter((step) => !step.inline)
      .map((step) => step.key)
      .sort();
    expect(EXPECTED_STEPS.length).toBe(15);
    expect(nonInline).toEqual([...EXPECTED_STEPS].sort());
  });

  it("non-forge-steps.ts's own NON_FORGE_STEPS are each inline (so they are not a fifteenth non-inline step this file missed)", () => {
    const inlineByKey = new Map(shippedRawCommandSteps().map((step) => [step.key, step.inline]));
    for (const key of NON_FORGE_STEPS) {
      expect(inlineByKey.get(key), `${key} is not inline`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Claim coverage: the real, compiled `produces` for each of the fifteen against the write it names.
// ---------------------------------------------------------------------------------------------------

/** The one shared fixture context every one of the nine workflows below compiles against — copied from
 * `test/workflows.test.ts`'s own `FIXTURE_CONTEXT` (not imported: that file does not export it, and a
 * second small literal here is cheaper than widening its surface for one shared constant). */
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
};

/** Compiles `workflowId`'s own shipped file and returns the one compiled `StepNode` named `stepId`. */
function compiledNode(workflowId: string, stepId: string): StepNode {
  const entry = Object.entries(WORKFLOW_INDEX).find(([id]) => id === workflowId);
  if (entry === undefined) throw new Error(`no shipped workflow named ${workflowId}`);
  const source = readFileSync(path.join(templatesPackageRoot, entry[1]), 'utf8');
  const parsed = parseWorkflow(source);
  if (!parsed.success) throw new Error(`${workflowId} failed to parse`);
  const compiled = compileRunPlan(parsed.workflow, FIXTURE_CONTEXT);
  if (!compiled.success) {
    throw new Error(`${workflowId} failed to compile: ${JSON.stringify(compiled.issues)}`);
  }
  const compiledId = `${workflowId}:${stepId}`;
  const node = compiled.nodes.find((candidate) => candidate.id === compiledId);
  if (node === undefined) throw new Error(`${workflowId} compiled with no step ${compiledId}`);
  return node;
}

function createTestClock(): () => number {
  let tick = 0;
  return () => {
    const value = tick;
    tick += 1;
    return value;
  };
}

const DEFAULT_TOOLS: ToolGrant = { read: true, write: true, exec: false, network: 'none' };

/** A command step never reaches prompt assembly (`runLaneLifecycle`'s own claim-enforcement path calls
 * neither `ctx.assembly` nor any function of it) — every function here throws if that ever changes,
 * rather than silently returning a fixture that would mask it. */
function stubAssembly(paths: ProjectPaths): PromptAssemblyContext {
  return {
    paths,
    loadAgent: () => Promise.reject(new Error('a command step never loads an agent')),
    listAgents: () => Promise.resolve([]),
    loadContent: () => Promise.reject(new Error('a command step never loads a brief')),
    openKb: () => Promise.reject(new Error('a command step never opens the KB')),
    models: DEFAULT_CONFIG.models,
    escalations: [],
    autonomy: 'guided',
    kbPackBudgetTokens: 0,
    skillsPackBudgetTokens: 0,
    templatesPackageRoot: paths.resolveWithin('.'),
    pinnedCore: {},
  };
}

const cleanup: string[] = [];
afterAll(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-command-claim-${prefix}-`));
  cleanup.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** One call's own `outOfClaim`/`reverted` — exactly what `enforceClaim` returns, the values
 * `runLaneLifecycle` derives its `PolicyViolation` event from (`06` §6.7). */
interface ClaimResult {
  readonly outOfClaim: readonly string[];
  readonly reverted: readonly string[];
}

/** Wraps the real `VcsFacade` so `enforceClaim`'s own return value is captured directly, rather than
 * read back from the durable event log `PolicyViolation` is written to (root `test/` has no dependency
 * on `@forge/telemetry`, and does not need one for this: the return value here is what that event's
 * payload is built from). Every other method is the real, unwrapped implementation. */
function recordingVcs(projectRoot: string, runId: string, into: ClaimResult[]): VcsFacade {
  const real = createVcsFacade(projectRoot, runId);
  return {
    ...real,
    async enforceClaim(handle, baseSha, declaredGlobs, policy, excludedGlobs) {
      const result = await real.enforceClaim(handle, baseSha, declaredGlobs, policy, excludedGlobs);
      into.push(result);
      return result;
    },
  };
}

function buildContext(
  projectRoot: string,
  runId: string,
  claimPolicy: 'strict' | 'warn',
  claimResults: ClaimResult[],
): ExecuteStepContext {
  const now = createTestClock();
  const gateRegistry: ReadonlyMap<string, GateDefinition> = new Map();
  return {
    adapter: new FakePlatformAdapter(),
    vcs: recordingVcs(projectRoot, runId, claimResults),
    telemetry: createTelemetryFacade(projectRoot, runId, now),
    gates: createGateEvaluator(gateRegistry),
    mergeQueue: createMergeQueueFacade(projectRoot, undefined),
    runId,
    projectRoot,
    integrationBase: 'main',
    integrationPath: projectRoot,
    model: 'fixture-model',
    tools: DEFAULT_TOOLS,
    assembly: stubAssembly(new ProjectPaths(projectRoot)),
    retainLaneWorktrees: false,
    claimPolicy,
    signCommits: false,
    now,
    laneRegistry: new Map<string, LaneHandle>(),
    gateRegistry,
  };
}

async function writeKnownFiles(lanePath: string, writes: readonly KnownWrite[]): Promise<void> {
  for (const write of writes) {
    const target = path.join(lanePath, write.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, write.content);
  }
}

async function committedTree(lanePath: string): Promise<readonly string[]> {
  const { stdout } = await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
    cwd: lanePath,
  });
  return stdout.split('\n').filter((line) => line !== '');
}

function slug(id: string): string {
  return id.replace(/[^a-z0-9-]/gi, '-');
}

interface StepRunResult {
  readonly outcome: Awaited<ReturnType<typeof runLaneLifecycle>>;
  readonly claimResults: readonly ClaimResult[];
  readonly tree: readonly string[];
}

/** Runs `node` through the real lane lifecycle (real git lane, real `resolveStepClaim`, real
 * `enforceClaim`) with a `runWork` that stands in for the real shell command: it writes exactly `writes`
 * (the command's own documented write, or nothing) and reports `changed` accordingly — the header
 * comment explains why this replaces literally shelling the command. */
async function runStep(
  node: StepNode,
  writes: readonly KnownWrite[],
  claimPolicy: 'strict' | 'warn',
): Promise<StepRunResult> {
  const projectRoot = await createTempRepo(slug(node.id));
  const runId = `run-${slug(node.id)}-${claimPolicy}`;
  const claimResults: ClaimResult[] = [];
  const ctx = buildContext(projectRoot, runId, claimPolicy, claimResults);
  const emptyDetail: StepOutcomeDetail = { kind: 'command', exitCode: -1, stdout: '', stderr: '' };
  let lanePath = '';
  const outcome = await runLaneLifecycle(node, ctx, ctx.now(), emptyDetail, async (lane) => {
    lanePath = lane.path;
    await writeKnownFiles(lane.path, writes);
    return {
      changed: writes.length > 0,
      commitSubject: node.id,
      detail: { kind: 'command', exitCode: 0, stdout: '', stderr: '' },
    };
  });
  const tree = writes.length > 0 ? await committedTree(lanePath) : [];
  return { outcome, claimResults, tree };
}

describe("every shipped non-inline command step's own documented write is inside its declared claim (PLAN-M14 P2)", () => {
  for (const key of EXPECTED_STEPS) {
    const [workflowId, stepId] = key.split(/:(.*)/s);
    if (workflowId === undefined || stepId === undefined) throw new Error(`bad key ${key}`);
    const writes = STEP_FIXTURES[key] ?? [];
    const label =
      writes.length > 0 ? writes.map((write) => write.relativePath).join(', ') : '(nothing)';

    it(`guided (warn): ${key} writes ${label} -- nothing lands outside the claim`, async () => {
      const node = compiledNode(workflowId, stepId);
      const { outcome, claimResults } = await runStep(node, writes, 'warn');
      expect(outcome.status).toBe('succeeded');
      const outOfClaim = claimResults.flatMap((result) => result.outOfClaim);
      expect(outOfClaim, `${key} wrote outside its own declared claim`).toEqual([]);
    });

    it(`supervised (strict): ${key} writes ${label} -- every written path survives claim enforcement`, async () => {
      const node = compiledNode(workflowId, stepId);
      const { outcome, tree } = await runStep(node, writes, 'strict');
      expect(outcome.status).toBe('succeeded');
      for (const write of writes) {
        expect(tree, `${key} lost ${write.relativePath} to claim enforcement`).toContain(
          write.relativePath,
        );
      }
    });
  }
});

describe('mutation evidence: without `produces` the guard above would have failed (PLAN-M14 P2, and now fails the step outright: PLAN-M14 P3)', () => {
  it('adopt:inventory-codebase with `produces` stripped: strict reverts the inventory report and fails the step; guided keeps it but flags it', async () => {
    const real = compiledNode('adopt', 'inventory-codebase');
    const stripped: StepNode = { ...real, produces: [] };
    const writes = STEP_FIXTURES['adopt:inventory-codebase'] ?? [];
    expect(writes.length).toBeGreaterThan(0);

    const strict = await runStep(stripped, writes, 'strict');
    // `06` §6.7 as amended (`PLAN-M14.md` P3, `SPEC-QUESTIONS.md` Q232 decision 1): the revert is
    // unchanged, but a real out-of-claim write under `strict` now also fails the step.
    expect(strict.outcome.status).toBe('failed');
    expect(strict.outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(strict.tree).not.toContain('reports/adoption/inventory.json');
    expect(strict.claimResults).toEqual([
      {
        outOfClaim: ['reports/adoption/inventory.json'],
        reverted: ['reports/adoption/inventory.json'],
      },
    ]);

    const warn = await runStep(stripped, writes, 'warn');
    expect(warn.outcome.status).toBe('succeeded');
    expect(warn.tree).toContain('reports/adoption/inventory.json');
    expect(warn.claimResults).toEqual([
      { outOfClaim: ['reports/adoption/inventory.json'], reverted: [] },
    ]);
  });

  it('debug:prove-fix with `produces` stripped: strict reverts both test-run reports and fails the step', async () => {
    const real = compiledNode('debug', 'prove-fix');
    const stripped: StepNode = { ...real, produces: [] };
    const strict = await runStep(stripped, TEST_RUN_WRITES, 'strict');
    expect(strict.outcome.status).toBe('failed');
    expect(strict.outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
    const expectedPaths = TEST_RUN_WRITES.map((write) => write.relativePath).sort();
    for (const write of TEST_RUN_WRITES) expect(strict.tree).not.toContain(write.relativePath);
    expect([...(strict.claimResults[0]?.outOfClaim ?? [])].sort()).toEqual(expectedPaths);
    expect([...(strict.claimResults[0]?.reverted ?? [])].sort()).toEqual(expectedPaths);
  });
});
