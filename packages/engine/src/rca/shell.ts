/**
 * `createRcaShell` — the `RcaLoopDeps.runShell` a real caller (`forge debug`) uses (`PLAN-M13.md` P28,
 * `SPEC-QUESTIONS.md` Q222). A command a model proposed runs only after `vetProposedCommand` accepts it against
 * the agent's tool grant; one FORGE wrote (`forge test run`) is not vetted. Both run through
 * `runConfinedCommand`: the scrubbed environment, no stdin, a timeout and an output cap.
 *
 * A refused command is not thrown and not run: it comes back as a result carrying `refusal` (`RUN-095`, its
 * reason category and the rendered message), so the loop records it as evidence and asks the model for another.
 *
 * The RCA loop is the one caller that turns on the `<trusted> <path> [-t/-g/-k <token>]` extension
 * (`dispatch/test-path.ts`, `PLAN-M14.md` P5): REPRODUCE/PROVE may run one of the project's own configured
 * test commands narrowed to a single, validated test file, so a reproduction is a real failing test rather
 * than "any red test in the whole layer" (`SPEC-QUESTIONS.md` Q230's "whole-layer reproduction" gap). This
 * is the only place that flips `VetOptions.allowTrustedPathExtension` on (`PLAN-M14.md` P24) — every other
 * `vetProposedCommand` caller stays exactly as it behaved before `test-path.ts` existed.
 *
 * @see specs/13 §13.2
 * @see specs/20 §20.1
 * @see PLAN-M14.md P5
 * @see PLAN-M14.md P24
 */
import type { ToolGrant } from '@forge/adapter-kit';
import { ForgeError } from '@forge/core';

import {
  commandWords,
  ENGINE_COMMAND_LIMITS,
  PROPOSED_COMMAND_LIMITS,
  PROPOSED_ENV_FIXED,
  runConfinedCommand,
  vetProposedCommand,
  type ConfinedLimits,
} from '../dispatch/confined-command.ts';
import { expandTrustedInvocation } from '../dispatch/test-path.ts';
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
  /** `execution.testRoots`, passed straight through to `vetProposedCommand`'s own `<trusted> <path>
   * [-t/-g/-k <token>]` extension (`dispatch/test-path.ts`, `PLAN-M14.md` P5/P24): a proposal that is one of
   * `trustedCommands`, verbatim, followed by one validated test path is trusted the identical way the bare
   * configured command already is. `undefined` (the project has not configured the key) falls back to
   * `validateTestPath`'s own built-in rule (`isTestPath`). */
  readonly testRoots?: readonly string[] | undefined;
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
    // `allowTrustedPathExtension: true` — the RCA loop is exactly the caller `confined-command.ts`'s own
    // `VetOptions.allowTrustedPathExtension` doc comment names as doing "its own work" to turn this on
    // (`PLAN-M14.md` P24): REPRODUCE/PROVE's own prompt text now states the `<trusted> <path>` shape
    // (`loop.ts`'s `runnableCommandsNote`) and `testRoots` (below) is wired from the caller's real config, so
    // a placeholder-matched proposal is no longer a silent no-op the way it was for every OTHER caller of
    // `vetProposedCommand` (`test-path.ts`'s own header comment; `forge story verify`'s P26 is the other).
    const refusal = await vetProposedCommand(command, options.grant, options.root, {
      ...(options.trustedCommands === undefined
        ? {}
        : { trustedCommands: options.trustedCommands }),
      allowTrustedPathExtension: true,
      testRoots: options.testRoots,
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
    // A command `vetProposedCommand` just accepted BECAUSE it word-for-word matched one of `trustedCommands` plus a
    // validated test path (the extension just enabled above) is the identical trust level as the bare configured
    // command — it is still exactly what the project configured, only narrowed to one file — so it gets the same
    // engine limits too, not the model's own tighter proposed-command budget. `vetProposedCommand` itself already
    // decided this once; re-deriving it here (rather than widening its `undefined`-on-accept return with a second,
    // caller-only signal) costs one more already-cheap, already-cached-by-the-OS path check and leaves that
    // function's own return type exactly what it was before this piece.
    //
    // Disclosed TOCTOU (fresh critic round, round 1): `validateTestPath` re-touches the filesystem
    // (`lstat`/`realpath`) here, a second time, independently of the identical check `vetProposedCommand`
    // already ran a moment earlier to decide ALLOW/REFUSE. If the test file is deleted or replaced in the
    // narrow window between those two awaits, this second check can come back `false` even though the
    // command was genuinely accepted as trusted-by-path — the command still runs (execution was already
    // authorised by the first check; this second one only ever picks a LIMIT, never a permission) but with
    // the tighter, proposed-command budget instead of the engine's. It can never do the reverse (grant
    // engine limits to something the vet refused, or to something it did not just accept): only ever
    // stricter than intended, never looser. Left as a real, bounded-safe inconsistency rather than plumbed
    // through `vetProposedCommand`'s own return value (a `confined-command.ts` change outside this piece's
    // Surface).
    const trustedInvocation = await expandTrustedInvocation(
      commandWords(command) ?? [],
      options.trustedCommands ?? [],
      { root: options.root, testRoots: options.testRoots },
    );
    const trusted =
      options.trustedCommands?.includes(command) === true ||
      (trustedInvocation.matched && trustedInvocation.ok);
    return runConfinedCommand(command, cwd, {
      limits: trusted ? engineLimits : proposedLimits,
      extraEnv: PROPOSED_ENV_FIXED,
      parentEnv,
    });
  };
}
