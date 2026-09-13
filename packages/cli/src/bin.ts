/**
 * `forge` — a real, minimal argv dispatcher, wired to exactly the subcommands `specs/22` M6's own
 * literal exit-test line invokes (`pnpm forge agent validate --all && pnpm forge workflow validate
 * --all && pnpm forge template validate --all`, plus `pnpm forge --json status`) — not a complete
 * dispatcher for every command this codebase has built since C1.
 *
 * **A real, deliberate scope boundary through M11, closed for one family by M12 P1.** Every command
 * built in C1-C8 (`kb`, `spec`, `adr`, `diagram`, `uninstall`, `implement`/`debug`/`refactor`/`deploy`/
 * `review`/`panel`/`test`/`ask`/`session`, `doctor`, `upgrade`, `module`, `config`, `cost`, `export`,
 * `help`, `customize`, `compile`, `overlay`, `preset`, `skill`, `mcp`, and the rest of `agent`/
 * `workflow` beyond `validate`) exists only as a real, already-tested plain function taking a
 * hand-built `*CommandContext` — confirmed directly, no real argv dispatcher existed anywhere in this
 * repository before this file. Wiring every one of them into this dispatcher (deciding each command's
 * own real flag shape, output formatting, and exit-code mapping) is real, substantial work this
 * milestone's own C9 mandate did not ask for — its own Surface text named only `forge template
 * validate --all` and `scripts/assert-json-contract.mjs`, not a general CLI. See `SPEC-QUESTIONS.md`
 * for the full record of this decision.
 *
 * `spec validate --rule <name> --json` (M8 P2) and `test run [--rule lint|typecheck] --json`
 * (M8 P4) were added narrowly, for the identical reason: `G-Ready.gate.yaml`/`G-Verify.gate.yaml`/
 * `G-Stable.gate.yaml` (already-shipped `@forge/templates` data) name each as a real `execa`-shelled
 * command a gate check runs, which makes it unreachable until it is a real, invocable subcommand,
 * unlike every other still-unwired command above (each of which is reachable only through this
 * package's own exported functions today, never through a shipped gate). The rest of `spec`/`test`
 * remain exactly as unwired as the paragraph above still says.
 *
 * `init` and the whole `run`/`resume`/`pause`/`abort`/`lanes`/`logs`/`gate`/`merge` execution family
 * are wired below by `PLAN-M12.md` P1 — `specs/22` M12's own "the real CLI dispatcher is this
 * milestone's own first, blocking subsystem" finding (SC1-SC3/SC7's own literal proof commands).
 * `implement`/`debug`/`refactor`/`deploy`/`review`/`panel`/`ask`/`session` and the remaining
 * `kb`/`spec`/`adr`/`diagram`/`customize`/`compile`/`preset`/`skill`/`mcp`/`help`/`module`/`overlay`/
 * `upgrade`/`export`/`doctor`/`audit`/`config`/`cost`/`uninstall` surface is `PLAN-M12.md` P2-P4's own
 * mandate, still unwired here.
 *
 * @see specs/22 M6
 * @see specs/22 M8
 * @see specs/22 M12
 * @see PLAN-M6.md C9
 * @see PLAN-M8.md P2
 * @see PLAN-M8.md P4
 * @see PLAN-M12.md P1
 */
import os from 'node:os';
import path from 'node:path';

import { KNOWN_ADAPTER_MODULES, loadAdapterFactory } from '@forge/adapter-kit/registry';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { SYSTEM_CLOCK } from '@forge/core';
import { EXIT_CODES, ForgeError, isForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, ProjectPaths } from '@forge/core/fs';
import type { ExpressionContext } from '@forge/engine/expr';
import type { ForgeConfig } from '@forge/schemas/config';

import { agentValidateAll } from './commands/agent.ts';
import { readConfig } from './commands/config.ts';
import { workflowValidateAll } from './commands/workflow.ts';
import { templateValidateAll } from './commands/template.ts';
import { testCoverage } from './commands/loop/test/coverage.ts';
import { testFlaky } from './commands/loop/test/flaky.ts';
import { createSystemTempPath } from './commands/loop/test/system-temp.ts';
import { testRun } from './commands/loop/test/run.ts';
import {
  abortRun,
  assertStopped,
  ensureIntegrationWorktree,
  gateApprove,
  gateCheck,
  gateList,
  gateReject,
  gateWaive,
  mergeAbort,
  mergeAllReady,
  mergeLane,
  pauseRun,
  readRunLock,
  resumeWorkflow,
  runLanes,
  runLogs,
  runStatus,
  runWorkflow,
  type GateCommandContext,
  type MergeContext,
  type RunDeps,
} from './commands/run/index.ts';
import { runStatusJson } from './commands/run/status.ts';
import { parseInitFlags } from './init/parse-init-flags.ts';
import { resolvePackageRoot } from './init/package-root.ts';
import { runInit } from './init/run-init.ts';
import {
  specValidateRule,
  VALIDATE_RULE_IDS,
  type ValidateRuleId,
} from './commands/spec/validate-rules.ts';
import { parseGlobalFlags } from './entry/parse-global-flags.ts';

