/**
 * `parseModule` — reads and validates one `module.yaml` file (`19` §19.1).
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { ForgeError, readTextFile, type AbsolutePath } from '@forge/core';
import { parse as parseYaml } from 'yaml';

import { moduleSchema } from './schema.ts';
import type { ModuleDefinition } from './types.ts';

function formatZodIssues(
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Reads `path` as a `module.yaml` document and validates it against `moduleSchema`.
 *
 * A `module.yaml` is boundary input in the same sense `.forge/config.yaml`/a preset bundle is (it can
 * be third-party content, hand-edited, or from an older FORGE version) — so a malformed one throws a
 * real, actionable `ForgeError` (`CFG-021`), never a bare YAML-library exception or a silent skip,
 * mirroring `applyPreset`'s own `CFG-011` precedent for the identical class of failure.
 *
 * @throws {ForgeError} `RUN-034` if `path` cannot be read.
 * @throws {ForgeError} `CFG-021` if `path`'s content is not valid YAML, or does not match
 * `moduleSchema`.
 */
export async function parseModule(path: AbsolutePath): Promise<ModuleDefinition> {
  const source = await readTextFile(path);

  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (cause) {
    // `String(cause)` rather than a conditional `cause instanceof Error ? cause.message : ...`: for
    // any real `Error` (every real failure `yaml`'s own `parse` throws is one, a `YAMLParseError`),
    // `String()` calls `Error.prototype.toString()`, which already renders `"<name>: <message>"` —
    // the identical rendering `@forge/core`'s own `renderCause` uses for an `Error` cause — with no
    // conditional branch this catch's own realistic input can never actually drive down the other
    // side of.
    throw new ForgeError('CFG-021', { path, detail: String(cause) }, { cause });
  }

  const result = moduleSchema.safeParse(document);
  if (!result.success) {
    throw new ForgeError('CFG-021', { path, detail: formatZodIssues(result.error.issues) });
  }
  return result.data;
}
