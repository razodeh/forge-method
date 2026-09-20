/**
 * The CLI face of `testRunLayer`: prints its `{v:1}` envelope (or the human form) and returns the exit code.
 * Kept out of `bin.ts`, which only routes to it.
 *
 * An unset or unusable command (`ENV-006`) is still an envelope, not only a stderr line: a gate reads stdout, and
 * an empty stdout is "check output could not be parsed", which is a failure with no reason attached. The envelope
 * carries `failed: 1`, the error's `code`, `problems` (its message) and `remedy`, and the exit code is `1`, the
 * same as a layer whose command ran and failed.
 *
 * @see PLAN-M13.md P25
 */
import { isForgeError } from '@forge/core/errors';

import { describeRefusal, printable, printableBlock, type OutputPort } from '../../output-port.ts';
import { testRunLayer, type TestLayerRule } from './layer.ts';
import type { TestCommands } from './run.ts';

export const TEST_LAYER_RULES = ['smoke', 'contract'] as const satisfies readonly TestLayerRule[];

export function isTestLayerRule(value: string | undefined): value is TestLayerRule {
  return value !== undefined && (TEST_LAYER_RULES as readonly string[]).includes(value);
}

/** `loadTestCommands` reads the project's configuration. It is a thunk because an invalid config is a failing verdict
 * here, not a refusal that escapes with no `failed` field (which a gate reads as "not failing"): an empty string for
 * `execution.testCommands.smoke` is `CFG-001` from the schema, the most natural way to write "unset". */
export async function runTestLayerCommand(
  projectRoot: string,
  loadTestCommands: () => Promise<TestCommands>,
  rule: TestLayerRule,
  json: boolean,
  out: OutputPort,
): Promise<number> {
  try {
    const result = await testRunLayer(
      { projectRoot, testCommands: await loadTestCommands() },
      rule,
    );
    if (json) {
      out.log(JSON.stringify({ v: 1, ...result }));
    } else if (result.failed === 0) {
      out.log(`forge test run --rule ${rule}: passed.`);
    } else {
      for (const problem of result.problems ?? []) out.error(printable(problem));
      for (const command of result.commands) {
        if (command.output !== undefined) out.error(printableBlock(command.output));
      }
    }
    return result.failed > 0 ? 1 : 0;
  } catch (error) {
    const refusal = describeRefusal(error);
    const code = isForgeError(error) ? error.code : undefined;
    if (json) {
      out.log(
        JSON.stringify({
          v: 1,
          rule,
          failed: 1,
          errors: 0,
          commands: [],
          ...(code === undefined ? {} : { code }),
          problems: [refusal.message],
          remedy: refusal.remedy,
        }),
      );
    } else {
      out.error(`${refusal.message} ${refusal.remedy}`);
    }
    return 1;
  }
}