const AGENTS_ROOT = '.forge/agents';
const WORKFLOWS_ROOT = '.forge/workflows';
const CHECKS_ROOT = '.forge/checks';
const SPECS_ROOT = 'docs/forge/specs';
const KB_ROOT = 'docs/forge/kb';

async function runAgentValidate(paths: ProjectPaths, json: boolean): Promise<number> {
  const findings = await agentValidateAll({ paths, agentsRoot: AGENTS_ROOT });
  if (json) {
    console.log(JSON.stringify({ v: 1, findings }));
  } else if (findings.length === 0) {
    console.log('forge agent validate --all: no real findings.');
  } else {
    for (const finding of findings) {
      console.error(`${finding.severity} ${finding.agentId} ${finding.code}: ${finding.message}`);
    }
  }
  return findings.some((finding) => finding.severity === 'error') ? 1 : 0;
}

async function runWorkflowValidate(paths: ProjectPaths, json: boolean): Promise<number> {
  const results = await workflowValidateAll({
    paths,
    workflowsRoot: WORKFLOWS_ROOT,
    agentsRoot: AGENTS_ROOT,
    checksRoot: CHECKS_ROOT,
  });
  const allIssues = [...results.values()].flat();
  if (json) {
    console.log(JSON.stringify({ v: 1, results: Object.fromEntries(results) }));
  } else if (allIssues.length === 0) {
    console.log('forge workflow validate --all: no real issues.');
  } else {
    for (const [id, issues] of results) {
      for (const issue of issues) console.error(`${id}: ${issue.code} ${issue.message}`);
    }
  }
  return allIssues.length > 0 ? 1 : 0;
}

async function runTemplateValidate(json: boolean): Promise<number> {
  const results = await templateValidateAll();
  const invalid = results.filter((result) => !result.valid);
  if (json) {
    console.log(JSON.stringify({ v: 1, results }));
  } else if (invalid.length === 0) {
    console.log('forge template validate --all: no real errors.');
  } else {
    for (const result of invalid) console.error(`${result.type}: ${result.errors.join('; ')}`);
  }
  return invalid.length > 0 ? 1 : 0;
}

async function runStatusCommand(
  paths: ProjectPaths,
  projectRoot: string,
  json: boolean,
): Promise<number> {
  if (json) {
    const report = await runStatusJson(paths, projectRoot, undefined);
    console.log(JSON.stringify(report));
  } else {
    const status = await runStatus(paths, projectRoot, undefined);
    console.log(JSON.stringify(status, null, 2));
  }
  return 0;
}

/**
 * `init`/`run`/`resume`/`gate`/`merge` — real dispatcher wiring for `03` §3.2.4/§3.3's own execution
 * and greenfield-wizard surface (`PLAN-M12.md` P1). Every one of these commands needs a real,
 * concrete `PlatformAdapter` — `@forge/cli/init`'s own `RunInitDeps.candidateAdapters` and
 * `@forge/cli/commands/run`'s own `RunDeps.adapter` were both left as an injected seam because no
 * concrete adapter existed anywhere in this codebase at the time (`SPEC-QUESTIONS.md` Q103).
 *
 * This file never imports an adapter package or names a platform by identifier — `specs/07` §7.1's
 * own boundary rule ("nothing above `@forge/adapter-kit` may reference Claude Code... by name") and
 * its mechanical enforcement, `forge-boundaries/no-platform-concept`, both forbid that here exactly as
 * much as inside `@forge/adapter-kit` itself; a first draft of this piece got this wrong (a literal
 * `import { ClaudeCodeAdapter } from '@forge/adapter-claude-code'`), caught by a critic round quoting
 * the lint rule's own doc comment naming that literal import as its own worked example of the failure
 * it exists to catch. The real, sanctioned fix that same doc comment names: "load it dynamically
 * through `adapter-kit`'s registry (a specifier built from configuration, never a literal)" —
 * `@forge/adapter-kit/registry`'s own `KNOWN_ADAPTER_MODULES`/`loadAdapterFactory`, used below. Every
 * platform id this file ever touches is a runtime string flowing out of that registry or a project's
 * own `.forge/config.yaml`, never typed as a literal here. See `SPEC-QUESTIONS.md` for the record. */
