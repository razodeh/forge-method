/**
 * `commands/dispatch/plan-and-loop.ts` — `forge plan <phase>` (`03` §3.2.3, `PLAN-M12.md` P4) and
 * the whole agent-facing loop family: `implement`/`refactor`/`story`/`deploy`/`debug`/`review`/
 * `panel`/`ask`/`session` (`03` §3.2.5/§3.2.6). One file because `plan`, `implement`, `refactor`, and
 * `deploy` all dispatch through the identical `runWorkflow`/`printWorkflowDispatchResult` mechanism
 * `forge run` itself uses (`run-and-gates.ts`), and `debug`/`review`/`panel`/`session` all build the
 * identical `buildLoopDepsForProject` dependency bundle — the same pairing the original `bin.ts`'s
 * own section banner ("the agent-facing loop family") already draws.
 *
 * `runStoryEvidenceCommand` (internal to `runStoryCommand`, `specs/22` M15 P7, `specs/22` M17 P5's
 * own ratchet-coverage wiring) lives here, unchanged from the real current `bin.ts`.
 *
 * @see specs/22 M17 P2
 */
import os from 'node:os';

import { FORGE_RUN_ID, SYSTEM_CLOCK } from '@forge/core';
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import type { ExpressionContext } from '@forge/engine/expr';

import { deployDryRunCheck, deployRollbackCheck } from '../deploy-evidence.ts';
import {
  recordDeployment,
  recordDryRun,
  recordRollback,
  type DeployRecordContext,
  type DeployRecordOutcome,
} from '../deploy-record.ts';
import { runGateCheck } from '../gate-check-output.ts';
import { ask } from '../loop/ask.ts';
import { debugFromFailure, debugSymptom, type DebugDeps, type DebugResult } from '../loop/debug.ts';
import { deployEnvironment } from '../loop/deploy.ts';
import { implementStory } from '../loop/implement.ts';
import { panelQuestion, type PanelDeps } from '../loop/panel.ts';
import { refactorTarget } from '../loop/refactor.ts';
import { reviewChange, type ReviewDeps } from '../loop/review.ts';
import {
  isSessionType,
  sessionExport,
  sessionList,
  sessionResume,
  sessionShow,
  startSession,
  type SessionType,
  type StartSessionOptions,
} from '../loop/session.ts';
import { assembleAndWriteEvidenceBundle } from '../loop/test/evidence-bundle.ts';
import { testCoverage } from '../loop/test/coverage.ts';
import { readConfig } from '../config.ts';
import {
  formatRunPlan,
  planRunPlan,
  runPlanJson,
  runWorkflow,
  workflowIdForPlanPhase,
  type PlanPhase,
} from '../run/index.ts';
import { isStoryPhase, renderStoryVerify, storyVerify, STORY_PHASES } from '../story.ts';
import {
  AGENTS_ROOT,
  assertNoArgs,
  buildElicitAskPort,
  buildLoopDepsForProject,
  buildRunDepsForProject,
  KB_ROOT,
  parseCommandFlags,
  printWorkflowDispatchResult,
  realEnvSnapshot,
  sanitizeDeep,
  SPECS_ROOT,
  stripControlChars,
  WORKFLOWS_ROOT,
  type DispatchContext,
} from './shared.ts';

// --- `forge plan <phase>` (`03` §3.2.3) -----------------------------------------------------------

/** `10` §10.5's own 20-workflow table has no real workflow for `data`/`testing` — `workflowIdForPlanPhase`
 * itself throws `USR-003` for those two, surfaced here verbatim rather than inventing a generic
 * "not wired" message. */
const PLAN_PHASES: readonly PlanPhase[] = [
  'product',
  'architecture',
  'data',
  'init',
  'testing',
  'delivery',
  'stages',
  'stage',
  'replan',
];

function isPlanPhase(value: string | undefined): value is PlanPhase {
  return value !== undefined && (PLAN_PHASES as readonly string[]).includes(value);
}

/** `{{stageId}}` (`plan-stage.workflow.yaml`'s own real template reference) resolves against
 * `ExpressionContext` at the top level — the same narrow, honest extension `implement.ts`'s own
 * `ImplementStoryExpressionContext` already documents for the identical reason. */
