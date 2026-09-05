/**
 * `CONFIG_KEY_DOCS` completeness against the real `configSchema` — "every leaf key has an entry in
 * `CONFIG_KEY_DOCS` and a default — a test walks the schema and fails on any key missing either"
 * (`PLAN-M1.md` P8's Check).
 *
 * `CONFIG_KEY_DOCS`'s own type (`Readonly<Record<ConfigKeyPath, string>>`) already makes a *missing*
 * or *extra* key a compile error against the hand-written `ConfigKeyPath` union — this test instead
 * catches the case that check cannot: `ConfigKeyPath` itself silently drifting out of sync with
 * `configSchema`'s actual shape (a field renamed in `schema.ts` without the union being updated to
 * match).
 */
import { describe, expect, it } from 'vitest';

import { CONFIG_KEY_DOCS } from '../../src/config/docs.ts';
import { DEFAULT_CONFIG } from '../../src/config/defaults.ts';
import { configSchema } from '../../src/config/schema.ts';
import { configLeafPaths } from '../../src/config/walk.ts';

/** Reads the value at a dot-path out of a plain object, for the "every leaf has a default" check. */
function getAtPath(root: unknown, path: string): { readonly found: true; readonly value: unknown } {
  let current = root;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      throw new Error(`"${path}" does not resolve in the object given (stopped at "${segment}").`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

describe('CONFIG_KEY_DOCS — completeness against the real schema', () => {
  const realLeafPaths = configLeafPaths(configSchema);

  it('the real schema has at least one leaf (guards the whole file against a vacuous pass)', () => {
    expect(realLeafPaths.length).toBeGreaterThan(0);
  });

  it.each(realLeafPaths)('%s has a non-empty CONFIG_KEY_DOCS entry', (path) => {
    const doc = (CONFIG_KEY_DOCS as Record<string, string | undefined>)[path];
    expect(doc, `missing or empty doc for "${path}"`).toBeTruthy();
  });

  it.each(realLeafPaths)('%s resolves to a value in DEFAULT_CONFIG', (path) => {
    expect(() => getAtPath(DEFAULT_CONFIG, path)).not.toThrow();
  });

  it('has no doc entry for a path the schema does not declare', () => {
    const realPathSet = new Set(realLeafPaths);
    const undocumentedExtras = Object.keys(CONFIG_KEY_DOCS).filter(
      (path) => !realPathSet.has(path),
    );
    expect(undocumentedExtras).toEqual([]);
  });

  it('DEFAULT_CONFIG itself is a valid config (every default actually satisfies its own schema)', () => {
    const result = configSchema.safeParse(DEFAULT_CONFIG);
    expect(result.success, !result.success ? JSON.stringify(result.error.issues) : '').toBe(true);
  });
});
