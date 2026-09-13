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
 * `module add/remove/update`, `overlay add`, `upgrade`, `export`, `doctor`, `audit`, `config
 * get/set/edit`, `cost`, and `uninstall` are wired below by `PLAN-M12.md` P2 — M10/M11's own real
 * distribution, security, and lifecycle surface (SC9's own literal proof command). `implement`/
 * `debug`/`refactor`/`deploy`/`review`/`panel`/`ask`/`session` and the remaining `kb`/`spec`/`adr`/
 * `diagram`/`customize`/`compile`/`preset`/`skill`/`mcp`/`help`, plus `module list/info` and
 * `overlay list/remove/update/explain/diff/doctor/eject` (real `03` §3.2.8 rows this piece's own
 * literal Surface line does not name), remain `PLAN-M12.md` P4's own mandate, still unwired here.
 *
 * @see specs/22 M6
 * @see specs/22 M8
 * @see specs/22 M12
 * @see PLAN-M6.md C9
 * @see PLAN-M8.md P2
 * @see PLAN-M8.md P4
 * @see PLAN-M12.md P1
 * @see PLAN-M12.md P2
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
import { auditReport, formatAuditReport, type AuditCommandContext } from './commands/audit.ts';
import {
  configEdit,
  configGet,
  configSet,
  readConfig,
  type ConfigCommandContext,
} from './commands/config.ts';
import { costReport, type CostCommandContext } from './commands/cost.ts';
import { runDoctor } from './commands/doctor/index.ts';
import {
  exportHtml,
  exportMarkdownBundle,
  exportThirdParty,
  type ExportCommandContext,
} from './commands/export.ts';
import {
  moduleAdd,
  moduleRemove,
  moduleUpdate,
  type InstallChangeReport,
  type InstallOptions,
  type ModuleCommandContext,
} from './commands/module.ts';
import { overlayAdd, type OverlayCommandContext } from './commands/overlay.ts';
import { uninstall } from './commands/uninstall.ts';
import { runUpgrade } from './commands/upgrade/index.ts';
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
import { readPackageVersion, resolvePackageRoot } from './init/package-root.ts';
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

/** The real, running Node version — `forge doctor`/`forge upgrade`'s own `processVersion` input
 * (`DoctorOptions`/`UpgradeDeps`), read once, here, and threaded through as a real, injected parameter
 * from there on (never read ambiently inside `runDoctor`/`runUpgrade` themselves) — the identical
 * `realEnvSnapshot`/`realNow` precedent immediately above, named the same way for the same reason: one
 * real boundary read per ambient fact, never re-read inline at each call site. */
function realProcessVersion(): string {
  return process.version;
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

/** `forge doctor`/`forge upgrade`'s own real, degraded adapter-construction path — unlike `run`/
 * `resume`/`merge` (which genuinely cannot proceed without a real adapter, so `buildAdapterForConfig`'s
 * own `ENV-004` throw is the right, loud failure there), `doctor`'s entire job is diagnosing exactly
 * this one narrow environment problem: `checkPlatformAdapter(undefined, ...)` already has a real,
 * honest degraded outcome for "no adapter" — a `warning`, not a `hard` failure — precisely so a
 * project whose `platform.primary` names an id this registry cannot construct (a stale/foreign value,
 * a test fixture built against `@forge/testkit`'s own `FakePlatformAdapter`, never a real registry
 * entry) still gets a real, runnable `forge doctor` instead of an opaque `ENV-004` crash on the one
 * command whose whole purpose is surfacing environment problems like this.
 *
 * **Scoped narrowly to exactly that one, named `ENV-004` case — never a blanket catch.** A genuine
 * construction *crash* for a different reason (`loadAdapterFactory`'s own dynamic `import()` failing
 * on a corrupted or incompatible adapter package, or a factory throwing for a reason unrelated to
 * `platform.primary`) still propagates as a real, loud failure here, identically to how
 * `buildAdapterForConfig` already behaves, unguarded, for `run`/`resume`/`merge` above — this function
 * does not invent a broader "swallow every adapter-construction error" contract `doctor`'s own
 * `runDoctor`/`DoctorCheck` shape has no real per-check slot to route such a crash into anyway (that
 * would need `runDoctor` itself extended with a new construction-failure check, out of this piece's own
 * scope). A genuine construction *success* whose `preflight()` then fails (the real CLI binary missing
 * from `PATH`) is still reported as the real, hard failure `checkPlatformAdapter` already gives it —
 * only the one named `ENV-004` construction failure is degraded here, never a preflight result and
 * never any other exception shape. */
async function buildAdapterForDiagnostics(
  config: ForgeConfig,
  env: Readonly<Record<string, string>>,
): Promise<PlatformAdapter | undefined> {
  try {
    return await buildAdapterForConfig(config, env);
  } catch (error) {
    if (isForgeError(error) && error.code === 'ENV-004') return undefined;
    throw error;
  }
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

// ---------------------------------------------------------------------------------------------
// `module`/`overlay`/`upgrade`/`export`/`doctor`/`audit`/`config`/`cost`/`uninstall` — `PLAN-M12.md`
// P2's own real distribution, security, and lifecycle surface.
// ---------------------------------------------------------------------------------------------

/** Strips C0 control characters, `DEL`, and the whole C1 range (`\x00`-`\x1f`, `\x7f`-`\x9f` —
 * contiguous once `DEL` and C1 are combined) from untrusted text before it reaches either a real
 * terminal or a `--json` consumer. `report.newGrants`/`.warnings` below originate from a fetched
 * module's/overlay's own `module.yaml`/`overlay.yaml` — real, hostile-author-controlled free text
 * (`moduleEntries`'s own `ceilings.<role>.exec`/`.allowlistHosts` patterns, `@forge/extensions/module`'s
 * own schema has no charset restriction on them) on exactly the git/npm-fetch install path the
 * consent screen exists to guard (`19` §19.5 step 3), never validated against a printable-only
 * charset upstream. A fresh critic round found a crafted `ESC` sequence embedded in a capability
 * pattern could otherwise overwrite or hide the very consent-relevant lines a human operator is meant
 * to read before typing `--yes`.
 *
 * **Applied to both output modes, not only the human-readable one.** An earlier version of this fix
 * stripped only the plain-text rendering below, reasoning that `JSON.stringify` already escapes every
 * control character into a literal, harmless `\uXXXX` sequence — a second critic round proved that
 * reasoning false by direct inspection: `JSON.stringify` escapes only `U+0000`-`U+001F` (plus `"`/`\`)
 * per ECMA-262; `DEL` (`\x7f`) and the entire C1 block (`\x80`-`\x9f`, `CSI`'s own 8-bit form `\x9b`
 * included) pass through a JSON string completely unescaped as raw bytes, leaving `--json` output
 * exactly as exposed as the un-fixed plain-text path was. Sanitizing the report's own fields once,
 * before either renderer sees them, is what actually closes both paths with one real fix instead of
 * two divergent ones that can drift. */
function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control chars to strip them.
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

/** Applies `stripControlChars` to every real, untrusted free-text field an `InstallChangeReport`
 * carries — `id`/`version`/`resolvedSetDelta` are all schema- or pattern-validated upstream
 * (`OVERLAY_ID_PATTERN`, a real semver, a real id already present in the trusted manifest) and need no
 * sanitizing; only `newGrants`/`warnings` are unconstrained free text a hostile bundle author controls
 * directly. */
function sanitizeInstallChangeReportForDisplay(report: InstallChangeReport): InstallChangeReport {
  return {
    ...report,
    newGrants: report.newGrants.map(stripControlChars),
    warnings: report.warnings.map(stripControlChars),
  };
}

/** A real, human-readable rendering of one `moduleAdd`/`moduleRemove`/`moduleUpdate`/`overlayAdd`
 * outcome — the identical fields `--json` mode reports verbatim, just not silently dropped for a
 * human running this interactively. Takes an already-`sanitizeInstallChangeReportForDisplay`'d report
 * — never sanitizes its own input, so this alone is not safe to call directly on a raw report. */
function renderInstallChangeReport(report: InstallChangeReport): string {
  const lines: string[] = [
    `forge: ${report.action} ${report.id}${report.version === undefined ? '' : ` v${report.version}`}.`,
  ];
  if (report.resolvedSetDelta.added.length > 0) {
    lines.push(`  added to the resolved set: ${report.resolvedSetDelta.added.join(', ')}`);
  }
  if (report.resolvedSetDelta.removed.length > 0) {
    lines.push(`  removed from the resolved set: ${report.resolvedSetDelta.removed.join(', ')}`);
  }
  for (const grant of report.newGrants) lines.push(`  new capability grant: ${grant}`);
  for (const warning of report.warnings) lines.push(`  warning: ${warning}`);
  return lines.join('\n');
}

function printInstallChangeReport(report: InstallChangeReport, json: boolean): void {
  const sanitized = sanitizeInstallChangeReportForDisplay(report);
  console.log(
    json ? JSON.stringify({ v: 1, report: sanitized }) : renderInstallChangeReport(sanitized),
  );
}

/** A fresh, real `InstallOptions` for one `module`/`overlay` command invocation — `workDir` is a real,
 * process-unique scratch path (`createSystemTempPath`, the identical real seam `test run`'s own
 * wiring above already uses) a git/npm-channel fetch needs; the local channel never touches it.
 * `consent.yes` mirrors the global `--yes` flag exactly like every other destructive real operation in
 * this dispatcher (`runInit`/`uninstall` below) — without it, a real interactive prompt still runs,
 * reading this process's own real stdin/stdout (`promptForConsent`'s own default), never faked or
 * silently auto-granted. */
function buildInstallOptions(projectRoot: string, yes: boolean, json: boolean): InstallOptions {
  return {
    workDir: createSystemTempPath('forge-install'),
    npmCwd: projectRoot,
    forgeVersion: readPackageVersion('@forge/agents'),
    consent: { yes, json },
  };
}

/** `forge module <add|remove|update>` (`19` §19.5, `03` §3.2.8) — `list`/`info` are real,
 * already-tested functions (`moduleList`/`moduleInfo`) this piece's own mandate (`PLAN-M12.md` P2's
 * literal Surface line) does not name; disclosed as still-unwired here (`PLAN-M12.md` P4's own
 * remaining-commands mandate), never silently completed. */
async function runModuleCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  yes: boolean,
  json: boolean,
): Promise<number> {
  const ctx: ModuleCommandContext = { paths, modulesDir: resolveModulesDir() };
  const options = buildInstallOptions(projectRoot, yes, json);

  if (sub === 'add') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id, source] = positionals;
    if (id === undefined || source === undefined || positionals.length > 2) {
      console.error('forge: "module add" needs a real <id> <source>.');
      return EXIT_CODES.usage;
    }
    printInstallChangeReport(await moduleAdd(ctx, id, source, options), json);
    return EXIT_CODES.success;
  }
  if (sub === 'remove') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "module remove" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    printInstallChangeReport(await moduleRemove(ctx, id), json);
    return EXIT_CODES.success;
  }
  if (sub === 'update') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id, source] = positionals;
    if (id === undefined || source === undefined || positionals.length > 2) {
      console.error('forge: "module update" needs a real <id> <source>.');
      return EXIT_CODES.usage;
    }
    printInstallChangeReport(await moduleUpdate(ctx, id, source, options), json);
    return EXIT_CODES.success;
  }
  console.error(
    `forge: "module ${sub ?? ''}" needs a real subcommand this dispatcher wires yet (add|remove|update).`,
  );
  return EXIT_CODES.usage;
}