interface PlanStageExpressionContext extends ExpressionContext {
  readonly stageId: string;
}

/** Builds the real `ExpressionContext` `forge plan <phase>` dispatches with — `stageId` (when
 * present) is added via a variable typed as the real, narrow `PlanStageExpressionContext`
 * extension, never a fresh object literal assigned directly to the wider `ExpressionContext` type. */
function buildPlanExpressionContext(
  stageId: string | undefined,
  vars: Readonly<Record<string, string>>,
): ExpressionContext {
  const base: ExpressionContext = Object.keys(vars).length > 0 ? { vars } : {};
  if (stageId === undefined) return base;
  const withStage: PlanStageExpressionContext = { ...base, stageId };
  return withStage;
}

/** `forge plan run-plan <stageId> [--json]` — the command `plan-stage.workflow.yaml`'s
 * `derive-run-plan` step runs (`03` §3.2.3, `06` §6.2). Read-only and deterministic; it needs no
 * adapter. */
async function runRunPlanCommand(
  paths: ProjectPaths,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const { positionals } = parseCommandFlags(rest, {});
  const [stageId] = positionals;
  if (stageId === undefined || positionals.length > 1) {
    console.error('forge: "plan run-plan" needs a real <stageId>.');
    return EXIT_CODES.usage;
  }
  const report = await planRunPlan(
    { paths, workflowsRoot: WORKFLOWS_ROOT, specsRoot: SPECS_ROOT, agentsRoot: AGENTS_ROOT },
    stageId,
  );
  console.log(json ? runPlanJson(report) : formatRunPlan(report));
  return report.ok ? EXIT_CODES.success : EXIT_CODES.failure;
}

const PLAN_FLAGS = { '--from': true, '--answers': true } as const;

async function runPlanCommand(
  paths: ProjectPaths,
  projectRoot: string,
  phase: string | undefined,
  rest: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  if (phase === 'run-plan') return runRunPlanCommand(paths, rest, json);
  if (!isPlanPhase(phase)) {
    console.error(`forge: "plan" needs a real <phase> (${PLAN_PHASES.join('|')}|run-plan).`);
    return EXIT_CODES.usage;
  }
  const { values, positionals } = parseCommandFlags(rest, PLAN_FLAGS);

  let stageId: string | undefined;
  if (phase === 'stage') {
    [stageId] = positionals;
    if (stageId === undefined || positionals.length > 1) {
      console.error('forge: "plan stage" needs a real <id>.');
      return EXIT_CODES.usage;
    }
  } else if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }

  const workflowId = workflowIdForPlanPhase(phase);
  const deps = await buildRunDepsForProject(paths, projectRoot);
  const from = values.get('--from');
  const vars: Record<string, string> = {};
  if (from !== undefined) vars['from'] = from;
  const expressionContext = buildPlanExpressionContext(stageId, vars);

  // A planning workflow may ask the human (`replan`'s approval, `PLAN-M13.md` P20).
  const askPort = await buildElicitAskPort(values.get('--answers'), undefined);
  try {
    const result = await runWorkflow(
      { ...deps, ask: askPort },
      {
        workflowId,
        expressionContext,
        dryRun,
        host: os.hostname(),
      },
    );
    return printWorkflowDispatchResult(`plan ${phase}`, result, json);
  } finally {
    askPort.close();
  }
}

// --- the agent-facing loop family: `implement`/`debug`/`refactor`/`deploy`/`review`/`panel`/`ask`/
// `session` (`03` §3.2.5/§3.2.6) --------------------------------------------------------------------

async function runImplementCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  const { positionals } = parseCommandFlags(args, {});
  const [storyId] = positionals;
  if (storyId === undefined || positionals.length > 1) {
    console.error('forge: "implement" needs a real <storyId>.');
    return EXIT_CODES.usage;
  }
  const deps = await buildRunDepsForProject(paths, projectRoot);
  const result = await implementStory(deps, storyId, {
    specsRoot: SPECS_ROOT,
    dryRun,
    host: os.hostname(),
  });
  return printWorkflowDispatchResult(`implement ${storyId}`, result, json);
}

