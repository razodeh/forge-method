/**
 * `commands/dispatch/help.ts` — `forge help [topic]` (`03`'s own closing line).
 *
 * @see specs/22 M17 P2
 */
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';

import { helpRecommendNext, type HelpCommandContext } from '../help.ts';
import { parseCommandFlags, SPECS_ROOT, type DispatchContext } from './shared.ts';

/** `topic` — `helpRecommendNext` itself has no real per-topic content of its own (only the bare,
 * state-aware "you are here" recommendation `03` explicitly demands); a real `forge help <topic>` is
 * a genuine, disclosed gap, refused rather than fabricated. */
async function runHelpCommand(
  paths: ProjectPaths,
  args: readonly string[],
  json: boolean,
): Promise<number> {
  const { positionals } = parseCommandFlags(args, {});
  if (positionals.length > 0) {
    throw new ForgeError('USR-003', {
      feature: `forge help ${positionals[0] ?? ''} (no real per-topic help content exists yet)`,
    });
  }
  const ctx: HelpCommandContext = { paths, specsRoot: SPECS_ROOT };
  const recommendation = await helpRecommendNext(ctx);
  console.log(
    json
      ? JSON.stringify({ v: 1, recommendation })
      : `${recommendation.command} — ${recommendation.reason}`,
  );
  return EXIT_CODES.success;
}

/**
 * Dispatches `forge help [topic]`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchHelp(ctx: DispatchContext): Promise<number | undefined> {
  const [command] = ctx.positionals;
  const afterCommand = ctx.positionals.slice(1);
  const { paths, flags } = ctx;
  if (command !== 'help') return undefined;
  return runHelpCommand(paths, afterCommand, flags.json);
}