/** `forge overlay add <source>` (`19` §19.5, `03` §3.2.8) — `list`/`remove`/`update`/`explain`/`diff`/
 * `doctor`/`eject` are real `03` §3.2.8 rows this piece's own mandate does not name (`overlayExplain`
 * already exists and is real, but wiring it is `PLAN-M12.md` P4's own job, not this one's). */
async function runOverlayCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  yes: boolean,
  json: boolean,
): Promise<number> {
  if (sub !== 'add') {
    console.error(
      `forge: "overlay ${sub ?? ''}" needs a real subcommand this dispatcher wires yet (add).`,
    );
    return EXIT_CODES.usage;
  }
  const { positionals } = parseCommandFlags(rest, {});
  const [source] = positionals;
  if (source === undefined || positionals.length > 1) {
    console.error('forge: "overlay add" needs a real <source>.');
    return EXIT_CODES.usage;
  }
  const ctx: OverlayCommandContext = { paths };
  const options = buildInstallOptions(projectRoot, yes, json);
  printInstallChangeReport(await overlayAdd(ctx, source, options), json);
  return EXIT_CODES.success;
}

const UPGRADE_FLAGS = { '--to': true } as const;

/** `forge upgrade [--to <version>]` (`03` §3.4) — `--dry-run` is already a real global flag
 * (`parseGlobalFlags`' own `KNOWN_FLAGS`), so it never reaches `rest` here; this only ever parses
 * `--to`, the one flag `03` §3.4 names that is not already global. */