const REFACTOR_FLAGS = { '--goal': true } as const;

async function runRefactorCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, REFACTOR_FLAGS);
  const [target] = positionals;
  if (target === undefined || positionals.length > 1) {
    console.error('forge: "refactor" needs a real <target>.');
    return EXIT_CODES.usage;
  }
  const goal = values.get('--goal');
  if (goal === undefined) {
    console.error('forge: "refactor" needs a real --goal <text>.');
    return EXIT_CODES.usage;
  }
  const deps = await buildRunDepsForProject(paths, projectRoot);
  const result = await refactorTarget(deps, target, goal, { dryRun, host: os.hostname() });
  return printWorkflowDispatchResult(`refactor ${target}`, result, json);
}

const STORY_VERIFY_FLAGS = { '--phase': true } as const;

/** `forge story evidence <storyId> [--json]` — `implement-story.workflow.yaml`'s own `evidence`
 * command step (`specs/22` M15 P7): assembles and commits a real `EvidenceBundle` for one story.
 * Re-runs the project's own `done`-phase verification itself — a real, disclosed cost, not a harmless
 * redundancy (see this project's own `SPEC-QUESTIONS.md` for the full reasoning). */
async function runStoryEvidenceCommand(
  paths: ProjectPaths,
  projectRoot: string,
  rest: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  const { positionals } = parseCommandFlags(rest, {});
  const [storyId] = positionals;
  if (storyId === undefined || positionals.length > 1) {
    console.error('forge: "story evidence" needs a real <storyId>.');
    return EXIT_CODES.usage;
  }
  if (dryRun) {
    console.error(
      'forge: "story evidence" needs a real run: it re-runs the story\'s own done-phase verification, so it has no --dry-run form.',
    );
    return EXIT_CODES.usage;
  }
  const config = await readConfig(paths);
  const verifyOutcome = await storyVerify(
    {
      paths,
      projectRoot,
      specsRoot: SPECS_ROOT,
      kbRoot: KB_ROOT,
      reportsRoot: config.paths.reports,
      testCommands: config.execution.testCommands,
      flakeConfig: config.quality.flake,
      testRoots: config.execution.testRoots,
      runId: realEnvSnapshot()[FORGE_RUN_ID],
    },
    storyId,
    'done',
  );
  // A story whose own done-phase verification is not a clean pass never gets a committed
  // EvidenceBundle, inside the real orchestrated workflow or standalone.
  if (verifyOutcome.kind !== 'verified' || !verifyOutcome.report.passed) {
    const rendering = renderStoryVerify(verifyOutcome, json);
    if (rendering.stdout !== undefined) console.log(rendering.stdout);
    if (rendering.stderr !== undefined) console.error(rendering.stderr);
    return rendering.exitCode;
  }
  const { report } = verifyOutcome;
  // `specs/22` M17 P5: ratchet coverage reads the project's own configured source/path too, the
  // identical wiring `test coverage` already does.
  const coverageCtx = {
    paths,
    projectRoot,
    specsRoot: SPECS_ROOT,
    coverage: config.quality.coverage,
  };
  const [acCoverage, ratchetCoverage] = await Promise.all([
    testCoverage(coverageCtx, { rule: 'acceptance-criteria' }),
    testCoverage(coverageCtx, { rule: 'ratchet' }),
  ]);
  const coverageProblems = [...(acCoverage.problems ?? []), ...(ratchetCoverage.problems ?? [])];
  const written = await assembleAndWriteEvidenceBundle({
    paths,
    // The real `FORGE_PROJECT_ROOT` env var, preferred over the bare, lane-scoped `projectRoot`
    // above, which stays correct and unchanged for `paths`/`reportsRoot`.
    projectRoot: realEnvSnapshot()['FORGE_PROJECT_ROOT'] ?? projectRoot,
    reportsRoot: config.paths.reports,
    storyId,
    runId: realEnvSnapshot()[FORGE_RUN_ID],
    verify: {
      phase: report.phase,
      passed: report.passed,
      errors: report.errors,
      checks: report.checks,
    },
    coverage: {
      acCoveragePercent: acCoverage.coverage,
      ratchetRegressions: ratchetCoverage.regressions,
      ...((acCoverage.missingAcIds?.length ?? 0) > 0
        ? { missingAcIds: acCoverage.missingAcIds }
        : {}),
      ...(coverageProblems.length > 0 ? { problems: coverageProblems } : {}),
    },
    clock: SYSTEM_CLOCK,
  });
  console.log(
    json
      ? JSON.stringify({ v: 1, ...written, story: storyId })
      : `forge story evidence ${storyId}: wrote ${written.id} (${written.path}).`,
  );
  return EXIT_CODES.success;
}

