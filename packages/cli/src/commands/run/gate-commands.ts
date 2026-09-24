/**
 * `forge gate <list|check|approve|reject|waive>` — `03` §3.2.4.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.3
 */
import {
  ArtifactDocument,
  ForgeError,
  isForgeError,
  listDirSorted,
  pathExists,
  readTextFile,
  writeFileAtomic,
  SYSTEM_CLOCK,
  type Clock,
} from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import {
  applyWaiver,
  approveGate,
  approverRefusal,
  buildGateReport,
  evaluateGate,
  evidenceArtifactType,
  recordChecks,
  renderGateReportFile,
  validateWaiverPolicy,
  waiverExceedsCap,
  type DeterministicCheckResult,
  type GateApprovalSummary,
  type GateApprover,
  type GateDefinition,
  type GateEvaluationResult,
  type GateReport,
  type Waiver,
} from '@forge/engine/gates';
import {
  documentProblems,
  GateNotFoundError,
  readProjectAgent,
  runShellCommand,
} from '@forge/engine/dispatch';
import { SECRET_PATTERNS } from '@forge/extensions/skills';
import { definitionForType, renderArtifactPath } from '@forge/schemas';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { appendEvent, readEvents } from '@forge/telemetry/events';

import { sanitizeForTerminal } from '../../generated-header.ts';
import { CONFIG_REL_PATH, readConfig } from '../config.ts';
import { loadGateRegistry } from './gates.ts';

/** `18` §18.7's own registered `GateReport` row: `idPrefix`/`idWidth` for numbering
 * (`nextGateReportId`), and the definition `documentProblems` validates a written report against. */
const GATE_REPORT_TYPE = definitionForType('GateReport');

export interface GateCommandContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly checksRoot: string;
  /** `<agentsRoot>/<id>.yaml` (`readProjectAgent`): only consulted when `marker` names an agent
   * (`resolveApprover`, `PLAN-M14.md` P15). */
  readonly agentsRoot: string;
  readonly runId: string;
  readonly clock?: Clock;
  /** The environment overlay a check command runs with: `PATH` with the launcher shim first, so a gate's
   * `forge ...` check runs THIS `forge` (the one that is executing, wherever it was launched from) exactly as it
   * does inside a run (`createGateEvaluator`'s `env`, `PLAN-M13.md` P12). Absent: the caller's own `PATH`. */
  readonly commandEnv?: Readonly<Record<string, string>> | undefined;
  /** The real FORGE run/step/agent marker (`@forge/core/session-marker`, `PLAN-M14.md` P4/P15), read once by
   * `bin.ts`'s own `realEnvSnapshot()` (R10: no ambient environment read happens in this file) and passed down
   * here. Absent when `FORGE_RUN_ID` itself is unset: a real human's own shell never carries this marker, and
   * every gate command behaves exactly as it did before this piece (`resolveApprover`'s own "byte-identical").
   * `stepId`/`agentId` mirror `commandStepEnvironment`'s own real stamping: every run-spawned shell command
   * carries `runId`/`stepId`; only an `agent` step's own session also carries `agentId`. */
  readonly marker?: {
    readonly runId: string;
    readonly stepId?: string;
    readonly agentId?: string;
  };
}

export async function gateList(ctx: GateCommandContext): Promise<readonly GateDefinition[]> {
  const registry = await loadGateRegistry(ctx.paths, ctx.checksRoot);
  return [...registry.values()];
}

async function findGateOrThrow(ctx: GateCommandContext, gateId: string): Promise<GateDefinition> {
  const registry = await loadGateRegistry(ctx.paths, ctx.checksRoot);
  const definition = registry.get(gateId);
  if (definition === undefined) {
    throw new ForgeError('RUN-050', { gateId }, { cause: new GateNotFoundError(gateId) });
  }
  return definition;
}

/** `DEFAULT_CONFIG.gates.waiverMaxDays` — this package's own single source of the documented default (90)
 * — narrowed with a real runtime check rather than a non-null assertion (forbidden in production code by
 * this repo's own eslint config): `gates` is itself typed optional on `ForgeConfig` (any OTHER config may
 * omit it), but `DEFAULT_CONFIG` always sets it (`schemas/test/config/docs.test.ts`'s "DEFAULT_CONFIG
 * itself is a valid config" proves it every run) — this throws instead of silently repeating "90" as a
 * second, driftable fallback literal if that invariant is ever broken. */
function defaultWaiverMaxDays(): number {
  const { gates } = DEFAULT_CONFIG;
  if (gates === undefined) {
    throw new Error('DEFAULT_CONFIG.gates is unexpectedly absent (schemas/src/config/defaults.ts)');
  }
  return gates.waiverMaxDays;
}

/** `gates.waiverMaxDays` (`PLAN-M14.md` P16, `SPEC-QUESTIONS.md` Q232 decision 10): the project's real,
 * configured cap, defaulting to `defaultWaiverMaxDays()` (90). Absent because a `.forge/config.yaml` was
 * written before this piece existed (the identical "older configs load" reason
 * `execution.mergeChecks`/`paths.release` are already optional for), OR because no config file exists on
 * this project AT ALL YET, both read as the documented default rather than a missing-file error `forge
 * gate waive`/`check`/`approve` have no reason to surface: a project need not have run `forge config set`
 * even once for gate commands to work. A config file that DOES exist but fails to validate still throws
 * (`readConfig`'s own `CFG-001`) — only a literally absent file is this lenient. */
