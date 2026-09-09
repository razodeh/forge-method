/**
 * `forge help [topic]` — `03`'s own closing line: "`forge help` with no args... MUST inspect state and
 * recommend the next command." A real, small decision tree over real, already-checkable project state
 * — not a static string.
 *
 * @see specs/03
 */
import { pathExists, type ProjectPaths } from '@forge/core/fs';

import { isProcessAlive, readRunLock } from './run/lock.ts';

export interface HelpCommandContext {
  readonly paths: ProjectPaths;
  readonly specsRoot: string;
}

export interface NextCommandRecommendation {
  readonly command: string;
  readonly reason: string;
}

/** With no args: inspects real, checkable project state, in the order a person would actually hit
 * each one, and recommends the first real next step. */
export async function helpRecommendNext(
  ctx: HelpCommandContext,
): Promise<NextCommandRecommendation> {
  if (!(await pathExists(ctx.paths.resolveWithin('.forge/config.yaml')))) {
    return { command: 'forge init', reason: 'This directory has never been initialized.' };
  }

  const lock = await readRunLock(ctx.paths);
  if (lock !== undefined && !isProcessAlive(lock.pid)) {
    return {
      command: 'forge resume',
      reason: `A previous run (${lock.runId}) was interrupted and can be resumed.`,
    };
  }
  if (lock !== undefined) {
    return {
      command: 'forge status',
      reason: `A run (${lock.runId}) is currently in progress.`,
    };
  }

  if (!(await pathExists(ctx.paths.resolveWithin(ctx.specsRoot)))) {
    return { command: 'forge spec new Vision', reason: 'This project has no spec tree yet.' };
  }

  return {
    command: 'forge doctor',
    reason: 'The project is initialized with no run in progress — check its real health.',
  };
}