/** `forge story verify <storyId> [--phase verify|done] [--json]`: evaluates a story's DoD profile
 * for one phase (`09` §9.8 as amended by `PLAN-M14.md` P1, `10` §10.6 steps 6 and 9). */
async function runStoryCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  if (sub === 'evidence') {
    return runStoryEvidenceCommand(paths, projectRoot, rest, dryRun, json);
  }
  if (sub !== 'verify') {
    console.error('forge: "story" needs a real subcommand (verify, evidence).');
    return EXIT_CODES.usage;
  }
  const { values, positionals } = parseCommandFlags(rest, STORY_VERIFY_FLAGS);
  const [storyId] = positionals;
  if (storyId === undefined || positionals.length > 1) {
    console.error('forge: "story verify" needs a real <storyId>.');
    return EXIT_CODES.usage;
  }
  const phaseFlag = values.get('--phase');
  if (phaseFlag !== undefined && !isStoryPhase(phaseFlag)) {
    console.error(
      `forge: "story verify" needs a real --phase (one of: ${STORY_PHASES.join(', ')}); got ${JSON.stringify(phaseFlag)}.`,
    );
    return EXIT_CODES.usage;
  }
  // `--dry-run` promises no effects; verification runs the project's own test commands, so it has no
  // dry form. Refusing is safer than ignoring the flag and running them anyway.
  if (dryRun) {
    console.error(
      'forge: "story verify" needs a real run: it runs the project\'s test commands, so it has no --dry-run form.',
    );
    return EXIT_CODES.usage;
  }
  const config = await readConfig(paths);
  const outcome = await storyVerify(
    {
      paths,
      projectRoot,
      specsRoot: SPECS_ROOT,
      kbRoot: KB_ROOT,
      reportsRoot: config.paths.reports,
      testCommands: config.execution.testCommands,
      flakeConfig: config.quality.flake,
      testRoots: config.execution.testRoots,
      runId: realEnvSnapshot()[FORGE_RUN_ID],
      telemetryProjectRoot: realEnvSnapshot()['FORGE_PROJECT_ROOT'],
    },
    storyId,
    phaseFlag ?? 'verify',
  );
  const rendering = renderStoryVerify(outcome, json);
  if (rendering.stdout !== undefined) console.log(rendering.stdout);
  if (rendering.stderr !== undefined) console.error(rendering.stderr);
  return rendering.exitCode;
}

const DEPLOY_FLAGS = { '--confirm': true, '--rollback-check': false } as const;

