/**
 * `commands/dispatch/run-and-gates.ts` — the whole real execution family `bin.ts`'s own top doc
 * comment names as one unit: `init`'s sibling "`run`/`resume`/`pause`/`abort`/`lanes`/`logs`/`gate`/
 * `merge`" surface (`PLAN-M12.md` P1), plus `parity`/`evidence`/`land` (`PLAN-M16.md`/`specs/22` M17
 * P9), which share the identical `resolveDispatchRunId`/`gateCommandMarker` machinery and the same
 * launcher-shim convention for running a gate's own checks. Kept as one file (not split further)
 * because the original source groups them structurally — one contiguous block of the pre-split
 * `bin.ts` — and several of these commands call each other's own locally-scoped helpers
 * (`resolveDispatchRunId`, `gateCommandMarker`) that have no real use outside this one family.
 *
 * @see specs/22 M17 P2
 * @see specs/22 M17 P9
 */
import os from 'node:os';

import { FORGE_RUN_ID, SYSTEM_CLOCK } from '@forge/core';
import { EXIT_CODES, ForgeError, isForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import type { ForgeConfig } from '@forge/schemas/config';

import { readConfig } from '../config.ts';
import { parseKeep, runEvidencePrune } from '../evidence/prune-command.ts';
import {
  abortRun,
  assertStopped,
  ensureIntegrationWorktree,
  formatGateApproval,
  formatGateReport,
  gateApprove,
  gateCheck,
  gateList,
  gateReject,
  gateWaive,
  describeExtraLandedWork,
  integrationBranchOfRun,
  landRunOnTrunk,
  mergeAbort,
  mergeAllReady,
  mergeLane,
  pauseRun,
  readRunLock,
  resumeWorkflow,
  runLanes,
  runLogs,
  runWorkflow,
  type GateCommandContext,
  type MergeContext,
} from '../run/index.ts';
import { buildRunExpressionContext } from '../run/expression-context.ts';
import { extractInputFlags } from '../run/inputs.ts';
import { createLauncherShimOrWarn, currentLauncher } from '../run/launcher-shim.ts';
import { readWorkflowSource } from '../run/run.ts';
import { runParityCapture, type ParityCaptureMarker } from '../parity/capture-command.ts';
import { parityCheckExitCode, runParityCheck } from '../parity/check-command.ts';
import {
  AGENTS_ROOT,
  CHECKS_ROOT,
  SPECS_ROOT,
  WORKFLOWS_ROOT,
  assertNoArgs,
  buildElicitAskPort,
  buildRunDepsForProject,
  gateCommandMarker,
  gateSubFlags,
  parseCommandFlags,
  parseOptionalRunIdPositional,
  printWorkflowDispatchResult,
  realEnvSnapshot,
  renderRunStatus,
  reportRunFailure,
  type DispatchContext,
} from './shared.ts';

const RUN_FLAGS = {
  '--stage': true,
  '--epic': true,
  '--story': true,
  '--answers': true,
} as const;

/** `forge run <workflow> [--stage <id>] [--epic <id>] [--story <id>] [--input <name>=<value>]...` (`03` §3.2.4).
 * The expression context the workflow compiles against is `buildRunExpressionContext`'s (`PLAN-M13.md` P21): run
 * inputs, `stageId`, the stage's stories for a workflow that runs over them, and the workflow's own `vars:`. */
async function runRunCommand(
  paths: ProjectPaths,
  projectRoot: string,
  workflowId: string | undefined,
  rest: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  if (workflowId === undefined || workflowId.startsWith('--')) {
    console.error('forge: "run" needs a real <workflow> id.');
    return EXIT_CODES.usage;
  }
  const { inputs, rest: flagArgs } = extractInputFlags(rest);
  const { values, positionals } = parseCommandFlags(flagArgs, RUN_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }

  const deps = await buildRunDepsForProject(paths, projectRoot);
  const { context: expressionContext, warnings } = await buildRunExpressionContext(
    deps,
    workflowId,
    {
      stage: values.get('--stage'),
      epic: values.get('--epic'),
      story: values.get('--story'),
      inputs,
    },
    SPECS_ROOT,
  );
  for (const warning of warnings) console.error(`forge: warning: ${warning}`);
  const askPort = await buildElicitAskPort(
    values.get('--answers'),
    await readWorkflowSource(deps, workflowId),
  );
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
    return printWorkflowDispatchResult(`run ${workflowId}`, result, json);
  } finally {
    askPort.close();
  }
}