async function runUpgradeCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, UPGRADE_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const to = values.get('--to');
  const config = await readConfig(paths);
  const env = realEnvSnapshot();
  const adapter = await buildAdapterForDiagnostics(config, env);
  const report = await runUpgrade(
    paths,
    projectRoot,
    { dryRun, ...(to !== undefined ? { to } : {}) },
    {
      modulesDir: resolveModulesDir(),
      specsRoot: SPECS_ROOT,
      config,
      env,
      processVersion: realProcessVersion(),
      ...(adapter !== undefined ? { adapter } : {}),
    },
  );
  console.log(
    json
      ? JSON.stringify({ v: 1, report })
      : `forge upgrade${dryRun ? ' --dry-run' : ''}: ${report.installedVersion} -> ` +
          `${report.targetVersion} (${String(report.migratedDocuments.length)} documents checked).`,
  );
  return report.doctor?.ok === false ? EXIT_CODES.prerequisiteMissing : EXIT_CODES.success;
}

/** `forge export <target>` (`03` §3.2.7) — `markdown-bundle`/`html` are real; `jira`/`linear`/
 * `github-issues` are real, dry-run-only refusals (`exportThirdParty`'s own doc comment), surfaced
 * here verbatim rather than a generic "not wired" message. */
async function runExportCommand(
  paths: ProjectPaths,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { positionals } = parseCommandFlags(args, {});
  const [target] = positionals;
  if (target === undefined || positionals.length > 1) {
    console.error(
      'forge: "export" needs a real <target> (markdown-bundle|html|jira|linear|github-issues).',
    );
    return EXIT_CODES.usage;
  }
  const ctx: ExportCommandContext = { paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT };
  if (target === 'markdown-bundle') {
    const content = await exportMarkdownBundle(ctx);
    console.log(json ? JSON.stringify({ v: 1, target, content }) : content);
    return EXIT_CODES.success;
  }
  if (target === 'html') {
    const content = await exportHtml(ctx);
    console.log(json ? JSON.stringify({ v: 1, target, content }) : content);
    return EXIT_CODES.success;
  }
  // `exportThirdParty` is typed `never` (it always throws) — an explicit `return` here, not a bare
  // statement, makes this function's own reliance on that contract visible at the call site: if a
  // future edit ever gave `exportThirdParty` a real, normally-returning case, this line would stop
  // compiling (a `never` is no longer assignable to `Promise<number>`'s resolved `number`) instead of
  // silently falling through to a missing return with no compiler signal at all.
  return exportThirdParty(target);
}