async function runDeployCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  // `forge deploy record <dry-run|rollback|deployment>` (`PLAN-M14.md` P23) — routed on the bare
  // first word, BEFORE `parseCommandFlags(args, DEPLOY_FLAGS)`, unconditionally, so an environment
  // actually named "record" can never be deployed to through this command.
  if (args[0] === 'record') {
    return runDeployRecordCommand(paths, projectRoot, args.slice(1), dryRun, json);
  }
  const { values, flags, positionals } = parseCommandFlags(args, DEPLOY_FLAGS);
  const [env] = positionals;
  if (env === undefined && (dryRun || flags.has('--rollback-check'))) {
    // `G-Deliver`'s `deploy:dry-run` and `deploy:rollback-rehearsed` checks (`14` §14.9,
    // `PLAN-M13.md` P26): the env-less forms judge the recorded delivery evidence and never deploy
    // anything (FORGE has no deploy executor).
    if (dryRun === flags.has('--rollback-check') || values.has('--confirm')) {
      console.error(
        'forge: "deploy" needs a real <env>, or exactly one of --dry-run and --rollback-check (and no --confirm) for the gate checks.',
      );
      return EXIT_CODES.usage;
    }
    const rollback = flags.has('--rollback-check');
    return runGateCheck(
      {
        command: `forge deploy ${rollback ? '--rollback-check' : '--dry-run'}`,
        refusalFields: {},
        json,
        out: console,
      },
      async () => {
        const config = await readConfig(paths);
        const context = {
          paths,
          projectRoot,
          kbRoot: config.paths.kb,
          reportsRoot: config.paths.reports,
          documentRoots: [
            config.paths.kb,
            config.paths.specs,
            config.paths.plans,
            config.paths.sessions,
            config.paths.reports,
          ],
        };
        return rollback ? deployRollbackCheck(context) : deployDryRunCheck(context);
      },
    );
  }
  if (flags.has('--rollback-check')) {
    console.error(
      'forge: "deploy --rollback-check" needs a real form: it is a check over recorded evidence and takes no <env>.',
    );
    return EXIT_CODES.usage;
  }
  if (env === undefined || positionals.length > 1) {
    console.error('forge: "deploy" needs a real <env>.');
    return EXIT_CODES.usage;
  }
  const deps = await buildRunDepsForProject(paths, projectRoot);
  const confirmation = values.get('--confirm');
  const result = await deployEnvironment(deps, env, {
    dryRun,
    host: os.hostname(),
    ...(confirmation !== undefined ? { confirmation } : {}),
  });
  return printWorkflowDispatchResult(`deploy ${env}`, result, json);
}

/** Every real flag each `deploy record` kind accepts, in the order `03` §3.2.5's own mandate text
 * gives them. */
const DEPLOY_RECORD_KIND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  'dry-run': ['--env', '--sha', '--ran-at'],
  rollback: [
    '--env',
    '--from-sha',
    '--to-sha',
    '--rehearsed-at',
    '--health-url',
    '--health-status',
    '--health-checked-at',
  ],
  deployment: [
    '--env',
    '--sha',
    '--deployed-at',
    '--health-url',
    '--health-status',
    '--health-checked-at',
  ],
};

/** `forge deploy record <dry-run|rollback|deployment>` (`PLAN-M14.md` P23): validates every required
 * flag is present and well-formed, then delegates to `commands/deploy-record.ts`'s own field-level
 * validation BEFORE writing anything. `--dry-run` has no form here -- unlike `forge deploy <env>
 * --dry-run`, this command either validates-and-writes a real record for real or refuses. */