async function resolveWaiverMaxDays(ctx: GateCommandContext): Promise<number> {
  if (!(await pathExists(ctx.paths.resolveWithin(CONFIG_REL_PATH)))) {
    return defaultWaiverMaxDays();
  }
  const config = await readConfig(ctx.paths);
  return config.gates?.waiverMaxDays ?? defaultWaiverMaxDays();
}

/** `paths.reports` (`18` §18.7's `GateReport` row is rooted here): the project's real, configured
 * reports root, defaulting to `DEFAULT_CONFIG.paths.reports` ("docs/forge/reports") the same
 * lenient-if-absent way `resolveWaiverMaxDays` reads `gates.waiverMaxDays` just above — a project need
 * not have run `forge config set` even once for `gate check`/`approve`/`waive` to know where to write a
 * `GateReport`. Unlike `gates.waiverMaxDays`, `paths.reports` is a REQUIRED field of a validated config
 * (`schema.ts`'s `pathsSchema`, unlike `paths.release`), so once a config file exists this never falls
 * further back than it: only a literally absent config file reads the packaged default. */
async function resolveReportsRoot(ctx: GateCommandContext): Promise<string> {
  if (!(await pathExists(ctx.paths.resolveWithin(CONFIG_REL_PATH)))) {
    return DEFAULT_CONFIG.paths.reports;
  }
  const config = await readConfig(ctx.paths);
  return config.paths.reports;
}

/** `GATE-###`, `18` §18.7's own `idPrefix`/`idWidth`, matched against a whole `id` (an optional
 * `-<suffix>` sub-id, `front-matter.ts`'s own base id pattern, is accepted and ignored — no real
 * `GateReport` writer here ever adds one, but a hand-edited file might). */
const GATE_REPORT_ID_PATTERN = new RegExp(
  `^${GATE_REPORT_TYPE.idPrefix}-(\\d{${String(GATE_REPORT_TYPE.idWidth)}})(?:-\\d+)?$`,
);

/** One above the highest `GATE-###` id this registry's `idWidth` can represent (`999` for the real,
 * 3-digit `GateReport` entry) — the same bound `@forge/core`'s own `IdAllocator` (`CFG-010`) and
 * `output-ids.ts`'s `reserveIds` (`RUN-109`) already refuse past, for the identical reason: silently
 * widening to a 4-digit id would produce one `GATE_REPORT_ID_PATTERN` itself can never match back on a
 * later scan (its `\d{3}` group is exact-width), so every id after it would misread the same, already-
 * claimed number as still free and re-issue it forever. */
const MAX_GATE_REPORT_NUMERIC_ID = 10 ** GATE_REPORT_TYPE.idWidth - 1;

/** The next free `GATE-###` id: one above the highest already claimed by a real `GateReport` file under
 * `<reportsRoot>/gates/` — `18` §18.8's own "truth is a scan of existing artifacts," scoped to this one
 * directory rather than the whole project. `GateReport`'s own registered file name is `<gate>-<ts>.md`
 * (`18` §18.7), not `<id>-....md` like every other numbered type, so the id can only be read out of each
 * file's own front matter, never off the file name itself — unlike `@forge/core`'s own `IdAllocator`
 * (whole-project scan, `.forge/state/ids.json` cache), this is a plain, single-process directory scan
 * with no cross-process lock: two concurrent `forge gate check` invocations against the same project may
 * compute and claim the identical next id (disclosed, `PLAN-M14.md` P17 — the run lock does not cover CLI
 * gate commands). A file that is not real Markdown, or not a `GateReport`, or whose `id` does not match
 * the registered shape, claims nothing — best-effort per file, the same stance
 * `@forge/core/ids`'s own `countIdsFromFiles` already takes for the identical reason: one malformed file
 * must not make numbering fail outright.
 * @throws {ForgeError} `GATE-514` if every id up to `MAX_GATE_REPORT_NUMERIC_ID` is already claimed. */
async function nextGateReportId(paths: ProjectPaths, reportsRoot: string): Promise<string> {
  const dir = `${reportsRoot}/gates`;
  let highest = 0;
  if (await pathExists(paths.resolveWithin(dir))) {
    for (const name of await listDirSorted(paths.resolveWithin(dir))) {
      if (!name.toLowerCase().endsWith('.md')) continue;
      let frontMatter: Record<string, unknown>;
      try {
        const text = await readTextFile(paths.resolveWithin(`${dir}/${name}`));
        frontMatter = ArtifactDocument.parse(text, `${dir}/${name}`).frontMatter as Record<
          string,
          unknown
        >;
      } catch {
        continue;
      }
      if (frontMatter['type'] !== 'GateReport') continue;
      const id = frontMatter['id'];
      const match = typeof id === 'string' ? GATE_REPORT_ID_PATTERN.exec(id) : null;
      if (match?.[1] !== undefined) highest = Math.max(highest, Number.parseInt(match[1], 10));
    }
  }
  if (highest >= MAX_GATE_REPORT_NUMERIC_ID) {
    throw new ForgeError('GATE-514', { max: MAX_GATE_REPORT_NUMERIC_ID });
  }
  return `${GATE_REPORT_TYPE.idPrefix}-${String(highest + 1).padStart(GATE_REPORT_TYPE.idWidth, '0')}`;
}

