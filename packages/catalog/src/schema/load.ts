/**
 * `loadCatalogEntry` — parses and validates one catalog entry document, never throwing on ordinary
 * malformed input.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */
import { parse as parseYaml } from 'yaml';

import { catalogEntrySchema } from './schema.ts';
import type { CatalogIssue, CatalogParseResult } from './types.ts';

function zodIssuesToCatalogIssues(
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): readonly CatalogIssue[] {
  return issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function withSourceContext(
  issues: readonly CatalogIssue[],
  sourcePath: string,
): readonly CatalogIssue[] {
  return issues.map((issue) => ({ ...issue, message: `${sourcePath}: ${issue.message}` }));
}

/** Never throws: a YAML syntax error and a zod schema violation both become entries in the same
 * returned `issues` list, matching `@forge/methods`'s own `loadFramework` precedent (M1) for the
 * identical "this can fail on ordinary malformed input, a caller needs to react to that" reason. */
export function loadCatalogEntry(source: string, sourcePath: string): CatalogParseResult {
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(source);
  } catch (cause) {
    return {
      success: false,
      issues: withSourceContext(
        [{ path: '(root)', message: cause instanceof Error ? cause.message : String(cause) }],
        sourcePath,
      ),
    };
  }

  const result = catalogEntrySchema.safeParse(parsedYaml);
  if (!result.success) {
    return {
      success: false,
      issues: withSourceContext(zodIssuesToCatalogIssues(result.error.issues), sourcePath),
    };
  }

  return { success: true, entry: result.data };
}