async function runDeployRecordCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  const [kind, ...rest] = args;
  const requiredFlags = kind === undefined ? undefined : DEPLOY_RECORD_KIND_FLAGS[kind];
  if (kind === undefined || requiredFlags === undefined) {
    console.error(
      'forge: "deploy record" needs a real <kind> (dry-run|rollback|deployment); got ' +
        `${kind === undefined ? 'nothing' : JSON.stringify(kind)}.`,
    );
    return EXIT_CODES.usage;
  }
  if (dryRun) {
    console.error(
      `forge: "deploy record ${kind}" needs a real run: it validates and writes a delivery record, so it ` +
        'has no --dry-run form.',
    );
    return EXIT_CODES.usage;
  }
  const { values, positionals } = parseCommandFlags(
    rest,
    Object.fromEntries(requiredFlags.map((flag) => [flag, true])),
  );
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const missing = requiredFlags.filter((flag) => values.get(flag) === undefined);
  if (missing.length > 0) {
    console.error(`forge: "deploy record ${kind}" needs ${missing.join(' ')}.`);
    return EXIT_CODES.usage;
  }
  // Present for every flag `requiredFlags` names -- `missing` above already refused otherwise -- so
  // `?? ''` here is unreachable, never a silently-accepted empty value.
  const need = (flag: string): string => values.get(flag) ?? '';

  const config = await readConfig(paths);
  const ctx: DeployRecordContext = {
    paths,
    projectRoot,
    kbRoot: config.paths.kb,
    reportsRoot: config.paths.reports,
    documentRoots: [
      config.paths.kb,
      config.paths.specs,
      config.paths.plans,
      config.paths.sessions,
      config.paths.reports,
    ],
  };
  let outcome: DeployRecordOutcome;
  if (kind === 'dry-run') {
    outcome = await recordDryRun(ctx, {
      env: need('--env'),
      sha: need('--sha'),
      ranAt: need('--ran-at'),
    });
  } else if (kind === 'rollback') {
    outcome = await recordRollback(ctx, {
      env: need('--env'),
      fromSha: need('--from-sha'),
      toSha: need('--to-sha'),
      rehearsedAt: need('--rehearsed-at'),
      healthUrl: need('--health-url'),
      healthStatus: need('--health-status'),
      healthCheckedAt: need('--health-checked-at'),
    });
  } else {
    outcome = await recordDeployment(ctx, {
      env: need('--env'),
      sha: need('--sha'),
      deployedAt: need('--deployed-at'),
      healthUrl: need('--health-url'),
      healthStatus: need('--health-status'),
      healthCheckedAt: need('--health-checked-at'),
    });
  }
  if (!outcome.ok) {
    console.error(`forge deploy record ${kind}: ${outcome.message}.`);
    console.error(outcome.remedy);
    return EXIT_CODES.usage;
  }
  console.log(
    json
      ? JSON.stringify({ v: 1, written: outcome.written })
      : `forge deploy record ${kind}: wrote ${outcome.written}.`,
  );
  return EXIT_CODES.success;
}

const DEBUG_FLAGS = { '--from-failure': true } as const;

async function runDebugCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  budgetUsd: number | undefined,
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, DEBUG_FLAGS);
  const fromFailure = values.get('--from-failure');
  // Every sibling command in this same piece validates its own required arguments before building
  // any real dependency (`buildLoopDepsForProject` can throw a real, hard `ENV-004`) -- `debug`
  // matches.
  const [symptom] = positionals;
  if (fromFailure === undefined) {
    if (symptom === undefined || positionals.length > 1) {
      console.error('forge: "debug" needs a real <symptom>, or --from-failure <runId>.');
      return EXIT_CODES.usage;
    }
  } else if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }

  /* v8 ignore start -- `forge debug` has no `--dry-run` form at all (unlike `implement`/
   * `refactor`/`deploy`/`plan`): completing it for real needs a live platform-adapter session,
   * which this in-process suite cannot drive without either a real network call (barred by
   * `QUALITY-BAR.md`) or adapter injection the real dispatch layer's `buildLoopDepsForProject`
   * does not support. This is not a gap M17 P2 introduced: `packages/cli/test/bin.test.ts`'s own
   * top doc comment already discloses the identical scope limit for the real subprocess suite —
   * it predates this piece entirely and is only newly VISIBLE now that per-file coverage floors
   * apply to code that used to hide, uncredited either way, inside the excluded bin.ts monolith.
   * Every branch reachable without a live call (every usage-error path above) is tested above. */
  const deps: DebugDeps = await buildLoopDepsForProject(paths, projectRoot);
  const options = budgetUsd === undefined ? {} : { costBudgetUsd: budgetUsd };
  const result: DebugResult = sanitizeDeep(
    fromFailure !== undefined
      ? await debugFromFailure(deps, fromFailure, options)
      : await debugSymptom(deps, symptom ?? '', options),
  );
  console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
  return result.outcome === 'recorded' ? EXIT_CODES.success : EXIT_CODES.failure;
  /* v8 ignore stop */
}

const REVIEW_FLAGS = { '--diff': true } as const;

async function runReviewCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, REVIEW_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  /* v8 ignore start -- `forge review` has no `--dry-run` form either; the identical, pre-existing
   * `bin.test.ts`-disclosed live-adapter-call limit `runDebugCommand`'s own comment above explains
   * in full applies here unchanged. */
  const deps: ReviewDeps = await buildLoopDepsForProject(paths, projectRoot);
  const diff = values.get('--diff');
  const outcome = sanitizeDeep(await reviewChange(deps, diff === undefined ? {} : { diff }));
  console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
  return outcome.outcome.status === 'succeeded' ? EXIT_CODES.success : EXIT_CODES.failure;
  /* v8 ignore stop */
}

