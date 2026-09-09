/**
 * `@forge/schemas/config` — the whole of `.forge/config.yaml` as one zod schema.
 *
 * @see specs/18 §18.3
 * @see specs/02 §2.8
 */
export { CONFIG_KEY_DOCS, type ConfigKeyPath } from './docs.ts';
export { DEFAULT_CONFIG } from './defaults.ts';
export { configSchema, type ForgeConfig } from './schema.ts';
export { configLeafPaths } from './walk.ts';
