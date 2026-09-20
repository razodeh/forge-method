/**
 * `testRunLayer` — `forge test run --rule smoke|contract`, the two layer checks `G-Deliver` (`test:smoke`) and
 * `G-Integration` (`contract:cross-service`) name (`PLAN-M13.md` P25).
 *
 * `13` §13.1 F-TEST-1 rule 4: every layer has a single command, recorded, and "gates invoke these, never ad-hoc
 * invocations". `01` D6: deterministic gates are "exit-code driven". So the verdict is the exit code of the
 * project's own configured command (`execution.testCommands.<layer>`), which works for any test runner. This is
 * deliberately not `runAndNormalize`: that reads vitest or pytest reports and refuses a command containing shell
 * syntax, which would make these two gate checks unusable for every other stack and for a smoke command that is a
 * script.
 *
 * The command is a shell command line the project's owner wrote (the same trust `command` steps and `kb verify`
 * already place in it, `@forge/engine/dispatch`'s `runShellCommand` is the one shared runner). What FORGE adds is
 * everything around it: the string is run exactly as configured, and nothing is appended to it or interpolated
 * into it (not the rule name, not a path, not a flag), so no other value can inject into it; a value holding a line
 * break or NUL is refused (`ENV-006`) because it is a second command, not a value; and the run is bounded by a
 * timeout and an output cap, both of which fail the check rather than hang or exhaust memory.
 *
 * Writes nothing under the project. `forge test run` (no rule) owns `test-results.json` and `flaky.json`; a
 * single-layer check must not replace the project-wide report with a partial one (the same reason `forge story
 * verify` runs with `persistState: false`).
 *
 * @see specs/13 §13.1 F-TEST-1
 * @see specs/14 §14.9
 * @see specs/01 D6
 * @see PLAN-M13.md P25
 */
import { ForgeError } from '@forge/core/errors';
import { runShellCommand, type ShellLimits } from '@forge/engine/dispatch';

import type { TestCommands } from './run.ts';

export type TestLayerRule = 'smoke' | 'contract';

/** Ten minutes: `13` F-TEST-1's slowest budgeted layer (E2E, "layer < 10 min"), which a smoke suite against a
 * deployed environment is at most as slow as. The specs give no cap for FORGE's own check; this is the largest
 * number a spec states for any layer. */
export const TEST_LAYER_LIMITS = { timeoutMs: 600_000, maxOutputBytes: 8 * 1024 * 1024 } as const;

/** How much of a failing command's output the result keeps: enough to act on, not a log. */
const OUTPUT_TAIL_CHARS = 2000;

export interface TestLayerContext {
  readonly projectRoot: string;
  readonly testCommands: TestCommands;
  /** Overrides `TEST_LAYER_LIMITS`; a test uses it to prove the caps without waiting for the real ones. */
  readonly limits?: ShellLimits;
}

export interface TestLayerCommandResult {
  readonly layer: TestLayerRule;
  readonly command: string;
  readonly exitCode: number;
  readonly passed: boolean;
  readonly timedOut?: true;
  readonly outputLimitExceeded?: true;
  /** The tail of stderr (else stdout) when the command did not pass; absent for a pass. */
  readonly output?: string;
}

/** `failed` counts commands that did not pass, `errors` is always `0` (both are present because `G-Verify` and
 * `G-Deliver` read different fields off the same `test run` envelope, `run.ts`'s `TestRunResult`). One command per
 * layer today, so `failed` is `0` or `1`; `commands` is a list so a second command per layer is not a shape change. */
export interface TestLayerResult {
  readonly rule: TestLayerRule;
  readonly failed: number;
  readonly errors: 0;
  readonly commands: readonly TestLayerCommandResult[];
  readonly problems?: readonly string[];
}

// A line break, carriage return or NUL is another command (or an unterminated one), not part of the value.
// Assembled from code points so the source holds no raw control characters.
const CONTROL_CHARACTERS = new RegExp(`[${String.fromCharCode(0)}\\n\\r]`);

/** The command as it will run: trailing whitespace removed (a YAML block scalar, `smoke: |`, ends in a newline, which
 * is not a second command), then refused if a line break or NUL remains, because that is another command. */
function usableCommand(key: string, value: string | undefined): string {
  if (value === undefined) {
    throw new ForgeError('ENV-006', { field: key, reason: 'it is not set' });
  }
  const command = value.trimEnd();
  if (command.trim() === '') {
    throw new ForgeError('ENV-006', { field: key, reason: 'it is blank' });
  }
  if (CONTROL_CHARACTERS.test(command)) {
    throw new ForgeError('ENV-006', {
      field: key,
      reason: 'it contains a line break or NUL, which makes it more than one command',
    });
  }
  return command;
}

function tail(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed.length > OUTPUT_TAIL_CHARS ? `…${trimmed.slice(-OUTPUT_TAIL_CHARS)}` : trimmed;
}

/** @throws {ForgeError} `ENV-006` when `execution.testCommands.<rule>` is unset or unusable. */
export async function testRunLayer(
  ctx: TestLayerContext,
  rule: TestLayerRule,
): Promise<TestLayerResult> {
  const command = usableCommand(`execution.testCommands.${rule}`, ctx.testCommands[rule]);
  const limits = ctx.limits ?? TEST_LAYER_LIMITS;
  const outcome = await runShellCommand(command, ctx.projectRoot, undefined, limits);

  const timedOut = outcome.timedOut === true;
  const flooded = outcome.outputLimitExceeded === true;
  const passed = outcome.exitCode === 0 && !timedOut && !flooded;
  const output = tail(outcome.stderr.trim() === '' ? outcome.stdout : outcome.stderr);

  const result: TestLayerCommandResult = {
    layer: rule,
    command,
    exitCode: outcome.exitCode,
    passed,
    ...(timedOut ? { timedOut: true as const } : {}),
    ...(flooded ? { outputLimitExceeded: true as const } : {}),
    ...(passed || output === '' ? {} : { output }),
  };
  if (passed) return { rule, failed: 0, errors: 0, commands: [result] };

  const why = timedOut
    ? `did not finish within ${String(limits.timeoutMs)}ms and was killed`
    : flooded
      ? `wrote more than ${String(limits.maxOutputBytes)} bytes of output and was stopped`
      : `exited ${String(outcome.exitCode)}`;
  return {
    rule,
    failed: 1,
    errors: 0,
    commands: [result],
    problems: [`execution.testCommands.${rule} (${JSON.stringify(command)}) ${why}.`],
  };
}
