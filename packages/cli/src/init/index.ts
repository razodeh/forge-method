/**
 * `@forge/cli/init` — `03` §3.3's greenfield wizard, driven non-interactively.
 *
 * @see specs/03 §3.3
 */
export { buildForgeConfig } from './config.ts';
export { generatedHeader } from './generated-header.ts';
export { sha256 } from './hash.ts';
export { resolveInitLevel } from './level.ts';
export { buildManifest } from './manifest.ts';
export { parseInitFlags } from './parse-init-flags.ts';
export { selectPlatform } from './platform.ts';
export { runInit } from './run-init.ts';
export type { InitOptions, InitResult, RunInitDeps, WrittenFile } from './types.ts';
