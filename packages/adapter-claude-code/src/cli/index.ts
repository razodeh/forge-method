/**
 * `@forge/adapter-claude-code/cli` — `07` §7.3's own `cli` transport.
 *
 * @see specs/07 §7.3
 * @see PLAN-M7.md P2
 */
export { buildCliArgs } from './build-args.ts';
export { parseCliEventLine } from './parse-event.ts';
export { spawnClaudeCli, type SpawnClaudeCliOptions, type SpawnedClaudeCli } from './spawn.ts';