/** Writes `report` as a real `GateReport` document (`10` §10.3 rule 4: "every gate evaluation writes a
 * `GateReport` artifact... with the exact command output — this is the audit trail") to
 * `<paths.reports>/gates/<gate>-<ts>.md` and returns its path, relative to the project root.
 * `evaluatedAt` — the caller's own clock, sampled once (`21` §21.1) — is both the front matter's own
 * `evaluatedAt` and (filesystem-safe: `:` is invalid in a Windows file name) this file's own `<ts>`.
 *
 * Validated with `documentProblems` (`@forge/engine/dispatch`) — the identical function the output check
 * judges an engine-written `ReviewReport` with — before it is ever written: a document this piece built
 * wrong is a bug here, not a caller-facing failure with a remedy to offer, the same `RangeError` stance
 * `swarm-review-step.ts`'s own `writeReport` already takes for the identical shape of self-check. Written
 * with `writeFileAtomic` (a typed `RUN-034` on failure, e.g. a plain file squatting where the `gates/`
 * directory itself needs to be created) BEFORE the caller appends any event: nothing is approved or
 * waived without its own audit trail actually landing on disk first. */
async function writeGateReportFile(
  ctx: GateCommandContext,
  definition: GateDefinition,
  report: GateReport,
  evaluatedAt: string,
): Promise<string> {
  const reportsRoot = await resolveReportsRoot(ctx);
  const ts = evaluatedAt.replace(/:/g, '-');
  const pathResult = renderArtifactPath('GateReport', { gate: definition.id, ts });
  if (!pathResult.success) {
    // `GateReport`'s own registered `pathTemplate` names exactly `{gate}` and `{ts}`, both supplied
    // above -- this would be a bug in this function, not a caller-facing failure with a remedy.
    throw new RangeError(
      `renderArtifactPath('GateReport', ...) failed: missing ${pathResult.missingVariable}`,
    );
  }
  // `GateReport`'s own registered `pathTemplate` ('reports/gates/{gate}-{ts}.md') names a literal
  // `reports/` top-level segment matching `ForgeConfig.paths.reports`'s own namespace label -- the
  // identical "strip the registered top-level label, reroot under the real configured path" `forge adr
  // new`/`loop/debug.ts`'s own `scaffoldDefect` already do for `kb/`/`reports/`.
  const relativePath = `${reportsRoot}/${pathResult.path.replace(/^reports\//, '')}`;
  const id = await nextGateReportId(ctx.paths, reportsRoot);
  const text = renderGateReportFile({
    id,
    gate: definition,
    report,
    runId: ctx.runId,
    evaluatedAt,
  });
  const problems = documentProblems(GATE_REPORT_TYPE, relativePath, text).problems;
  if (problems.length > 0) {
    throw new RangeError(`the engine built an invalid ${id}: ${problems.join('; ')}`);
  }
  await writeFileAtomic(ctx.paths.resolveWithin(relativePath), text);
  return relativePath;
}

/** `check <id>`: re-evaluates without approving — `10` §10.3 gate rule 3's own non-mutating read
 * path. Real: the identical `evaluateGate`/`buildGateReport` pipeline `@forge/engine/dispatch`'s own
 * `createGateEvaluator` wraps for a live run, called here directly. Emits no event — the whole point
 * of "does not mutate" (a caller that *wants* the result recorded calls `approve`/`reject` next,
 * which do) — but `PLAN-M14.md` P17 still writes a real `GateReport` document: rule 4 says every
 * EVALUATION writes one, and `check` genuinely evaluates the gate, it just appends no event. */
export async function gateCheck(
  ctx: GateCommandContext,
  gateId: string,
): Promise<
  GateReport & {
    readonly reportPath: string;
    readonly warnings: readonly DeterministicCheckResult[];
  }
> {
  const definition = await findGateOrThrow(ctx, gateId);
  const evaluated = await evaluateFresh(ctx, definition);
  // `10` §10.3 rule 1: a waiver "appears in every report until resolved". The report shows the newest waiver this
  // run recorded that has not lapsed and that was granted for every check failing now (`passed` stays false: the
  // checks still fail; `approved` says the waiver covers them).
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const nowIso = clock.now();
  const now = Date.parse(nowIso);
  const waiver = await coveringWaiver(ctx, gateId, evaluated, now);
  const report = buildGateReport(
    definition,
    waiver === undefined ? evaluated : applyWaiver(evaluated, waiver, now),
  );
  const reportPath = await writeGateReportFile(ctx, definition, report, nowIso);
  // `PLAN-M14.md` P20: `warn`-severity attached checks never affect `passed`/`approved` above, but they
  // are still reported — the report itself (`GateReport`, `report.ts`) stays unchanged (rule 4's audit
  // trail is about the checks that actually gate the outcome), so this evaluation's own `warnings` ride
  // alongside it here, the identical "the evaluation this call actually ran" data `reportPath` already
  // does.
  return { ...report, reportPath, warnings: evaluated.warnings };
}

/** The newest recorded waiver for `gateId` that has not lapsed and covers every check failing in `evaluated`.
 * A recorded waiver whose own `expiresAt` exceeds its own grant (`ts`) plus the configured
 * `gates.waiverMaxDays` cap is skipped exactly as a malformed (`GATE-504`) or already-lapsed (`GATE-505`)
 * one is -- a hand-appended waiver that never went through `forge gate waive`'s own `GATE-512` refusal does
 * not silently bypass the cap here (`PLAN-M14.md` P16). */
