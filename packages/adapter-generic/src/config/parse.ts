/**
 * `parseAdapterConfig` — reads and validates one `adapter.yaml` file against `07` §7.5's own complete
 * shape. Never throws a raw `yaml`/Zod exception: every real failure (file missing/unreadable, invalid
 * YAML syntax, a document that does not match the schema) becomes a `GenericAdapterConfigError` naming
 * the exact problem and a remedy — `GenericAdapter`'s own construction refuses outright on any of these
 * (`PLAN-M11.md` P7's own Checks: "a deliberately-broken adapter.yaml... fails to even construct an
 * adapter... a real refusal, not a silent partial adapter").
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import { readFile } from 'node:fs/promises';

import { parse as parseYaml } from 'yaml';

import { adapterYamlConfigSchema, type AdapterYamlConfig } from './schema.ts';
import { GenericAdapterConfigError } from './errors.ts';

function describeZodIssues(error: {
  readonly issues: readonly { path: readonly (string | number)[]; message: string }[];
}): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

export async function parseAdapterConfig(path: string): Promise<AdapterYamlConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    throw new GenericAdapterConfigError(
      {
        code: 'ADP-GENERIC-CONFIG-UNREADABLE',
        message: `Could not read adapter.yaml at ${path}: ${cause instanceof Error ? cause.message : String(cause)}.`,
        remedy: `Ensure ${path} exists and is readable.`,
      },
      { cause },
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (cause) {
    throw new GenericAdapterConfigError(
      {
        code: 'ADP-GENERIC-CONFIG-INVALID-YAML',
        message: `${path} is not valid YAML: ${cause instanceof Error ? cause.message : String(cause)}.`,
        remedy: `Fix the YAML syntax in ${path}.`,
      },
      { cause },
    );
  }

  const result = adapterYamlConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new GenericAdapterConfigError({
      code: 'ADP-GENERIC-CONFIG-SCHEMA',
      message: `${path} does not match the 07 §7.5 adapter.yaml schema: ${describeZodIssues(result.error)}.`,
      remedy:
        "Fix the listed field(s) so the document matches 07 §7.5's own worked adapter.yaml example exactly.",
    });
  }

  return result.data;
}