async function runResumeCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, { '--answers': true });
  if (positionals.length > 1) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[1] ?? '' });
  }
  const runId = positionals[0];
  const deps = await buildRunDepsForProject(paths, projectRoot);
  // A run stopped at a question is asked again here, with the answers of `--answers` (`PLAN-M13.md` P20).
  const askPort = await buildElicitAskPort(values.get('--answers'), undefined);
  let result: Awaited<ReturnType<typeof resumeWorkflow>>;
  try {
    result = await resumeWorkflow(
      { ...deps, ask: askPort },
      {
        ...(runId !== undefined ? { runId } : {}),
        host: os.hostname(),
      },
    );
  } finally {
    askPort.close();
  }
  if (json) {
    console.log(JSON.stringify({ v: 1, runId: result.runId, runState: result.runState }));
  } else {
    console.log(
      `forge resume: runId=${result.runId} status=${renderRunStatus(result.runState.runStatus)}.`,
    );
  }
  return reportRunFailure(result.runState);
}

async function runPauseCommand(paths: ProjectPaths, json: boolean): Promise<number> {
  const result = await pauseRun(paths);
  assertStopped(result);
  console.log(
    json
      ? JSON.stringify({
          v: 1,
          runId: result.lock.runId,
          pid: result.lock.pid,
          stopped: result.stopped,
        })
      : `forge pause: stopped run ${result.lock.runId} (pid ${String(result.lock.pid)}).`,
  );
  return EXIT_CODES.success;
}

/** `forge abort [runId]` — `03` §3.2.4's own row names an optional `[runId]`, but the real
 * `abortRun`/`stopLockedProcess` machinery (`commands/run/lock.ts`) always targets whichever process
 * currently holds this *project's* one real lock — there is no way to target a specific *past* run by
 * id, only the run (if any) currently in flight. A given `runId` that does not match the actually
 * locked run's own id is refused (`RUN-048`, "no active run") rather than silently aborting the wrong
 * one or silently ignoring the mismatch. See `SPEC-QUESTIONS.md`. */
async function runAbortCommand(
  paths: ProjectPaths,
  runId: string | undefined,
  json: boolean,
): Promise<number> {
  if (runId !== undefined) {
    const lock = await readRunLock(paths);
    if (lock?.runId !== runId) {
      throw new ForgeError('RUN-048', undefined);
    }
  }
  const result = await abortRun(paths);
  assertStopped(result);
  console.log(
    json
      ? JSON.stringify({
          v: 1,
          runId: result.lock.runId,
          pid: result.lock.pid,
          stopped: result.stopped,
        })
      : `forge abort: stopped run ${result.lock.runId} (pid ${String(result.lock.pid)}).`,
  );
  return EXIT_CODES.success;
}

async function runLanesCommand(
  paths: ProjectPaths,
  projectRoot: string,
  runId: string | undefined,
  json: boolean,
): Promise<number> {
  const lanes = await runLanes(paths, projectRoot, runId);
  if (json) {
    console.log(JSON.stringify({ v: 1, lanes }));
  } else if (lanes.length === 0) {
    console.log('forge lanes: no real lanes yet.');
  } else {
    for (const lane of lanes)
      console.log(`${lane.laneId} ${lane.status} step=${lane.stepId ?? '-'}`);
  }
  return EXIT_CODES.success;
}

const LOGS_FLAGS = { '--follow': false, '--lane': true, '--run': true, '--step': true } as const;

/** `forge logs [--step <id>] [--run <id>]` — `--follow` (live-tail) and `--lane <id>` filtering are
 * both real, already-disclosed gaps in `runLogs` itself (`commands/run/status.ts`'s own doc comment:
 * "a future piece's own job", and `RunLogsOptions` carries no `laneId` field at all), refused here
 * rather than silently ignored. `--run <id>` is this dispatcher's own addition — defaults to the last
 * run exactly as `runLogs` itself already does for `undefined`. */
