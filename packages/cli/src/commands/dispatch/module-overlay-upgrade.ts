/**
 * `commands/dispatch/module-overlay-upgrade.ts` — `forge module <add|remove|update>`/`forge overlay
 * add`/`forge upgrade` (`19` §19.5, `03` §3.2.8/§3.4, `PLAN-M12.md` P2). Grouped as one file because
 * the original `bin.ts` groups them under one doc comment banner ("`module`/`overlay`/`upgrade`/
 * `export`/`doctor`/`audit`/`config`/`cost`/`uninstall`") AND, more concretely, `module`/`overlay`
 * share `buildInstallOptions`/`printInstallChangeReport`/`sanitizeInstallChangeReportForDisplay`
 * (both call the identical `@forge/extensions/install` consent/fetch pipeline), while `upgrade`
 * shares `defaultNonInteractiveConflictMode` and the degraded-adapter path (`buildAdapterForDiagnostics`)
 * with `forge init`/`forge doctor`. `export`/`doctor`/`audit`/`config`/`cost`/`uninstall` are split
 * out into `workspace.ts`/`lifecycle.ts` — see those files' own top doc comments for the DECISION.
 *
 * `runUpgradeCommand`'s own `.gitignore` preview (`printUpgradePlanPreview`'s sibling block,
 * `specs/22` M17 P13 defect #21a) lives here, unchanged from the real current `bin.ts`.
 *
 * @see specs/22 M17 P2
 * @see specs/22 M17 P13
 */
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';

import {
  moduleAdd,
  moduleRemove,
  moduleUpdate,
  type InstallChangeReport,
  type InstallOptions,
  type ModuleCommandContext,
} from '../module.ts';
import { overlayAdd, type OverlayCommandContext } from '../overlay.ts';
import { runUpgrade } from '../upgrade/index.ts';
import { readPackageVersion } from '../../init/package-root.ts';
import {
  CONFLICT_RESOLUTION_MODES,
  sanitizeForTerminal,
  sanitizeWrittenFilePaths,
  type ConflictResolutionMode,
} from '../../generated-header.ts';
import { createSystemTempPath } from '../loop/test/system-temp.ts';
import { readConfig } from '../config.ts';
import {
  buildAdapterForDiagnostics,
  defaultNonInteractiveConflictMode,
  parseCommandFlags,
  realEnvSnapshot,
  realProcessVersion,
  resolveModulesDir,
  SPECS_ROOT,
  stripControlChars,
  type DispatchContext,
} from './shared.ts';

/** Applies `stripControlChars` to every real, untrusted free-text field an `InstallChangeReport`
 * carries — `id`/`version`/`resolvedSetDelta` are all schema- or pattern-validated upstream and need
 * no sanitizing; only `newGrants`/`warnings` are unconstrained free text a hostile bundle author
 * controls directly. */
function sanitizeInstallChangeReportForDisplay(report: InstallChangeReport): InstallChangeReport {
  return {
    ...report,
    newGrants: report.newGrants.map(stripControlChars),
    warnings: report.warnings.map(stripControlChars),
  };
}

/** A real, human-readable rendering of one `moduleAdd`/`moduleRemove`/`moduleUpdate`/`overlayAdd`
 * outcome — the identical fields `--json` mode reports verbatim. Takes an already-sanitized report —
 * never sanitizes its own input. */
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

/** A fresh, real `InstallOptions` for one `module`/`overlay` command invocation — `workDir` is a
 * real, process-unique scratch path a git/npm-channel fetch needs; the local channel never touches
 * it. `consent.yes` mirrors the global `--yes` flag exactly like every other destructive real
 * operation in this dispatcher. */
function buildInstallOptions(projectRoot: string, yes: boolean, json: boolean): InstallOptions {
  return {
    workDir: createSystemTempPath('forge-install'),
    npmCwd: projectRoot,
    forgeVersion: readPackageVersion('@forge/agents'),
    consent: { yes, json },
  };
}

/** `forge module <add|remove|update>` (`19` §19.5, `03` §3.2.8) — `list`/`info` are real,
 * already-tested functions this piece's own mandate does not name; disclosed as still-unwired. */
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
 * `doctor`/`eject` are real `03` §3.2.8 rows this piece's own mandate does not name. */
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
const VALID_CONFLICT_MODES = new Set<string>(CONFLICT_RESOLUTION_MODES);

/** `PLAN-M14.md` P43: how many `staleFiles`/`editedFiles`/`missingFiles` paths the plain-text
 * renderer prints per category before summarising the rest as a count — `--json` always carries the
 * real, complete arrays, never truncated. */
const UPGRADE_PLAN_PREVIEW_LIMIT = 5;

