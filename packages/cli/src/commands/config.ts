/**
 * `forge config <get|set|list|explain|edit>` — `03` §3.2.7.
 *
 * @see specs/03 §3.2.7
 * @see specs/18 §18.3
 */
import {
  ForgeError,
  pathExists,
  readTextFile,
  writeFileAtomic,
  type ProjectPaths,
} from '@forge/core';
import {
  CONFIG_KEY_DOCS,
  configLeafPaths,
  configSchema,
  type ConfigKeyPath,
  type ForgeConfig,
} from '@forge/schemas/config';
import * as YAML from 'yaml';

export interface ConfigCommandContext {
  readonly paths: ProjectPaths;
}

const CONFIG_REL_PATH = '.forge/config.yaml';

/** Every real leaf key `configSchema` declares, derived from the schema itself (`configLeafPaths`)
 * rather than the separately-hand-maintained `ConfigKeyPath` union — this is what lets `get`/`set`
 * reject a typo'd key at the one real source of truth, not a second list that could drift from it. */
const REAL_KEYS: ReadonlySet<string> = new Set(configLeafPaths(configSchema));

async function readConfig(paths: ProjectPaths): Promise<ForgeConfig> {
  if (!(await pathExists(paths.resolveWithin(CONFIG_REL_PATH)))) {
    throw new ForgeError('CFG-020', undefined);
  }
  const raw: unknown = YAML.parse(await readTextFile(paths.resolveWithin(CONFIG_REL_PATH)));
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ForgeError('CFG-001', { path: CONFIG_REL_PATH, line: 0 });
  }
  return result.data;
}

/** `path` is always one of `REAL_KEYS` here (every real caller runs it through `assertRealKey` first)
 * — a real, schema-derived leaf dot-path, whose every ancestor in a real, schema-valid `ForgeConfig`
 * is therefore guaranteed to be a real, plain object. No defensive "ancestor turned out not to be an
 * object" branch is written for that reason: `configLeafPaths` walks the identical `configSchema`
 * `value` itself was already validated against, so that state cannot arise through this module's own
 * real callers -- see `SPEC-QUESTIONS.md`. */
function getByPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    return (current as Record<string, unknown>)[segment];
  }, value);
}

/** Replaces the value at `path` in a plain-object clone of `config` — a real, structural clone (not
 * `config.set()`-style byte splicing: `.forge/config.yaml` is plain YAML data, not an `ArtifactDocument`
 * front-matter file, so there is no existing formatting to preserve). The identical "`path` is always a
 * real, schema-derived leaf" guarantee `getByPath` documents applies here too. */
function setByPath(config: ForgeConfig, path: string, value: unknown): ForgeConfig {
  const clone = structuredClone(config) as Record<string, unknown>;
  const lastDot = path.lastIndexOf('.');
  // A top-level real leaf (e.g. `version`) has no dot at all; every other real leaf's own last
  // segment is the real key to write, everything before it a real chain of ancestors to walk —
  // split via `lastIndexOf` rather than `.split('.')` + array indexing specifically so the "last
  // segment" is a real, always-defined `string` from `.slice()`, never a `string | undefined` an
  // assertion would otherwise be needed to narrow.
  const lastKey = lastDot === -1 ? path : path.slice(lastDot + 1);
  const ancestorPath = lastDot === -1 ? '' : path.slice(0, lastDot);
  let cursor = clone;
  for (const segment of ancestorPath === '' ? [] : ancestorPath.split('.')) {
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[lastKey] = value;
  return clone as unknown as ForgeConfig;
}

function assertRealKey(key: string): void {
  if (!REAL_KEYS.has(key)) {
    throw new ForgeError('USR-002', { flag: 'key', value: key });
  }
}

/** `get <key>` — the real, currently-effective value at a real dot-path. */
export async function configGet(ctx: ConfigCommandContext, key: string): Promise<unknown> {
  assertRealKey(key);
  const config = await readConfig(ctx.paths);
  return getByPath(config, key);
}

/** `set <key> <value>` — writes a real, schema-revalidated `.forge/config.yaml`. `value` is parsed as
 * real YAML scalar/collection syntax (`YAML.parse` on the raw string) rather than always treated as a
 * bare string, so `forge config set execution.concurrency 4` sets a real number, not the string
 * `"4"`, which `configSchema`'s own `z.number()` field would otherwise reject outright. */
export async function configSet(
  ctx: ConfigCommandContext,
  key: string,
  rawValue: string,
): Promise<ForgeConfig> {
  assertRealKey(key);
  const config = await readConfig(ctx.paths);
  let parsedValue: unknown;
  try {
    parsedValue = YAML.parse(rawValue);
  } catch {
    // A critic round caught this call unguarded: a genuinely malformed raw value (not just one that
    // parses but fails schema revalidation, already handled below) threw a raw `YAMLParseError`
    // straight out of this function instead of the same real, actionable `USR-002` every other
    // malformed-CLI-value case in this module already raises.
    throw new ForgeError('USR-002', { flag: 'value', value: rawValue });
  }
  const updated = setByPath(config, key, parsedValue);
  const result = configSchema.safeParse(updated);
  if (!result.success) {
    throw new ForgeError('CFG-001', { path: CONFIG_REL_PATH, line: 0 });
  }
  await writeFileAtomic(ctx.paths.resolveWithin(CONFIG_REL_PATH), YAML.stringify(result.data));
  return result.data;
}

export interface ConfigListEntry {
  readonly key: ConfigKeyPath;
  readonly value: unknown;
}

/** `list` — every real leaf key, with its own real, currently-effective value. */
export async function configList(ctx: ConfigCommandContext): Promise<readonly ConfigListEntry[]> {
  const config = await readConfig(ctx.paths);
  return [...REAL_KEYS].map((key) => ({
    key: key as ConfigKeyPath,
    value: getByPath(config, key),
  }));
}

export interface ConfigExplanation {
  readonly key: ConfigKeyPath;
  readonly value: unknown;
  readonly doc: string;
}

/** `explain <key>` — `PLAN-M1.md` P8's own real payoff: the real, currently-effective value plus its
 * real, already-written documentation line from `CONFIG_KEY_DOCS`. */
export async function configExplain(
  ctx: ConfigCommandContext,
  key: string,
): Promise<ConfigExplanation> {
  assertRealKey(key);
  const config = await readConfig(ctx.paths);
  const doc = CONFIG_KEY_DOCS[key as ConfigKeyPath];
  return { key: key as ConfigKeyPath, value: getByPath(config, key), doc };
}

/** `edit` — `03` §3.2.7 names an interactive `$EDITOR`-launching flow; no real subprocess-spawning,
 * terminal-handoff mechanism exists anywhere in this codebase yet (the identical "no real
 * non-interactive equivalent, refuse honestly" shape `forge session`/`forge ask` already establish in
 * C5), so this is a real, named `USR-003` refusal rather than a fabricated editor launch. `forge
 * config get/set` already cover the real, scriptable half of "edit a value." */
export function configEdit(): never {
  throw new ForgeError('USR-003', { feature: 'config edit' });
}