const PANEL_FLAGS = { '--roles': true } as const;

function splitCommaList(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

async function runPanelCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, PANEL_FLAGS);
  const [question] = positionals;
  if (question === undefined || positionals.length > 1) {
    console.error('forge: "panel" needs a real <question>.');
    return EXIT_CODES.usage;
  }
  const roles = splitCommaList(values.get('--roles'));
  if (roles === undefined) {
    console.error('forge: "panel" needs a real --roles <a,b,c>.');
    return EXIT_CODES.usage;
  }
  /* v8 ignore start -- `forge panel` has no `--dry-run` form either; the identical, pre-existing
   * `bin.test.ts`-disclosed live-adapter-call limit `runDebugCommand`'s own comment above explains
   * in full applies here unchanged. */
  const deps: PanelDeps = await buildLoopDepsForProject(paths, projectRoot);
  const outcome = sanitizeDeep(await panelQuestion(deps, question, roles));
  console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
  return outcome.outcome.status === 'succeeded' ? EXIT_CODES.success : EXIT_CODES.failure;
  /* v8 ignore stop */
}

/** `forge ask <question>` always refuses (`ask()` is a real, unconditional `USR-003`) — but it
 * still takes exactly one real positional, unlike every zero-positional command `assertNoArgs`
 * exists for elsewhere: a second, unexpected positional is still a real `USR-002`. */
function runAskCommand(args: readonly string[]): number {
  const { positionals } = parseCommandFlags(args, {});
  if (positionals.length > 1) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[1] ?? '' });
  }
  return ask();
}

const SESSION_KEYWORDS = ['list', 'show', 'resume', 'export'] as const;
const SESSION_START_FLAGS = {
  '--question': true,
  '--target': true,
  '--scope': true,
  '--stage': true,
  '--defect': true,
  '--options': true,
  '--technique': true,
  '--roles': true,
} as const;