const DOCTOR_FLAGS = { '--fix': false, '--rebuild-index': false } as const;

/** `forge doctor [--fix] [--rebuild-index] [--json]` (`03` §3.7) — the first real CLI wiring this
 * command has ever had (confirmed by `SPEC-QUESTIONS.md` Q179/Q181, per `PLAN-M12.md`'s own finding).
 * Exit `5` (`EXIT_CODES.prerequisiteMissing`) iff any hard check still fails after the real checks
 * (and, with `--fix`, the real fix pass) run — `03` §3.7's own literal "exit code 5 if any hard
 * prerequisite fails, 0 with warnings otherwise" contract, read directly off `DoctorReport.ok`. */
async function runDoctorCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { flags, positionals } = parseCommandFlags(args, DOCTOR_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const config = await readConfig(paths);
  const env = realEnvSnapshot();
  const adapter = await buildAdapterForDiagnostics(config, env);
  const report = await runDoctor({
    paths,
    projectRoot,
    config,
    ...(adapter !== undefined ? { adapter } : {}),
    env,
    processVersion: realProcessVersion(),
    fix: flags.has('--fix'),
    rebuildIndex: flags.has('--rebuild-index'),
  });
  if (json) {
    console.log(JSON.stringify(report));
  } else {
    for (const check of report.checks) {
      console.log(`${check.ok ? 'ok' : check.severity} ${check.id}: ${check.message}`);
    }
    for (const fix of report.fixes ?? []) {
      console.log(`fix ${fix.applied ? 'applied' : 'not applied'} ${fix.id}: ${fix.message}`);
    }
  }
  return report.ok ? EXIT_CODES.success : EXIT_CODES.prerequisiteMissing;
}

