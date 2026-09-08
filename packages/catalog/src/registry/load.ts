/**
 * `loadCatalogRegistry` — reads every `<dir>/<kind>/<id>.entry.yaml` into a `CatalogRegistry`.
 *
 * `dir` is a plain `string`, not `@forge/core/fs`'s own `AbsolutePath` -- `02` §2.2's own boundary graph
 * gives `@forge/catalog` no `core` edge at all (`catalog ← schemas` only, confirmed directly against
 * `tools/eslint-plugin-forge-boundaries/src/graph.mjs`), so this package cannot use `@forge/core`'s own
 * path-containment machinery. The caller (ultimately `@forge/cli`, which does have a `core` edge) is
 * responsible for handing this function an already-safe, already-resolved directory -- this function
 * does no containment checking of its own.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */
import { readFileSync } from 'node:fs';
// Needs Dirent.isDirectory()/isFile() per entry (a kind directory vs. an entry file, at two levels),
// which @forge/core/fs's listDirSorted (names only) does not provide, and this package has no core
// edge to reach it with regardless (see the doc comment above) -- sorted explicitly below instead,
// the same pattern scripts/lib/check-boundaries.mjs already uses for the identical reason.
// eslint-disable-next-line no-restricted-imports -- see comment above
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { loadCatalogEntry } from '../schema/load.ts';
import type { CatalogEntry } from '../schema/types.ts';
import { CatalogRegistry } from './registry.ts';

const ENTRY_SUFFIX = '.entry.yaml';

export interface CatalogLoadIssue {
  readonly path: string;
  readonly message: string;
}

export interface CatalogLoadResult {
  readonly registry: CatalogRegistry;
  readonly issues: readonly CatalogLoadIssue[];
}

/** Reads every `<dir>/<kind>/<id>.entry.yaml` -- one directory per `kind`, matching `12` §12.2's own
 * canonical layout comment (`# canonical: catalog/<kind>/<id>.entry.yaml`, with `dir` itself standing
 * in for that `catalog/` root). A malformed individual entry is collected as an issue, named by its own
 * relative path, rather than aborting the whole load -- one bad file should not hide every other real
 * entry from a caller trying to see the rest of the catalog. */
export function loadCatalogRegistry(dir: string): CatalogLoadResult {
  const registry = new CatalogRegistry();
  const issues: CatalogLoadIssue[] = [];

  let kindDirs;
  try {
    kindDirs = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { registry, issues };
  }

  for (const kindDir of [...kindDirs].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!kindDir.isDirectory()) continue;
    const kindPath = path.join(dir, kindDir.name);

    let entryFiles;
    try {
      entryFiles = readdirSync(kindPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entryFile of [...entryFiles].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!entryFile.isFile() || !entryFile.name.endsWith(ENTRY_SUFFIX)) continue;
      const relativePath = `${kindDir.name}/${entryFile.name}`;
      const source = readFileSync(path.join(kindPath, entryFile.name), 'utf8');
      const result = loadCatalogEntry(source, relativePath);

      if (!result.success) {
        issues.push(...result.issues);
        continue;
      }

      const entry: CatalogEntry = result.entry;
      if (entry.kind !== kindDir.name) {
        issues.push({
          path: relativePath,
          message: `entry's own "kind: ${entry.kind}" does not match its directory "${kindDir.name}".`,
        });
        continue;
      }

      registry.add(entry);
    }
  }

  return { registry, issues };
}