async function runLogsCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { values, flags, positionals } = parseCommandFlags(args, LOGS_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  if (flags.has('--follow')) {
    throw new ForgeError('USR-003', {
      feature: 'forge logs --follow (no live-tail loop exists yet)',
    });
  }
  if (flags.has('--lane')) {
    throw new ForgeError('USR-003', {
      feature: 'forge logs --lane (runLogs only filters by --step today)',
    });
  }
  const runId = values.get('--run');
  const stepId = values.get('--step');
  const options = {
    ...(runId !== undefined ? { runId } : {}),
    ...(stepId !== undefined ? { stepId } : {}),
  };
  for await (const event of runLogs(paths, projectRoot, options)) {
    console.log(json ? JSON.stringify({ v: 1, event }) : JSON.stringify(event));
  }
  return EXIT_CODES.success;
}

/** Resolves the real run id `gate`/`merge`/`land` operate against: an explicit `--run <id>` override
 * (already parsed by the caller's own `parseCommandFlags` call), or the project's own last-run
 * pointer (`last-run.json`, written by `runWorkflow`). Exported (`specs/22` M17 P7): `test-exempt-
 * coverage-flaky.ts`'s own `forge test adopt --write --run <id>` needs the identical resolution,
 * the same cross-file need `resolveStoryById`/`runRawBindingCheck` already established for
 * `test-binding.ts`.
 * @throws {ForgeError} `RUN-048` when neither is available. */
export async function resolveDispatchRunId(
  paths: ProjectPaths,
  explicitRunId: string | undefined,
): Promise<string> {
  if (explicitRunId !== undefined) return explicitRunId;
  const pointer = paths.resolveState('last-run.json');
  if (!(await pathExists(pointer))) {
    throw new ForgeError('RUN-048', undefined);
  }
  const { runId } = JSON.parse(await readTextFile(pointer)) as { readonly runId: string };
  return runId;
}

/** `forge gate <sub>`. `check`, `approve` and `waive` run the gate's checks, and every shipped check is a `forge ...`
 * command, so they run with the launcher shim first on `PATH` exactly as a run's gate step does: a checkout launch
 * (`node packages/cli/bin/forge.mjs`) has no `forge` on `PATH`, and without the shim every check would exit 127
 * (`PLAN-M13.md` P12, P41).
 *
 * `PLAN-M14.md` P22: `commandEnv` also carries the caller's own real `FORGE_BASE_REF`, when set, read once
 * from `realEnvSnapshot()` rather than left to `execa`'s own ambient `process.env` extension. */
async function runGateCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  if (sub !== 'check' && sub !== 'approve' && sub !== 'waive') {
    return runGateSubcommand(paths, projectRoot, sub, rest, json, undefined);
  }
  const env = realEnvSnapshot();
  const shim = await createLauncherShimOrWarn(currentLauncher(env), (message) => {
    console.error(message);
  });
  const baseRef = env['FORGE_BASE_REF'];
  // `shim?.commandEnv` alone used to leave `commandEnv` `undefined` whenever the shim could not be
  // created (`createLauncherShimOrWarn` warns and swallows the failure rather than throwing, `03`
  // §3.2.4 — a disk-full or unwritable-temp-dir host still runs the gate's own checks, just without
  // `forge` resolving to this exact binary on `PATH`). `undefined` reaches `runShellCommand` as its own
  // `env === undefined`, which keeps `shell: true` (cmd.exe on Windows) unconditionally: `env` has to be
  // a real, concrete object for `resolvePosixShell` to have anything to search (`shell.ts`'s own doc
  // comment) — so a real `env` (already read, once, above) is the fallback here instead of nothing at
  // all. `shim?.commandEnv ?? env`: the shim's own `PATH`-with-the-launcher-first value when it exists,
  // or this file's own real environment snapshot when it does not — never literally `undefined`.
  const commandEnv = {
    ...(shim?.commandEnv ?? env),
    ...(baseRef === undefined ? {} : { FORGE_BASE_REF: baseRef }),
  };
  try {
    return await runGateSubcommand(paths, projectRoot, sub, rest, json, commandEnv);
  } finally {
    await shim?.cleanup();
  }
}