async function coveringWaiver(
  ctx: GateCommandContext,
  gateId: string,
  evaluated: GateEvaluationResult,
  now: number,
): Promise<Waiver | undefined> {
  if (evaluated.passed) return undefined;
  const failing = evaluated.checks.filter((check) => !check.passed).map((check) => check.checkId);
  const maxDays = await resolveWaiverMaxDays(ctx);
  for (const recorded of await recordedWaivers(ctx, gateId)) {
    if (!failing.every((id) => recorded.coveredCheckIds.includes(id))) continue;
    try {
      if (waiverExceedsCap(recorded.waiver, recorded.ts, maxDays)) {
        throw new ForgeError('GATE-512', { maxDays, expiresAt: recorded.waiver.expiresAt });
      }
      applyWaiver(evaluated, recorded.waiver, now);
      return recorded.waiver;
    } catch (error) {
      if (!(
        error instanceof ForgeError &&
        (error.code === 'GATE-504' || error.code === 'GATE-505' || error.code === 'GATE-512')
      )) {
        throw error;
      }
    }
  }
  return undefined;
}

/** One evaluation of `definition` in the project, exactly as `check`, `approve` and `waive` each run it: the same
 * `evaluateGate`, the same shell runner (which hands `stderr` to the audit trail). */
function evaluateFresh(
  ctx: GateCommandContext,
  definition: GateDefinition,
): Promise<GateEvaluationResult> {
  return evaluateGate(definition, ctx.projectRoot, (check) =>
    runShellCommand(check.run, ctx.projectRoot, ctx.commandEnv),
  );
}

/** Human-mode `forge gate approve` line. The waiver's `owner` was typed by a person and read back from the event log,
 * so it is terminal-sanitised like any other text a check or a file supplies. `reportPath` (`PLAN-M14.md` P17)
 * is engine-computed, not user text, but sanitised the same way every other dynamic value on this line is;
 * optional so a caller that hand-builds a `GateApprovalSummary` without one (a test fixture) still formats. */
export function formatGateApproval(
  gateId: string,
  summary: GateApprovalSummary & { readonly reportPath?: string },
): string {
  const how =
    summary.basis === 'waiver'
      ? `waived ${String(summary.checksWaived)} failing check(s) under a waiver by ${sanitizeForTerminal(summary.waiver?.owner ?? 'unknown')}`
      : `${String(summary.checksPassed)} checks passed`;
  const reportLine =
    summary.reportPath === undefined ? '' : `\nreport: ${sanitizeForTerminal(summary.reportPath)}`;
  return `forge gate approve ${sanitizeForTerminal(gateId)}: recorded (${how}).${reportLine}`;
}

/** Human-mode `forge gate check`/`waive` output: the verdict, then for EVERY failing check its id, its exit code and
 * why it failed, so a person is not sent to `--json` to learn what went wrong (the fail-closed `reason` of
 * `PLAN-M13.md` P35, and the stderr the audit trail now keeps, `P41`), then every attached `warn` check that
 * failed (`PLAN-M14.md` P20: reported, never a reason to refuse), then the real `GateReport` document this
 * evaluation just wrote (`PLAN-M14.md` P17) — `reportPath`/`warnings` optional so a caller that hand-builds a
 * `GateReport` without either (a test fixture) still formats. A check whose own `failOn` tripped has no
 * `reason`: the finding is in its output, so the first line of that is shown instead. */
export function formatGateReport(
  report: GateReport & {
    readonly reportPath?: string;
    readonly warnings?: readonly DeterministicCheckResult[];
  },
): string {
  const lines = [`${sanitizeForTerminal(report.gateId)}: passed=${String(report.passed)}`];
  // A check's output is untrusted text shown in a terminal or a CI log: whitespace collapsed (a pretty-printed JSON
  // body is one line, not `{`), secret shapes redacted, escapes and control bytes stripped, then capped.
  const oneLine = (text: string): string => {
    // Stripped FIRST, then redacted: a secret split by an invisible control character would otherwise miss the
    // pattern and then be reassembled by the strip.
    let clean = sanitizeForTerminal(text);
    for (const pattern of SECRET_PATTERNS) {
      clean = clean.replace(
        new RegExp(
          pattern.source,
          pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
        ),
        '[REDACTED]',
      );
    }
    const flat = clean.replace(/\s+/g, ' ').trim();
    return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat;
  };
  for (const check of report.checks) {
    if (check.passed) continue;
    lines.push(
      `  FAIL ${oneLine(check.checkId)} (exit ${String(check.exitCode)}): ${
        check.reason === undefined
          ? `its failOn matched; output: ${oneLine(check.stdout)}`
          : oneLine(check.reason)
      }`,
    );
    if (check.stderr !== undefined) lines.push(`       stderr: ${oneLine(check.stderr)}`);
  }
  for (const warn of report.warnings ?? []) {
    if (warn.passed) continue;
    lines.push(
      `  WARN ${oneLine(warn.checkId)} (exit ${String(warn.exitCode)}): ${
        warn.reason === undefined
          ? `its failOn matched; output: ${oneLine(warn.stdout)}`
          : oneLine(warn.reason)
      }`,
    );
  }
  if (report.waiver !== undefined) {
    lines.push(
      `  waived by ${oneLine(report.waiver.owner)} until ${oneLine(report.waiver.expiresAt)}: ${oneLine(report.waiver.reason)}`,
    );
  }
  if (report.reportPath !== undefined) {
    lines.push(`report: ${sanitizeForTerminal(report.reportPath)}`);
  }
  return lines.join('\n');
}

