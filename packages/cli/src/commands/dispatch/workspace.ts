/**
 * `commands/dispatch/workspace.ts` — the project-operation commands `PLAN-M12.md` P2's own doc
 * comment groups alongside `module`/`overlay`/`upgrade`/`doctor`: `forge export <target>`, `forge
 * audit [--since <date>]`, `forge config <get|set|edit>`, `forge cost`, `forge report
 * [--since]/[--baseline]`, `forge uninstall`. Split from `module-overlay-upgrade.ts`/`lifecycle.ts`
 * as its own file — a DECISION: those two files' own real cross-cutting dependencies
 * (`buildInstallOptions`/consent for module/overlay/upgrade; `buildAdapterForDiagnostics` for
 * doctor/upgrade) are not shared by any command in this file, so grouping them together would mean
 * importing unused machinery into every one of these six otherwise-independent, small commands.
 *
 * @see specs/22 M17 P2
 */
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import { SYSTEM_CLOCK } from '@forge/core';

import {
  configEdit,
  configGet,
  configSet,
  readConfig,
  type ConfigCommandContext,
} from '../config.ts';
import { auditReport, formatAuditReport, type AuditCommandContext } from '../audit.ts';
import { costReport, type CostCommandContext } from '../cost.ts';
import {
  exportHtml,
  exportMarkdownBundle,
  exportThirdParty,
  type ExportCommandContext,
} from '../export.ts';
import { buildReport, writeBaseline, type ReportCommandContext } from '../report.ts';
import { uninstall } from '../uninstall.ts';
import {
  gateCommandMarker,
  KB_ROOT,
  parseCommandFlags,
  realEnvSnapshot,
  SPECS_ROOT,
  type DispatchContext,
} from './shared.ts';

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
  // `exportThirdParty` is typed `never` (it always throws) — an explicit `return`, not a bare
  // statement, makes this function's own reliance on that contract visible at the call site.
  return exportThirdParty(target);
}

const AUDIT_FLAGS = { '--since': true } as const;

/** `forge audit [--since <date>] [--json]` (`20` §20.9) — a thin CLI layer over `auditReport`'s own
 * already-real query/format pipeline; `parseSince`'s own `USR-002` validation is what actually
 * rejects a malformed `--since` value. */
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
 * this piece's own mandate does not name; disclosed as still-unwired. */
async function runConfigCommand(
  paths: ProjectPaths,
  projectRoot: string,
  sub: string | undefined,
  rest: readonly string[],
  json: boolean,
): Promise<number> {
  const ctx: ConfigCommandContext = { paths, projectRoot };
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
    const { positionals, flags: setFlags } = parseCommandFlags(rest, { '--commit': false });
    const [key, value] = positionals;
    if (key === undefined || value === undefined || positionals.length > 2) {
      console.error('forge: "config set" needs a real <key> <value>.');
      return EXIT_CODES.usage;
    }
    const commit = setFlags.has('--commit');
    // The real FORGE run/step marker (`PLAN-M14.md` P37): absent for a human's own shell, real
    // inside a run-spawned `command` step — read only for `--commit`, the one branch that uses it.
    const marker = commit ? gateCommandMarker(realEnvSnapshot()) : undefined;
    const commitCtx: ConfigCommandContext = marker === undefined ? ctx : { ...ctx, marker };
    const { committed } = await configSet(commitCtx, key, value, { commit });
    // `configSet` real-YAML-parses `value` before writing; echoing the raw, unparsed `value` string
    // here would make `config set --json`'s own `value` field disagree in *type* with the identical
    // key's `config get --json` field for the same stored data. Reading the real, just-written value
    // back via `configGet` reports what is genuinely on disk, not a second, independently-derived guess.
    const stored = await configGet(ctx, key);
    console.log(
      json
        ? JSON.stringify({ v: 1, key, value: stored, committed })
        : `forge config set ${key}: ${JSON.stringify(stored)}.`,
    );
    return EXIT_CODES.success;
  }
  if (sub === 'edit') {
    const { positionals } = parseCommandFlags(rest, {});
    if (positionals.length > 0) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
    }
    // `configEdit` is typed `never` (it always throws) — see `runExportCommand`'s identical
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
 * real run this project has ever executed, with no per-run or per-date scoping mechanism at all —
 * both flags are real, disclosed gaps refused honestly here, rather than this dispatcher inventing a
 * filtering mechanism `costReport` itself does not have. */
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

/** Byte-for-byte the same validation `commands/audit.ts`'s own private `parseSince`/`SINCE_PATTERN`
 * already is — a SECOND copy, not an import, since `audit.ts` keeps it module-private. */
const REPORT_SINCE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

function parseReportSince(raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;
  if (!REPORT_SINCE_PATTERN.test(raw)) {
    throw new ForgeError('USR-002', { flag: '--since', value: raw });
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ForgeError('USR-002', { flag: '--since', value: raw });
  }
  return parsed;
}