async function runGateSubcommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
  commandEnv: Readonly<Record<string, string>> | undefined,
): Promise<number> {
  const subFlags = sub === undefined ? undefined : gateSubFlags(sub);
  if (sub === undefined || subFlags === undefined) {
    console.error('forge: "gate" needs a real subcommand (list|check|approve|reject|waive).');
    return EXIT_CODES.usage;
  }
  const { values, positionals } = parseCommandFlags(rest, subFlags);

  // `list` alone needs no real run id at all -- `gateList` only ever reads `ctx.paths`/`ctx.checksRoot`
  // (`commands/run/gate-commands.ts`), so it must not force a real prior `forge run` to exist just to
  // enumerate this project's own registered gate definitions.
  if (sub === 'list') {
    if (positionals.length > 0) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
    }
    const gates = await gateList({
      paths,
      projectRoot,
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
      runId: '',
    });
    console.log(
      json
        ? JSON.stringify({ v: 1, gates })
        : gates.map((gate) => gate.id).join('\n') || 'forge gate list: no real gates.',
    );
    return EXIT_CODES.success;
  }

  const gateId = positionals[0];
  if (gateId === undefined || positionals.length > 1) {
    console.error(`forge: "gate ${sub}" needs exactly one real <gate> id.`);
    return EXIT_CODES.usage;
  }
  const runId = await resolveDispatchRunId(paths, values.get('--run'));
  const marker = gateCommandMarker(realEnvSnapshot());
  const ctx: GateCommandContext = {
    paths,
    projectRoot,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
    runId,
    commandEnv,
    ...(marker === undefined ? {} : { marker }),
  };

  if (sub === 'check') {
    const report = await gateCheck(ctx, gateId);
    console.log(json ? JSON.stringify({ v: 1, report }) : formatGateReport(report));
    return report.passed ? EXIT_CODES.success : EXIT_CODES.gateFailed;
  }
  if (sub === 'approve') {
    const reason = values.get('--reason');
    // Evaluates the gate first and throws `GATE-507` (checks failing, no waiver) or `GATE-508` (approver not
    // authorised): the top-level handler prints the refusal, its `--json` envelope and exit code 3
    // (`PLAN-M13.md` P41). Only an approval that was decided is recorded.
    const summary = await gateApprove(ctx, gateId, reason);
    console.log(
      json
        ? JSON.stringify({ v: 1, gateId, recorded: true, evaluation: summary })
        : formatGateApproval(gateId, summary),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'reject') {
    const reason = values.get('--reason');
    if (reason === undefined) {
      console.error('forge: "gate reject" needs --reason <text>.');
      return EXIT_CODES.usage;
    }
    await gateReject(ctx, gateId, reason);
    console.log(
      json
        ? JSON.stringify({ v: 1, gateId, recorded: true })
        : `forge gate reject ${gateId}: recorded.`,
    );
    return EXIT_CODES.success;
  }
  // `sub === 'waive'`: the only remaining case `gateSubFlags` returns a real flag set for.
  const reason = values.get('--reason');
  const owner = values.get('--owner');
  const expiresAt = values.get('--expires');
  if (reason === undefined || owner === undefined || expiresAt === undefined) {
    console.error(
      'forge: "gate waive" needs --reason <text> --owner <identifier> --expires <iso-date>.',
    );
    return EXIT_CODES.usage;
  }
  const report = await gateWaive(ctx, gateId, { reason, owner, expiresAt });
  console.log(json ? JSON.stringify({ v: 1, report }) : formatGateReport(report));
  return report.passed ? EXIT_CODES.success : EXIT_CODES.gateFailed;
}

/** `--trusted @trunk` (`specs/22` M17 P9, Decision 7): resolved HERE, by `forge parity check` itself, to
 * `refs/heads/<vcs.trunk>`. `alreadyRead` is the config `runParityCommand` already read for
 * `reportsRoot`, reused rather than read twice; when `undefined` (a `--no-record` call) this falls
 * back to a SEPARATE, TOLERANT read: a project with no `.forge/config.yaml` yet resolves `@trunk` to
 * the schema's own documented default (`"main"`) rather than a hard `CFG-020` failure. A config file
 * that EXISTS but fails to validate is not tolerated the same way. */
