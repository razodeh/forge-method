/**
 * `@forge/cli/entry` — `03` §3.1's resolution logic and §3.2's global-flags table.
 *
 * @see specs/03 §3.1
 * @see specs/03 §3.2
 */
export { isSupportedNodeVersion, MIN_NODE_VERSION } from './node-version.ts';
export { parseGlobalFlags } from './parse-global-flags.ts';
export { resolveEntryContext } from './resolve-entry-context.ts';
export type {
  AutonomyLevel,
  EntryEnv,
  EntryProjectBranch,
  EntryResolution,
  GlobalFlags,
  ModelTier,
} from './types.ts';