const AUDIT_FLAGS = { '--since': true } as const;

/** `forge audit [--since <date>] [--json]` (`20` §20.9) — a thin CLI layer over `auditReport`'s own
 * already-real query/format pipeline; `parseSince`'s own `USR-002` validation is what actually
 * rejects a malformed `--since` value, surfaced through this dispatcher's own real `main()` catch. */
async function runAuditCommand(
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, AUDIT_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const since = values.get('--since');
  const ctx: AuditCommandContext = { projectRoot };
  const report = await auditReport(ctx, since === undefined ? {} : { since });
  console.log(json ? JSON.stringify(report) : formatAuditReport(report));
  return EXIT_CODES.success;
}

/** `forge config <get|set|edit>` (`03` §3.2.7) — `list`/`explain` are real, already-tested functions
 * this piece's own mandate does not name; disclosed as still-unwired (`PLAN-M12.md` P4's own
 * remaining-commands mandate), never silently completed. */
async function runConfigCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx: ConfigCommandContext = { paths };
  if (sub === 'get') {
    const { positionals } = parseCommandFlags(rest, {});
    const [key] = positionals;
    if (key === undefined || positionals.length > 1) {
      console.error('forge: "config get" needs a real <key>.');
      return EXIT_CODES.usage;
    }
    const value = await configGet(ctx, key);
    console.log(json ? JSON.stringify({ v: 1, key, value }) : `${key}: ${JSON.stringify(value)}`);
    return EXIT_CODES.success;
  }
  if (sub === 'set') {
    const { positionals } = parseCommandFlags(rest, {});
    const [key, value] = positionals;
    if (key === undefined || value === undefined || positionals.length > 2) {
      console.error('forge: "config set" needs a real <key> <value>.');
      return EXIT_CODES.usage;
    }
    await configSet(ctx, key, value);
    // A round-3 critic finding: `configSet` (`commands/config.ts`) real-YAML-parses `value` before
    // writing (`execution.concurrency 4` stores the real number `4`, not the string `"4"`) — echoing
    // the raw, unparsed `value` string here made `config set --json`'s own `value` field disagree in
    // *type* with the identical key's `config get --json` field for the exact same stored data, a real
    // `--json` stable-contract violation. Reading the real, just-written value back via `configGet`
    // (rather than re-parsing `value` a second time here) reports what is genuinely on disk, not a
    // second, independently-derived guess at it.
    const stored = await configGet(ctx, key);
    console.log(
      json
        ? JSON.stringify({ v: 1, key, value: stored })
        : `forge config set ${key}: ${JSON.stringify(stored)}.`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'edit') {
    const { positionals } = parseCommandFlags(rest, {});
    if (positionals.length > 0) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
    }
    // `configEdit` is typed `never` (it always throws) — an explicit `return`, not a bare statement,
    // makes this branch's own reliance on that contract visible: see `runExportCommand`'s identical
    // `exportThirdParty` call for the fuller reasoning.
    return configEdit();
  }
  console.error(
    `forge: "config ${sub ?? ''}" needs a real subcommand this dispatcher wires yet (get|set|edit).`,
  );
  return EXIT_CODES.usage;
}