async function resolveTrunkForTrustedFlag(
  paths: ProjectPaths,
  alreadyRead: ForgeConfig | undefined,
): Promise<string> {
  if (alreadyRead !== undefined) return alreadyRead.vcs.trunk;
  try {
    return (await readConfig(paths)).vcs.trunk;
  } catch (error) {
    if (isForgeError(error) && error.code === 'CFG-020') return DEFAULT_CONFIG.vcs.trunk;
    throw error;
  }
}

/** `forge parity <sub>` (`PLAN-M16.md` P6/P7, `13` F-TEST-9, Q294 Amendments A8/A9). `capture` and
 * `check` are the two real sub-verbs. Both `runParityCapture` and `runParityCheck` return plain data
 * (no `v`): this dispatcher adds the envelope's `v: 1` on `--json`. */
async function runParityCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  if (sub === 'check') {
    const { values, flags, positionals } = parseCommandFlags(rest, {
      '--name': true,
      '--trusted': true,
      '--story': true,
      '--no-record': false,
    });
    assertNoArgs(positionals);
    const name = values.get('--name');
    const trusted = values.get('--trusted');
    const story = values.get('--story');
    const noRecord = flags.has('--no-record');
    const config = noRecord ? undefined : await readConfig(paths);
    const reportsRoot = config?.paths.reports;
    const resolvedTrusted =
      trusted === '@trunk'
        ? `refs/heads/${await resolveTrunkForTrustedFlag(paths, config)}`
        : trusted;
    const env = realEnvSnapshot();
    const result = await runParityCheck({
      projectRoot,
      parentEnv: env,
      runId: env[FORGE_RUN_ID],
      ...(env['FORGE_PROJECT_ROOT'] === undefined
        ? {}
        : { telemetryProjectRoot: env['FORGE_PROJECT_ROOT'] }),
      ...(reportsRoot === undefined ? {} : { reportsRoot }),
      ...(name === undefined ? {} : { name }),
      ...(resolvedTrusted === undefined ? {} : { trusted: resolvedTrusted }),
      ...(story === undefined ? {} : { story }),
      ...(noRecord ? { noRecord: true } : {}),
    });
    if (json) {
      console.log(JSON.stringify({ v: 1, ...result }));
    } else {
      const detail = result.declarations
        .map((entry) => `${entry.name}: ${entry.verdict}`)
        .join(', ');
      console.log(
        `forge parity check: ${String(result.passing)} passing, ${String(result.failing)} failing` +
          `${detail === '' ? '' : ` (${detail})`}.`,
      );
    }
    return parityCheckExitCode(result);
  }
  if (sub !== 'capture') {
    console.error('forge: "parity" needs a real subcommand (capture, check).');
    return EXIT_CODES.usage;
  }
  const { values, positionals } = parseCommandFlags(rest, { '--name': true });
  assertNoArgs(positionals);
  const marker: ParityCaptureMarker | undefined = gateCommandMarker(realEnvSnapshot());
  const name = values.get('--name');
  const result = await runParityCapture({
    projectRoot,
    parentEnv: realEnvSnapshot(),
    ...(name === undefined ? {} : { name }),
    ...(marker === undefined ? {} : { marker }),
  });
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else {
    const detail =
      result.captures.map((entry) => `${entry.name} -> ${entry.file}`).join(', ') ||
      'nothing to capture';
    console.log(
      `forge parity capture: captured ${String(result.captured)}, unchanged ${String(result.unchanged)} (${detail}).`,
    );
  }
  return EXIT_CODES.success;
}

const EVIDENCE_PRUNE_FLAGS = { '--apply': false, '--keep': true } as const;

/** `forge evidence <sub>` (`process/plans/PLAN-M16.md` P14, `18` §18.7, `03` §3.2.5). `prune` is the
 * one real sub-verb. The FORGE session marker is read here, once, via the identical
 * `gateCommandMarker(realEnvSnapshot())` `forge parity capture` already reuses for its own identical
 * refusal shape — `runEvidencePrune` itself decides whether the marker's mere PRESENCE refuses this
 * particular call (only ever for `--apply`; a dry run is always allowed, `18` §18.7). */
