/**
 * `commands/dispatch/test-run.ts` — `forge test run [--rule lint|typecheck|oracle-lint]
 * [--timeout-ms <n>]` (`03` §3.2.5, M8 P4/P6, `specs/22` M16 P10, M17 P5).
 *
 * `detectToolVersions` lives here (its own current signature is `specs/22` M17 P4's), NOT in
 * `test-binding.ts`, even though `runOneStoryBinding` (there) is its only real caller — the
 * placement map this piece's own brief hands down names this split point explicitly, verified
 * directly against the real current `bin.ts`: `detectToolVersions` and `runTestRunCommand` share no
 * other real dependency with the binding family beyond the one `TestLayerIdentity` parameter type
 * both already import from `commands/loop/test/binding.ts` (never a NEW shared type — see this
 * piece's own gauntlet-log DECISION). Exported so `test-binding.ts` can import it.
 *
 * @see specs/22 M17 P2
 * @see specs/22 M16 P10
 */
import { createRequire } from 'node:module';

import { ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import type { TestLayerIdentity } from '../loop/test/binding.ts';
import { createSystemTempPath } from '../loop/test/system-temp.ts';
import { testRun } from '../loop/test/run.ts';
import {
  TEST_LAYER_RULES,
  isTestLayerRule,
  runTestLayerCommand,
} from '../loop/test/layer-command.ts';
import { readConfig } from '../config.ts';
import { assertNoArgs, parseCommandFlags, type DispatchContext } from './shared.ts';

const TEST_RULE_IDS = ['lint', 'typecheck', 'oracle-lint'] as const;
type TestRuleId = (typeof TEST_RULE_IDS)[number];

function isTestRuleId(value: string | undefined): value is TestRuleId {
  return value !== undefined && (TEST_RULE_IDS as readonly string[]).includes(value);
}

/** `--rule lint|typecheck`, the same "not a global flag, found locally in `rest`" pattern other
 * commands already establish. Returns the raw value verbatim (never silently narrowed to `undefined`
 * for an unrecognised one) — a typo (`--rule typecheckk`) must error, not silently run the entire
 * default test suite. A later critic round (`PLAN-M8.md` P6) found the identical collapse still
 * happened for a *trailing, valueless* `--rule` — returning `''` there (never `undefined`) closes it. */
function findRawTestRuleFlag(rest: readonly string[]): string | undefined {
  const index = rest.indexOf('--rule');
  return index === -1 ? undefined : (rest[index + 1] ?? '');
}

/** `--timeout-ms <n>`, found locally in `rest` (`specs/22` M16 P10) — `forge test run`'s own override
 * of `reporter.ts`'s `DEFAULT_TEST_RUN_TIMEOUT_MS`. Returns the raw value verbatim; `parseTimeoutMsFlag`
 * is what turns a bad one into a real, reported `RUN-117`. */
function findTimeoutMsFlag(rest: readonly string[]): string | undefined {
  const index = rest.indexOf('--timeout-ms');
  return index === -1 ? undefined : (rest[index + 1] ?? '');
}

/** Parses `--timeout-ms`'s raw string value into a real, positive millisecond count — shared by
 * `forge test run` and `forge test binding`, both of which override the SAME `reporter.ts`-level
 * default. `undefined` when the flag was not given at all; a flag that WAS given but does not parse
 * as a positive whole number is a real, typed `RUN-117` refusal. */
export function parseTimeoutMsFlag(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new ForgeError('RUN-117', { flag: '--timeout-ms', value: raw });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ForgeError('RUN-117', { flag: '--timeout-ms', value: raw });
  }
  return value;
}

/** Parses `--max-hunks`'s raw string value into a real, positive hunk count (`specs/22` M16 P12; `03`
 * §3.2.5 row 117). `undefined` when the flag was not given at all; a flag that WAS given but does not
 * parse as a positive whole number is a real, typed `RUN-139` refusal — a DIFFERENT code than
 * `RUN-117` because that code's own message/remedy are hardcoded to milliseconds. */
export function parseMaxHunksFlag(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new ForgeError('RUN-139', { flag: '--max-hunks', value: raw });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ForgeError('RUN-139', { flag: '--max-hunks', value: raw });
  }
  return value;
}