const REPORT_FLAGS = { '--since': true, '--baseline': false } as const;

/** `forge report [--since <when>] [--baseline] [--json]` (`specs/22` M15 P12) — a thin CLI layer
 * over `report.ts`'s own real `buildReport`/`writeBaseline`/`readBaseline`. `--baseline` writes a
 * fresh snapshot and prints it back, rather than a second, separate `--show-baseline` verb. */
async function runReportCommand(
  paths: ProjectPaths,
  projectRoot: string,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { values, flags, positionals } = parseCommandFlags(args, REPORT_FLAGS);
  if (positionals.length > 0) {
    throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[0] ?? '' });
  }
  const baseline = flags.has('--baseline');
  if (baseline && values.has('--since')) {
    throw new ForgeError('USR-002', {
      flag: '--baseline',
      value: `${values.get('--since') ?? ''} (cannot be combined with --since -- a baseline is always the current, unfiltered scorecard)`,
    });
  }
  const since = parseReportSince(values.get('--since'));
  const config = await readConfig(paths);
  const ctx: ReportCommandContext = {
    paths,
    projectRoot,
    reportsRoot: config.paths.reports,
    clock: SYSTEM_CLOCK,
  };
  if (baseline) {
    const snapshot = await writeBaseline(ctx);
    console.log(
      json
        ? JSON.stringify({ v: 1, baseline: snapshot })
        : `forge report --baseline: captured at ${snapshot.capturedAt} (commit ${snapshot.commit ?? '(none)'}).`,
    );
    return EXIT_CODES.success;
  }
  const report = await buildReport(ctx, since === undefined ? {} : { since });
  // `specs/22` M16 P15: `parity`/`hunks` are pushed ONLY when the scorecard actually carries them.
  const lines = [
    `forge report: binding ${String(report.binding.passingCount)}/${String(report.binding.totalCount)} (${(report.binding.passRate * 100).toFixed(0)}%)`,
    `  critic loop: ${String(report.criticLoop.roundsConsumed)} round(s) consumed, ${String(report.criticLoop.stopAndDiscloseCount)} stop-and-disclose`,
    `  gates: ${String(report.gates.pairsWithCleanFirstPass)}/${String(report.gates.pairsEvaluated)} clean first pass, ${String(report.gates.totalRejectionsBeforeFirstPass)} rejection(s) total`,
    `  exemptions: ${String(report.exemptions.opened)} opened, ${String(report.exemptions.expiredIds.length)} expired`,
    `  cost: $${report.cost.totalUsd.toFixed(2)} across ${String(report.cost.byStory.length)} stor(y/ies)`,
    `  kb reads: ${String(report.kbReads.precededByKbRead)}/${String(report.kbReads.artifactsCreated)} artifacts preceded by a real KB read (${(report.kbReads.rate * 100).toFixed(0)}%)`,
  ];
  if (report.parity !== undefined) {
    lines.push(
      `  parity: ${String(report.parity.verdictCounts.match)}/${String(report.parity.totalDeclarations)} declarations matched (${(report.parity.passRate * 100).toFixed(0)}%) across ${String(report.parity.checksRun)} check(s)`,
    );
  }
  if (report.hunks !== undefined) {
    lines.push(
      `  hunks: ${String(report.hunks.killedHunks)} killed, ${String(report.hunks.uncoveredHunks)} uncovered, ${String(report.hunks.invalidHunks)} invalid, ${String(report.hunks.timeoutHunks)} timeout, ${String(report.hunks.skippedHunks)} skipped (${String(report.hunks.checksRun)} --hunks run(s))`,
    );
  }
  console.log(json ? JSON.stringify({ v: 1, report }) : lines.join('\n'));
  return EXIT_CODES.success;
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

/**
 * Dispatches `forge export`/`audit`/`config`/`cost`/`report`/`uninstall`. `undefined` for every
 * other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchWorkspace(ctx: DispatchContext): Promise<number | undefined> {
  const [command] = ctx.positionals;
  const afterCommand = ctx.positionals.slice(1);
  const { paths, projectRoot, flags } = ctx;

  if (command === 'export') {
    return runExportCommand(paths, afterCommand, flags.json);
  }
  if (command === 'audit') {
    return runAuditCommand(projectRoot, afterCommand, flags.json);
  }
  if (command === 'config') {
    const [configSub, ...configRest] = afterCommand;
    return runConfigCommand(paths, projectRoot, configSub, configRest, flags.json);
  }
  if (command === 'cost') {
    return runCostCommand(paths, projectRoot, afterCommand, flags.json);
  }
  if (command === 'report') {
    return runReportCommand(paths, projectRoot, afterCommand, flags.json);
  }
  if (command === 'uninstall') {
    return runUninstallCommand(paths, projectRoot, afterCommand, flags.yes, flags.json);
  }
  return undefined;
}