async function emitGateEvent(
  ctx: GateCommandContext,
  type: 'GateApproved' | 'GateRejected' | 'GateWaived',
  gateId: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  // Secret shapes in a free-text `--reason`, a check's `reason` or its command line are redacted at write time, as
  // every other event the engine appends is (`createTelemetryFacade`, `20` §20.10 S3).
  await appendEvent(
    ctx.projectRoot,
    ctx.runId,
    {
      type,
      runId: ctx.runId,
      ts: clock.now(),
      payload: { gateId, ...payload },
    },
    { valuePatterns: SECRET_PATTERNS },
  );
}

/** Every waiver recorded for `gateId` in this run's event log, newest first, as the waivers `gate waive`
 * validated when it recorded them. */
interface RecordedWaiver {
  readonly waiver: Waiver;
  /** The checks that were failing when it was granted (empty for a waiver that recorded none). */
  readonly coveredCheckIds: readonly string[];
  /** Epoch ms this waiver's own `GateWaived` event recorded (`event.ts`) — the moment it was actually
   * granted, which `gates.waiverMaxDays` (`waiver.ts`'s `waiverExceedsCap`, `PLAN-M14.md` P16) is measured
   * from, never from whatever "now" happens to be when a later `check`/`approve` re-reads it. */
  readonly ts: number;
}

async function recordedWaivers(
  ctx: GateCommandContext,
  gateId: string,
): Promise<readonly RecordedWaiver[]> {
  const waivers: RecordedWaiver[] = [];
  for await (const event of readEvents(ctx.projectRoot, ctx.runId)) {
    if (event.type !== 'GateWaived') continue;
    const payload = event.payload;
    if (typeof payload !== 'object' || payload === null) continue;
    const {
      gateId: waivedGate,
      reason,
      owner,
      expiresAt,
      evaluation,
    } = payload as Record<string, unknown>;
    if (
      waivedGate === gateId &&
      typeof reason === 'string' &&
      typeof owner === 'string' &&
      typeof expiresAt === 'string'
    ) {
      waivers.push({
        waiver: { reason, owner, expiresAt },
        coveredCheckIds: failingCheckIds(evaluation),
        ts: Date.parse(event.ts),
      });
    }
  }
  return waivers.reverse();
}