function realEnvSnapshot(): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** The real `modules/` roster directory (`RunInitDeps.modulesDir`'s own doc comment) resolved from
 * this package's own real install location — this only ever finds the *workspace* `modules/`
 * directory (two levels above `@forge/cli`'s own package root), since no publishing/distribution
 * mechanism for `modules/` exists yet (the identical, already-disclosed gap `RunInitDeps.modulesDir`'s
 * own doc comment names, `SPEC-QUESTIONS.md` Q103) — real for every real use of this dispatcher today
 * (a workspace checkout), not yet real for a published, installed `forge-method` package. */
function resolveModulesDir(): string {
  return path.join(resolvePackageRoot('@forge/cli'), '..', '..', 'modules');
}

/** Real wall-clock time via `@forge/core`'s own injected-clock seam (R10) — never `Date.now()`
 * directly, matching `commands/run/context.ts`'s own identical `Date.parse(clock.now())` pattern. */
function realNow(): number {
  return Date.parse(SYSTEM_CLOCK.now());
}

/** Every real candidate `forge init` offers `selectPlatform` — every module `@forge/adapter-kit/
 * registry`'s own `KNOWN_ADAPTER_MODULES` names, each loaded and constructed dynamically (see this
 * section's own top doc comment for why this can never be a literal, direct import instead). Real,
 * disclosed gap: `@forge/adapter-generic` is not in that registry (no shipped `adapter.yaml` exists
 * anywhere in this workspace to construct one from) — see `SPEC-QUESTIONS.md`. */
async function buildCandidateAdapters(
  env: Readonly<Record<string, string>>,
): Promise<readonly PlatformAdapter[]> {
  const adapters: PlatformAdapter[] = [];
  for (const spec of KNOWN_ADAPTER_MODULES) {
    const factory = await loadAdapterFactory(spec.packageName);
    adapters.push(factory({ env, now: realNow }));
  }
  return adapters;
}

/** Reconstructs the identical real adapter a project's own `.forge/config.yaml` already recorded at
 * `forge init` time (`platform.primary`) — `forge run`/`resume` never re-run platform *selection*
 * (`03` §3.3 step 5's own "detect installed platforms... pick primary" is `init`'s job alone); this
 * only ever re-builds the one real adapter this dispatcher knows how to construct for the id already
 * on record, reading that platform's own real `platform.adapterConfig` blob back in.
 * @throws {ForgeError} `ENV-004` for any recorded `platform.primary` this registry has no real module
 * for — the identical, disclosed "not every real platform id has a real construction path here" gap
 * this section's own top doc comment names, now surfaced for a *recorded* id this dispatcher genuinely
 * cannot honour rather than silently defaulting to the wrong adapter. An empty `platform.primary`
 * (`03` §3.3's own "unset" default) falls back to this registry's own first real entry. */
async function buildAdapterForConfig(
  config: ForgeConfig,
  env: Readonly<Record<string, string>>,
): Promise<PlatformAdapter> {
  const platformId = config.platform.primary;
  const spec =
    platformId === ''
      ? KNOWN_ADAPTER_MODULES[0]
      : KNOWN_ADAPTER_MODULES.find((candidate) => candidate.id === platformId);
  if (spec === undefined) {
    throw new ForgeError('ENV-004', {
      tool: platformId === '' ? 'a platform adapter' : platformId,
    });
  }
  const factory = await loadAdapterFactory(spec.packageName);
  return factory({ env, now: realNow, config: config.platform.adapterConfig[spec.id] });
}

async function buildRunDepsForProject(paths: ProjectPaths, projectRoot: string): Promise<RunDeps> {
  const config = await readConfig(paths);
  const env = realEnvSnapshot();
  return {
    paths,
    projectRoot,
    config,
    adapter: await buildAdapterForConfig(config, env),
    workflowsRoot: WORKFLOWS_ROOT,
    checksRoot: CHECKS_ROOT,
  };
}

async function runInitCommand(
  initArgs: readonly string[],
  yes: boolean,
  json: boolean,
): Promise<number> {
  const { dir, options } = parseInitFlags(initArgs, yes);
  const env = realEnvSnapshot();
  const result = await runInit(dir, options, {
    candidateAdapters: await buildCandidateAdapters(env),
    env,
    modulesDir: resolveModulesDir(),
  });
  if (json) {
    console.log(JSON.stringify({ v: 1, result }));
  } else if (result.kind === 'already-initialized') {
    console.log(`forge init: ${result.projectRoot} is already initialized.`);
  } else {
    console.log(
      `forge init: wrote ${String(result.files.length)} files to ${result.projectRoot} ` +
        `(level ${result.level}, platform ${result.platform ?? 'none'}).`,
    );
  }
  // `03` §3.3's own idempotency rule ("MUST detect it and switch to upgrade semantics") has no real
  // `upgrade` conflict-resolution mechanism yet (`PLAN-M12.md` P3's own mandate) — reported honestly as
  // a real, non-zero "nothing happened" outcome rather than a silent success, matching this
  // dispatcher's own "detect, don't yet resolve" scope for P1.
  return result.kind === 'already-initialized' ? 1 : 0;
}

/**
 * A minimal, generic flag parser local to one command's own `rest`/`afterCommand` slice —
 * generalising the "not a global flag, found locally" pattern `findRuleFlag`/`findRawTestRuleFlag`
 * above already establish for `spec validate`/`test run`, but (unlike the first draft's own
 * `findFlagValue`) validated against a real, exhaustive `spec` of every flag the calling command
 * actually recognises: any `--`-shaped token not named in `spec` is a real, reported `USR-002`, never
 * silently dropped — the identical "an unrecognised flag is a reportable error" discipline
 * `parseGlobalFlags`/`parseInitFlags` already apply everywhere else in this package, which a fresh
 * critic round found the first draft's per-flag `findFlagValue` calls did not: `forge run wf --epci
 * foo` (a typo of `--epic`) silently ran with no error and no `vars.epic` at all.
 *
 * A declared value-flag's very next token is always consumed as its value, whatever it looks like —
 * `spec[flag] === true` means "this flag takes a value," full stop, so `--reason "--skip until next
 * sprint"` works correctly rather than the first draft's own heuristic (any value starting with `--`
 * is rejected) misfiring on a legitimate value that merely starts with two dashes. Missing a required
 * value (the flag is the last token, or immediately followed by another recognised flag) is still a
 * real `USR-002`.
 */
function parseCommandFlags(
  args: readonly string[],
  spec: Readonly<Record<string, boolean>>,
): {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  readonly positionals: readonly string[];
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  const remaining = [...args];

  for (let token = remaining.shift(); token !== undefined; token = remaining.shift()) {
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const takesValue = spec[token];
    if (takesValue === undefined) {
      throw new ForgeError('USR-002', { flag: token, value: '' });
    }
    flags.add(token);
    if (takesValue) {
      const value = remaining.shift();
      if (value === undefined) {
        throw new ForgeError('USR-002', { flag: token, value: '' });
      }
      values.set(token, value);
    }
  }

  return { values, flags, positionals };
}

/** `forge run <workflow> [--stage <id>] [--epic <id>] [--story <id>]` (`03` §3.2.4) into
 * `@forge/engine/expr`'s `ExpressionContext` — `stage` maps directly to its own named field;
 * `epic`/`story` have no dedicated `ExpressionContext` field (only `item`/`stage`/`run`/`config`/`kb`/
 * `failures`/`vars` exist), so both fold into `vars`, the one field `10`/`06`'s own workflow
 * expressions already read arbitrary caller-supplied values from. A real, disclosed decision — see
 * `SPEC-QUESTIONS.md`. */
function buildExpressionContext(values: ReadonlyMap<string, string>): ExpressionContext {
  const stage = values.get('--stage');
  const epic = values.get('--epic');
  const story = values.get('--story');
  const vars: Record<string, string> = {};
  if (epic !== undefined) vars['epic'] = epic;
  if (story !== undefined) vars['story'] = story;
  return {
    ...(stage !== undefined ? { stage } : {}),
    ...(Object.keys(vars).length > 0 ? { vars } : {}),
  };
}

/** Renders a real `RunState['runStatus']` for a human — `undefined` (no `RunStarted` event was ever
 * recorded at all, an empty log) is a real, reachable state `String(...)` would otherwise stringify
 * as the literal text `"undefined"`, the exact user-facing anti-pattern this codebase's own render
 * helpers elsewhere are written to avoid. */
function renderRunStatus(runStatus: string | undefined): string {
  return runStatus ?? 'unknown';
}

/** Real run/resume failure exit codes: `EXIT_CODES.failure` (a genuine runtime failure — a step
 * failed or the run was aborted mid-flight), never `EXIT_CODES.usage` (this is not a caller mistake)
 * and never `EXIT_CODES.gateFailed` (a gate-shaped failure is reported by `forge gate`, not by the
 * run's own bare status here). */
function runOutcomeExitCode(runStatus: string | undefined): number {
  return runStatus === 'failed' || runStatus === 'aborted'
    ? EXIT_CODES.failure
    : EXIT_CODES.success;
}

/** `forge pause`/`forge resume [runId]`/`forge abort [runId]`/`forge lanes [runId]` (`03` §3.2.4) all
 * take no real flags at all, only an optional bare `[runId]` positional — parsed through the identical
 * `parseCommandFlags` validation every other new command below uses, so a stray or misspelled flag
 * (`forge pause --forc`, `forge resume run1 --extra`) is a real, reported `USR-002` here too, not
 * silently dropped the way a fresh critic round found a first draft of these four specifically left it
 * (the four commands `parseCommandFlags` itself was added for, missed at the call site). */
function parseOptionalRunIdPositional(args: readonly string[]): string | undefined {
  const { positionals } = parseCommandFlags(args, {});
  if (positionals.length > 1) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[1] ?? '' });
  }
  return positionals[0];
}