async function runEvidenceCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  if (sub !== 'prune') {
    console.error('forge: "evidence" needs a real subcommand (prune).');
    return EXIT_CODES.usage;
  }
  const { values, flags, positionals } = parseCommandFlags(rest, EVIDENCE_PRUNE_FLAGS);
  assertNoArgs(positionals);
  const keep = parseKeep(values.get('--keep'));
  const apply = flags.has('--apply');
  const marker = gateCommandMarker(realEnvSnapshot());
  const result = await runEvidencePrune({
    paths: new ProjectPaths(projectRoot),
    clock: SYSTEM_CLOCK,
    keep,
    apply,
    marker,
  });
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else {
    const verb = apply ? 'removed' : 'would remove';
    console.log(
      `forge evidence prune: kept ${String(result.kept.length)}, ${verb} ${String(result.removed.length)}` +
        (result.pending.length > 0
          ? `, ${String(result.pending.length)} pending (still referenced)`
          : '') +
        '.',
    );
  }
  return EXIT_CODES.success;
}

const MERGE_FLAGS = {
  '--lane': true,
  '--all': false,
  '--abort': false,
  '--run': true,
  '--pre-checks': true,
  '--post-checks': true,
} as const;

async function runMergeCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { values, flags, positionals } = parseCommandFlags(args, MERGE_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  if (flags.has('--abort')) {
    mergeAbort();
  }
  const laneId = values.get('--lane');
  const all = flags.has('--all');
  if (laneId === undefined && !all) {
    console.error('forge: "merge" needs --lane <id> or --all.');
    return EXIT_CODES.usage;
  }

  const config = await readConfig(paths);
  const runId = await resolveDispatchRunId(paths, values.get('--run'));
  // The integration branch the run used (a `--stage` run has its own): its ready lanes are merged there.
  const integrationBranch = await integrationBranchOfRun(paths, config, runId);
  const integrationPath = await ensureIntegrationWorktree(
    paths,
    projectRoot,
    integrationBranch,
    // `specs/22` M17 P9: the project's own configured `vcs.trunk`, not a hardcoded `'main'` literal --
    // the integration branch, when it does not exist yet, is created from this.
    config.vcs.trunk,
  );
  // `PLAN-M14.md` P40: the checks a landed lane's own merge-check commands spawn carry the identical FORGE
  // run marker (`PLAN-M14.md` P4) a live run's own merge step would give them — the same shim pattern
  // `runGateCommand` above already uses for gate checks.
  const env = realEnvSnapshot();
  const shim = await createLauncherShimOrWarn(
    currentLauncher(env),
    (message) => {
      console.error(message);
    },
    runId,
  );
  const overrides = { pre: values.get('--pre-checks'), post: values.get('--post-checks') };
  try {
    const ctx: MergeContext = {
      paths,
      projectRoot,
      runId,
      integrationPath,
      config,
      workflowsRoot: WORKFLOWS_ROOT,
      // `shim?.commandEnv` alone (never `undefined`, see `runGateCommand`'s own identical comment,
      // above): a merge's pre/post-check commands still need a real, concrete environment to run
      // with when the launcher shim itself could not be created, both so `resolvePosixShell` has a
      // real `PATH` to search and so the checks are not run with no environment at all.
      commandEnv: shim?.commandEnv ?? env,
    };

    if (all) {
      const results = await mergeAllReady(ctx, overrides);
      console.log(json ? JSON.stringify({ v: 1, results }) : JSON.stringify(results, null, 2));
      const anyFailed = results.some(({ result }) => result.failure !== undefined);
      return anyFailed ? EXIT_CODES.failure : EXIT_CODES.success;
    }
    // `laneId` is real here: `all` is `false` and the guard above already refused the only other case.
    const result = await mergeLane(ctx, laneId ?? '', overrides);
    console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
    return result.failure === undefined ? EXIT_CODES.success : EXIT_CODES.failure;
  } finally {
    await shim?.cleanup();
  }
}

const LAND_FLAGS = {
  '--run': true,
} as const;