const COST_FLAGS = { '--run': true, '--since': true } as const;

/** `forge cost [--run <id>] [--since <date>]` (`03` §3.2.8) — `costReport` always aggregates every
 * real run this project has ever executed, with no per-run or per-date scoping mechanism at all
 * (unlike `forge audit`'s own real `queryAuditEvents`, which does support `since`) — both flags are
 * real, disclosed gaps refused honestly here, the identical "refuse rather than silently ignore or
 * fabricate" stance `forge logs --follow`/`--lane` already take above, rather than this dispatcher
 * inventing a filtering mechanism `costReport` itself does not have. See `SPEC-QUESTIONS.md`. */
async function runCostCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, COST_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  if (values.has('--run')) {
    throw new ForgeError('USR-003', {
      feature: 'forge cost --run (costReport has no real per-run scope yet)',
    });
  }
  if (values.has('--since')) {
    throw new ForgeError('USR-003', {
      feature: 'forge cost --since (costReport has no real per-date scope yet)',
    });
  }
  const config = await readConfig(paths);
  const ctx: CostCommandContext = { paths, projectRoot, config };
  const report = await costReport(ctx);
  if (json) {
    console.log(
      JSON.stringify({
        v: 1,
        totalUsd: report.totalUsd,
        byRun: Object.fromEntries(report.byRun),
        byAgent: Object.fromEntries(report.byAgent),
        byModel: Object.fromEntries(report.byModel),
        budgetStatus: report.budgetStatus,
      }),
    );
  } else {
    console.log(`forge cost: total=$${report.totalUsd.toFixed(2)} budget=${report.budgetStatus}`);
    for (const [runId, amount] of report.byRun) {
      console.log(`  run ${runId}: $${amount.toFixed(2)}`);
    }
  }
  return report.budgetStatus === 'breached' ? EXIT_CODES.budgetExceeded : EXIT_CODES.success;
}

const UNINSTALL_FLAGS = { '--remove-docs': false } as const;

/** `forge uninstall [--remove-docs]` (`03` §3.2.1) — `--yes` (already global) is required, matching
 * `uninstall`'s own real `USR-002` refusal without it. */
async function runUninstallCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  yes: boolean,
  json: boolean,
): Promise<number> {
  const { flags, positionals } = parseCommandFlags(args, UNINSTALL_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const removeDocs = flags.has('--remove-docs');
  const result = await uninstall(paths, projectRoot, {
    yes,
    ...(removeDocs ? { removeDocs: true } : {}),
  });
  console.log(
    json
      ? JSON.stringify({ v: 1, ...result })
      : `forge uninstall: removed ${result.removed.join(', ') || '(nothing)'}; backup at ${result.backupDir}.`,
  );
  return EXIT_CODES.success;
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
  if (command === 'module') {
    const [moduleSub, ...moduleRest] = afterCommand;
    return runModuleCommand(paths, projectRoot, moduleSub, moduleRest, flags.yes, flags.json);
  }
  if (command === 'overlay') {
    const [overlaySub, ...overlayRest] = afterCommand;
    return runOverlayCommand(paths, projectRoot, overlaySub, overlayRest, flags.yes, flags.json);
  }
  if (command === 'upgrade') {
    return runUpgradeCommand(paths, projectRoot, afterCommand, flags.dryRun, flags.json);
  }
  if (command === 'export') {
    return runExportCommand(paths, afterCommand, flags.json);
  }
  if (command === 'doctor') {
    return runDoctorCommand(paths, projectRoot, afterCommand, flags.json);
  }
  if (command === 'audit') {
    return runAuditCommand(projectRoot, afterCommand, flags.json);
  }
  if (command === 'config') {
    const [configSub, ...configRest] = afterCommand;
    return runConfigCommand(paths, configSub, configRest, flags.json);
  }
  if (command === 'cost') {
    return runCostCommand(paths, projectRoot, afterCommand, flags.json);
  }
  if (command === 'uninstall') {
    return runUninstallCommand(paths, projectRoot, afterCommand, flags.yes, flags.json);
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
