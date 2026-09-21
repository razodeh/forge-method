/**
 * The pre- and post-merge check sets (`PLAN-M13.md` P38, `06` §6.5 steps 3 and 5, `10` §10.1's example policy
 * `{ conflict: agent, preChecks: fast, postChecks: full }`, `13` §13.1 F-TEST-1 rule 4, `SPEC-QUESTIONS.md` Q226).
 *
 * `fast` and `full` are names of SETS of test layers. A layer's command is the project's own
 * `execution.testCommands.<layer>` ("every layer has a single command ... gates invoke these, never ad-hoc
 * invocations", F-TEST-1); this module turns a name into those commands, and everything after that is the merge
 * queue's ordinary check running. Before it, the engine ran the name itself as a shell command (`fast: command not
 * found`), so no real `build-stage` merge could land.
 *
 * - `fast` is `06` §6.5 step 3's "fast subset: typecheck, lint, affected unit tests": the `typecheck`, `lint` and
 *   `unit` layers. There is no "affected" layer in the config (F-TEST-7 point 6's `test:affected` is a project
 *   convention, not a key), so `unit` is the whole layer.
 * - `full` is step 5's "full build + full test + contract tests": `typecheck`, `lint`, `unit`, `integration` and
 *   `contract`. The config has no `build` layer (the typecheck is the build check FORGE can name), and `e2e`,
 *   `nfr` and `smoke` are left out on purpose: they need an environment (a preview stack, a deployed target,
 *   `14` §14.9) that a worktree of the integration branch does not have; `G-Verify` and `G-Deliver` run them.
 * - A single layer name (`unit`, `lint`, ...) is the set of that one layer.
 * - Anything else is a literal shell command, exactly as a merge policy's checks always were.
 *
 * A layer of a set that has no configured command is skipped and REPORTED as skipped (the caller records it), not
 * treated as passing: F-TEST-1 says a layer with no command "reports as unable to verify, never as passing". A set
 * none of whose layers has a command verifies nothing, so it is a typed refusal (`MERGE-CHECKS-UNCONFIGURED`) that
 * names the config keys, and the merge does not start: failing closed, because a merge whose declared checks
 * cannot run has not been checked. A configured command is used exactly as written (nothing appended or
 * interpolated); one holding a line break or NUL is refused, because that is a second command, not a value.
 *
 * @see specs/06 §6.5
 * @see specs/13 §13.1
 */
import { TEST_COMMAND_LAYERS, type TestCommandLayer } from './test-command-grant.ts';
import type { MergeCheckCommand, StepFailureInfo } from './types.ts';

/** The layers of `execution.testCommands` (`@forge/schemas` config): the one list, `test-command-grant.ts`'s, which the exec
 * grant derivation (`PLAN-M13.md` P23) shares so the two cannot disagree about which keys are layers. A set's own order is
 * in `CHECK_SETS`. */
const LAYERS = TEST_COMMAND_LAYERS;

export type CheckLayer = TestCommandLayer;

/** The named sets and the layers each one runs, in run order (cheapest first, so a failure stops early). */
export const CHECK_SETS = {
  fast: ['typecheck', 'lint', 'unit'],
  full: ['typecheck', 'lint', 'unit', 'integration', 'contract'],
} as const satisfies Readonly<Record<string, readonly CheckLayer[]>>;

export type ResolvedMergeChecks =
  | {
      readonly ok: true;
      readonly commands: readonly MergeCheckCommand[];
      /** Layers of the set that have no configured command (not run, not counted as passing). */
      readonly skipped: readonly string[];
    }
  | { readonly ok: false; readonly failure: StepFailureInfo };

/** Whether `value` is a set name (`fast`, `full`) or a layer name, i.e. not a literal shell command. */
export function isCheckSetName(value: string): boolean {
  return Object.hasOwn(CHECK_SETS, value) || (LAYERS as readonly string[]).includes(value);
}

function layersOf(name: string): readonly CheckLayer[] {
  if (name === 'fast' || name === 'full') return CHECK_SETS[name];
  return LAYERS.filter((layer) => layer === name);
}

// A line break, carriage return or NUL is another command (or an unterminated one), not part of the value.
// Assembled from code points so the source holds no raw control characters.
const CONTROL_CHARACTERS = new RegExp(`[${String.fromCharCode(0)}\\n\\r]`);

function refusal(code: string, message: string): { readonly ok: false; failure: StepFailureInfo } {
  return { ok: false, failure: { source: 'merge', code, message } };
}

/**
 * Resolves the value of a merge policy's `preChecks`/`postChecks` (or `execution.mergeChecks.pre`/`.post`) into
 * the commands to run. `source` names where the value came from, for the refusal ("the merge policy preChecks of
 * step X", "execution.mergeChecks.post"). Never throws: a refusal is data.
 */
export function resolveMergeChecks(
  spec: string | undefined,
  testCommands: Readonly<Partial<Record<string, string>>>,
  source: string,
): ResolvedMergeChecks {
  if (spec === undefined) return { ok: true, commands: [], skipped: [] };
  const value = spec.trim();
  if (value === '') {
    return refusal(
      'MERGE-CHECKS-UNCONFIGURED',
      `${source} is blank, so it names no check. Remedy: name a check set ("fast", "full", or one layer such as "unit"), give a shell command, or remove the entry.`,
    );
  }
  if (!isCheckSetName(value)) return { ok: true, commands: [{ command: spec }], skipped: [] };

  const layers = layersOf(value);
  const commands: MergeCheckCommand[] = [];
  const skipped: string[] = [];
  for (const layer of layers) {
    const key = `execution.testCommands.${layer}`;
    const configured = testCommands[layer];
    if (configured === undefined || configured.trim() === '') {
      skipped.push(layer);
      continue;
    }
    const command = configured.trimEnd();
    if (CONTROL_CHARACTERS.test(command)) {
      return refusal(
        'MERGE-CHECK-COMMAND-INVALID',
        `${key} holds a line break or NUL, which makes it more than one command, so the check set "${value}" (${source}) was not run. Remedy: make ${key} one shell command line (chain steps with "&&" or put them in a script).`,
      );
    }
    commands.push({ command, label: key });
  }
  if (commands.length === 0) {
    const keys = layers.map((layer) => `execution.testCommands.${layer}`).join(', ');
    const noun = layers.length === 1 ? 'a layer' : 'layers';
    return refusal(
      'MERGE-CHECKS-UNCONFIGURED',
      `${source} names the check set "${value}", which runs ${noun} of ${keys}, and none of them is configured, so nothing can be verified and the merge did not start (a set with no command is not a pass). Remedy: set at least one of them in .forge/config.yaml under execution.testCommands, or give the check a literal shell command instead of the name "${value}".`,
    );
  }
  return { ok: true, commands, skipped };
}