/**
 * `forge land [--run <id>]` — lands a run's own integration branch on `vcs.trunk` (`specs/22` M17 P9,
 * `06` §6.5's "Landing a finished run on trunk" paragraph). `--run` resolves exactly as `forge merge`'s
 * own does, above, to find WHICH BRANCH to land — never to scope WHAT lands to that run's own commits
 * alone.
 *
 * **`--run` names a branch, not a commit range.** The default integration branch is shared and
 * accumulates across every run that targets the same stage, so this command genuinely lands whatever
 * is CURRENTLY on that branch; {@link describeExtraLandedWork} detects the mismatch when `runId`'s
 * own event log makes it detectable and surfaces it as a non-fatal `warning` — landing still proceeds.
 */
async function runLandCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, LAND_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const config = await readConfig(paths);
  const runId = await resolveDispatchRunId(paths, values.get('--run'));
  // The integration branch the run used (a `--stage` run has its own) -- the identical resolution
  // `forge merge` above uses to find which branch a lane lands into.
  const integrationBranch = await integrationBranchOfRun(paths, config, runId);

  const result = await landRunOnTrunk(projectRoot, config.vcs.trunk, integrationBranch, runId);
  // Never computed for `mergesDirectly` (nothing was separately "landed" to compare against at all).
  const warning = result.mergesDirectly
    ? undefined
    : await describeExtraLandedWork(projectRoot, runId, result.trunkTip);

  if (json) {
    // `03` §3.5: exactly one line under `--json` -- the warning (when there is one) is folded into
    // this SAME envelope, never a second line, which would break that contract.
    console.log(JSON.stringify({ v: 1, ...result, ...(warning === undefined ? {} : { warning }) }));
    return EXIT_CODES.success;
  }
  if (result.mergesDirectly) {
    console.log(
      `forge land: execution.integrationBranch already is ${config.vcs.trunk} -- nothing further to land.`,
    );
  } else if (result.landed) {
    console.log(`forge land: fast-forwarded ${config.vcs.trunk} to ${result.trunkTip}.`);
  } else {
    console.log(
      `forge land: ${config.vcs.trunk} already has run ${runId}'s own work -- nothing to land.`,
    );
  }
  if (warning !== undefined) console.log(`forge land: warning: ${warning}`);
  return EXIT_CODES.success;
}

/**
 * Dispatches the whole `run`/`resume`/`pause`/`abort`/`lanes`/`logs`/`gate`/`parity`/`evidence`/
 * `merge`/`land` family — `undefined` for every other command, so `commands/dispatch/index.ts`'s own
 * chain tries the next area.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchRunAndGates(ctx: DispatchContext): Promise<number | undefined> {
  const [command] = ctx.positionals;
  const afterCommand = ctx.positionals.slice(1);
  const { paths, projectRoot, flags } = ctx;

  if (command === 'gate') {
    const [gateSub, ...gateRest] = afterCommand;
    return runGateCommand(paths, projectRoot, gateSub, gateRest, flags.json);
  }
  if (command === 'parity') {
    const [paritySub, ...parityRest] = afterCommand;
    return runParityCommand(paths, projectRoot, paritySub, parityRest, flags.json);
  }
  if (command === 'evidence') {
    const [evidenceSub, ...evidenceRest] = afterCommand;
    return runEvidenceCommand(paths, projectRoot, evidenceSub, evidenceRest, flags.json);
  }
  if (command === 'merge') {
    return runMergeCommand(paths, projectRoot, afterCommand, flags.json);
  }
  if (command === 'land') {
    return runLandCommand(paths, projectRoot, afterCommand, flags.json);
  }
  if (command === 'run') {
    const [workflowId, ...runRest] = afterCommand;
    return runRunCommand(paths, projectRoot, workflowId, runRest, flags.dryRun, flags.json);
  }
  if (command === 'resume') {
    return runResumeCommand(paths, projectRoot, afterCommand, flags.json);
  }
  if (command === 'pause') {
    assertNoArgs(afterCommand);
    return runPauseCommand(paths, flags.json);
  }
  if (command === 'abort') {
    return runAbortCommand(paths, parseOptionalRunIdPositional(afterCommand), flags.json);
  }
  if (command === 'lanes') {
    return runLanesCommand(
      paths,
      projectRoot,
      parseOptionalRunIdPositional(afterCommand),
      flags.json,
    );
  }
  if (command === 'logs') {
    return runLogsCommand(paths, projectRoot, afterCommand, flags.json);
  }
  return undefined;
}
