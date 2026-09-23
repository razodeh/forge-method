/**
 * `forge gate <list|check|approve|reject|waive>` — `03` §3.2.4.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.3
 */
import {
  ArtifactDocument,
  ForgeError,
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
  recordChecks,
  renderGateReportFile,
  validateWaiverPolicy,
  waiverExceedsCap,
  type GateApprovalSummary,
  type GateApprover,
  type GateDefinition,
  type GateEvaluationResult,
  type GateReport,
  type Waiver,
} from '@forge/engine/gates';
import { documentProblems, GateNotFoundError, runShellCommand } from '@forge/engine/dispatch';
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
  readonly runId: string;
  readonly clock?: Clock;
  /** The environment overlay a check command runs with: `PATH` with the launcher shim first, so a gate's
   * `forge ...` check runs THIS `forge` (the one that is executing, wherever it was launched from) exactly as it
   * does inside a run (`createGateEvaluator`'s `env`, `PLAN-M13.md` P12). Absent: the caller's own `PATH`. */
  readonly commandEnv?: Readonly<Record<string, string>> | undefined;
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
): Promise<GateReport & { readonly reportPath: string }> {
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
  return { ...report, reportPath };
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
 * `PLAN-M13.md` P35, and the stderr the audit trail now keeps, `P41`), then the real `GateReport` document this
 * evaluation just wrote (`PLAN-M14.md` P17) — `reportPath` optional so a caller that hand-builds a `GateReport`
 * without one (a test fixture) still formats. A check whose own `failOn` tripped has no `reason`: the finding is
 * in its output, so the first line of that is shown instead. */
export function formatGateReport(report: GateReport & { readonly reportPath?: string }): string {
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
  /** Who approves. `forge gate approve` is a person at a terminal, so the CLI passes nothing and this is
   * `{ kind: 'human' }`: the CLI cannot tell an agent that ran the command from a person (`approve.ts` says why,
   * and `SPEC-QUESTIONS.md` Q229 records it). A caller that CAN authenticate an agent passes it here, and the
   * gate's `approval.roles`, `alwaysHuman` and the agent's `gates.may_approve` are enforced for it. */
  readonly approver?: GateApprover;
}

/** `approve <id>`: evaluates the gate, refuses unless it may be approved, and only then records `GateApproved`
 * with the evaluation as its audit trail (`10` §10.3 rules 1 and 4; `approveGate` has the reasoning).
 *
 * A failing gate is approved only under a waiver this run recorded for it (`forge gate waive`, which validated its
 * reason, owner and expiry) that has not lapsed. Nothing is appended when the approval is refused: a refusal is
 * an exit code and a typed error, not an event that could be replayed as an approval.
 * @throws {ForgeError} `GATE-507` (checks failing, no valid waiver), `GATE-508` (approver not authorised),
 * `RUN-050` (unknown gate). */
export async function gateApprove(
  ctx: GateCommandContext,
  gateId: string,
  reason?: string,
  options: ApproveOptions = {},
): Promise<GateApprovalSummary & { readonly reportPath: string }> {
  const definition = await findGateOrThrow(ctx, gateId);
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const approver = options.approver ?? { kind: 'human' };
  // Who may approve is decided BEFORE any check command runs: an approver the gate does not name should not be able
  // to make the project run its checks (`approveGate` decides it again for a caller that bypasses this).
  const refusal = approverRefusal(definition, approver);
  if (refusal !== undefined) {
    throw new ForgeError('GATE-508', {
      gateId,
      approver: approver.kind === 'human' ? 'human' : `agent ${approver.agentId}`,
      detail: refusal,
    });
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
  return { ...summary, reportPath };
}

export async function gateReject(
  ctx: GateCommandContext,
  gateId: string,
  reason: string,
): Promise<void> {
  await emitGateEvent(ctx, 'GateRejected', gateId, { reason });
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
): Promise<GateReport & { readonly reportPath: string }> {
  const definition = await findGateOrThrow(ctx, gateId);
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  // A waiver is what lets a failing gate be approved, so it is held to the gate's `approval` block like the
  // approval itself (`approve.ts`): roles and quorum, before any check runs. Like `approve` it cannot tell an
  // agent that runs the command from a person, and `--owner` is the person's own word (Q229).
  const refusal = approverRefusal(definition, { kind: 'human' });
  if (refusal !== undefined) {
    throw new ForgeError('GATE-508', { gateId, approver: 'human', detail: refusal });
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

  return { ...report, reportPath };
}
