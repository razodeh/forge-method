/**
 * `commands/dispatch/init.ts` — `forge init [dir] [--name <name>] [--yes] [--on-conflict <mode>]`
 * (`03` §3.3, `PLAN-M12.md` P1/P3, `PLAN-M13.md` P12). Dispatched specially by
 * `commands/dispatch/index.ts`'s own `main()`, BEFORE `ProjectPaths` is ever constructed — `init`
 * creates the project, and that constructor resolves the root against the real file system, so it
 * cannot be given a directory that does not exist yet (a fresh `-C <new dir>`).
 *
 * @see specs/22 M17 P2
 */
import path from 'node:path';

import { EXIT_CODES, ForgeError } from '@forge/core/errors';

import { parseInitFlags } from '../../init/parse-init-flags.ts';
import { formatUnmappedTierWarnings, sanitizeOneLine } from '../../init/tier-map.ts';
import { runInit } from '../../init/run-init.ts';
import { sanitizeWrittenFilePaths } from '../../generated-header.ts';
import {
  buildCandidateAdapters,
  defaultNonInteractiveConflictMode,
  realEnvSnapshot,
  resolveModulesDir,
} from './shared.ts';

/** `forge init` dispatch wrapper — `02` §3.3. */
export async function runInitCommand(
  initArgs: readonly string[],
  yes: boolean,
  json: boolean,
  project: string | undefined,
): Promise<number> {
  const { dir: requestedDir, options } = parseInitFlags(initArgs, yes);
  // `03` §3.2: `--project, -C <path>` — "Operate on this project root", default the current directory. For
  // `forge init [dir]` the target is `[dir]` resolved against that root, so `-C <path>` alone initialises
  // `<path>`, and `-C <base> <dir>` initialises `<base>/<dir>`.
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
      // stderr." An explicit `--on-conflict show-diff` combined with `--json` would otherwise land
      // human-oriented diff text on `process.stdout` ahead of this function's own single JSON line.
      ...(json ? { conflictOutput: process.stderr } : {}),
    },
  );
  // Sanitized once, reused by both renderers below — `sanitizeWrittenFilePaths` (`generated-header.ts`)
  // is the one, single, directly unit-tested real call site.
  const sanitizedFiles = sanitizeWrittenFilePaths(result.files);
  if (json) {
    console.log(JSON.stringify({ v: 1, result: { ...result, files: sanitizedFiles } }));
  } else if (result.kind === 'reinitialized') {
    // `03` §3.3's own idempotency rule ("MUST detect it and switch to upgrade semantics").
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
