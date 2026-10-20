/**
 * Every shipped non-inline `command` step that writes a tracked file in its lane declares `produces`
 * naming it (`PLAN-M14.md` P2, `SPEC-QUESTIONS.md` Q212/Q216/Q232 decision 1). `resolveStepClaim`
 * (`packages/engine/src/dispatch/outputs.ts`) gives a `command` step `globs: produces` and the run's
 * default claim policy; under `strict` (`supervised`/`autonomous`/an adopted project) a write outside
 * that claim is reverted, and since `PLAN-M14.md` P3 the step fails outright too. This file is the
 * guard: for each of the sixteen non-inline command steps the nine named workflows ship, it proves the
 * command's own documented write (read from its real source, not guessed) lies inside the step's real,
 * compiled `produces` claim.
 *
 * **Enumeration.** `kind: command` steps that are not `inline: true`, parsed straight off the shipped
 * YAML the same way `test/command-steps.test.ts` does (an independent re-derivation, not a shared
 * walker) — checked against a pinned list of sixteen and against `test/non-forge-steps.ts`'s own
 * `NON_FORGE_STEPS` (shared with that file; every one of which is `inline: true`, confirmed here rather
 * than assumed, so the two files' claims about the same workflows cannot quietly diverge).
 *
 * **Unwired today (UPDATE, `specs/22` M17 P17/P18): no longer true for two of the three.** This
 * section originally named three of the sixteen commands (`forge adopt inventory`, `forge migrate
 * run`, `forge spec re-derive`) as not wired into `bin.ts` at all, each rejected by the real CLI
 * (`test/command-steps.test.ts`'s own `KNOWN_UNACCEPTED`, Q213) — which is why the write
 * determination below is by reading source, not by running the command. `forge migrate run` (M17
 * P18) and `forge spec re-derive` (M17 P17, `commands/dispatch/spec.ts`'s own `specReDerive`) are
 * now both real and wired; `test/command-steps.test.ts`'s own `KNOWN_UNACCEPTED` no longer names
 * either. `specReDerive` is confirmed, by reading it directly, to be genuinely read-only (it only
 * builds and queries a `SpecGraph` from `docs/forge/specs`/`kb`, exactly like `specMatrix` below) —
 * `replan:re-derive`'s own `[]` claim is therefore still correct, now because a real implementation
 * was checked rather than because none existed yet. Whether `forge migrate run`'s own real apply
 * path ever writes anything, and whether `migrate:migrate-data`'s `[]` claim is still right for that
 * reason, was not investigated here — out of this piece's own narrow scope (`forge adopt`/`forge
 * spec re-derive` only); disclosed rather than assumed. `forge adopt inventory` is still not a real
 * subcommand `17` §17.6 defines at all (`forge adopt [dir]` itself is wired, but takes no
 * `inventory` subcommand — `test/command-steps.test.ts`'s own updated `KNOWN_UNACCEPTED` comment has
 * the full story) and still has only the real, named handler function this file already reads
 * (`writeInventoryReport`, called by `adopt()`'s own full pipeline, `adopt.ts:413`).
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
 * - `implement-story:evidence` (`forge story evidence {{storyId}} --json`, `specs/22` M15 P7) —
 *   `assembleAndWriteEvidenceBundle` (`loop/test/evidence-bundle.ts`) writes a real `EvidenceBundle`
 *   at `EvidenceBundle`'s own registered path, rooted under the real configured `paths.reports`
 *   (`docs/forge/reports/evidence/{id}-{story}.md` under the shipped default); `produces` names the
 *   matching glob spelled out in full (`docs/forge/reports/evidence/*-{{storyId}}.md`), not the bare
 *   `reports/...` registry-path shorthand -- `resolveDocsRootPrefix` only rewrites an entry that opens
 *   with a full shipped default docs root, so a shorter prefix would pass through unrewritten and never
 *   match the real write (a real bug a gauntlet critic round caught in an earlier version of this).
 * - `replan:re-derive`'s approved branch (`forge spec re-derive --json`) — now real and wired (see
 *   "Unwired today" above); confirmed read-only by reading `specReDerive` (`commands/spec.ts`)
 *   directly, so still no `produces`.
 * - `migrate:migrate-data` (`forge migrate run --phase expand --json`) — now wired too (M17 P18),
 *   but whether its own real apply path ever writes a file was not investigated by this piece (see
 *   "Unwired today" above); still `[]` here, not re-verified.
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
 * @see PLAN-M15.md P7
 * @see SPEC-QUESTIONS.md Q212, Q216, Q232, Q286
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
  type DocRoots,
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
// What each of the sixteen steps writes, per the header comment's own citations.
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
 * so all sixteen are covered by one table, not just the seven that need `produces`. */
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
  'implement-story:evidence': [
    { relativePath: 'docs/forge/reports/evidence/EVID-001-story-1.md', content: '{}\n' },
  ],
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

