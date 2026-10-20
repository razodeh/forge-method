/**
 * `forge` — this package's real entry point. The real argv dispatcher itself lives in
 * `commands/dispatch/index.ts`: this file is now a thin, ~56-line wrapper around it, holding only
 * what genuinely cannot move — reading `process.argv`, awaiting {@link main}, and the one
 * top-level refusal/crash catch that sets `process.exitCode` and prints the `--json` envelope.
 *
 * **`specs/22` M17 P2's own real mandate is "CI green: `bin.ts` coverage, and the whole suite as
 * the bar," not a cosmetic refactor** (`PLAN-M17.md` P2; `M16`'s own exit tests were never actually
 * complete — `pnpm test` with `--coverage` was red because this file's own 6,041 lines had 0%
 * in-process coverage, v8 coverage cannot see into a spawned child process regardless of how
 * thoroughly the real, subprocess-based `bin*.test.ts` suite exercises it). This file is excluded
 * from coverage measurement in `vitest.config.ts` for exactly that reason, on the same "thin
 * wrapper, no real decision logic left" basis the `scripts/*.mjs` entries there already use — the
 * real decision logic this split moved out, unchanged, into `commands/dispatch/*.ts`, which v8
 * CAN see, and which the ~18 area/infra files under that directory now carry real, substantial
 * in-process test coverage for (`packages/cli/test/commands/dispatch/`). Re-inlining any one of
 * those dispatch modules back into this file would make its coverage disappear again, for the
 * identical reason — a mutation experiment that was deliberately run and reverted to prove exactly
 * that, during this piece's own build.
 *
 * Before M17 P2, this file was a 6,041-line monolith: every command's own flag parsing, dependency
 * building, and output rendering lived here directly, alongside the dispatch `if`/`else if` chain
 * itself. That logic is unchanged — moved, not rewritten — into `commands/dispatch/*.ts`, one file
 * per command area; see `commands/dispatch/index.ts`'s own doc comment for the real design (each area
 * file exports a `dispatchX` function tried in sequence) and `process/GAUNTLET-LOG.md`'s own `M17 P2`
 * entry for the full placement map and every DECISION this extraction made.
 *
 * Every command, flag, and error path this dispatcher answers is documented in full on
 * `commands/dispatch/index.ts` and the ~17 area files it assembles — not repeated here, so this one
 * doc comment never has to be kept in sync with seventeen others as new commands land.
 *
 * @see specs/22 M6
 * @see specs/22 M8
 * @see specs/22 M12
 * @see specs/22 M17 P2
 * @see PLAN-M6.md C9
 * @see PLAN-M8.md P2
 * @see PLAN-M8.md P4
 * @see PLAN-M12.md P1
 * @see PLAN-M12.md P2
 * @see PLAN-M12.md P4
 */
import { refusalEnvelopeLine, refusalOf } from './commands/run/vcs-refusal.ts';
import { main } from './commands/dispatch/index.ts';

// `--json` is read from argv here, not from `parseGlobalFlags`' result: a refusal thrown while
// parsing the flags (`USR-002`) is one too, and its reader asked for JSON.
const jsonRequested = process.argv
  .slice(2)
  .some((arg) => arg === '--json' || arg.startsWith('--json='));

try {
  process.exitCode = await main();
} catch (error) {
  // A refusal (a `ForgeError`, a `VcsError`, another package's coded error) prints its message and
  // remedy on stderr and exits with its own code; under `--json` stdout also gets the one-line
  // `{v:1, ok:false, error}` envelope (`PLAN-M13.md` P21; the dirty-tree refusal is the one P12 left
  // as plain text). Anything else is a crash and keeps its stack, with no envelope.
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