/** `test:run`/`test:lint`/`test:typecheck` (`G-Verify.gate.yaml`) each shell `forge test run
 * [--rule lint|typecheck] --json` and read back a top-level numeric `failed` or `errors` field
 * (`failOn: 'failed > 0'` / `'errors > 0'`) — `testRun`'s own return value already carries both. */
async function runTestRunCommand(
  paths: ProjectPaths,
  projectRoot: string,
  rule: TestRuleId | undefined,
  json: boolean,
  timeoutMs: number | undefined,
): Promise<number> {
  const config = await readConfig(paths);
  const ctx = {
    paths,
    projectRoot,
    testCommands: config.execution.testCommands,
    flakeConfig: config.quality.flake,
    // `specs/22` M17 P5: `quality.oracleLint` itself is optional -- `?.` reads `undefined` for a
    // config written before this piece existed, which `testRun`/`runOracleLintRule` already treat
    // as "use the built-in default".
    oracleLintGlobs: config.quality.oracleLint?.testFileGlobs,
  };
  const options = {
    ...(rule === undefined ? {} : { rule }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  const result = await testRun(ctx, options, () => createSystemTempPath('forge-test-run'));
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else if ((result.problems ?? []).length > 0) {
    for (const problem of result.problems ?? []) console.error(problem);
  } else {
    console.log(
      `forge test run${rule === undefined ? '' : ` --rule ${rule}`}: failed=${String(result.failed)} errors=${String(result.errors)}.`,
    );
  }
  return result.failed > 0 || result.errors > 0 ? 1 : 0;
}

/** The real, installed test tool's own version, best-effort — a diagnostic `MutationEvidence` field
 * (`specs/18` §18.7), never load-bearing for a binding verdict. A legacy `'js'` ecosystem resolves
 * `vitest`'s own real `package.json`. A legacy `'python'` ecosystem is left empty. A structured
 * command (`specs/22` M17 P4) is ALSO left empty — there is no single ecosystem concept to resolve a
 * tool version from at all. Exported for `test-binding.ts`'s own `runOneStoryBinding`. */
export function detectToolVersions(testLayer: TestLayerIdentity): Readonly<Record<string, string>> {
  if (!('ecosystem' in testLayer) || testLayer.ecosystem !== 'js') return {};
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require('vitest/package.json') as { readonly version?: unknown };
    return typeof packageJson.version === 'string' ? { vitest: packageJson.version } : {};
  } catch {
    return {};
  }
}

/**
 * Dispatches `forge test run`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchTestRun(ctx: DispatchContext): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const { paths, projectRoot, flags } = ctx;
  if (command !== 'test' || sub !== 'run') return undefined;

  const rawRule = findRawTestRuleFlag(rest);
  // `--rule=smoke` matches no `--rule` token, so it would silently run the whole default test suite instead.
  if (rest.some((token) => token.startsWith('--rule='))) {
    console.error('forge: "test run" takes `--rule <name>` (a space, not `=`).');
    return 2;
  }
  if (isTestLayerRule(rawRule)) {
    const { positionals: layerPositionals } = parseCommandFlags(rest, {
      '--rule': true,
      '--timeout-ms': true,
    });
    // `layerPositionals` is already flag-free (the parse above already separated `--rule`/
    // `--timeout-ms` out of it) -- `assertNoArgs` re-parsing it with its own empty spec is a
    // harmless no-op pass that still reuses the real, shared "extra positional" refusal, rather
    // than this file duplicating that refusal's own exact shape a second time.
    assertNoArgs(layerPositionals);
    if (rest.filter((token) => token === '--rule').length > 1) {
      throw new ForgeError('USR-002', { flag: '--rule', value: 'given more than once' });
    }
    return runTestLayerCommand(
      projectRoot,
      async () => (await readConfig(paths)).execution.testCommands,
      rawRule,
      flags.json,
      console,
    );
  }
  if (rawRule !== undefined && !isTestRuleId(rawRule)) {
    console.error(
      `forge: "test run --rule" needs a real rule (one of: ${[...TEST_RULE_IDS, ...TEST_LAYER_RULES].join(', ')}); ` +
        `got ${JSON.stringify(rawRule)}.`,
    );
    return 2;
  }
  const timeoutMs = parseTimeoutMsFlag(findTimeoutMsFlag(rest));
  return runTestRunCommand(paths, projectRoot, rawRule, flags.json, timeoutMs);
}