/** `forge pause` takes no positional at all, unlike its three siblings above. */
function assertNoArgs(args: readonly string[]): void {
  const { positionals } = parseCommandFlags(args, {});
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
}

const RUN_FLAGS = { '--stage': true, '--epic': true, '--story': true } as const;

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
  const { values, positionals } = parseCommandFlags(rest, RUN_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }

  const deps = await buildRunDepsForProject(paths, projectRoot);
  const expressionContext = buildExpressionContext(values);
  const result = await runWorkflow(deps, {
    workflowId,
    expressionContext,
    dryRun,
    host: os.hostname(),
  });

  if (result.kind === 'dry-run') {
    if (json) {
      console.log(JSON.stringify({ v: 1, plan: result.plan }));
    } else if (result.plan.success) {
      console.log(
        `forge run ${workflowId} --dry-run: compiled ${String(result.plan.nodes.length)} steps.`,
      );
    } else {
      for (const issue of result.plan.issues) console.error(issue.message);
    }
    // A malformed workflow is a real usage error regardless of which real compilation stage caught
    // it -- `RUN-045` (`parseWorkflow` itself failing) already maps to `EXIT_CODES.usage`; a
    // structurally-parseable workflow `compileRunPlan` still rejects (a bad dependency, a duplicate
    // step id) is the identical class of caller mistake, not a second, different exit code.
    return result.plan.success ? EXIT_CODES.success : EXIT_CODES.usage;
  }

  if (json) {
    console.log(JSON.stringify({ v: 1, runId: result.runId, runState: result.runState }));
  } else {
    console.log(
      `forge run ${workflowId}: runId=${result.runId} status=${renderRunStatus(result.runState.runStatus)}.`,
    );
  }
  return runOutcomeExitCode(result.runState.runStatus);
}