/** The ids of the checks a recorded `GateWaived` evaluation says were failing: what that waiver excused. */
function failingCheckIds(evaluation: unknown): readonly string[] {
  if (typeof evaluation !== 'object' || evaluation === null) return [];
  const checks = (evaluation as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return [];
  return (checks as readonly unknown[]).flatMap((check) => {
    if (typeof check !== 'object' || check === null) return [];
    const { checkId, passed } = check as Record<string, unknown>;
    return typeof checkId === 'string' && passed === false ? [checkId] : [];
  });
}

export interface ApproveOptions {
  /** Who approves, overriding `resolveApprover`'s own real session-marker resolution (`PLAN-M14.md` P15)
   * entirely: a caller that already knows who is approving (an engine-dispatched approval, a future
   * authenticated channel) passes it here and `ctx.marker` is never consulted. Absent (the CLI's own real
   * call): resolved from the marker instead -- see `resolveApprover`. Either way the gate's
   * `approval.roles`, `alwaysHuman` and (for an agent) `gates.may_approve` are enforced for it. */
  readonly approver?: GateApprover;
}

/** Who is approving/waiving `gateId` under `ctx`'s real session marker (`@forge/core/session-marker`,
 * `PLAN-M14.md` P4, amended by P15): `10` §10.3 rule 6 no longer holds unconditionally that "the command
 * is a person's: it cannot tell an agent that runs it from one" -- an honest agent session (`forge gate
 * approve`/`waive` run from inside an `agent` step's own spawned shell, `commandStepEnvironment`/
 * `dispatch-agent-step.ts`) carries `FORGE_AGENT_ID`, and a real human's own terminal never does (this is
 * a cheap signal for an *honest* session, not a security boundary -- `session-marker.ts`'s own doc
 * comment says so; a hostile shell can still unset or forge it).
 *
 * `explicit` (`ApproveOptions.approver`, the pre-existing programmatic seam) always wins: a caller that
 * already knows who is approving does not need the marker second-guessed.
 *
 * Otherwise:
 * - No marker, or a marker whose own `runId` does not match `ctx.runId` (the run this command actually
 *   resolved, `resolveDispatchRunId`) -- discarded identically: `{ kind: 'human' }`, byte-identical to
 *   every gate command run before this piece. A marker naming a DIFFERENT run cannot be trusted for this
 *   one, so it is treated exactly as if it were never there.
 * - A marker naming `ctx.runId` with no agent id: a run's OWN `command` step (every shell command a run
 *   spawns carries `FORGE_RUN_ID`/`FORGE_STEP_ID`, `commandStepEnvironment`; only an `agent` step's own
 *   session also carries `FORGE_AGENT_ID`) -- refused outright, `GATE-510`: there is no identity here for
 *   `approval.roles`/`gates.may_approve` to check, and it is not a person at a terminal either.
 * - A marker naming `ctx.runId` and an agent id: the agent's own resolved roster entry
 *   (`readProjectAgent`) supplies `gates.may_approve`; `approverRefusal` decides from there exactly as for
 *   a human (roles, `alwaysHuman`, `may_approve`), unchanged. An agent id the roster does not recognise is
 *   `GATE-508`, carrying the underlying `RUN-056` as its cause: the marker names someone, but not someone
 *   this project's roster can actually authorise.
 * @throws {ForgeError} `GATE-510` for a bare run marker; `GATE-508` for an agent id the roster does not
 * recognise. */
async function resolveApprover(
  ctx: GateCommandContext,
  gateId: string,
  explicit?: GateApprover,
): Promise<GateApprover> {
  if (explicit !== undefined) return explicit;
  const marker = ctx.marker;
  if (marker?.runId !== ctx.runId) return { kind: 'human' };
  if (marker.agentId === undefined) {
    throw new ForgeError('GATE-510', { gateId, stepId: marker.stepId ?? marker.runId });
  }
  try {
    const agent = await readProjectAgent(ctx.paths, ctx.agentsRoot, marker.agentId);
    return { kind: 'agent', agentId: marker.agentId, mayApprove: agent.gates.may_approve };
  } catch (cause) {
    // `readProjectAgent`'s own doc comment: only a genuinely absent/unparseable/mis-named agent is
    // `RUN-056` -- any OTHER I/O failure (`EMFILE`, `EBUSY`) propagates unchanged so it stays retryable.
    // Rewrapping THOSE into this `GATE-508` too would misreport a transient I/O hiccup as "this agent
    // isn't on the roster," and defeat the very retryability `readProjectAgent` was built to preserve.
    if (!(isForgeError(cause) && cause.code === 'RUN-056')) throw cause;
    throw new ForgeError(
      'GATE-508',
      {
        gateId,
        approver: `agent ${marker.agentId}`,
        detail:
          "the session marker names an agent this project's roster does not recognise (RUN-056)",
      },
      { cause },
    );
  }
}

/** `PLAN-M14.md` P19: whether `agentId` produced evidence FOR `definition` in THIS run (`ctx.runId`) --
 * `readEvents` is itself scoped to one run, so evidence from a different run is never consulted (`10`
 * §10.3 rule 6 is a same-run rule, `approve.ts`'s own doc comment). Two independent sources, either one
 * enough:
 *  (a) a `StepStarted` whose own `agentId` (a step this run dispatched as `agentId`, `runAgentStep`/
 *      `runSwarmReviewStep`) carries `payload.gateEvidence` naming `definition.id` -- the compiled
 *      `StepNode.gateEvidence` (`plan/compile.ts`'s own `attachDependentGateEvidence`: a step's own
 *      declared `gateEvidence:` plus every `gate`-kind step that directly depends on it);
 *  (b) an `ArtifactCreated` by that same `agentId` whose own `type` one of `definition.evidence`'s own
 *      `artifact` entries names (`evidenceArtifactType`: the `Type(*)`/`Type(id)` grammar read as the
 *      name before `(`, never a wildcard match).
 * A gate with no `evidence:` of its own still refuses under (a) alone -- `evidence:` only narrows (b). */
async function agentProducedEvidenceForGate(
  ctx: GateCommandContext,
  definition: GateDefinition,
  agentId: string,
): Promise<boolean> {
  const evidenceTypes = new Set(
    (definition.evidence ?? []).map((ref) => evidenceArtifactType(ref.artifact)),
  );
  for await (const event of readEvents(ctx.projectRoot, ctx.runId)) {
    if (event.agentId !== agentId) continue;
    if (event.type === 'StepStarted') {
      const payload = event.payload;
      const gateEvidence =
        typeof payload === 'object' && payload !== null
          ? (payload as { readonly gateEvidence?: unknown }).gateEvidence
          : undefined;
      if (Array.isArray(gateEvidence) && gateEvidence.includes(definition.id)) return true;
    } else if (event.type === 'ArtifactCreated') {
      const payload = event.payload;
      const type =
        typeof payload === 'object' && payload !== null
          ? (payload as { readonly type?: unknown }).type
          : undefined;
      if (typeof type === 'string' && evidenceTypes.has(type)) return true;
    }
  }
  return false;
}

/** `[definition.id]` when `approver` is an agent who produced evidence for `definition` in this run
 * (`agentProducedEvidenceForGate`), else `[]` -- what `ApproveGateInput.producedEvidenceFor` and
 * `gateWaive`'s own identical check both consult. A human approver is never scanned for at all: `10`
 * §10.3's own rule never refuses one on this basis, whatever an agent of the same run produced. */
async function producedEvidenceForThisGate(
  ctx: GateCommandContext,
  definition: GateDefinition,
  approver: GateApprover,
): Promise<readonly string[]> {
  if (approver.kind !== 'agent') return [];
  return (await agentProducedEvidenceForGate(ctx, definition, approver.agentId))
    ? [definition.id]
    : [];
}

/** `approve <id>`: evaluates the gate, refuses unless it may be approved, and only then records `GateApproved`
 * with the evaluation as its audit trail (`10` §10.3 rules 1 and 4; `approveGate` has the reasoning).
 *
 * A failing gate is approved only under a waiver this run recorded for it (`forge gate waive`, which validated its
 * reason, owner and expiry) that has not lapsed. Nothing is appended when the approval is refused: a refusal is
 * an exit code and a typed error, not an event that could be replayed as an approval.
 * @throws {ForgeError} `GATE-507` (checks failing, no valid waiver), `GATE-508` (approver not authorised),
 * `GATE-511` (agent approver produced this run's own evidence for the gate, `PLAN-M14.md` P19),
 * `RUN-050` (unknown gate). */
export async function gateApprove(
  ctx: GateCommandContext,
  gateId: string,
  reason?: string,
  options: ApproveOptions = {},
): Promise<
  GateApprovalSummary & {
    readonly reportPath: string;
    readonly warnings: readonly DeterministicCheckResult[];
  }
> {
  const definition = await findGateOrThrow(ctx, gateId);
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  // Who may approve is decided BEFORE any check command runs: an approver the gate does not name should not be able
  // to make the project run its checks (`approveGate` decides it again for a caller that bypasses this). Includes
  // resolving WHO that is, from the real session marker (`resolveApprover`, `PLAN-M14.md` P15) -- a bare run
  // marker (a run's own command step) is refused here as `GATE-510`, before this either.
  const approver = await resolveApprover(ctx, gateId, options.approver);
  const refusal = approverRefusal(definition, approver);
  if (refusal !== undefined) {
    throw new ForgeError('GATE-508', {
      gateId,
      approver: approver.kind === 'human' ? 'human' : `agent ${approver.agentId}`,
      detail: refusal,
    });
  }
  // `PLAN-M14.md` P19, `05` §5.2 / `10` §10.3 rule 6 / `20` §20.10 S6, `SPEC-QUESTIONS.md` Q232 decision
  // 8: refused BEFORE any check command runs too, the identical "decided first" reasoning as the roles
  // check just above -- an agent that produced this run's own evidence for the gate must not be able to
  // make the project run its checks toward its own approval either. `approveGate` decides it again below
  // for a caller that bypasses this (the same "computed once, enforced twice" shape `refusal` already is).
  const producedEvidenceFor = await producedEvidenceForThisGate(ctx, definition, approver);
  if (approver.kind === 'agent' && producedEvidenceFor.includes(gateId)) {
    throw new ForgeError('GATE-511', { gateId, agentId: approver.agentId });
  }
  const evaluated = await evaluateFresh(ctx, definition);
  // Sampled AFTER the checks ran (they have no time limit): a waiver that lapsed while they ran has lapsed.
  const nowIso = clock.now();
  const now = Date.parse(nowIso);

  // A gate that passed needs no waiver, so the event log is only read when a check failed. Newest waiver first;
  // one that lapsed or is malformed (`GATE-504`/`GATE-505`), one whose own expiry exceeds the configured
  // `gates.waiverMaxDays` cap measured from its own grant (`GATE-512`, `PLAN-M14.md` P16 -- `approveGate`
  // itself, unchanged, knows nothing of the cap), or that excused other checks than the ones failing now
  // (`GATE-507`), is skipped in favour of an older one that covers them, and with none left the approval is
  // refused (`GATE-507`).
  const waivers: readonly RecordedWaiver[] = evaluated.passed
    ? []
    : await recordedWaivers(ctx, gateId);
  const maxDays = evaluated.passed ? undefined : await resolveWaiverMaxDays(ctx);
  let summary: GateApprovalSummary | undefined;
  // The waiver `approveGate` actually accepted, if any -- kept so the `GateReport` this approval writes
  // (below) reports the identical, already-validated evaluation `summary` itself describes, rather than
  // re-deriving it from a second, independent waiver-selection pass that could in principle disagree.
  let usedWaiver: Waiver | undefined;
  for (const recorded of [...waivers, undefined]) {
    try {
      if (
        recorded !== undefined &&
        maxDays !== undefined &&
        waiverExceedsCap(recorded.waiver, recorded.ts, maxDays)
      ) {
        throw new ForgeError('GATE-512', { maxDays, expiresAt: recorded.waiver.expiresAt });
      }
      summary = approveGate({
        definition,
        evaluated,
        waiver: recorded?.waiver,
        waivedCheckIds: recorded?.coveredCheckIds,
        approver,
        now,
        producedEvidenceFor,
      });
      usedWaiver = recorded?.waiver;
      break;
    } catch (error) {
      const skippable =
        recorded !== undefined &&
        error instanceof ForgeError &&
        (error.code === 'GATE-504' ||
          error.code === 'GATE-505' ||
          error.code === 'GATE-507' ||
          error.code === 'GATE-512');
      if (!skippable) throw error;
    }
  }
  if (summary === undefined) throw new ForgeError('GATE-507', { gateId, failing: 'the gate' });

  // `PLAN-M14.md` P17, `10` §10.3 rule 4: the real `GateReport` document, written BEFORE the event --
  // `usedWaiver` re-applies deterministically to the identical `(evaluated, now)` `approveGate` itself
  // just accepted it against, so this cannot throw where that did not. A write failure (`RUN-034`) or a
  // self-built-invalid document (`RangeError`) propagates unwrapped: nothing is approved without its
  // trail actually landing on disk.
  const finalReport = buildGateReport(
    definition,
    usedWaiver === undefined ? evaluated : applyWaiver(evaluated, usedWaiver, now),
  );
  const reportPath = await writeGateReportFile(ctx, definition, finalReport, nowIso);

  await emitGateEvent(ctx, 'GateApproved', gateId, {
    reason,
    approver: summary.approver,
    evaluation: summary,
    reportPath,
  });
  // `PLAN-M14.md` P20: reported alongside the approval summary, exactly as `gateCheck` does above --
  // `warn`-severity attached checks never affect approval (`approveGate` reads `evaluated.checks` only).
  return { ...summary, reportPath, warnings: evaluated.warnings };
}

/** `reject <id>`: records `GateRejected`. Rejecting needs no identity the spec holds accountable (`10`
 * §10.3 rule 6 is only about who may APPROVE), so this never refuses under the real session marker the
 * way `gateApprove`/`gateWaive` do (`PLAN-M14.md` P15) -- but a run's own bare `command` step rejecting a
 * gate (the marker `resolveApprover` itself refuses for approve/waive, `GATE-510`) is still worth naming
 * in the audit trail, the identical reason `GateApproved`/`GateWaived` already carry an `approver`. Every
 * other marker shape (none, an agent, a run id that does not match `ctx.runId`) is left unchanged: this
 * command makes no authorisation check for them, so recording "human" or "agent X" here would look like
 * one it never actually made. */
export async function gateReject(
  ctx: GateCommandContext,
  gateId: string,
  reason: string,
): Promise<void> {
  const marker = ctx.marker;
  const bareRunMarker =
    marker?.runId === ctx.runId && marker.agentId === undefined ? marker : undefined;
  await emitGateEvent(ctx, 'GateRejected', gateId, {
    reason,
    ...(bareRunMarker === undefined
      ? {}
      : { approver: `run ${bareRunMarker.runId} step ${bareRunMarker.stepId ?? ''}`.trim() }),
  });
}

export interface WaiveInput {
  readonly reason: string;
  readonly owner: string;
  readonly expiresAt: string;
}

/** `waive <id> --reason --expires`: the real `evaluateGate` → `applyWaiver` → `buildGateReport`
 * pipeline (`@forge/engine/gates`) — `10` §10.3 rule 1's own real enforcement (`GATE-504`/`GATE-505`
 * for a malformed or already-lapsed waiver), not re-implemented here, only driven — recorded as a
 * real `GateWaived` event carrying the real, validated `reason`/`owner`/`expiresAt`. */
export async function gateWaive(
  ctx: GateCommandContext,
  gateId: string,
  input: WaiveInput,
): Promise<
  GateReport & {
    readonly reportPath: string;
    readonly warnings: readonly DeterministicCheckResult[];
  }
> {
  const definition = await findGateOrThrow(ctx, gateId);
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  // A waiver is what lets a failing gate be approved, so it is held to the gate's `approval` block like the
  // approval itself (`approve.ts`): roles and quorum, before any check runs. Like `approve`, who is waiving is
  // resolved from the real session marker (`resolveApprover`, `PLAN-M14.md` P15) -- a bare run marker (a run's
  // own command step) is refused here as `GATE-510`, before any check runs either. `--owner` remains the
  // person's own word regardless of who is recorded as the approver (Q229).
  const approver = await resolveApprover(ctx, gateId);
  const refusal = approverRefusal(definition, approver);
  if (refusal !== undefined) {
    throw new ForgeError('GATE-508', {
      gateId,
      approver: approver.kind === 'human' ? 'human' : `agent ${approver.agentId}`,
      detail: refusal,
    });
  }
  // `PLAN-M14.md` P19, `SPEC-QUESTIONS.md` Q232 decision 8: applies here too -- a waiver is what lets a
  // failing gate be approved (`gateApprove`'s own comment above), so an agent that produced this run's own
  // evidence for the gate must not be able to grant itself the waiver that would let it pass either.
  // Checked before any check runs, the identical "decided first" position as the `GATE-508` refusal just
  // above it and `GATE-510` earlier still (inside `resolveApprover`). `gateWaive` never calls `approveGate`
  // at all (unlike `gateApprove`), so this direct check is the ONLY place this rule is enforced for
  // waiving; there is no second, internal check to fall back on.
  const producedEvidenceFor = await producedEvidenceForThisGate(ctx, definition, approver);
  if (approver.kind === 'agent' && producedEvidenceFor.includes(gateId)) {
    throw new ForgeError('GATE-511', { gateId, agentId: approver.agentId });
  }
  const evaluated = await evaluateFresh(ctx, definition);
  const waiver: Waiver = input;
  // A waiver excuses failing checks. On a gate that passes there is nothing to excuse, and recording one anyway
  // would be a standing waiver for whatever fails later (`10` §10.3 rule 1).
  if (evaluated.passed) throw new ForgeError('GATE-509', { gateId });
  const nowIso = clock.now();
  const now = Date.parse(nowIso);
  const waived = applyWaiver(evaluated, waiver, now);
  // `PLAN-M14.md` P16: the additional policy layer beyond applyWaiver's own shape/expiry checks above --
  // `GATE-513` for an `--owner` that is not a real identifier, `GATE-512` for an `--expires` beyond the
  // configured `gates.waiverMaxDays` cap (default 90). Nothing is appended when this throws.
  validateWaiverPolicy(waiver, now, await resolveWaiverMaxDays(ctx));

  // `PLAN-M14.md` P17, `10` §10.3 rule 4: the real `GateReport` document, written BEFORE the event -- a
  // write failure (`RUN-034`) or a self-built-invalid document (`RangeError`) propagates unwrapped, so
  // nothing is waived without its trail actually landing on disk.
  const report = buildGateReport(definition, waived);
  const reportPath = await writeGateReportFile(ctx, definition, report, nowIso);

  // The waiver and what it waived: the checks that were failing when it was granted, with the digests of their
  // output, so a later reader sees what was excused and not only that something was (`10` §10.3 rule 1: waivers
  // "appear in every report until resolved").
  await emitGateEvent(ctx, 'GateWaived', gateId, {
    reason: input.reason,
    owner: input.owner,
    expiresAt: input.expiresAt,
    evaluation: {
      passed: evaluated.passed,
      checks: recordChecks(evaluated, !evaluated.passed),
    },
    reportPath,
  });

  // `PLAN-M14.md` P20: reported alongside the waiver's own report, the identical "the evaluation this
  // call actually ran" data `gateCheck`/`gateApprove` both carry too.
  return { ...report, reportPath, warnings: evaluated.warnings };
}
