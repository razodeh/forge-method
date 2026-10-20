/**
 * `commands/dispatch/customize-and-compile.ts` — `forge customize`/`forge compile [--check]
 * --sources <path>` (`03` §3.2.8). Two small, related commands sharing one file, following this
 * piece's own `<area1>-and-<area2>.ts` naming pattern: both are real, disclosed-gap "no automatic
 * project-content-gathering mechanism exists yet" commands grouped together in the original
 * `bin.ts`'s own section banner, and neither shares a real helper with any other area.
 *
 * @see specs/22 M17 P2
 */
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';
import type { CompileOptions, CompileSources } from '@forge/extensions/compile';

import { customize } from '../customize.ts';
import { forgeCompile } from '../compile.ts';
import { assertNoArgs, parseCommandFlags, type DispatchContext } from './shared.ts';

function runCustomizeCommand(args: readonly string[]): number {
  assertNoArgs(args);
  return customize();
}

const COMPILE_FLAGS = { '--check': false, '--sources': true } as const;

/** `forge compile [--check] --sources <path>` — `compile.ts`'s own doc comment names the real,
 * disclosed gap this wiring works within: no "gather this project's own real customization-layer
 * sources at runtime" resolver exists anywhere in this codebase, so `sources` is read from a real,
 * caller-supplied JSON file rather than fabricated by this dispatcher. */
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

/**
 * Dispatches `forge customize`/`forge compile`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchCustomizeAndCompile(
  ctx: DispatchContext,
): Promise<number | undefined> {
  const [command] = ctx.positionals;
  const afterCommand = ctx.positionals.slice(1);
  const { paths, flags } = ctx;

  if (command === 'customize') {
    return runCustomizeCommand(afterCommand);
  }
  if (command === 'compile') {
    return runCompileCommand(paths, afterCommand, flags.json);
  }
  return undefined;
}