async function runResumeCommand(
  paths: ProjectPaths,
  projectRoot: string,
  runId: string | undefined,
  json: boolean,
): Promise<number> {
  const deps = await buildRunDepsForProject(paths, projectRoot);
  const result = await resumeWorkflow(deps, {
    ...(runId !== undefined ? { runId } : {}),
    host: os.hostname(),
  });
  if (json) {
    console.log(JSON.stringify({ v: 1, runId: result.runId, runState: result.runState }));
  } else {
    console.log(
      `forge resume: runId=${result.runId} status=${renderRunStatus(result.runState.runStatus)}.`,
    );
  }
  return runOutcomeExitCode(result.runState.runStatus);
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
 * rather than silently ignored. `--run <id>` is this dispatcher's own addition (`03` §3.2.4's row
 * names none, but `runLogs` needs one to resolve when it is not the last run) — defaults to the last
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

/** Resolves the real run id `gate`/`merge` operate against: an explicit `--run <id>` override
 * (already parsed by the caller's own `parseCommandFlags` call), or the project's own last-run
 * pointer (`last-run.json`, written by `runWorkflow` — the identical file `commands/run/status.ts`'s
 * own private `resolveRunId` and `commands/run/resume.ts`'s own private `readLastRunId` each already
 * read, neither of which is exported for this dispatcher to reuse directly).
 * @throws {ForgeError} `RUN-048` when neither is available. */