describe('the shipped non-inline command steps are exactly the pinned sixteen (PLAN-M14 P2, P25; PLAN-M15 P7)', () => {
  it('a plain parse-level walk of every shipped workflow finds exactly these, no more and no fewer', () => {
    const nonInline = shippedRawCommandSteps()
      .filter((step) => !step.inline)
      .map((step) => step.key)
      .sort();
    expect(EXPECTED_STEPS.length).toBe(16);
    expect(nonInline).toEqual([...EXPECTED_STEPS].sort());
  });

  it("non-forge-steps.ts's own NON_FORGE_STEPS are each inline (so they are not a seventeenth non-inline step this file missed)", () => {
    const inlineByKey = new Map(shippedRawCommandSteps().map((step) => [step.key, step.inline]));
    for (const key of NON_FORGE_STEPS) {
      expect(inlineByKey.get(key), `${key} is not inline`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Claim coverage: the real, compiled `produces` for each of the sixteen against the write it names.
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
  docRoots?: DocRoots,
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
    ...(docRoots === undefined ? {} : { docRoots }),
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
  docRoots?: DocRoots,
): Promise<StepRunResult> {
  const projectRoot = await createTempRepo(slug(node.id));
  const runId = `run-${slug(node.id)}-${claimPolicy}`;
  const claimResults: ClaimResult[] = [];
  const ctx = buildContext(projectRoot, runId, claimPolicy, claimResults, docRoots);
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

  // `PLAN-M15.md` P7's own "Mutation evidence": "Write the bundle outside the claim: the
  // claim-enforcement test reports it reverted."
  it('implement-story:evidence with `produces` stripped: strict reverts the EvidenceBundle and fails the step', async () => {
    const real = compiledNode('implement-story', 'evidence');
    const stripped: StepNode = { ...real, produces: [] };
    const writes = STEP_FIXTURES['implement-story:evidence'] ?? [];
    expect(writes.length).toBeGreaterThan(0);

    const strict = await runStep(stripped, writes, 'strict');
    expect(strict.outcome.status).toBe('failed');
    expect(strict.outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(strict.tree).not.toContain('docs/forge/reports/evidence/EVID-001-story-1.md');
    expect(strict.claimResults).toEqual([
      {
        outOfClaim: ['docs/forge/reports/evidence/EVID-001-story-1.md'],
        reverted: ['docs/forge/reports/evidence/EVID-001-story-1.md'],
      },
    ]);
  });

  // Every OTHER test in this file (including the one immediately above) compiles and claims against
  // the shipped DEFAULT `paths.reports` -- the one config every real project starts with, but not the
  // only one a real project can have. `produces: ['docs/forge/reports/evidence/*-{{storyId}}.md']`
  // only stays correct under a RECONFIGURED `paths.reports` because `resolveDocsRootPrefix`
  // (`packages/engine/src/dispatch/outputs.ts`) rewrites its leading `docs/forge/reports` segment to
  // whatever the project's own configured root is, and `assembleAndWriteEvidenceBundle` independently
  // reroots its own write under that identical configured root (`reportsRoot`, threaded from
  // `config.paths.reports` in `bin.ts`) -- two independent computations that must agree. This is the
  // one test in the file that actually proves they do, not just under the default they'd trivially
  // agree on by construction.
  it('implement-story:evidence still lands inside its own claim under a RECONFIGURED paths.reports, not only the shipped default', async () => {
    const docRoots: DocRoots = { ...DEFAULT_CONFIG.paths, reports: 'evidence-reports' };
    const real = compiledNode('implement-story', 'evidence');
    const writes = [
      { relativePath: 'evidence-reports/evidence/EVID-001-story-1.md', content: '{}\n' },
    ];

    const strict = await runStep(real, writes, 'strict', docRoots);
    expect(strict.outcome.status).toBe('succeeded');
    expect(strict.claimResults.flatMap((result) => result.outOfClaim)).toEqual([]);
    expect(strict.tree).toContain('evidence-reports/evidence/EVID-001-story-1.md');
  });
});

// `specs/22` M15 P7: `packages/cli/src/commands/loop/test/evidence-bundle.ts`'s own `findReviewsThisRun`/
// `computeStoryCost` depend on a real invariant about how `implement-story.workflow.yaml`'s own steps
// compile -- that every one of them gets the BARE `${workflowId}:${stepId}` id, with no per-story
// `itemKey` suffix, because `implement-story` is never a fanout target or subworkflow anywhere in this
// codebase and so always runs standalone, one story per `forge run`. A gauntlet critic round found an
// earlier version of `evidence-bundle.ts` (and its own tests) got this wrong in a way that was
// self-consistent and therefore invisible to unit tests alone: both sides independently assumed the same
// incorrect three-argument `compileStepId(..., storyId)` form. This is the direct, independent check that
// would have caught it -- the REAL compiler's own output, not a second copy of the same assumption.
describe("evidence-bundle.ts's own compileStepId assumption matches the real compiler, independently (specs/22 M15 P7)", () => {
  it('every step compileStepId is called for in evidence-bundle.ts compiles to the bare, two-argument form -- no itemKey, ever', () => {
    const storyStepIds = [
      'plan',
      'red',
      'green',
      'refactor',
      'self-verify',
      'review',
      'document',
      'done-check',
      'evidence',
    ];
    for (const stepId of storyStepIds) {
      const node = compiledNode('implement-story', stepId);
      expect(node.id, `compiled id for step "${stepId}"`).toBe(`implement-story:${stepId}`);
    }
  });
});