async function runSessionCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  // Every subcommand's own required positionals are validated first; the one real dependency this
  // command needs is built only once a real, dispatchable subcommand/type is confirmed.
  if (sub === 'list') {
    assertNoArgs(rest);
    const deps = await buildLoopDepsForProject(paths, projectRoot);
    const sessions = sanitizeDeep(await sessionList(deps));
    console.log(
      json
        ? JSON.stringify({ v: 1, sessions })
        : sessions
            .map(
              (session) =>
                `${session.id} ${session.sessionType} ${session.status} ${session.title}`,
            )
            .join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show' || sub === 'resume' || sub === 'export') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error(`forge: "session ${sub}" needs a real <id>.`);
      return EXIT_CODES.usage;
    }
    const deps = await buildLoopDepsForProject(paths, projectRoot);
    if (sub === 'show') {
      const doc = await sessionShow(deps, id);
      // `body` is real, rendered agent-conversation output — the single most plausible vector for a
      // prompt-injected or buggy model response to smuggle a raw ANSI/C1 escape sequence into a
      // caller's terminal.
      const record = sanitizeDeep(doc.record);
      const body = stripControlChars(doc.body);
      console.log(
        json ? JSON.stringify({ v: 1, record, body, path: doc.path }) : `${doc.path}\n\n${body}`,
      );
      return EXIT_CODES.success;
    }
    if (sub === 'resume') {
      // `sessionResume`'s own real, typed refusals (RUN-070/071/072/073/074 -- a missing record, a
      // non-truncated record, an already-decided one, a corrupt one) are every branch reachable
      // without a real, live continuation, and are tested above; the call below either throws one
      // of those (covering the statement, not what follows it) or genuinely continues the session
      // live, which needs a real platform-adapter call this in-process suite cannot drive -- the
      // identical limit `runDebugCommand`'s own comment above explains in full.
      const result = sanitizeDeep(await sessionResume(deps, id));
      /* v8 ignore start -- only reached by a real, live continuation; see the comment above */
      console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
      return result.outcome.status === 'succeeded' ? EXIT_CODES.success : EXIT_CODES.failure;
      /* v8 ignore stop */
    }
    // `sub === 'export'`: the only remaining case this branch's own guard admits.
    const result = await sessionExport(deps, id);
    console.log(
      json
        ? JSON.stringify({ v: 1, ...result })
        : `forge session export ${id}: wrote ${result.path}.`,
    );
    return EXIT_CODES.success;
  }

  if (sub === undefined || !isSessionType(sub)) {
    console.error(
      `forge: "session ${sub ?? ''}" needs a real session <type>, or one of (${SESSION_KEYWORDS.join('|')}).`,
    );
    return EXIT_CODES.usage;
  }
  const type: SessionType = sub;
  const deps = await buildLoopDepsForProject(paths, projectRoot);
  const { values } = parseCommandFlags(rest, SESSION_START_FLAGS);
  const question = values.get('--question');
  const target = values.get('--target');
  const scope = values.get('--scope');
  const stage = values.get('--stage');
  const defect = values.get('--defect');
  const options: StartSessionOptions = {
    ...(question !== undefined ? { question } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(stage !== undefined ? { stage } : {}),
    ...(defect !== undefined ? { defect } : {}),
    ...(splitCommaList(values.get('--options')) !== undefined
      ? { options: splitCommaList(values.get('--options')) }
      : {}),
    ...(splitCommaList(values.get('--technique')) !== undefined
      ? { technique: splitCommaList(values.get('--technique')) }
      : {}),
    ...(splitCommaList(values.get('--roles')) !== undefined
      ? { roles: splitCommaList(values.get('--roles')) }
      : {}),
  };
  // `startSession`'s own real, pre-adapter-call validation (USR-002 for a missing type-specific
  // flag, tested above for "design-review"/"premortem") throws BEFORE ever touching the adapter;
  // a call that does not throw there completed a real, live session, which needs a real
  // platform-adapter call this in-process suite cannot drive -- the identical limit
  // `runDebugCommand`'s own comment above explains in full.
  const result = sanitizeDeep(await startSession(deps, type, options));
  /* v8 ignore start -- only reached by a real, live session; see the comment above */
  console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
  return result.outcome.status === 'succeeded' ? EXIT_CODES.success : EXIT_CODES.failure;
  /* v8 ignore stop */
}

/**
 * Dispatches `forge plan`/`implement`/`refactor`/`story`/`deploy`/`debug`/`review`/`panel`/`ask`/
 * `session`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchPlanAndLoop(ctx: DispatchContext): Promise<number | undefined> {
  const [command] = ctx.positionals;
  const afterCommand = ctx.positionals.slice(1);
  const { paths, projectRoot, flags } = ctx;

  if (command === 'plan') {
    const [phase, ...planRest] = afterCommand;
    return runPlanCommand(paths, projectRoot, phase, planRest, flags.dryRun, flags.json);
  }
  if (command === 'implement') {
    return runImplementCommand(paths, projectRoot, afterCommand, flags.dryRun, flags.json);
  }
  if (command === 'refactor') {
    return runRefactorCommand(paths, projectRoot, afterCommand, flags.dryRun, flags.json);
  }
  if (command === 'story') {
    const [storySub, ...storyRest] = afterCommand;
    return runStoryCommand(paths, projectRoot, storySub, storyRest, flags.dryRun, flags.json);
  }
  if (command === 'deploy') {
    return runDeployCommand(paths, projectRoot, afterCommand, flags.dryRun, flags.json);
  }
  if (command === 'debug') {
    return runDebugCommand(paths, projectRoot, afterCommand, flags.budget, flags.json);
  }
  if (command === 'review') {
    return runReviewCommand(paths, projectRoot, afterCommand, flags.json);
  }
  if (command === 'panel') {
    return runPanelCommand(paths, projectRoot, afterCommand, flags.json);
  }
  if (command === 'ask') {
    return runAskCommand(afterCommand);
  }
  if (command === 'session') {
    const [sessionSub, ...sessionRest] = afterCommand;
    return runSessionCommand(paths, projectRoot, sessionSub, sessionRest, flags.json);
  }
  return undefined;
}
