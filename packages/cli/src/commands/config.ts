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
import {
  AGENT_RUN_LAYERS,
  checkTestCommand,
  TEST_COMMAND_LAYERS,
  type TestCommandLayer,
} from '@forge/engine/dispatch';
import * as YAML from 'yaml';

export interface ConfigCommandContext {
  readonly paths: ProjectPaths;
}

// Exported so `adopt.ts` can locate the same, single real config file to write its own
// `project.adopted` marker back into (`PLAN-M10.md` P20) — one real source of truth for the path,
// never a second, independently-spelled literal that could drift from this one.
export const CONFIG_REL_PATH = '.forge/config.yaml';

/** Every real leaf key `configSchema` declares, derived from the schema itself (`configLeafPaths`)
 * rather than the separately-hand-maintained `ConfigKeyPath` union — this is what lets `get`/`set`
 * reject a typo'd key at the one real source of truth, not a second list that could drift from it. */
const REAL_KEYS: ReadonlySet<string> = new Set(configLeafPaths(configSchema));

/** `@throws {ForgeError}` `CFG-020` if `.forge/config.yaml` does not exist; `CFG-001` if it does not
 * validate. Exported for `bin.ts`'s own `test run` wiring (`PLAN-M8.md` P4) — the only other real
 * caller of "the real, validated project config" this codebase has, and the identical read every
 * other config-aware command in this file already does. */
export async function readConfig(paths: ProjectPaths): Promise<ForgeConfig> {
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

const TEST_COMMAND_KEY_PREFIX = 'execution.testCommands.';

/** The layer of an `execution.testCommands.<layer>` key, or `undefined` for any other key. `execution.testCommands` is one
 * leaf (a record whose keys are data, `configLeafPaths`), so without this a single layer could only be set by replacing
 * the whole map with a YAML flow mapping, which drops every other layer (`PLAN-M13.md` P23). */
function testCommandLayerOf(key: string): TestCommandLayer | undefined {
  if (!key.startsWith(TEST_COMMAND_KEY_PREFIX)) return undefined;
  const layer = key.slice(TEST_COMMAND_KEY_PREFIX.length);
  return TEST_COMMAND_LAYERS.find((candidate) => candidate === layer);
}

function assertRealKey(key: string): void {
  if (!REAL_KEYS.has(key) && testCommandLayerOf(key) === undefined) {
    throw new ForgeError('USR-002', { flag: 'key', value: key });
  }
}

/** The command `set` stores for a layer: the value as written (never YAML-parsed: `pnpm run test:unit` and
 * `node -e "x"` are strings, but `true`, `123` and `a: b` would parse into other types), trimmed. The layers whose command
 * becomes an exec grant (`AGENT_RUN_LAYERS`) must be one plain command (`checkTestCommand`); the others only one line, since
 * a gate may run them chained (`SPEC-QUESTIONS.md` Q219). A refusal is `ENV-006`, the code a gate check with no usable
 * command reports, so the remedy is the one the gate would print. */
function testCommandValue(layer: TestCommandLayer, key: string, rawValue: string): string {
  if (AGENT_RUN_LAYERS.includes(layer)) {
    const checked = checkTestCommand(rawValue);
    if (!checked.ok) {
      throw new ForgeError('ENV-006', {
        field: key,
        reason: `${checked.detail}. ${checked.remedy}`,
      });
    }
    return checked.command;
  }
  const command = rawValue.trim();
  if (command === '' || /[\n\r\0]/.test(command)) {
    throw new ForgeError('ENV-006', {
      field: key,
      reason:
        command === ''
          ? 'the command is empty'
          : 'the command spans more than one line; chain steps with "&&" on one line or put them in a script',
    });
  }
  return command;
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
  const layer = testCommandLayerOf(key);
  let parsedValue: unknown;
  if (layer === undefined) {
    try {
      parsedValue = YAML.parse(rawValue);
    } catch {
      // A critic round caught this call unguarded: a genuinely malformed raw value (not just one that
      // parses but fails schema revalidation, already handled below) threw a raw `YAMLParseError`
      // straight out of this function instead of the same real, actionable `USR-002` every other
      // malformed-CLI-value case in this module already raises.
      throw new ForgeError('USR-002', { flag: 'value', value: rawValue });
    }
  } else {
    parsedValue = testCommandValue(layer, key, rawValue);
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
  const docKey = testCommandLayerOf(key) === undefined ? key : 'execution.testCommands';
  const doc = CONFIG_KEY_DOCS[docKey as ConfigKeyPath];
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
