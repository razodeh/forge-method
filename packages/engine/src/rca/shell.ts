/**
 * `createRcaShell` — the `RcaLoopDeps.runShell` a real caller (`forge debug`) uses (`PLAN-M13.md` P28,
 * `SPEC-QUESTIONS.md` Q222). A command a model proposed runs only after `vetProposedCommand` accepts it against
 * the agent's tool grant; one FORGE wrote (`forge test run`) is not vetted. Both run through
 * `runConfinedCommand`: the scrubbed environment, no stdin, a timeout and an output cap.
 *
 * A refused command is not thrown and not run: it comes back as a result carrying `refusal` (`RUN-095`, its
 * reason category and the rendered message), so the loop records it as evidence and asks the model for another.
 *
 * @see specs/20 §20.1
 */
import type { ToolGrant } from '@forge/adapter-kit';
import { ForgeError } from '@forge/core';

import {
  ENGINE_COMMAND_LIMITS,
  PROPOSED_COMMAND_LIMITS,
  PROPOSED_ENV_FIXED,
  runConfinedCommand,
  vetProposedCommand,
  type ConfinedLimits,
} from '../dispatch/confined-command.ts';
import type { RunRcaShell } from './types.ts';

export interface RcaShellOptions {
  /** The grant a proposed command is held to: the agent's own resolved `tools` (its `exec` patterns and `network`). */
  readonly grant: Pick<ToolGrant, 'exec' | 'network' | 'allowlistHosts'>;
  /** The exact commands the project configured for its test layers and `grant.exec` already holds
   * (`test-command-grant.ts`, `PLAN-M13.md` P23): a proposed command equal to one of them is the user's own command, so
   * it skips the package-manager verb rule and nothing else. */
  readonly trustedCommands?: readonly string[];
  /** The lane worktree: the only directory a proposed command may name. */
  readonly root: string;
  /** Called for every refused proposed command, before it is returned (a caller emits a `PolicyViolation`). */
  readonly onRefused?: (refusal: {
    readonly command: string;
    readonly reason: string;
    readonly detail: string;
  }) => void | Promise<void>;
  readonly proposedLimits?: ConfinedLimits;
  readonly engineLimits?: ConfinedLimits;
  /** The environment to scrub: the caller's snapshot of the process's (`bin.ts` reads it once, R10); a test supplies
   * canaries. Required, so a caller cannot forget that this is where secrets are dropped. */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
}

/** What the refusal message says the command was proposed during: only `runRcaLoop` knows which phase asked, and it
 * reports that in the evidence. */
const REFUSAL_PHASE = 'the RCA loop';

export function createRcaShell(options: RcaShellOptions): RunRcaShell {
  const proposedLimits = options.proposedLimits ?? PROPOSED_COMMAND_LIMITS;
  const engineLimits = options.engineLimits ?? ENGINE_COMMAND_LIMITS;
  return async (command, cwd, origin) => {
    const { parentEnv } = options;
    if (origin === 'engine') {
      return runConfinedCommand(command, cwd, { limits: engineLimits, parentEnv });
    }
    const refusal = await vetProposedCommand(command, options.grant, options.root, {
      ...(options.trustedCommands === undefined
        ? {}
        : { trustedCommands: options.trustedCommands }),
    });
    if (refusal !== undefined) {
      await options.onRefused?.({ command, reason: refusal.reason, detail: refusal.detail });
      const message = new ForgeError('RUN-095', {
        phase: REFUSAL_PHASE,
        reason: refusal.reason,
        detail: refusal.detail,
      }).message;
      return {
        stdout: '',
        stderr: message,
        exitCode: 126,
        refusal: { ...refusal, code: 'RUN-095', message },
      };
    }
    // A configured test command is a whole test layer, which takes as long as the layer's own budget (`13` F-TEST-1, up to
    // five minutes for integration): it gets the engine's limits, not the two minutes a model's ad-hoc reproduction gets.
    const trusted = options.trustedCommands?.includes(command) === true;
    return runConfinedCommand(command, cwd, {
      limits: trusted ? engineLimits : proposedLimits,
      extraEnv: PROPOSED_ENV_FIXED,
      parentEnv,
    });
  };
}
