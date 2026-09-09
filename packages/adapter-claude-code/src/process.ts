/**
 * `ClaudeCliRunner` — the one seam every piece in this package that shells out to the real `claude`
 * binary goes through, injectable for deterministic fixture tests (this codebase's own established
 * "inject the real dependency, default to the real implementation" convention — the identical shape
 * `ExecuteStepContext.now`/`VcsFacade`/`TelemetryFacade` already use elsewhere in this build) rather
 * than each caller hand-rolling its own `execa` mock.
 *
 * @see PLAN-M7.md P1
 */
import { execa } from 'execa';

export interface ClaudeCliResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export type ClaudeCliRunner = (
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) => Promise<ClaudeCliResult>;

/** Never throws: a missing binary or any other spawn failure resolves to a real, honest
 * `exitCode: -1` result rather than a rejected promise — every caller already treats a non-zero exit
 * as "this attempt did not succeed," so a spawn failure is just one more way to not succeed, not a
 * distinct case callers must additionally handle. */
export const realClaudeCliRunner: ClaudeCliRunner = async (args, env) => {
  try {
    const result = await execa('claude', [...args], { env, reject: false });
    return { exitCode: result.exitCode ?? -1, stdout: result.stdout };
  } catch {
    return { exitCode: -1, stdout: '' };
  }
};