/** `forge upgrade [--to <version>] [--on-conflict <mode>]` (`03` §3.4). `--dry-run` is already a
 * real global flag, so it never reaches `rest` here. */
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
      ...(json ? { conflictOutput: process.stderr } : {}),
    },
  );
  const sanitizedRegeneratedFiles =
    report.regeneratedFiles === undefined
      ? undefined
      : sanitizeWrittenFilePaths(report.regeneratedFiles);
  const sanitizedStaleFiles = report.staleFiles.map(sanitizeForTerminal);
  const sanitizedEditedFiles = report.editedFiles.map(sanitizeForTerminal);
  const sanitizedMissingFiles = report.missingFiles.map(sanitizeForTerminal);
  // `specs/22` M17 P13 (defect #21a): `GITIGNORE_ENTRIES` is a fixed, compile-time literal list,
  // never project-controlled input the way `staleFiles`/`missingFiles` paths are — sanitizing it
  // anyway matches this function's own established belt-and-suspenders choice for the other three.
  const sanitizedGitignoreEntriesAdded = report.gitignoreEntriesAdded.map(sanitizeForTerminal);
  if (json) {
    const sanitizedReport = {
      ...report,
      ...(sanitizedRegeneratedFiles === undefined
        ? {}
        : { regeneratedFiles: sanitizedRegeneratedFiles }),
      staleFiles: sanitizedStaleFiles,
      editedFiles: sanitizedEditedFiles,
      missingFiles: sanitizedMissingFiles,
      gitignoreEntriesAdded: sanitizedGitignoreEntriesAdded,
    };
    console.log(JSON.stringify({ v: 1, report: sanitizedReport }));
  } else {
    console.log(
      `forge upgrade${dryRun ? ' --dry-run' : ''}: ${report.installedVersion} -> ` +
        `${report.targetVersion} (${String(report.migratedDocuments.length)} documents checked).`,
    );
    const conflicts = (sanitizedRegeneratedFiles ?? []).filter(
      (file) => file.conflict !== undefined,
    );
    if (conflicts.length > 0) {
      console.log(`  resolved ${String(conflicts.length)} conflict(s):`);
      for (const file of conflicts) console.log(`    ${file.path}: ${file.conflict ?? ''}`);
    }
    if (
      sanitizedStaleFiles.length > 0 ||
      sanitizedEditedFiles.length > 0 ||
      sanitizedMissingFiles.length > 0
    ) {
      console.log(
        `  ${String(sanitizedStaleFiles.length)} stale, ${String(sanitizedEditedFiles.length)} ` +
          `edited, ${String(sanitizedMissingFiles.length)} missing (of the materialised regenerable ` +
          'files):',
      );
      printUpgradePlanPreview('stale', sanitizedStaleFiles);
      printUpgradePlanPreview('edited', sanitizedEditedFiles);
      printUpgradePlanPreview('missing', sanitizedMissingFiles);
    }
    // `specs/22` M17 P13 (defect #21a): `.gitignore` is a merged, hand-owned file, never one of the
    // "materialised regenerable files" the summary line above describes, so it gets its own line.
    if (sanitizedGitignoreEntriesAdded.length > 0) {
      const verb = dryRun ? 'would merge' : 'merged';
      console.log(
        `  ${verb} ${String(sanitizedGitignoreEntriesAdded.length)} new ` +
          `entr${sanitizedGitignoreEntriesAdded.length === 1 ? 'y' : 'ies'} into .gitignore:`,
      );
      for (const entry of sanitizedGitignoreEntriesAdded.slice(0, UPGRADE_PLAN_PREVIEW_LIMIT)) {
        console.log(`    gitignore: ${entry}`);
      }
      if (sanitizedGitignoreEntriesAdded.length > UPGRADE_PLAN_PREVIEW_LIMIT) {
        console.log(
          `    ... and ${String(sanitizedGitignoreEntriesAdded.length - UPGRADE_PLAN_PREVIEW_LIMIT)} ` +
            'more gitignore entry/entries.',
        );
      }
    }
  }
  return report.doctor?.ok === false ? EXIT_CODES.prerequisiteMissing : EXIT_CODES.success;
}

/** `runUpgradeCommand`'s own plain-text helper for one of `staleFiles`/`editedFiles`/`missingFiles`:
 * the first `UPGRADE_PLAN_PREVIEW_LIMIT` real paths, one per line, then a real count of however many
 * more there are. */
function printUpgradePlanPreview(
  label: 'stale' | 'edited' | 'missing',
  paths: readonly string[],
): void {
  for (const filePath of paths.slice(0, UPGRADE_PLAN_PREVIEW_LIMIT)) {
    console.log(`    ${label}: ${filePath}`);
  }
  if (paths.length > UPGRADE_PLAN_PREVIEW_LIMIT) {
    console.log(
      `    ... and ${String(paths.length - UPGRADE_PLAN_PREVIEW_LIMIT)} more ${label} file(s).`,
    );
  }
}

/**
 * Dispatches `forge module`/`forge overlay`/`forge upgrade`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchModuleOverlayUpgrade(
  ctx: DispatchContext,
): Promise<number | undefined> {
  const [command] = ctx.positionals;
  const afterCommand = ctx.positionals.slice(1);
  const { paths, projectRoot, flags } = ctx;

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
  return undefined;
}
