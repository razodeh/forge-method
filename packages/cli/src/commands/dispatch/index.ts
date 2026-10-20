/**
 * `commands/dispatch/index.ts` — `forge`'s real argv dispatcher, assembled from the ~17 per-area
 * files under this directory. `bin.ts` itself is now a thin ~56-line entry point that imports
 * {@link main} from here and handles only process-level argv/exit-code wiring that cannot move
 * (reading `process.argv`, setting `process.exitCode`, the top-level refusal/crash catch).
 *
 * **This is not a cosmetic refactor — `specs/22` M17 P2's own real mandate (`PLAN-M17.md` P2) is
 * "CI green: `bin.ts` coverage, and the whole suite as the bar."** `M16`'s own exit tests were
 * never actually complete: `pnpm test` (the real CI gate, coverage included) was red because the
 * former 6,041-line `bin.ts` monolith had 0% in-process coverage — every `bin*.test.ts` test drives
 * the real CLI as a SPAWNED SUBPROCESS, which v8 coverage in the parent test process cannot see
 * into at all, no matter how thoroughly that subprocess's own behaviour is exercised and asserted
 * against. Splitting the monolith into these importable `dispatchX` modules (behaviour-preserving;
 * zero logic changed) is what makes v8 coverage able to see this logic run at all — but the split
 * alone does not raise a single number: every one of these ~18 area/infra files also needed real,
 * substantial, genuinely NEW in-process tests of its own (`packages/cli/test/commands/dispatch/`),
 * written as part of this same piece, since the pre-existing subprocess suite contributes exactly
 * zero in-process coverage credit regardless of how comprehensive it already was. `bin.ts` is
 * excluded from coverage measurement in `vitest.config.ts` (the same "thin wrapper" basis the
 * `scripts/*.mjs` entries there already use) — a dispatch module re-inlined back into it would lose
 * its coverage again for the identical reason, which a deliberate, reverted mutation experiment
 * confirmed directly during this piece's own build.
 *
 * **Design.** Every area file exports one `dispatchX(ctx: DispatchContext): Promise<number |
 * undefined>` function: `undefined` means "this command/sub pair is not mine," `number` is the
 * final exit code. `main()` below tries each in sequence and returns the first defined result — the
 * original monolithic `if`/`else if` chain's own real command tokens are mutually exclusive across
 * every area (confirmed by reading the whole of the original `bin.ts`: no two areas ever handle the
 * identical `command`/`sub` pair), so trying them in any order reproduces the original dispatch
 * exactly. `init` and `--version` are handled specially, here, before `ProjectPaths` is ever
 * constructed — `init` creates the project, and `ProjectPaths`'s own constructor resolves the root
 * against the real file system, so it cannot be given a directory that does not exist yet.
 *
 * @see specs/22 M17 P2
 */
import { EXIT_CODES } from '@forge/core/errors';
import { ProjectPaths } from '@forge/core/fs';

import { parseGlobalFlags } from '../../entry/parse-global-flags.ts';
import { readOwnPackageVersion } from '../../init/package-root.ts';
import { dispatchAdr } from './adr.ts';
import { dispatchCustomizeAndCompile } from './customize-and-compile.ts';
import { dispatchDiagram } from './diagram.ts';
import { dispatchHelp } from './help.ts';
import { runInitCommand } from './init.ts';
import { dispatchKb } from './kb.ts';
import { dispatchLifecycle } from './lifecycle.ts';
import { dispatchMigrate } from './migrate.ts';
import { dispatchModuleOverlayUpgrade } from './module-overlay-upgrade.ts';
import { dispatchPlanAndLoop } from './plan-and-loop.ts';
import { dispatchPresetSkillMcp } from './preset-skill-mcp.ts';
import { dispatchRunAndGates } from './run-and-gates.ts';
import { assertNoArgs, type DispatchContext, type Dispatcher } from './shared.ts';
import { dispatchSpec } from './spec.ts';
import { dispatchTestBinding } from './test-binding.ts';
import { dispatchTestExemptCoverageFlaky } from './test-exempt-coverage-flaky.ts';
import { dispatchTestRun } from './test-run.ts';
import { dispatchWorkspace } from './workspace.ts';

/** `forge --version`/`-V` — `03` §3.2's own global-flags table names this row. Reads
 * `forge-method`'s own `package.json` `version` field via the same `readPackageVersion` helper
 * `init`/`upgrade` already use for every other package's version. */
function printVersion(): void {
  console.log(readOwnPackageVersion(import.meta.url));
}

/** Tried, in order, by {@link main} once a command is anything other than `--version`/`init`.
 * Order is not semantically load-bearing (see this file's own top doc comment) — chosen here to put
 * the largest/most-used areas first purely as a minor, non-functional ordering convenience. */
const DISPATCHERS: readonly Dispatcher[] = [
  dispatchRunAndGates,
  dispatchLifecycle,
  dispatchTestRun,
  dispatchTestBinding,
  dispatchTestExemptCoverageFlaky,
  dispatchMigrate,
  dispatchSpec,
  dispatchKb,
  dispatchAdr,
  dispatchDiagram,
  dispatchModuleOverlayUpgrade,
  dispatchWorkspace,
  dispatchCustomizeAndCompile,
  dispatchPresetSkillMcp,
  dispatchHelp,
  dispatchPlanAndLoop,
];

/**
 * The real `forge` argv dispatcher. Exported for `bin.ts`'s own thin entry point to call.
 *
 * @see specs/22 M17 P2
 */
export async function main(): Promise<number> {
  const flags = parseGlobalFlags(process.argv.slice(2));
  const [command, sub, ...rest] = flags.positionals;

  if (command === '--version' || command === '-V') {
    // Every other zero-positional command in this dispatcher rejects a stray extra positional
    // (`assertNoArgs`) rather than silently ignoring it — `forge --version foo` reaching here
    // unchecked would be the one inconsistent exception.
    assertNoArgs([sub, ...rest].filter((token): token is string => token !== undefined));
    printVersion();
    return EXIT_CODES.success;
  }

  // `init` creates the project, so it must run before `ProjectPaths` is built: that constructor
  // resolves the root against the real file system and cannot be given a directory that does not
  // exist yet (a fresh `-C <new dir>`, `PLAN-M13.md` P12).
  if (command === 'init') {
    return runInitCommand(flags.positionals.slice(1), flags.yes, flags.json, flags.project);
  }

  const projectRoot = flags.project ?? process.cwd();
  const paths = new ProjectPaths(projectRoot);
  const ctx: DispatchContext = { positionals: flags.positionals, flags, paths, projectRoot };

  for (const dispatcher of DISPATCHERS) {
    // Sequential by design: the first area that claims a command/sub pair ends the search; most
    // invocations resolve after 1-2 tries, never all 16.
    const result = await dispatcher(ctx);
    if (result !== undefined) return result;
  }

  console.error(
    `forge: "${[command, sub].filter((token) => token !== undefined).join(' ')}" is not wired into ` +
      "this real, deliberately minimal dispatcher yet (see bin.ts's own doc comment for the full " +
      'list of commands that exist as real functions but have no CLI wiring yet).',
  );
  return EXIT_CODES.usage;
}
