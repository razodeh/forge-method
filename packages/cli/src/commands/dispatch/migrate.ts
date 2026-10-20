/**
 * `commands/dispatch/migrate.ts` — `forge migrate run --phase <expand|migrate|contract> [--migration
 * <id>] [--json]` (`03` §3.2.5, `specs/22` M17 P18, #14).
 *
 * **DECISION.** `forge migrate run` is the newest real addition with no obvious home in the original
 * 17-file placement map (it did not exist when that map's own investigation ran). The piece brief
 * left the choice between folding it into `test-run.ts` or giving it a dedicated `migrate.ts` to this
 * builder. Given its own dedicated file: `migrate run` shares nothing behavioural with `test run`
 * beyond both being `forge <noun> run` in shape — no helper, flag parser, or type is shared between
 * them — and folding it into `test-run.ts` would make that file's own name misleading (it would then
 * cover an area with no "test" in it at all). A dedicated, one-command file costs one extra entry in
 * `commands/dispatch/index.ts`'s own chain and keeps every other file's own name accurate.
 *
 * @see specs/22 M17 P2
 * @see specs/22 M17 P18
 */
import { ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';

import { isMigratePhase, migrateRun } from '../migrate/run.ts';
import { buildSpecContext } from './spec.ts';
import { assertNoArgs, parseCommandFlags, type DispatchContext } from './shared.ts';

/** `forge migrate run --phase <expand|migrate|contract> [--migration <id>] [--json]` — the CLI
 * dispatch wrapper around the library call `migrateRun` (`commands/migrate/run.ts`), the identical
 * "validate the usage shape here, return a plain result there" split `test run` already establishes.
 * `--phase` missing or not one of `MIGRATE_PHASES`, and `--migration <id>` naming no entry of that
 * phase, are both a typed `ForgeError('USR-006', ...)`. */
async function runMigrateRunCommand(
  paths: ProjectPaths,
  projectRoot: string,
  phaseRaw: string | undefined,
  migration: string | undefined,
  json: boolean,
): Promise<number> {
  if (phaseRaw === undefined) {
    throw new ForgeError('USR-006', { value: '', reason: 'missing-phase' });
  }
  if (!isMigratePhase(phaseRaw)) {
    throw new ForgeError('USR-006', { value: phaseRaw, reason: 'bad-phase' });
  }
  const ctx = buildSpecContext(paths);
  const outcome = await migrateRun(ctx, projectRoot, {
    phase: phaseRaw,
    ...(migration === undefined ? {} : { migration }),
  });
  if (outcome.kind === 'unknown-migration') {
    throw new ForgeError('USR-006', { value: migration ?? '', reason: 'unknown-migration' });
  }
  const { result } = outcome;
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else if ((result.problems ?? []).length > 0) {
    for (const problem of result.problems ?? []) console.error(problem);
  } else {
    console.log(
      `forge migrate run --phase ${result.phase}: applied=${String(result.applied.length)} ` +
        `failed=${String(result.failed)} errors=${String(result.errors)}.`,
    );
  }
  return result.failed > 0 || result.errors > 0 ? 1 : 0;
}

/**
 * Dispatches `forge migrate run`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchMigrate(ctx: DispatchContext): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const { paths, projectRoot, flags } = ctx;
  if (command !== 'migrate' || sub !== 'run') return undefined;

  const { values, positionals } = parseCommandFlags(rest, {
    '--phase': true,
    '--migration': true,
  });
  assertNoArgs(positionals);
  return runMigrateRunCommand(
    paths,
    projectRoot,
    values.get('--phase'),
    values.get('--migration'),
    flags.json,
  );
}
