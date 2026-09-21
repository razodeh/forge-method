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
 * distribution, security, and lifecycle surface (SC9's own literal proof command).
 *
 * `kb`, the full `spec` surface (`validate`'s own bare form included, alongside the narrower,
 * gate-shelled `--rule` form above), `adr`, `diagram`, `customize`, `compile`, `preset`, `skill`,
 * `mcp`, `help`, `plan` (a real `commands/run/` sibling of `run`/`gate`/`merge` above, left unwired by
 * P1's own narrower, explicitly-named Surface list — closed here rather than left dangling with no
 * later piece ever allocated to it, see `SPEC-QUESTIONS.md`), and the agent-facing `implement`/
 * `debug`/`refactor`/`deploy`/`review`/`panel`/`ask`/`session` loop family are wired below by
 * `PLAN-M12.md` P4 — completing the dispatcher. A handful of named-but-still-genuinely-unbuilt rows
 * remain honestly refused rather than fabricated (`kb diff`, `spec new` for a non-spec artifact type,
 * `diagram legend`/`render --open`, `customize` entirely, `preset diff`, `skill new/attach/detach/
 * test/import`, `mcp add/test/grant/revoke/trace`, `forge help <topic>`, `forge ask`, `forge plan
 * data/testing`, `forge test plan/generate/report`) — each a real, disclosed `USR-003`, not a generic
 * "not wired" fallback. `module list/info`, `overlay list/remove/update/explain/diff/doctor/eject`,
 * and `config list/explain` (real rows P2's own literal Surface line did not name) remain genuinely
 * unwired, as does the rest of `agent`/`workflow` beyond `validate --all` (`03` §3.2.7's own `list`/
 * `show`/`new`/`compile`/`graph` rows) — no piece of `PLAN-M12.md` ever named these as its own mandate;
 * disclosed here rather than silently implied complete.
 *
 * `plan run-plan <stageId> [--json]` — the command `plan-stage.workflow.yaml`'s `derive-run-plan` step runs
 * — is wired by `PLAN-M13.md` P10 (`commands/run/run-plan.ts`; `03` names no such subcommand, see
 * `SPEC-QUESTIONS.md`).
 *
 * `story verify <storyId> [--json]` — the command `implement-story.workflow.yaml`'s `self-verify` step runs — is
 * wired by `PLAN-M13.md` P22 (`commands/story.ts`: the story's `done` DoD profile, `09` §9.8; `03` §3.2.5 gained its row,
 * see `SPEC-QUESTIONS.md` Q213).
 *
 * `run <workflow>` takes `--input <name>=<value>` (repeatable), and `--stage`/`--story` also supply `stageId`/`storyId`
 * (`PLAN-M13.md` P21, `commands/run/expression-context.ts`): a workflow that declares `inputs:` is refused, naming
 * what is missing, when they are not given; `build-stage` gets its stories from the stage's Epics and Stories. Under
 * `--json`, any refusal that is *thrown* (a coded `ForgeError`, a `VcsError`, another package's coded error) also
 * prints the one-line `{v:1, ok:false, error}` envelope on stdout, at the end of this file; a command that prints its
 * own usage message and returns (`forge story verify <unknown>`, `forge test run --rule <bad>`) does not (see
 * `SPEC-QUESTIONS.md` Q218).
 *
 * @see specs/22 M6
 * @see specs/22 M8
 * @see specs/22 M12
 * @see PLAN-M6.md C9
 * @see PLAN-M8.md P2
 * @see PLAN-M8.md P4
 * @see PLAN-M12.md P1
 * @see PLAN-M12.md P2
 * @see PLAN-M12.md P4
 */
import os from 'node:os';
import path from 'node:path';

import { KNOWN_ADAPTER_MODULES, loadAdapterFactory } from '@forge/adapter-kit/registry';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { SYSTEM_CLOCK } from '@forge/core';
import { EXIT_CODES, ForgeError, isForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, ProjectPaths } from '@forge/core/fs';
import type { ExpressionContext } from '@forge/engine/expr';
import type { RunState } from '@forge/engine/resume';
import type { ForgeConfig } from '@forge/schemas/config';

import { agentValidateAll } from './commands/agent.ts';
import {
  adrAccept,
  adrList,
  adrNew,
  adrReject,
  adrShow,
  adrSupersede,
  type AdrCommandContext,
} from './commands/adr.ts';
import { auditReport, formatAuditReport, type AuditCommandContext } from './commands/audit.ts';
import {
  configEdit,
  configGet,
  configSet,
  readConfig,
  type ConfigCommandContext,
} from './commands/config.ts';
import { forgeCompile } from './commands/compile.ts';
import { costReport, type CostCommandContext } from './commands/cost.ts';
import { customize } from './commands/customize.ts';
import {
  diagramDiff,
  diagramGenerate,
  diagramLegend,
  diagramList,
  diagramRender,
  diagramShow,
  diagramSync,
  diagramValidate,
  type DiagramCommandContext,
} from './commands/diagram.ts';
import { runDoctor } from './commands/doctor/index.ts';
import { runDoctorRuleCommand } from './commands/doctor/rule-command.ts';
import { runKbLintRuleCommand } from './commands/kb-rule-command.ts';
import { describeRefusal } from './commands/output-port.ts';
import {
  exportHtml,
  exportMarkdownBundle,
  exportThirdParty,
  type ExportCommandContext,
} from './commands/export.ts';
import { helpRecommendNext, type HelpCommandContext } from './commands/help.ts';
import {
  kbDiff,
  kbGraph,
  kbLint,
  kbList,
  kbOpen,
  kbSearch,
  kbShow,
  kbSync,
  kbVerify,
  type KbCommandContext,
} from './commands/kb.ts';
import { ask } from './commands/loop/ask.ts';
import {
  debugFromFailure,
  debugSymptom,
  type DebugDeps,
  type DebugResult,
} from './commands/loop/debug.ts';
import { deployEnvironment } from './commands/loop/deploy.ts';
import { implementStory } from './commands/loop/implement.ts';
import { panelQuestion, type PanelDeps } from './commands/loop/panel.ts';
import { refactorTarget } from './commands/loop/refactor.ts';
import { reviewChange, type ReviewDeps } from './commands/loop/review.ts';
import {
  isSessionType,
  sessionExport,
  sessionList,
  sessionResume,
  sessionShow,
  startSession,
  type SessionCommandDeps,
  type SessionType,
  type StartSessionOptions,
} from './commands/loop/session.ts';
import { mcpList, mcpValidate, type McpCommandContext } from './commands/mcp.ts';
import {
  moduleAdd,
  moduleRemove,
  moduleUpdate,
  type InstallChangeReport,
  type InstallOptions,
  type ModuleCommandContext,
} from './commands/module.ts';
import { overlayAdd, type OverlayCommandContext } from './commands/overlay.ts';
import {
  presetApply,
  presetEject,
  presetList,
  presetShow,
  type PresetCommandContext,
} from './commands/preset.ts';
import { skillList, skillValidate, type SkillCommandContext } from './commands/skill.ts';
import {
  specList,
  specMatrix,
  specNew,
  specOrphans,
  specShow,
  SPEC_ARTIFACT_TYPES,
  specTrace,
  specValidate,
  type SpecCommandContext,
} from './commands/spec.ts';
import { uninstall } from './commands/uninstall.ts';
import { runUpgrade } from './commands/upgrade/index.ts';
import { gateValidateAll, workflowValidateAll } from './commands/workflow.ts';
import { templateValidateAll } from './commands/template.ts';
import { test as runTestRefusal } from './commands/loop/test.ts';
import { testCoverage } from './commands/loop/test/coverage.ts';
import { testFlaky } from './commands/loop/test/flaky.ts';
import { createSystemTempPath } from './commands/loop/test/system-temp.ts';
import { testRun } from './commands/loop/test/run.ts';
import {
  TEST_LAYER_RULES,
  isTestLayerRule,
  runTestLayerCommand,
} from './commands/loop/test/layer-command.ts';
import {
  abortRun,
  assertStopped,
  ensureIntegrationWorktree,
  formatGateApproval,
  formatGateReport,
  formatRunPlan,
  gateApprove,
  gateCheck,
  gateList,
  gateReject,
  gateWaive,
  integrationBranchOfRun,
  mergeAbort,
  mergeAllReady,
  mergeLane,
  pauseRun,
  planRunPlan,
  readRunLock,
  resumeWorkflow,
  runLanes,
  runLogs,
  runPlanJson,
  runStatus,
  runWorkflow,
  workflowIdForPlanPhase,
  type GateCommandContext,
  type MergeContext,
  type PlanPhase,
  type RunDeps,
} from './commands/run/index.ts';
import { createLauncherShimOrWarn, currentLauncher } from './commands/run/launcher-shim.ts';
import { runFailureError, runFailureNote } from './commands/run/run-failure.ts';
import {
  createAskPort,
  readAnswersFile,
  unmatchedAnswerWarnings,
  type CliAskPort,
} from './commands/run/ask.ts';
import { buildRunExpressionContext } from './commands/run/expression-context.ts';
import { extractInputFlags } from './commands/run/inputs.ts';
import { refusalEnvelopeLine, refusalOf } from './commands/run/vcs-refusal.ts';
import { runStatusJson } from './commands/run/status.ts';
import {
  CONFLICT_RESOLUTION_MODES,
  sanitizeWrittenFilePaths,
  type ConflictResolutionMode,
} from './generated-header.ts';
import { parseInitFlags } from './init/parse-init-flags.ts';
import { formatUnmappedTierWarnings, sanitizeOneLine } from './init/tier-map.ts';
import {
  readOwnPackageVersion,
  readPackageVersion,
  resolveOwnPackageRoot,
} from './init/package-root.ts';
import { runInit } from './init/run-init.ts';
import {
  specValidateRule,
  VALIDATE_RULE_IDS,
  type ValidateRuleId,
} from './commands/spec/validate-rules.ts';
import { renderStoryVerify, storyVerify } from './commands/story.ts';
import { parseGlobalFlags } from './entry/parse-global-flags.ts';
import { ARTIFACT_TYPES } from '@forge/schemas';
import type { ArtifactTypeId } from '@forge/schemas';
import type { CompileOptions, CompileSources } from '@forge/extensions/compile';
import { readWorkflowSource } from './commands/run/run.ts';
import type { DryRunResult, RealRunResult } from './commands/run/run.ts';

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
  // `specs/22` M13: a gate's advisory `brief:` is validated by this same command, in its own
  // `gates` result field (workflow ids and gate ids are different namespaces).
  const gateResults = await gateValidateAll({
    paths,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
  });
  const allIssues = [...results.values()].flat();
  const allGateIssues = [...gateResults.values()].flat();
  if (json) {
    console.log(
      JSON.stringify({
        v: 1,
        results: Object.fromEntries(results),
        gates: Object.fromEntries(gateResults),
      }),
    );
  } else if (allIssues.length === 0 && allGateIssues.length === 0) {
    console.log('forge workflow validate --all: no real issues.');
  } else {
    for (const [id, issues] of results) {
      for (const issue of issues) console.error(`${id}: ${issue.code} ${issue.message}`);
    }
    for (const [id, issues] of gateResults) {
      for (const issue of issues) console.error(`gate ${id}: ${issue.code} ${issue.message}`);
    }
  }
  return allIssues.length + allGateIssues.length > 0 ? 1 : 0;
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
 * directory (two levels above `forge-method`'s own package root), since no publishing/distribution
 * mechanism for `modules/` exists yet (the identical, already-disclosed gap `RunInitDeps.modulesDir`'s
 * own doc comment names, `SPEC-QUESTIONS.md` Q103) — real for every real use of this dispatcher today
 * (a workspace checkout), not yet real for a published, installed `forge-method` package. */
function resolveModulesDir(): string {
  return path.join(resolveOwnPackageRoot(import.meta.url), '..', '..', 'modules');
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
    agentsRoot: AGENTS_ROOT,
    // The running CLI, so `command` steps' `forge ...` resolves to it wherever it was launched from.
    launcher: currentLauncher(env),
    warn: (message) => {
      console.error(message);
    },
  };
}

/** The identical real `paths`/`projectRoot`/`config`/`adapter`/`checksRoot` shape `RunDeps` already
 * builds, plus `agentsRoot` — the one extra field `forge debug`/`forge review`/`forge panel` each need
 * (`loadProjectAgent`) that `RunDeps` itself has no reason to carry (`runWorkflow` never loads an agent
 * directly). Structurally assignable to `SessionCommandDeps` too (a strict subset of this shape), so
 * `forge session` reuses the identical builder rather than a fifth, near-duplicate one. */
async function buildLoopDepsForProject(
  paths: ProjectPaths,
  projectRoot: string,
): Promise<DebugDeps & ReviewDeps & PanelDeps & SessionCommandDeps> {
  const config = await readConfig(paths);
  const env = realEnvSnapshot();
  return {
    paths,
    projectRoot,
    config,
    adapter: await buildAdapterForConfig(config, env),
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
    env,
  };
}

/**
 * `--on-conflict <mode>` is parsed by `parseInitFlags` itself (it is `init`'s own local flag, not a
 * global one). When it was not given at all *and* this invocation is non-interactive by the global
 * `--yes`/`--json` flags (`03` §3.1's own "every interactive flow MUST have a --yes-able
 * non-interactive equivalent" rule, applied here to the real conflict prompt `writeRegenerableContent`
 * would otherwise open on a real, detected drift), a real default is picked rather than left
 * `undefined` (which would block on `process.stdin` in a script or CI job that piped nothing to it):
 * `keep-mine`, the one mode that never destroys a human's local edit or the newly generated content
 * (the new content is discarded outright by `keep-mine`, unlike `merge`, which at least preserves it
 * in a sidecar) — disclosed here and in `SPEC-QUESTIONS.md` as this piece's own named `--yes` default,
 * per `PLAN-M12.md` P3's own "decided and disclosed by this piece" requirement.
 */
function defaultNonInteractiveConflictMode(
  explicit: ConflictResolutionMode | undefined,
  yes: boolean,
  json: boolean,
): ConflictResolutionMode | undefined {
  if (explicit !== undefined) return explicit;
  return yes || json ? 'keep-mine' : undefined;
}

async function runInitCommand(
  initArgs: readonly string[],
  yes: boolean,
  json: boolean,
  project: string | undefined,
): Promise<number> {
  const { dir: requestedDir, options } = parseInitFlags(initArgs, yes);
  // `03` §3.2: `--project, -C <path>` — "Operate on this project root", default the current directory. For
  // `forge init [dir]` the target is `[dir]` resolved against that root, so `-C <path>` alone initialises
  // `<path>`, and `-C <base> <dir>` initialises `<base>/<dir>`. It used to be parsed and dropped, writing
  // into the current directory (`PLAN-M13.md` P12, `Q208` finding 7).
  const base = path.resolve(project ?? process.cwd());
  const dir = path.resolve(base, requestedDir);
  // A relative `[dir]` stays under `-C`; an absolute one is the user naming the target outright.
  if (
    project !== undefined &&
    !path.isAbsolute(requestedDir) &&
    (path.relative(base, dir) === '..' || path.relative(base, dir).startsWith(`..${path.sep}`))
  ) {
    throw new ForgeError('USR-002', { flag: '[dir]', value: requestedDir });
  }
  const env = realEnvSnapshot();
  const onConflict = defaultNonInteractiveConflictMode(options.onConflict, yes, json);
  const result = await runInit(
    dir,
    { ...options, ...(onConflict !== undefined ? { onConflict } : {}) },
    {
      candidateAdapters: await buildCandidateAdapters(env),
      env,
      modulesDir: resolveModulesDir(),
      // `03` §3.5's own output-mode table: "`--json`: NDJSON events on stdout... human logs to
      // stderr." An explicit `--on-conflict show-diff` combined with `--json` is a real, anticipated
      // case (`resolveGeneratedConflict`'s own doc comment names it) — without this, the human-oriented
      // diff text `printDiff` writes would land on `process.stdout` ahead of this function's own single
      // JSON line below, corrupting the "`--json` output is exactly one JSON line" contract every other
      // branch in this file honors (a round-3 critic finding, reproduced live: `forge init … --json
      // --on-conflict show-diff` against a drifted file made `JSON.parse(stdout)` throw).
      ...(json ? { conflictOutput: process.stderr } : {}),
    },
  );
  // Sanitized once, reused by both renderers below — a round-3 critic finding: the prior version called
  // `sanitizeForTerminal` separately inline in each renderer (once over the whole array for `--json`,
  // once per line in the plain-text loop), which is both the literal "two places that can drift" shape
  // this piece's own `CONFLICT_RESOLUTION_MODES` fix already closed for a different concern, and the
  // reason a direct unit test of the sanitization itself could not also prove what either renderer
  // actually prints. `sanitizeWrittenFilePaths` (`generated-header.ts`) is the one, single, directly
  // unit-tested real call site now; both branches below use its output verbatim.
  const sanitizedFiles = sanitizeWrittenFilePaths(result.files);
  if (json) {
    console.log(JSON.stringify({ v: 1, result: { ...result, files: sanitizedFiles } }));
  } else if (result.kind === 'reinitialized') {
    // `03` §3.3's own idempotency rule ("MUST detect it and switch to upgrade semantics") — real as of
    // `PLAN-M12.md` P3: the regenerable directories are regenerated for real, with real conflict
    // resolution wherever a local edit was detected (`run-init.ts`'s own doc comment explains why this
    // is scoped to the regenerable directories, not the full `runUpgrade` pipeline). `03` §3.3's own
    // "FORGE reports them" (the modified-hash files) means naming each one, not only a tally — a round-1
    // critic finding: the non-interactive `--yes` path (this piece's own disclosed `keep-mine` default,
    // silent by design during resolution itself) previously gave a human running plain `forge init
    // --yes` no way to see *which* files were preserved unedited without separately re-running with
    // `--json`.
    const conflicts = sanitizedFiles.filter((file) => file.conflict !== undefined);
    console.log(
      `forge init: ${result.projectRoot} already initialized — regenerated ` +
        `${String(result.files.length)} file(s)` +
        (conflicts.length > 0 ? `, resolved ${String(conflicts.length)} conflict(s):` : '.'),
    );
    for (const file of conflicts) console.log(`  ${file.path}: ${file.conflict ?? ''}`);
  } else {
    console.log(
      `forge init: wrote ${String(result.files.length)} files to ${result.projectRoot} ` +
        `(level ${result.level}, platform ${result.platform ?? 'none'}).`,
    );
  }
  // `PLAN-M13.md` P5b: say so now, with the remedy, rather than let the first agent step fail RUN-078.
  if (!json) {
    for (const line of formatUnmappedTierWarnings(result.modelTiers)) console.log(line);
    if (result.kind === 'reinitialized') {
      for (const note of result.modelTierNotes) {
        console.log(`forge init: warning: ${sanitizeOneLine(note)}.`);
      }
    }
  }
  return EXIT_CODES.success;
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

/** The identical `DryRunResult | RealRunResult` rendering `forge run` establishes above, shared by
 * every other command that dispatches through the same `runWorkflow` (`forge plan <phase>`,
 * `forge implement`/`forge refactor`/`forge deploy` — `PLAN-M12.md` P4) so the JSON contract and
 * human-readable shape stay identical across every real caller of that one mechanism, rather than
 * drifting across four independently-hand-rolled copies. */
function printWorkflowDispatchResult(
  label: string,
  result: DryRunResult | RealRunResult,
  json: boolean,
): number {
  if (result.kind === 'dry-run') {
    if (json) {
      console.log(JSON.stringify({ v: 1, plan: result.plan }));
    } else if (result.plan.success) {
      console.log(`forge ${label} --dry-run: compiled ${String(result.plan.nodes.length)} steps.`);
    } else {
      for (const issue of result.plan.issues) console.error(issue.message);
    }
    return result.plan.success ? EXIT_CODES.success : EXIT_CODES.usage;
  }
  if (json) {
    console.log(JSON.stringify({ v: 1, runId: result.runId, runState: result.runState }));
  } else {
    console.log(
      `forge ${label}: runId=${result.runId} status=${renderRunStatus(result.runState.runStatus)}.`,
    );
  }
  return reportRunFailure(result.runState);
}

/** A failed run says why, on stderr, with the remedy — the way every other refusal does — and exits with the
 * reason's own code (a budget refusal is `4`, anything else `1`). With `--json` stdout still carries the one
 * JSON line, whose `runState.runFailure` holds the same reason for a machine reader. A failed run whose log
 * carries no reason (recorded before it did) keeps the plain failure exit code. */
function reportRunFailure(runState: RunState): number {
  const failure = runFailureError(runState);
  if (failure === undefined) return runOutcomeExitCode(runState.runStatus);
  console.error(failure.message);
  console.error(failure.remedy);
  const note = runFailureNote(runState);
  if (note !== undefined) console.error(note);
  return failure.exitCode;
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

const RUN_FLAGS = {
  '--stage': true,
  '--epic': true,
  '--story': true,
  '--answers': true,
} as const;

/** The port an `elicit` step asks through (`PLAN-M13.md` P20): the answers in `--answers <file>` (relative to the
 * current directory, as any file argument is) and, when stdin and stderr are both a terminal, a prompt on stderr for
 * the rest. Off a terminal a question with no answer fails its step with the remedy, instead of waiting on stdin.
 * The caller closes it. */
async function buildElicitAskPort(
  answersFile: string | undefined,
  workflowSource: string | undefined,
): Promise<CliAskPort> {
  const answers =
    answersFile === undefined
      ? undefined
      : await readAnswersFile(path.resolve(process.cwd(), answersFile));
  if (answers !== undefined && workflowSource !== undefined) {
    for (const warning of unmatchedAnswerWarnings(workflowSource, answers)) {
      console.error(`forge: warning: ${warning}`);
    }
  }
  return createAskPort({
    answers,
    interactive: process.stdin.isTTY && process.stderr.isTTY,
    warn: (message) => {
      console.error(message);
    },
  });
}

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

/** `forge gate <sub>`. `check`, `approve` and `waive` run the gate's checks, and every shipped check is a `forge ...`
 * command, so they run with the launcher shim first on `PATH` exactly as a run's gate step does: a checkout launch
 * (`node packages/cli/bin/forge.mjs`) has no `forge` on `PATH`, and without the shim every check would exit 127
 * (`PLAN-M13.md` P12, P41). */
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
  const shim = await createLauncherShimOrWarn(currentLauncher(realEnvSnapshot()), (message) => {
    console.error(message);
  });
  try {
    return await runGateSubcommand(paths, projectRoot, sub, rest, json, shim?.commandEnv);
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
  const ctx: GateCommandContext = {
    paths,
    projectRoot,
    checksRoot: CHECKS_ROOT,
    runId,
    commandEnv,
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
    console.error('forge: "gate waive" needs --reason <text> --owner <name> --expires <iso-date>.');
    return EXIT_CODES.usage;
  }
  const report = await gateWaive(ctx, gateId, { reason, owner, expiresAt });
  console.log(json ? JSON.stringify({ v: 1, report }) : formatGateReport(report));
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
  // The integration branch the run used (a `--stage` run has its own): its ready lanes are merged there.
  const integrationBranch = await integrationBranchOfRun(paths, config, runId);
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
      (result) =>
        result.outcome.kind !== 'clean' &&
        result.outcome.kind !== 'conflict-resolved' &&
        result.outcome.kind !== 'already-integrated',
    );
    return anyFailed ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  // `laneId` is real here: `all` is `false` and the guard above already refused the only other case.
  const outcome = await mergeLane(ctx, laneId ?? '');
  console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
  return outcome.kind === 'clean' ||
    outcome.kind === 'conflict-resolved' ||
    outcome.kind === 'already-integrated'
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
  const ctx = { paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT, agentsRoot: AGENTS_ROOT };
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

/**
 * The general-purpose form of `stripControlChars` — recursively strips control characters out of
 * every string value found anywhere inside `value` (arrays and plain objects walked, everything else
 * returned unchanged), applied once to a real data structure before either `--json` or human-readable
 * rendering. `PLAN-M12.md` P4's own fresh critic round found this dispatcher's newly-wired `kb`/
 * `spec`/`adr`/`diagram`/`session` commands printing real, project-authored free text — KB entry
 * titles, diagram `source` text, spec/ADR front matter, a session's own recorded body — with none of
 * the sanitization `sanitizeInstallChangeReportForDisplay` already established as this file's own
 * precedent for exactly this bug class (a hostile or merely careless committer fully controls every
 * one of those fields; `docs/forge/**` content is no more trustworthy than a fetched module's
 * `module.yaml` free text once it reaches a real terminal). Applied to the real object before either
 * renderer sees it, for the identical reason `stripControlChars`'s own doc comment gives: `JSON.stringify`
 * never escapes `DEL`/the C1 range, so `--json` output is exactly as exposed as plain text without this.
 */
function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return stripControlChars(value) as unknown as T;
  if (Array.isArray(value)) {
    const items = value as readonly unknown[];
    return items.map((item) => sanitizeDeep(item)) as unknown as T;
  }
  // A round-2 critic round found this walked *every* non-null object, not only real plain ones —
  // `Object.entries`/`Object.fromEntries` on a `Date`/`Map`/`Set`/class instance silently drops its
  // own real internal state (`Object.entries(new Date(...))` is `[]`), corrupting it into `{}` with no
  // error. Nothing this dispatcher prints today carries such a value (every real timestamp field in
  // this codebase's own schemas is an ISO string, not a `Date`), but this is exactly the class of
  // latent bug a five-year-maintenance codebase eventually trips over — walked only for a real plain
  // object (`Object.getPrototypeOf(value)` is `Object.prototype` or `null`), left untouched otherwise.
  const isPlainObject =
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  if (isPlainObject) {
    const entries: readonly (readonly [string, unknown])[] = Object.entries(
      value as Readonly<Record<string, unknown>>,
    ).map(([key, entryValue]) => [key, sanitizeDeep(entryValue)] as const);
    return Object.fromEntries(entries) as unknown as T;
  }
  return value;
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

const UPGRADE_FLAGS = { '--to': true, '--on-conflict': true } as const;
// Built from the one real, shared `CONFLICT_RESOLUTION_MODES` array (`generated-header.ts`) rather than
// a second, independently-declared literal set — a round-1 critic finding: `parse-init-flags.ts`'s own
// `--on-conflict` validation for `forge init` previously declared its own separate copy of the same
// four literals, a real "two places that can silently drift apart" gap.
const VALID_CONFLICT_MODES = new Set<string>(CONFLICT_RESOLUTION_MODES);

/** `forge upgrade [--to <version>] [--on-conflict <mode>]` (`03` §3.4) — `--dry-run` is already a real
 * global flag (`parseGlobalFlags`' own `KNOWN_FLAGS`), so it never reaches `rest` here; this parses
 * `--to` and `--on-conflict`, the two flags `03` §3.4/§3.3 name that are not already global.
 * `--on-conflict`'s own non-interactive default (`--yes`/`--json` given, no explicit mode) is the
 * identical `keep-mine` `runInitCommand`'s own doc comment names and justifies — one real, shared
 * decision, not two independently-drifting ones.
 *
 * **A real asymmetry with `runInitCommand`, disclosed rather than papered over (a round-2 critic
 * finding).** `runInit` itself unconditionally requires `--yes` to run at all (`ForgeError('USR-002')`
 * otherwise), so `runInitCommand`'s own `yes` is always `true` by the time `defaultNonInteractiveConflictMode`
 * runs — the interactive prompt is structurally unreachable through a real `forge init` invocation.
 * `runUpgrade` has no such gate: a bare `forge upgrade` with no `--yes`/`--json`/`--on-conflict` at all
 * is a real, legal, common invocation, and it still opens a real interactive prompt
 * (`resolveGeneratedConflict`) if a regenerable file has drifted. Against a real, closed `stdin` (this
 * codebase's own subprocess test harness, or an ordinary interactive terminal) that prompt resolves —
 * to an explicit answer, or to `keep-mine` on EOF — exactly as tested below. Against a real, *open but
 * silent* `stdin` (a detached/background process, a CI runner piping a long-lived stream it never
 * writes to or closes), the prompt blocks waiting for a human exactly the way this codebase's one other
 * real terminal prompt (`@forge/extensions/install/consent.ts`'s `promptForConsent`) already discloses,
 * in its own doc comment, as a real, accepted, unfixed limitation: "no other interactive-shaped code in
 * this codebase establishes [a timeout] convention either, and a real terminal prompt genuinely has no
 * other correct behaviour than waiting for the human at the other end." This is that identical,
 * pre-existing, disclosed class of limitation — not a new gap this piece introduces — surfaced here
 * because `forge upgrade` (unlike `forge init`) can actually reach it. See `SPEC-QUESTIONS.md`. */
async function runUpgradeCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  dryRun: boolean,
  yes: boolean,
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, UPGRADE_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const to = values.get('--to');
  const onConflictFlag = values.get('--on-conflict');
  if (onConflictFlag !== undefined && !VALID_CONFLICT_MODES.has(onConflictFlag)) {
    throw new ForgeError('USR-002', { flag: '--on-conflict', value: onConflictFlag });
  }
  const onConflict = defaultNonInteractiveConflictMode(
    onConflictFlag as ConflictResolutionMode | undefined,
    yes,
    json,
  );
  const config = await readConfig(paths);
  const env = realEnvSnapshot();
  const adapter = await buildAdapterForDiagnostics(config, env);
  const report = await runUpgrade(
    paths,
    projectRoot,
    {
      dryRun,
      ...(to !== undefined ? { to } : {}),
      ...(onConflict !== undefined ? { onConflict } : {}),
    },
    {
      modulesDir: resolveModulesDir(),
      specsRoot: SPECS_ROOT,
      config,
      env,
      processVersion: realProcessVersion(),
      ...(adapter !== undefined ? { adapter } : {}),
      // `03` §3.5's own output-mode table: "`--json`: NDJSON events on stdout... human logs to
      // stderr." Identical reasoning and identical reproduced failure to `runInitCommand`'s own fix
      // just above (a round-3 critic finding): without this, `--json --on-conflict show-diff` against
      // a drifted file writes a human diff to `process.stdout` ahead of this function's own single
      // JSON line, corrupting the "`--json` output is exactly one JSON line" contract.
      ...(json ? { conflictOutput: process.stderr } : {}),
    },
  );
  // Sanitized once, reused by both renderers below — see `runInitCommand`'s own identical, disclosed
  // fix (round-3 critic finding) for why this replaced two separate inline `sanitizeForTerminal` calls.
  const sanitizedRegeneratedFiles =
    report.regeneratedFiles === undefined
      ? undefined
      : sanitizeWrittenFilePaths(report.regeneratedFiles);
  if (json) {
    const sanitizedReport =
      sanitizedRegeneratedFiles === undefined
        ? report
        : { ...report, regeneratedFiles: sanitizedRegeneratedFiles };
    console.log(JSON.stringify({ v: 1, report: sanitizedReport }));
  } else {
    console.log(
      `forge upgrade${dryRun ? ' --dry-run' : ''}: ${report.installedVersion} -> ` +
        `${report.targetVersion} (${String(report.migratedDocuments.length)} documents checked).`,
    );
    // `03` §3.3's own "FORGE reports them" — named per file, not only a tally, matching
    // `runInitCommand`'s own identical, disclosed fix for the same real gap.
    const conflicts = (sanitizedRegeneratedFiles ?? []).filter(
      (file) => file.conflict !== undefined,
    );
    if (conflicts.length > 0) {
      console.log(`  resolved ${String(conflicts.length)} conflict(s):`);
      for (const file of conflicts) console.log(`    ${file.path}: ${file.conflict ?? ''}`);
    }
  }
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

const DOCTOR_FLAGS = { '--fix': false, '--rebuild-index': false, '--rule': true } as const;

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
  const { flags, values, positionals } = parseCommandFlags(args, DOCTOR_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const doctorRule = values.get('--rule');
  if (doctorRule !== undefined) {
    if (
      flags.has('--fix') ||
      flags.has('--rebuild-index') ||
      args.filter((a) => a === '--rule').length > 1
    ) {
      throw new ForgeError('USR-002', {
        flag: '--rule',
        value: `${doctorRule} (cannot be repeated, or combined with --fix or --rebuild-index)`,
      });
    }
    // Read inside the rule command, so an unreadable config is a failing verdict and not an escaping refusal.
    return runDoctorRuleCommand(
      async () => {
        const config = await readConfig(paths);
        return {
          paths,
          projectRoot,
          kbRoot: config.paths.kb,
          reportsRoot: config.paths.reports,
          env: realEnvSnapshot(),
        };
      },
      doctorRule,
      json,
      console,
    );
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

// ---------------------------------------------------------------------------------------------
// `kb`/`spec`/`adr`/`diagram`/`customize`/`compile`/`preset`/`skill`/`mcp`/`help`/`plan`, plus the
// agent-facing `implement`/`debug`/`refactor`/`deploy`/`review`/`panel`/`ask`/`session` loop family
// — `PLAN-M12.md` P4's own remaining-commands mandate.
// ---------------------------------------------------------------------------------------------

/** Parses a caller-supplied JSON value out of one flag's own raw string — the identical "this package
 * cannot gather it itself... passed straight through from the caller" seam `diagram.generate`/`diff`/
 * `sync`'s own `generatorInput` parameter and `compile`'s own `sources` parameter both already
 * establish (their own doc comments), since no real "locate my own real project content at runtime"
 * resolver exists anywhere in this codebase yet (`SPEC-QUESTIONS.md`). A malformed JSON string is a
 * real, reported `USR-002`, never a raw `JSON.parse` `SyntaxError` reaching the caller. */
function parseJsonFlag(flag: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ForgeError('USR-002', { flag, value: raw });
  }
}

// --- `forge kb <sub>` (`03` §3.2.2, `17` §17.4/§17.6) -------------------------------------------------

const KB_SUBCOMMANDS = [
  'list',
  'show',
  'search',
  'lint',
  'diff',
  'sync',
  'open',
  'graph',
  'verify',
] as const;

async function buildKbContext(paths: ProjectPaths): Promise<KbCommandContext> {
  const config = await readConfig(paths);
  return { paths, kbRoot: KB_ROOT, specsRoot: SPECS_ROOT, level: config.project.level };
}

const KB_GRAPH_FLAGS = { '--hops': true } as const;
const KB_LINT_FLAGS = { '--rule': true } as const;

async function runKbCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  if (sub === 'lint') {
    const { values: lintValues, positionals: lintPositionals } = parseCommandFlags(
      rest,
      KB_LINT_FLAGS,
    );
    assertNoArgs(lintPositionals);
    if (rest.filter((token) => token === '--rule').length > 1) {
      throw new ForgeError('USR-002', { flag: '--rule', value: 'given more than once' });
    }
    const lintRule = lintValues.get('--rule');
    // Context is built inside the rule command: a project whose config cannot be read is a failing verdict there,
    // not a refusal that escapes with no `errors` field for the gate to read (`PLAN-M13.md` P25).
    if (lintRule !== undefined) {
      return runKbLintRuleCommand(() => buildKbContext(paths), lintRule, json, console);
    }
    let findings: Awaited<ReturnType<typeof kbLint>>;
    try {
      findings = sanitizeDeep(await kbLint(await buildKbContext(paths)));
    } catch (error) {
      // `G-Design`'s `kb:lint` reads `errors`; a refusal printed by the top-level handler has none, which the gate
      // reads as "not failing". Under `--json` an unreadable project is one failing finding instead.
      if (!json) throw error;
      const refusal = describeRefusal(error);
      console.log(
        JSON.stringify({
          v: 1,
          errors: 1,
          findings: [
            {
              ruleId: 'kb:refused',
              severity: 'error',
              message: `The check could not run: ${refusal.message}`,
              remedy: refusal.remedy,
            },
          ],
        }),
      );
      return EXIT_CODES.failure;
    }
    // `errors` is what `G-Design`'s `kb:lint` gate check (`failOn: 'errors > 0'`) reads: without it the check
    // evaluated an absent field and could never fail (`PLAN-M13.md` P25).
    const errors = findings.filter((f) => f.severity === 'error').length;
    console.log(
      json
        ? JSON.stringify({ v: 1, errors, findings })
        : findings
            .map(
              (f) =>
                `${f.severity} ${f.ruleId}${f.entryId === undefined ? '' : ` ${f.entryId}`}: ${f.message}`,
            )
            .join('\n') || 'forge kb lint: no real findings.',
    );
    return errors > 0 ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  const ctx = await buildKbContext(paths);

  if (sub === 'list') {
    assertNoArgs(rest);
    // Every field printed below (`title` especially) is real, project-authored KB free text a
    // hostile or careless committer fully controls — sanitized once, here, before either renderer
    // sees it (`sanitizeDeep`'s own doc comment has the fuller reasoning, a fresh critic-round finding).
    const entries = sanitizeDeep(await kbList(ctx));
    console.log(
      json
        ? JSON.stringify({ v: 1, entries })
        : entries.map((entry) => `${entry.kind} ${entry.id} ${entry.title}`).join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "kb show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const entry = sanitizeDeep(await kbShow(ctx, id));
    console.log(
      json
        ? JSON.stringify({ v: 1, entry })
        : `${entry.kind} ${entry.id} ${entry.title} (${entry.path})`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'search') {
    const { positionals } = parseCommandFlags(rest, {});
    const query = positionals.join(' ');
    if (query === '') {
      console.error('forge: "kb search" needs a real <query>.');
      return EXIT_CODES.usage;
    }
    const hits = sanitizeDeep(await kbSearch(ctx, query));
    console.log(
      json
        ? JSON.stringify({ v: 1, hits })
        : hits.map((hit) => `${hit.id} (${hit.score.toFixed(2)}) ${hit.title}`).join('\n') ||
            'forge kb search: no real hits.',
    );
    return EXIT_CODES.success;
  }
  if (sub === 'diff') {
    assertNoArgs(rest);
    return kbDiff();
  }
  if (sub === 'sync') {
    assertNoArgs(rest);
    const result = await kbSync(ctx);
    console.log(
      json
        ? JSON.stringify({ v: 1, ...result })
        : `forge kb sync: indexed ${String(result.entryCount)} entries.`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'open') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "kb open" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const result = await kbOpen(ctx, id);
    console.log(json ? JSON.stringify({ v: 1, ...result }) : result.path);
    return EXIT_CODES.success;
  }
  if (sub === 'graph') {
    const { values, positionals } = parseCommandFlags(rest, KB_GRAPH_FLAGS);
    if (positionals.length > 1) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[1] ?? '' });
    }
    const hopsRaw = values.get('--hops');
    let hops = 1;
    if (hopsRaw !== undefined) {
      if (!/^\d+$/.test(hopsRaw))
        throw new ForgeError('USR-002', { flag: '--hops', value: hopsRaw });
      hops = Number(hopsRaw);
    }
    const edges = await kbGraph(ctx, positionals[0], hops);
    console.log(
      json
        ? JSON.stringify({ v: 1, edges })
        : edges.map((edge) => `${edge.from} -> ${edge.to}`).join('\n') ||
            'forge kb graph: no real edges.',
    );
    return EXIT_CODES.success;
  }
  if (sub === 'verify') {
    assertNoArgs(rest);
    // `detail` carries a real, stored command's own real stdout/stderr (`runStoredVerificationCommand`)
    // — real, untrusted process output, sanitized for the identical reason every other free-text field
    // in this command is.
    const findings = sanitizeDeep(await kbVerify(ctx));
    const failing = findings.filter(
      (f) => f.outcome === 'fail' || f.outcome === 'timeout' || f.outcome === 'error',
    );
    console.log(
      json
        ? JSON.stringify({ v: 1, findings })
        : findings.map((f) => `${f.outcome} ${f.id}: ${f.detail}`).join('\n') ||
            'forge kb verify: no real, verifiable entries.',
    );
    return failing.length > 0 ? EXIT_CODES.failure : EXIT_CODES.success;
  }

  console.error(`forge: "kb ${sub ?? ''}" needs a real subcommand (${KB_SUBCOMMANDS.join('|')}).`);
  return EXIT_CODES.usage;
}

// --- `forge spec <sub>` (`03` §3.2.2) -------------------------------------------------------------

const SPEC_SUBCOMMANDS = ['list', 'show', 'validate', 'trace', 'matrix', 'orphans', 'new'] as const;

function buildSpecContext(paths: ProjectPaths): SpecCommandContext {
  return { paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT, agentsRoot: AGENTS_ROOT };
}

/** `spec validate` with no real `--rule` — `03` §3.2.2's own bare form, distinct from `spec validate
 * --rule <name>` above (`PLAN-M8.md` P2's own narrow gate-shelled wiring, unchanged by this piece):
 * the full `18` §18.6 two-phase document check plus `09` §9.4's graph-level required-edge/cycle
 * checks. G-Design's `spec:validate` check runs it with `--json` and reads `errors` (P35). */
async function runSpecValidateCommand(
  paths: ProjectPaths,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  assertNoArgs(rest);
  const ctx = buildSpecContext(paths);
  const result = await specValidate(ctx);
  const hasProblems =
    result.documents.some((doc) => !doc.valid) ||
    result.missingRequiredEdges.length > 0 ||
    result.cycles.length > 0;
  if (json) {
    // `errors` is the field G-Design's `spec:validate` check reads (`failOn: 'errors > 0'`): one per document
    // error, per missing required edge and per cycle. Without it the check read an absent field (P35).
    const errors =
      result.documents.reduce(
        (sum, doc) => sum + (doc.valid ? 0 : Math.max(1, doc.errors.length)),
        0,
      ) +
      result.missingRequiredEdges.length +
      result.cycles.length;
    console.log(JSON.stringify({ v: 1, ...result, errors }));
  } else if (!hasProblems) {
    console.log('forge spec validate: no real problems.');
  } else {
    for (const doc of result.documents) {
      if (!doc.valid) for (const error of doc.errors) console.error(`${doc.path}: ${error}`);
    }
    for (const violation of result.missingRequiredEdges) console.error(violation.message);
    for (const cycle of result.cycles) console.error(`cycle: ${cycle.path.join(' -> ')}`);
  }
  return hasProblems ? EXIT_CODES.failure : EXIT_CODES.success;
}

async function runSpecCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx = buildSpecContext(paths);

  if (sub === 'list') {
    assertNoArgs(rest);
    const specs = sanitizeDeep(await specList(ctx));
    console.log(
      json
        ? JSON.stringify({ v: 1, specs })
        : specs.map((spec) => `${spec.id} ${spec.type} ${spec.title}`).join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "spec show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const doc = await specShow(ctx, id);
    // `frontMatter` carries real, project-authored free text (titles, descriptions) — sanitized
    // before either renderer sees it, the identical discipline every other command in this piece now
    // applies.
    const frontMatter = sanitizeDeep(doc.frontMatter);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, frontMatter })
        : `${doc.path}\n${JSON.stringify(frontMatter, null, 2)}`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'trace') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "spec trace" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const result = await specTrace(ctx, id);
    console.log(
      json
        ? JSON.stringify({ v: 1, ...result })
        : `parents: ${result.parents.map((p) => p.id).join(', ') || '(none)'}\n` +
            `children: ${result.children.map((c) => c.id).join(', ') || '(none)'}`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'matrix') {
    assertNoArgs(rest);
    const matrix = await specMatrix(ctx);
    console.log(json ? JSON.stringify({ v: 1, ...matrix }) : JSON.stringify(matrix, null, 2));
    return EXIT_CODES.success;
  }
  if (sub === 'orphans') {
    assertNoArgs(rest);
    const orphans = await specOrphans(ctx);
    console.log(
      json
        ? JSON.stringify({ v: 1, orphans })
        : orphans.map((orphan) => `${orphan.kind} ${orphan.id}: ${orphan.reason}`).join('\n') ||
            'forge spec orphans: no real orphans.',
    );
    return orphans.length > 0 ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  if (sub === 'new') {
    const { positionals } = parseCommandFlags(rest, {});
    const [type, title] = positionals;
    if (type === undefined || title === undefined || positionals.length > 2) {
      console.error(
        'forge: "spec new" needs a real <type> <title> (a multi-word title must be one quoted argument).',
      );
      return EXIT_CODES.usage;
    }
    // A fresh critic round found this message previously listed the full, 21-entry `ArtifactTypeId`
    // registry (`ADR`/`Diagram`/`SessionRecord`/... included) as if each were a valid `spec new`
    // answer — every one of those still fails `specNew`'s own real, narrower domain check below. The
    // *validity* check here still needs the full registry (to tell "not a real type at all" apart from
    // "a real type, just not one `spec new` accepts" — the latter is `specNew`'s own real, distinct
    // `USR-003`, not this dispatcher's `USR-002`), but the message now names only the eight real
    // `spec new` accepts (`SPEC_ARTIFACT_TYPES`, exported by `spec.ts` for exactly this).
    if (!ARTIFACT_TYPES.some((candidate) => candidate.id === type)) {
      console.error(
        `forge: "spec new" needs a real <type> (one of: ${[...SPEC_ARTIFACT_TYPES].join(', ')}).`,
      );
      return EXIT_CODES.usage;
    }
    // `specNew` itself throws `USR-003` for a real, registered `ArtifactTypeId` that is not one of
    // `spec.ts`'s own eight `docs/forge/specs/**`-rooted types (`ADR`/`Risk`/etc., not in
    // `SPEC_ARTIFACT_TYPES`) — the cast here is safe (`type` just passed the real registry-membership
    // check above), and
    // that further, narrower refusal is genuine, disclosed spec.ts behaviour, not something this
    // dispatcher invents.
    const doc = await specNew(ctx, type as ArtifactTypeId, title);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, id: doc.get(['id']) })
        : `forge spec new ${type}: wrote ${doc.path}.`,
    );
    return EXIT_CODES.success;
  }

  console.error(
    `forge: "spec ${sub ?? ''}" needs a real subcommand (${SPEC_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

// --- `forge adr <sub>` (`03` §3.2.2) --------------------------------------------------------------

const ADR_SUBCOMMANDS = ['new', 'list', 'show', 'supersede', 'accept', 'reject'] as const;

function buildAdrContext(paths: ProjectPaths): AdrCommandContext {
  return { paths, kbRoot: KB_ROOT };
}

async function runAdrCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx = buildAdrContext(paths);

  if (sub === 'new') {
    const { positionals } = parseCommandFlags(rest, {});
    const [title] = positionals;
    if (title === undefined || positionals.length > 1) {
      console.error('forge: "adr new" needs a real <title>.');
      return EXIT_CODES.usage;
    }
    const doc = await adrNew(ctx, title);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, id: doc.get(['id']) })
        : `forge adr new: wrote ${doc.path}.`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'list') {
    assertNoArgs(rest);
    const entries = sanitizeDeep(await adrList(ctx));
    console.log(
      json
        ? JSON.stringify({ v: 1, entries })
        : entries.map((entry) => `${entry.id} ${entry.title}`).join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "adr show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const doc = await adrShow(ctx, id);
    const frontMatter = sanitizeDeep(doc.frontMatter);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, frontMatter })
        : `${doc.path}\n${JSON.stringify(frontMatter, null, 2)}`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'supersede') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id, newTitle] = positionals;
    if (id === undefined || newTitle === undefined || positionals.length > 2) {
      console.error('forge: "adr supersede" needs a real <id> <newTitle>.');
      return EXIT_CODES.usage;
    }
    const result = await adrSupersede(ctx, id, newTitle);
    console.log(
      json
        ? JSON.stringify({
            v: 1,
            superseded: result.superseded.path,
            replacement: result.replacement.path,
          })
        : `forge adr supersede ${id}: ${result.superseded.path} -> ${result.replacement.path}.`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'accept' || sub === 'reject') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error(`forge: "adr ${sub}" needs a real <id>.`);
      return EXIT_CODES.usage;
    }
    const doc = sub === 'accept' ? await adrAccept(ctx, id) : await adrReject(ctx, id);
    console.log(
      json
        ? JSON.stringify({ v: 1, path: doc.path, status: doc.get(['status']) })
        : `forge adr ${sub} ${id}: recorded.`,
    );
    return EXIT_CODES.success;
  }

  console.error(
    `forge: "adr ${sub ?? ''}" needs a real subcommand (${ADR_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

// --- `forge diagram <sub>` (`03` §3.2.2) ----------------------------------------------------------

const DIAGRAM_SUBCOMMANDS = [
  'list',
  'show',
  'validate',
  'render',
  'sync',
  'generate',
  'diff',
  'legend',
] as const;

function buildDiagramContext(paths: ProjectPaths): DiagramCommandContext {
  return { paths, kbRoot: KB_ROOT };
}

const DIAGRAM_RENDER_FLAGS = { '--open': false } as const;
const DIAGRAM_INPUT_FLAGS = { '--input': true } as const;

async function runDiagramCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx = buildDiagramContext(paths);

  if (sub === 'list') {
    assertNoArgs(rest);
    const entries = sanitizeDeep(await diagramList(ctx));
    console.log(
      json
        ? JSON.stringify({ v: 1, entries })
        : entries.map((entry) => `${entry.id} ${entry.title}`).join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "diagram show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    // `source` (a real, project-authored mermaid/text blob) and every other free-text field on a real
    // diagram sidecar is exactly as untrusted as a KB entry's own title — sanitized here for the
    // identical reason (a fresh critic-round finding).
    const diagram = sanitizeDeep(await diagramShow(ctx, id));
    console.log(json ? JSON.stringify({ v: 1, diagram }) : diagram.source);
    return EXIT_CODES.success;
  }
  if (sub === 'validate') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "diagram validate" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const findings = sanitizeDeep(await diagramValidate(ctx, id));
    console.log(
      json
        ? JSON.stringify({ v: 1, findings })
        : findings.map((f) => `${f.severity} ${f.message}`).join('\n') ||
            'forge diagram validate: no real findings.',
    );
    return findings.some((f) => f.severity === 'error') ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  if (sub === 'render') {
    const { flags, positionals } = parseCommandFlags(rest, DIAGRAM_RENDER_FLAGS);
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "diagram render" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    if (flags.has('--open')) {
      throw new ForgeError('USR-003', {
        feature: 'forge diagram render --open (no real browser-launch mechanism exists yet)',
      });
    }
    const html = stripControlChars(await diagramRender(ctx, id));
    console.log(json ? JSON.stringify({ v: 1, id, html }) : html);
    return EXIT_CODES.success;
  }
  if (sub === 'generate') {
    const { values, positionals } = parseCommandFlags(rest, DIAGRAM_INPUT_FLAGS);
    const [generatorName] = positionals;
    if (generatorName === undefined || positionals.length > 1) {
      console.error('forge: "diagram generate" needs a real <generator>.');
      return EXIT_CODES.usage;
    }
    const inputRaw = values.get('--input');
    const input = inputRaw === undefined ? undefined : parseJsonFlag('--input', inputRaw);
    const generated = sanitizeDeep(diagramGenerate(generatorName, input));
    console.log(json ? JSON.stringify({ v: 1, generated }) : generated.source);
    return EXIT_CODES.success;
  }
  if (sub === 'diff') {
    const { values, positionals } = parseCommandFlags(rest, DIAGRAM_INPUT_FLAGS);
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "diagram diff" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const inputRaw = values.get('--input');
    if (inputRaw === undefined) {
      console.error(
        'forge: "diagram diff" needs a real --input <json> (this generator\'s own real input).',
      );
      return EXIT_CODES.usage;
    }
    const result = sanitizeDeep(await diagramDiff(ctx, id, parseJsonFlag('--input', inputRaw)));
    console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
    return result.hasDrift ? EXIT_CODES.failure : EXIT_CODES.success;
  }
  if (sub === 'sync') {
    const { values, positionals } = parseCommandFlags(rest, DIAGRAM_INPUT_FLAGS);
    if (positionals.length > 0) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
    }
    const inputRaw = values.get('--input');
    if (inputRaw === undefined) {
      console.error(
        'forge: "diagram sync" needs a real --input <json>, a JSON object mapping diagram id to that ' +
          "diagram's own real generator input.",
      );
      return EXIT_CODES.usage;
    }
    const parsedInput = parseJsonFlag('--input', inputRaw);
    if (typeof parsedInput !== 'object' || parsedInput === null || Array.isArray(parsedInput)) {
      throw new ForgeError('USR-002', { flag: '--input', value: inputRaw });
    }
    const generatorInputs = new Map(
      Object.entries(parsedInput as Readonly<Record<string, unknown>>),
    );
    const results = sanitizeDeep(await diagramSync(ctx, generatorInputs));
    console.log(
      json
        ? JSON.stringify({ v: 1, results })
        : results
            .map((result) =>
              result.kind === 'ok'
                ? `${result.id}: ${result.result.hasDrift ? 'drifted' : 'in sync'}`
                : `${result.id}: error ${result.message}`,
            )
            .join('\n') || 'forge diagram sync: no real diagrams with a generator to check.',
    );
    return results.some((result) => result.kind === 'error' || result.result.hasDrift)
      ? EXIT_CODES.failure
      : EXIT_CODES.success;
  }
  if (sub === 'legend') {
    assertNoArgs(rest);
    return diagramLegend();
  }

  console.error(
    `forge: "diagram ${sub ?? ''}" needs a real subcommand (${DIAGRAM_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

// --- `forge customize`/`forge compile [--check]` (`03` §3.2.8) -----------------------------------

function runCustomizeCommand(args: readonly string[]): number {
  assertNoArgs(args);
  return customize();
}

const COMPILE_FLAGS = { '--check': false, '--sources': true } as const;

/** `forge compile [--check] --sources <path>` — `compile.ts`'s own doc comment names the real,
 * disclosed gap this wiring works within: no "gather this project's own real customization-layer
 * sources at runtime" resolver exists anywhere in this codebase, so `sources` is read from a real,
 * caller-supplied JSON file rather than fabricated by this dispatcher — the identical `--input <json>`
 * seam `forge diagram generate`/`diff`/`sync` already establish for the structurally identical
 * situation, just from a file rather than an inline flag value (`CompileSources` is too large a
 * document for one shell argument). See `SPEC-QUESTIONS.md`. */
async function runCompileCommand(
  paths: ProjectPaths,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { flags, values, positionals } = parseCommandFlags(args, COMPILE_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const sourcesPath = values.get('--sources');
  if (sourcesPath === undefined) {
    console.error(
      'forge: "compile" needs a real --sources <path> (a JSON file holding this project\'s own real ' +
        'CompileSources — no automatic project-content-gathering mechanism exists yet; see SPEC-QUESTIONS.md).',
    );
    return EXIT_CODES.usage;
  }
  const resolved = paths.resolveWithin(sourcesPath);
  if (!(await pathExists(resolved))) {
    throw new ForgeError('CFG-001', { path: sourcesPath, line: 0 });
  }
  let sources: CompileSources;
  try {
    sources = JSON.parse(await readTextFile(resolved)) as CompileSources;
  } catch {
    throw new ForgeError('USR-002', { flag: '--sources', value: sourcesPath });
  }
  const options: CompileOptions = flags.has('--check') ? { check: true } : {};
  const result = forgeCompile(sources, options);
  console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
  return result.violations.length > 0 ? EXIT_CODES.failure : EXIT_CODES.success;
}

// --- `forge preset <sub>` (`03` §3.2.8) -----------------------------------------------------------

const PRESET_SUBCOMMANDS = ['list', 'show', 'apply'] as const;
const PRESET_APPLY_FLAGS = { '--eject': false } as const;

async function runPresetCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  if (sub === 'list') {
    assertNoArgs(rest);
    const presets = presetList();
    console.log(
      json
        ? JSON.stringify({ v: 1, presets })
        : presets.map((preset) => `${preset.id} (${preset.posture})`).join('\n'),
    );
    return EXIT_CODES.success;
  }
  if (sub === 'show') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "preset show" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const preset = presetShow(id);
    console.log(json ? JSON.stringify({ v: 1, preset }) : JSON.stringify(preset, null, 2));
    return EXIT_CODES.success;
  }
  if (sub === 'apply') {
    const { flags, positionals } = parseCommandFlags(rest, PRESET_APPLY_FLAGS);
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "preset apply" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    if (flags.has('--eject')) {
      const overlays = presetEject(id);
      console.log(
        json
          ? JSON.stringify({ v: 1, overlays })
          : overlays.map((overlay) => overlay.path).join('\n'),
      );
      return EXIT_CODES.success;
    }
    const ctx: PresetCommandContext = { paths };
    const applied = await presetApply(ctx, id);
    console.log(
      json
        ? JSON.stringify({ v: 1, applied })
        : `forge preset apply ${id}: wrote ${String(applied.files.length)} file(s).`,
    );
    return EXIT_CODES.success;
  }

  // `diff` is `03` §3.2.8's own named subcommand with no real mechanism anywhere in this codebase
  // (`preset.ts`'s own surface has no `presetDiff` at all) — a real, disclosed gap, not fabricated here.
  console.error(
    `forge: "preset ${sub ?? ''}" needs a real subcommand this dispatcher wires yet ` +
      `(${PRESET_SUBCOMMANDS.join('|')}) — "diff" has no real mechanism yet (see SPEC-QUESTIONS.md).`,
  );
  return EXIT_CODES.usage;
}

// --- `forge skill <sub>` (`03` §3.2.8) ------------------------------------------------------------

const SKILL_SUBCOMMANDS = ['list', 'validate'] as const;

async function runSkillCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx: SkillCommandContext = { paths };

  if (sub === 'list') {
    assertNoArgs(rest);
    const ids = await skillList(ctx);
    console.log(json ? JSON.stringify({ v: 1, ids }) : ids.join('\n'));
    return EXIT_CODES.success;
  }
  if (sub === 'validate') {
    const { positionals } = parseCommandFlags(rest, {});
    const [id] = positionals;
    if (id === undefined || positionals.length > 1) {
      console.error('forge: "skill validate" needs a real <id>.');
      return EXIT_CODES.usage;
    }
    const outcome = await skillValidate(ctx, id);
    console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
    return outcome.valid ? EXIT_CODES.success : EXIT_CODES.failure;
  }

  // `new`/`attach`/`detach`/`test`/`import` are `03` §3.2.8's own named subcommands with no real
  // mechanism anywhere in `@forge/extensions/skills` — a real, disclosed gap, not fabricated here.
  console.error(
    `forge: "skill ${sub ?? ''}" needs a real subcommand this dispatcher wires yet (${SKILL_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

// --- `forge mcp <sub>` (`03` §3.2.8) --------------------------------------------------------------

const MCP_SUBCOMMANDS = ['validate', 'list'] as const;
const MCP_VALIDATE_FLAGS = { '--environment': true } as const;

async function runMcpCommand(
  paths: ProjectPaths,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  if (sub === 'validate') {
    const { values, positionals } = parseCommandFlags(rest, MCP_VALIDATE_FLAGS);
    if (positionals.length > 0) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
    }
    const environment = values.get('--environment');
    if (environment === undefined) {
      console.error('forge: "mcp validate" needs a real --environment <env>.');
      return EXIT_CODES.usage;
    }
    const ctx: McpCommandContext = { paths };
    const outcome = await mcpValidate(ctx, environment);
    console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
    return outcome.valid ? EXIT_CODES.success : EXIT_CODES.failure;
  }
  if (sub === 'list') {
    assertNoArgs(rest);
    return mcpList();
  }

  // `add`/`test`/`grant`/`revoke`/`trace` are `03` §3.2.8's own named subcommands with no real
  // mechanism anywhere in `@forge/extensions/mcp` — a real, disclosed gap, not fabricated here.
  console.error(
    `forge: "mcp ${sub ?? ''}" needs a real subcommand this dispatcher wires yet (${MCP_SUBCOMMANDS.join('|')}).`,
  );
  return EXIT_CODES.usage;
}

// --- `forge help [topic]` (`03`'s own closing line) -----------------------------------------------

/** `topic` — `helpRecommendNext` itself has no real per-topic content of its own (only the bare,
 * state-aware "you are here" recommendation `03` explicitly demands); a real `forge help <topic>` is a
 * genuine, disclosed gap, refused rather than fabricated. */
async function runHelpCommand(
  paths: ProjectPaths,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { positionals } = parseCommandFlags(args, {});
  if (positionals.length > 0) {
    throw new ForgeError('USR-003', {
      feature: `forge help ${positionals[0] ?? ''} (no real per-topic help content exists yet)`,
    });
  }
  const ctx: HelpCommandContext = { paths, specsRoot: SPECS_ROOT };
  const recommendation = await helpRecommendNext(ctx);
  console.log(
    json
      ? JSON.stringify({ v: 1, recommendation })
      : `${recommendation.command} — ${recommendation.reason}`,
  );
  return EXIT_CODES.success;
}

// --- `forge plan <phase>` (`03` §3.2.3) -----------------------------------------------------------

/** `10` §10.5's own 20-workflow table has no real workflow for `data`/`testing` — `workflowIdForPlanPhase`
 * itself throws `USR-003` for those two, the identical `PLAN-M6.md` C4 disclosure `forge merge --abort`
 * already establishes for the sibling gap in the same family; this dispatcher surfaces it verbatim
 * rather than inventing a generic "not wired" message. Genuinely a `run/`-family command sharing
 * `runWorkflow` with `forge run`/`implement`/`refactor`/`deploy` — left unwired by `PLAN-M12.md` P1's
 * own narrower, explicitly-named Surface list, closed here rather than left dangling with no piece of
 * this milestone ever allocated to it. See `SPEC-QUESTIONS.md`. */
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

/** Builds the real `ExpressionContext` `forge plan <phase>` dispatches with — `stageId` (when present)
 * is added via a variable typed as the real, narrow `PlanStageExpressionContext` extension, never a
 * fresh object literal assigned directly to the wider `ExpressionContext` type, which would trip
 * TypeScript's excess-property check on the one field that type does not itself declare (the identical
 * pattern `implement.ts`'s own `ImplementStoryExpressionContext` already establishes). */
function buildPlanExpressionContext(
  stageId: string | undefined,
  vars: Readonly<Record<string, string>>,
): ExpressionContext {
  const base: ExpressionContext = Object.keys(vars).length > 0 ? { vars } : {};
  if (stageId === undefined) return base;
  const withStage: PlanStageExpressionContext = { ...base, stageId };
  return withStage;
}

/** `forge plan run-plan <stageId> [--json]` — the command `plan-stage.workflow.yaml`'s `derive-run-plan` step
 * runs (`03` §3.2.3, `06` §6.2). Read-only and deterministic; it needs no adapter, so it is deliberately not
 * routed through `buildRunDepsForProject`. Exit `0` for a schedulable plan (warnings are still printed), `1`
 * when the stage's inputs are inconsistent (a cycle, an unknown dependency, ...), and a typed `RUN-082`
 * (exit `2`) for a stage no Epic declares. */
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

/** `forge story verify <storyId> [--json]`: evaluates a story's `done` DoD profile (`09` §9.8, `10` §10.6 step 6),
 * the command `implement-story:self-verify` runs. Arguments are checked before the config is read, like every
 * sibling command. */
async function runStoryCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  if (sub !== 'verify') {
    console.error('forge: "story" needs a real subcommand (verify).');
    return EXIT_CODES.usage;
  }
  const { positionals } = parseCommandFlags(rest, {});
  const [storyId] = positionals;
  if (storyId === undefined || positionals.length > 1) {
    console.error('forge: "story verify" needs a real <storyId>.');
    return EXIT_CODES.usage;
  }
  // `--dry-run` promises no effects (`03` §3.2); verification runs the project's own test commands, so it has no
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
      testCommands: config.execution.testCommands,
      flakeConfig: config.quality.flake,
    },
    storyId,
  );
  const rendering = renderStoryVerify(outcome, json);
  if (rendering.stdout !== undefined) console.log(rendering.stdout);
  if (rendering.stderr !== undefined) console.error(rendering.stderr);
  return rendering.exitCode;
}

const DEPLOY_FLAGS = { '--confirm': true } as const;

async function runDeployCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  dryRun: boolean,
  json: boolean,
): Promise<number> {
  const { values, positionals } = parseCommandFlags(args, DEPLOY_FLAGS);
  const [env] = positionals;
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
  // A fresh critic round found this dispatcher building a real `PlatformAdapter` (`buildLoopDepsForProject`,
  // which can throw a real, hard `ENV-004` for an unresolvable `platform.primary`) *before* checking
  // whether the caller even gave a real `<symptom>`/`--from-failure` at all — a real, unrelated
  // environment crash at exit 5 for the cheap, ordinary usage mistake `forge debug` (bare) should report
  // at exit 2 instead. Every sibling command in this same piece (`review`/`panel`/`implement`/
  // `refactor`/`deploy`/`plan`) already validates its own required arguments before building any real
  // dependency; this reorders `debug` to match.
  const [symptom] = positionals;
  if (fromFailure === undefined) {
    if (symptom === undefined || positionals.length > 1) {
      console.error('forge: "debug" needs a real <symptom>, or --from-failure <runId>.');
      return EXIT_CODES.usage;
    }
  } else if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }

  const deps: DebugDeps = await buildLoopDepsForProject(paths, projectRoot);
  const options = budgetUsd === undefined ? {} : { costBudgetUsd: budgetUsd };
  const result: DebugResult = sanitizeDeep(
    fromFailure !== undefined
      ? await debugFromFailure(deps, fromFailure, options)
      : await debugSymptom(deps, symptom ?? '', options),
  );
  // A fresh critic round found round 1's own sanitization fix stopped at `kb`/`spec`/`adr`/`diagram`/
  // `session show`/`session list`, missing this identical live-agent-output surface — `DebugResult`'s
  // own `reason`/`evidence` fields are real, model-derived free text carrying the exact "prompt-injected
  // or buggy model response smuggling a raw escape sequence" risk `session show`'s own body was
  // sanitized for.
  console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
  return result.outcome === 'recorded' ? EXIT_CODES.success : EXIT_CODES.failure;
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
  const deps: ReviewDeps = await buildLoopDepsForProject(paths, projectRoot);
  const diff = values.get('--diff');
  // `outcome` carries real, live-agent-produced review text (`InteractionOutcome.reviewReport` etc.)
  // — the identical untrusted-content class `session show`'s own body was sanitized for; a fresh
  // critic round found this sibling command missing the same fix.
  const outcome = sanitizeDeep(await reviewChange(deps, diff === undefined ? {} : { diff }));
  console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
  return outcome.outcome.status === 'succeeded' ? EXIT_CODES.success : EXIT_CODES.failure;
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
  const deps: PanelDeps = await buildLoopDepsForProject(paths, projectRoot);
  // The identical live-agent-output sanitization `review`/`debug`/`session` now all apply.
  const outcome = sanitizeDeep(await panelQuestion(deps, question, roles));
  console.log(json ? JSON.stringify({ v: 1, outcome }) : JSON.stringify(outcome, null, 2));
  return outcome.outcome.status === 'succeeded' ? EXIT_CODES.success : EXIT_CODES.failure;
}

/** `forge ask <question>` always refuses (`ask()` is a real, unconditional `USR-003` — see this
 * command's own doc comment) — but it still takes exactly one real positional (`03` §3.2.6's own
 * `<question>`), unlike every zero-positional command `assertNoArgs` exists for elsewhere in this
 * file: a second, unexpected positional is still this dispatcher's own real `USR-002`, not silently
 * accepted just because the one real positional it does allow is never actually read. */
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
  // A fresh critic round found the original version built a real `PlatformAdapter`
  // (`buildLoopDepsForProject`, which can throw a real, hard `ENV-004` for an unresolvable
  // `platform.primary`) unconditionally, before even checking whether `sub` names anything real at
  // all — so a bare `forge session` or a typo'd `forge session bogus-type` risked a real, unrelated
  // environment crash at exit 5 instead of the cheap usage message below, at exit 2. Every subcommand's
  // own required positionals are now validated first; the one real dependency this command needs is
  // built only once a real, dispatchable subcommand/type is confirmed.
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
      // `body` is real, rendered agent-conversation output — confirmed by a fresh critic round as
      // the single most plausible vector in this whole piece for a prompt-injected or buggy model
      // response to smuggle a raw ANSI/C1 escape sequence straight into a caller's terminal.
      // Sanitized, along with `record`'s own free-text fields (`title` etc.), before either
      // renderer sees it.
      const record = sanitizeDeep(doc.record);
      const body = stripControlChars(doc.body);
      console.log(
        json ? JSON.stringify({ v: 1, record, body, path: doc.path }) : `${doc.path}\n\n${body}`,
      );
      return EXIT_CODES.success;
    }
    if (sub === 'resume') {
      const result = sanitizeDeep(await sessionResume(deps, id));
      console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
      return result.outcome.status === 'succeeded' ? EXIT_CODES.success : EXIT_CODES.failure;
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

  // A fresh critic round found this dispatcher previously built a real `PlatformAdapter`
  // (`buildLoopDepsForProject`, which can throw a real, hard `ENV-004` for an unresolvable
  // `platform.primary`) *before* checking whether `sub` names anything real at all — so a bare `forge
  // session` or a typo'd `forge session bogus-type` risked a real, unrelated environment crash at exit
  // 5 instead of this cheap usage message at exit 2. This check (and every branch above) now runs
  // before any real dependency is built.
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
  const result = sanitizeDeep(await startSession(deps, type, options));
  console.log(json ? JSON.stringify({ v: 1, result }) : JSON.stringify(result, null, 2));
  return result.outcome.status === 'succeeded' ? EXIT_CODES.success : EXIT_CODES.failure;
}

/** `forge --version`/`-V` — `03` §3.2's own global-flags table names this row; nothing wired it until
 * now. Deliberately checked before `ProjectPaths` is ever constructed below: `--version` is a query
 * about the installed CLI itself, not about any project, and must answer even from a directory that
 * is not (or not yet) a real FORGE project — the identical reasoning `21` §21.5's own "cold start"
 * benchmark (`PLAN-M12.md` P5) depends on, since a warm-cache `npx forge-method --version` timing is
 * only real if the command it measures does not first require a valid project root to exist. Reads
 * `forge-method`'s own `package.json` `version` field via the same `readPackageVersion` helper `init`/
 * `upgrade` already use for every other package's version, rather than a second, hand-rolled reader. */
function printVersion(): void {
  console.log(readOwnPackageVersion(import.meta.url));
}

async function main(): Promise<number> {
  const flags = parseGlobalFlags(process.argv.slice(2));
  const [command, sub, ...rest] = flags.positionals;

  if (command === '--version' || command === '-V') {
    // A round-1 critic finding for `PLAN-M12.md` P5: every other zero-positional command in this
    // dispatcher rejects a stray extra positional (`assertNoArgs`, the shared helper commit `0f1f4ac`
    // introduced) rather than silently ignoring it — `forge --version foo` reaching here unchecked
    // would be the one inconsistent exception.
    assertNoArgs([sub, ...rest].filter((token): token is string => token !== undefined));
    printVersion();
    return EXIT_CODES.success;
  }

  // `init` creates the project, so it must run before `ProjectPaths` is built: that constructor resolves the
  // root against the real file system and cannot be given a directory that does not exist yet (a fresh
  // `-C <new dir>`, `PLAN-M13.md` P12).
  if (command === 'init') {
    return runInitCommand(flags.positionals.slice(1), flags.yes, flags.json, flags.project);
  }

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
    // `PLAN-M12.md` P4: the bare, no-`--rule` form (`03` §3.2.2's own real `spec validate` row) is now
    // wired below — `ruleFlag === undefined` means no `--rule` was given at all, distinct from `''`
    // (a real, trailing valueless `--rule`) or any other misspelled value, both of which still name
    // the one real, gate-shelled `--rule` form's own error message.
    if (ruleFlag === undefined) {
      return runSpecValidateCommand(paths, rest, flags.json);
    }
    if (!isValidateRuleId(ruleFlag)) {
      console.error(
        `forge: "spec validate" needs a real --rule <name> (one of: ${VALIDATE_RULE_IDS.join(', ')}); ` +
          `got ${JSON.stringify(ruleFlag)}.`,
      );
      return 2;
    }
    return runSpecValidateRule(paths, ruleFlag, flags.json);
  }
  if (command === 'kb') {
    return runKbCommand(paths, sub, rest, flags.json);
  }
  if (command === 'spec') {
    return runSpecCommand(paths, sub, rest, flags.json);
  }
  if (command === 'adr') {
    return runAdrCommand(paths, sub, rest, flags.json);
  }
  if (command === 'diagram') {
    return runDiagramCommand(paths, sub, rest, flags.json);
  }
  if (command === 'preset') {
    return runPresetCommand(paths, sub, rest, flags.json);
  }
  if (command === 'skill') {
    return runSkillCommand(paths, sub, rest, flags.json);
  }
  if (command === 'mcp') {
    return runMcpCommand(paths, sub, rest, flags.json);
  }
  if (command === 'test' && sub === 'run') {
    const rawRule = findRawTestRuleFlag(rest);
    // `--rule=smoke` matches no `--rule` token, so it would silently run the whole default test suite instead.
    if (rest.some((token) => token.startsWith('--rule='))) {
      console.error('forge: "test run" takes `--rule <name>` (a space, not `=`).');
      return 2;
    }
    if (isTestLayerRule(rawRule)) {
      // The layer checks take exactly `--rule <name>`: an unknown flag is refused here like everywhere else.
      const { positionals: layerPositionals } = parseCommandFlags(rest, { '--rule': true });
      assertNoArgs(layerPositionals);
      if (rest.filter((token) => token === '--rule').length > 1) {
        throw new ForgeError('USR-002', { flag: '--rule', value: 'given more than once' });
      }
      return runTestLayerCommand(
        projectRoot,
        async () => (await readConfig(paths)).execution.testCommands,
        rawRule,
        flags.json,
        console,
      );
    }
    if (rawRule !== undefined && !isTestRuleId(rawRule)) {
      console.error(
        `forge: "test run --rule" needs a real rule (one of: ${[...TEST_RULE_IDS, ...TEST_LAYER_RULES].join(', ')}); ` +
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
  // `test plan`/`test generate`/`test report` (`03` §3.2.5) — real, disclosed `USR-003` refusals
  // (`loop/test.ts`'s own doc comment: no real test-strategy-planning/generation/reporting mechanism
  // exists anywhere in this codebase) that no prior dispatcher piece ever wired at all (M8 P4/P6/P7
  // each wired only `run`/`coverage`/`flaky`) — closed here for real dispatcher completeness, the
  // identical "a real, disclosed-USR-003 sibling left dangling by a narrower per-piece Surface line"
  // reasoning `forge plan`'s own doc comment above already gives.
  if (command === 'test' && (sub === 'plan' || sub === 'generate' || sub === 'report')) {
    assertNoArgs(rest);
    return runTestRefusal(sub);
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
    return runUpgradeCommand(paths, projectRoot, afterCommand, flags.dryRun, flags.yes, flags.json);
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
  if (command === 'customize') {
    return runCustomizeCommand(afterCommand);
  }
  if (command === 'compile') {
    return runCompileCommand(paths, afterCommand, flags.json);
  }
  if (command === 'help') {
    return runHelpCommand(paths, afterCommand, flags.json);
  }
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

  console.error(
    `forge: "${[command, sub].filter((token) => token !== undefined).join(' ')}" is not wired into ` +
      "this real, deliberately minimal dispatcher yet (see bin.ts's own doc comment for the full " +
      'list of commands that exist as real functions but have no CLI wiring yet).',
  );
  return 2;
}

// `--json` is read from argv here, not from `parseGlobalFlags`' result: a refusal thrown while parsing the flags
// (`USR-002`) is one too, and its reader asked for JSON.
const jsonRequested = process.argv
  .slice(2)
  .some((arg) => arg === '--json' || arg.startsWith('--json='));

try {
  process.exitCode = await main();
} catch (error) {
  // A refusal (a `ForgeError`, a `VcsError`, another package's coded error) prints its message and remedy on stderr
  // and exits with its own code; under `--json` stdout also gets the one-line `{v:1, ok:false, error}` envelope
  // (`PLAN-M13.md` P21; the dirty-tree refusal is the one P12 left as plain text). Anything else is a crash and
  // keeps its stack, with no envelope.
  const refusal = refusalOf(error);
  if (refusal !== undefined) {
    if (jsonRequested) console.log(refusalEnvelopeLine(refusal));
    console.error(refusal.message);
    console.error(refusal.remedy);
    process.exitCode = refusal.exitCode;
  } else {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