async function resolveDispatchRunId(
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

/** The real, exhaustive flag set each `gate` subcommand accepts — a plain `switch` (not a `Record`
 * lookup) so a missing/misspelled subcommand narrows to `undefined` without an unsafe index or a
 * non-null assertion at the call site. */
function gateSubFlags(sub: string): Readonly<Record<string, boolean>> | undefined {
  switch (sub) {
    // `list` alone takes no real `--run` at all -- it never needs a runId (see `runGateCommand`'s own
    // `sub === 'list'` branch), so accepting one here would only silently do nothing with it, the
    // identical "recognised but ineffective flag" failure mode `parseCommandFlags` itself exists to
    // close everywhere else.
    case 'list':
      return {};
    case 'check':
      return { '--run': true };
    case 'approve':
    case 'reject':
      return { '--run': true, '--reason': true };
    case 'waive':
      return { '--run': true, '--reason': true, '--owner': true, '--expires': true };
    default:
      return undefined;
  }
}

async function runGateCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
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
    const gates = await gateList({ paths, projectRoot, checksRoot: CHECKS_ROOT, runId: '' });
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
  const ctx: GateCommandContext = { paths, projectRoot, checksRoot: CHECKS_ROOT, runId };

  if (sub === 'check') {
    const report = await gateCheck(ctx, gateId);
    console.log(
      json ? JSON.stringify({ v: 1, report }) : `${gateId}: passed=${String(report.passed)}`,
    );
    return report.passed ? EXIT_CODES.success : EXIT_CODES.gateFailed;
  }
  if (sub === 'approve') {
    const reason = values.get('--reason');
    await gateApprove(ctx, gateId, reason);
    console.log(
      json
        ? JSON.stringify({ v: 1, gateId, recorded: true })
        : `forge gate approve ${gateId}: recorded.`,
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
    console.error('forge: "gate waive" needs --reason <text> --owner <name> --expires <iso-date>.');
    return EXIT_CODES.usage;
  }
  const report = await gateWaive(ctx, gateId, { reason, owner, expiresAt });
  console.log(
    json ? JSON.stringify({ v: 1, report }) : `${gateId}: passed=${String(report.passed)}`,
  );
  return report.passed ? EXIT_CODES.success : EXIT_CODES.gateFailed;
}

const MERGE_FLAGS = { '--lane': true, '--all': false, '--abort': false, '--run': true } as const;

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
  const integrationBranch = config.execution.integrationBranch.replace('{stage}', 'current');
  const integrationPath = await ensureIntegrationWorktree(
    paths,
    projectRoot,
    integrationBranch,
    'main',
  );
  const ctx: MergeContext = { paths, projectRoot, runId, integrationPath };

  if (all) {
    const results = await mergeAllReady(ctx);
    console.log(json ? JSON.stringify({ v: 1, results }) : JSON.stringify(results, null, 2));
    const anyFailed = results.some(
      (result) => result.outcome.kind !== 'clean' && result.outcome.kind !== 'conflict-resolved',
    );
    return anyFailed ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  // `laneId` is real here: `all` is `false` and the guard above already refused the only other case.
  const outcome = await mergeLane(ctx, laneId ?? '');
  console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
  return outcome.kind === 'clean' || outcome.kind === 'conflict-resolved'
    ? EXIT_CODES.success
    : EXIT_CODES.failure;
}

function isValidateRuleId(value: string | undefined): value is ValidateRuleId {
  return value !== undefined && (VALIDATE_RULE_IDS as readonly string[]).includes(value);
}

/** `--rule <name>` is not a global flag (`parseGlobalFlags`' own `KNOWN_FLAGS` has no entry for it),
 * so it survives into `rest` verbatim — found and validated here rather than adding it to the shared
 * global-flags parser, matching `requireAllFlag`'s own precedent of parsing a command-specific flag
 * out of `rest` locally instead of widening a parser every other command also goes through.
 *
 * Returns `''` (never a real rule id), not `undefined`, when `--rule` is present but is the very last
 * token — a fresh critic round reproduced this directly: `rest[index + 1]` is `undefined` for that
 * case too, indistinguishable from "no `--rule` at all," so `forge test coverage --rule` (trailing,
 * no value) silently ran the default rule instead of erroring, the identical gap `findRawTestRuleFlag`
 * below already exists to close for a *misspelled* value. `''` fails every real rule-id check exactly
 * like a misspelled one does, with no new branching needed at any call site. */
function findRuleFlag(rest: readonly string[]): string | undefined {
  const index = rest.indexOf('--rule');
  if (index === -1) return undefined;
  return rest[index + 1] ?? '';
}

/** `story:dor`/`story:file-claim-overlap`/etc. (`G-Ready.gate.yaml`/`G-Stable.gate.yaml`) each shell
 * `forge spec validate --rule <name> --json` and read a top-level numeric `errors` field back
 * (`failOn: 'errors > 0'`) — `specValidateRule`'s own return value carries the full `violations` list
 * instead (real callers want to know *what*, `@forge/methods/dod`'s own doc comment gives the fuller
 * reasoning), so this is the one place that numeric field is actually produced. */
async function runSpecValidateRule(
  paths: ProjectPaths,
  rule: ValidateRuleId,
  json: boolean,
): Promise<number> {
  const ctx = { paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT };
  const result = await specValidateRule(ctx, rule);
  if (json) {
    console.log(
      JSON.stringify({ v: 1, errors: result.violations.length, violations: result.violations }),
    );
  } else if (result.violations.length === 0) {
    console.log(`forge spec validate --rule ${rule}: no real violations.`);
  } else {
    for (const violation of result.violations) {
      console.error(`${violation.subject}: ${violation.message}`);
    }
  }
  return result.violations.length > 0 ? 1 : 0;
}

const TEST_RULE_IDS = ['lint', 'typecheck', 'oracle-lint'] as const;
type TestRuleId = (typeof TEST_RULE_IDS)[number];

function isTestRuleId(value: string | undefined): value is TestRuleId {
  return value !== undefined && (TEST_RULE_IDS as readonly string[]).includes(value);
}

/** `--rule lint|typecheck`, the same "not a global flag, found locally in `rest`" pattern
 * `findRuleFlag` above already establishes for `spec validate`. Returns the raw value verbatim
 * (never silently narrowed to `undefined` for an unrecognised one) — a fresh critic round found
 * the original version collapsed "no `--rule` given" and "a `--rule` given but misspelled" into
 * the identical `undefined`, so a typo (`--rule typecheckk`) silently ran the entire default test
 * suite instead of erroring, the same real, reported gap `isValidateRuleId` below already avoids
 * for `spec validate`. A later critic round (`PLAN-M8.md` P6) found the identical collapse still
 * happened for a *trailing, valueless* `--rule` (the very last token in `rest`) — `findRuleFlag`'s
 * own doc comment above has the fuller reasoning for returning `''` rather than `undefined` there. */
function findRawTestRuleFlag(rest: readonly string[]): string | undefined {
  const index = rest.indexOf('--rule');
  return index === -1 ? undefined : (rest[index + 1] ?? '');
}

/** `test:run`/`test:lint`/`test:typecheck` (`G-Verify.gate.yaml`) each shell `forge test run
 * [--rule lint|typecheck] --json` and read back a top-level numeric `failed` or `errors` field
 * (`failOn: 'failed > 0'` / `'errors > 0'`) — `testRun`'s own return value already carries both,
 * per its own doc comment's reasoning; this wiring just adds the real project config and a real
 * `createTempPath`. */
async function runTestRunCommand(
  paths: ProjectPaths,
  projectRoot: string,
  rule: TestRuleId | undefined,
  json: boolean,
): Promise<number> {
  const config = await readConfig(paths);
  const ctx = {
    paths,
    projectRoot,
    testCommands: config.execution.testCommands,
    flakeConfig: config.quality.flake,
  };
  const options = rule === undefined ? {} : { rule };
  const result = await testRun(ctx, options, () => createSystemTempPath('forge-test-run'));
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else if ((result.problems ?? []).length > 0) {
    for (const problem of result.problems ?? []) console.error(problem);
  } else {
    console.log(
      `forge test run${rule === undefined ? '' : ` --rule ${rule}`}: failed=${String(result.failed)} errors=${String(result.errors)}.`,
    );
  }
  return result.failed > 0 || result.errors > 0 ? 1 : 0;
}

const TEST_COVERAGE_RULE_IDS = ['acceptance-criteria', 'ratchet'] as const;
type TestCoverageRuleId = (typeof TEST_COVERAGE_RULE_IDS)[number];

function isTestCoverageRuleId(value: string | undefined): value is TestCoverageRuleId {
  return value !== undefined && (TEST_COVERAGE_RULE_IDS as readonly string[]).includes(value);
}

/** `story:ac-coverage`/`test:coverage`/`coverage:ratchet` (`G-Verify.gate.yaml`) each shell `forge
 * test coverage [--rule acceptance-criteria|ratchet] --json` and read back a top-level numeric
 * `coverage`/`regressions` field (`failOn: 'coverage < 100'`/`'coverage < 80'`/`'regressions > 0'`)
 * — `testCoverage`'s own return value already carries both, per its own doc comment's reasoning. */
async function runTestCoverageCommand(
  paths: ProjectPaths,
  projectRoot: string,
  rule: TestCoverageRuleId | undefined,
  json: boolean,
): Promise<number> {
  const ctx = { paths, projectRoot, specsRoot: SPECS_ROOT };
  const options = rule === undefined ? {} : { rule };
  const result = await testCoverage(ctx, options);
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else if ((result.problems ?? []).length > 0) {
    for (const problem of result.problems ?? []) console.error(problem);
  } else {
    console.log(
      `forge test coverage${rule === undefined ? '' : ` --rule ${rule}`}: coverage=${String(result.coverage)} regressions=${String(result.regressions)}.`,
    );
    // A fresh critic round found the non-`--json` path told a human "coverage=50" with no way to
    // learn *which* AC was unproven — `result.missingAcIds` already names every one.
    for (const acId of result.missingAcIds ?? []) console.error(`${acId}: no passing bound test.`);
  }
  return (result.problems ?? []).length > 0 ||
    result.regressions > 0 ||
    (rule === undefined && result.coverage < 80) ||
    (rule === 'acceptance-criteria' && result.coverage < 100)
    ? 1
    : 0;
}

/** `test:flaky` (`G-Stable`, `failOn: 'flaky > 0'`) and `test:quarantine-cap` (`G-Verify`,
 * `failOn: 'quarantined > 5'`, `quality.flake.quarantineCap`'s own literal default) both shell the
 * identical `forge test flaky --json` — `testFlaky`'s own return value always carries both fields
 * together (the same "both always present, only one is semantically meaningful per caller" shape
 * `TestRunResult`/`TestCoverageResult` already establish), so one real invocation answers both
 * already-shipped checks with no `--rule` needed at all — a bare `--rule` on this command is always
 * rejected (exit 2), the same strict-unrecognised-flag discipline `test run`/`test coverage` already
 * apply, rather than the first draft's own silent no-op for one. This command's own bare exit code
 * (for a human running it directly, outside either gate) fails on *either* condition, since it has no
 * way to know which gate is asking. */
async function runTestFlakyCommand(paths: ProjectPaths, json: boolean): Promise<number> {
  const config = await readConfig(paths);
  const flakeConfig = config.quality.flake;
  const result = await testFlaky(paths, flakeConfig);
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else if ((result.problems ?? []).length > 0) {
    for (const problem of result.problems ?? []) console.error(problem);
  } else {
    console.log(
      `forge test flaky: flaky=${String(result.flaky)} quarantined=${String(result.quarantined)}.`,
    );
    for (const name of result.flakyTests ?? []) console.error(`flaky: ${name}`);
    for (const name of result.quarantinedTests ?? []) console.error(`quarantined: ${name}`);
  }
  return (result.problems ?? []).length > 0 ||
    result.flaky > 0 ||
    result.quarantined > flakeConfig.quarantineCap
    ? 1
    : 0;
}

async function main(): Promise<number> {
  const flags = parseGlobalFlags(process.argv.slice(2));
  const [command, sub, ...rest] = flags.positionals;
  const projectRoot = flags.project ?? process.cwd();
  const paths = new ProjectPaths(projectRoot);

  // A critic round caught the original version falling through to the generic "not wired" message
  // below for e.g. `agent validate` with no real `--all` -- wrong: this command *is* wired, the real
  // problem is a missing required flag, and the generic message pointed a caller at dozens of
  // genuinely-unimplemented commands instead of naming the one real thing they actually got wrong.
  const isValidateAll = (name: string): boolean => command === name && sub === 'validate';
  const requireAllFlag = (): boolean => {
    if (rest.includes('--all')) return true;
    console.error(
      `forge: "${String(command)} ${String(sub)}" is real, but needs --all (only the real "--all" form is wired ` +
        'here yet; a real single-id form does not exist).',
    );
    return false;
  };

  if (isValidateAll('agent')) {
    return requireAllFlag() ? runAgentValidate(paths, flags.json) : 2;
  }
  if (isValidateAll('workflow')) {
    return requireAllFlag() ? runWorkflowValidate(paths, flags.json) : 2;
  }
  if (isValidateAll('template')) {
    return requireAllFlag() ? runTemplateValidate(flags.json) : 2;
  }
  if (command === 'status') {
    return runStatusCommand(paths, projectRoot, flags.json);
  }
  if (command === 'spec' && sub === 'validate') {
    const ruleFlag = findRuleFlag(rest);
    if (!isValidateRuleId(ruleFlag)) {
      console.error(
        `forge: "spec validate" needs a real --rule <name> (one of: ${VALIDATE_RULE_IDS.join(', ')}); ` +
          `got ${JSON.stringify(ruleFlag)}. The bare, no-rule form of "spec validate" is not wired here yet.`,
      );
      return 2;
    }
    return runSpecValidateRule(paths, ruleFlag, flags.json);
  }
  if (command === 'test' && sub === 'run') {
    const rawRule = findRawTestRuleFlag(rest);
    if (rawRule !== undefined && !isTestRuleId(rawRule)) {
      console.error(
        `forge: "test run --rule" needs a real rule (one of: ${TEST_RULE_IDS.join(', ')}); ` +
          `got ${JSON.stringify(rawRule)}.`,
      );
      return 2;
    }
    return runTestRunCommand(paths, projectRoot, rawRule, flags.json);
  }
  if (command === 'test' && sub === 'coverage') {
    const rawRule = findRuleFlag(rest);
    if (rawRule !== undefined && !isTestCoverageRuleId(rawRule)) {
      console.error(
        `forge: "test coverage --rule" needs a real rule (one of: ${TEST_COVERAGE_RULE_IDS.join(', ')}); ` +
          `got ${JSON.stringify(rawRule)}.`,
      );
      return 2;
    }
    return runTestCoverageCommand(paths, projectRoot, rawRule, flags.json);
  }
  if (command === 'test' && sub === 'flaky') {
    // A fresh critic round found the first draft silently accepted (and ignored) any `--rule` value
    // here, including a real typo of the plan's own first-drafted `--rule quarantine-cap` form —
    // `test flaky` has no real rule distinction at all (this doc comment's own fuller reasoning is on
    // `runTestFlakyCommand`), so any `--rule` at all is a real, reportable error, not a silent no-op.
    if (findRuleFlag(rest) !== undefined) {
      console.error('forge: "test flaky" takes no --rule at all — it answers every rule already.');
      return 2;
    }
    return runTestFlakyCommand(paths, flags.json);
  }

  // `afterCommand` (unlike `sub`/`rest` above) makes no assumption that the token right after the
  // command is a literal subcommand keyword — `forge run <workflow>`/`forge resume [runId]` both put
  // a real, free-form id (or nothing at all) in that position, and `forge merge`'s own flags
  // (`--lane`/`--all`/`--abort`) can appear with no positional before them at all. Every branch below
  // parses its own slice of this locally, the same "each command owns its own local flag-finding"
  // precedent `findRuleFlag`/`findRawTestRuleFlag` above already establish, rather than forcing every
  // new command's own argument shape through the `[command, sub, ...rest]` destructure above, which
  // fits only the closed-subcommand-keyword shape `agent`/`workflow`/`template`/`spec`/`test` all share.
  const afterCommand = flags.positionals.slice(1);

  if (command === 'init') {
    return runInitCommand(afterCommand, flags.yes, flags.json);
  }
  if (command === 'run') {
    const [workflowId, ...runRest] = afterCommand;
    return runRunCommand(paths, projectRoot, workflowId, runRest, flags.dryRun, flags.json);
  }
  if (command === 'resume') {
    return runResumeCommand(
      paths,
      projectRoot,
      parseOptionalRunIdPositional(afterCommand),
      flags.json,
    );
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
  if (command === 'gate') {
    const [gateSub, ...gateRest] = afterCommand;
    return runGateCommand(paths, projectRoot, gateSub, gateRest, flags.json);
  }
  if (command === 'merge') {
    return runMergeCommand(paths, projectRoot, afterCommand, flags.json);
  }

  console.error(
    `forge: "${[command, sub].filter((token) => token !== undefined).join(' ')}" is not wired into ` +
      "this real, deliberately minimal dispatcher yet (see bin.ts's own doc comment for the full " +
      'list of commands that exist as real functions but have no CLI wiring yet).',
  );
  return 2;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (isForgeError(error)) {
    console.error(error.message);
    console.error(error.remedy);
    process.exitCode = error.exitCode;
  } else {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
