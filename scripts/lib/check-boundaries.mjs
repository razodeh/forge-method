/**
 * Checks every `packages/<name>/package.json`'s declared `dependencies` against the `specs/02` §2.2
 * graph — the second, non-ESLint check `PLAN-M1.md` P2 requires.
 *
 * The ESLint rules in `tools/eslint-plugin-forge-boundaries` catch a bad import as it is written.
 * This catches a bad *dependency*: a `package.json` hand-edited to add `@forge/engine`, a dependency
 * only ever reached dynamically (`await import(computedSpecifier)`, invisible to static analysis),
 * or one added and never imported at all. Static analysis and manifest analysis are different
 * questions, and a boundary violation should not survive because it dodged one of the two.
 *
 * Deliberately its own file, separate from the CLI in `../check-boundaries.mjs`: this half is pure
 * and importable, so it has its own tests; the CLI half is a thin wrapper proven by a subprocess
 * test against fixture trees, the same split `scripts/lib/coverage-ratchet.mjs` uses and for the
 * same reason.
 *
 * @see specs/02 §2.2
 * @see PLAN-M1.md P2
 */
import { readFileSync } from 'node:fs';
// eslint-disable-next-line no-restricted-imports -- @forge/core/fs's listDirSorted (PLAN-M1.md P4) does not exist yet; sorted explicitly below. Migrate once P4 lands.
import { readdirSync } from 'node:fs';
import path from 'node:path';

import {
  PACKAGE_GRAPH,
  isForgePackage,
} from '../../tools/eslint-plugin-forge-boundaries/src/graph.mjs';

/**
 * One declared `@forge/*` dependency edge that `PACKAGE_GRAPH` does not permit.
 * @typedef {{ from: string, to: string, reason: string }} Violation
 */

/**
 * Reads every `packages/<name>/package.json` under `root` and reports the `@forge/*` dependencies that
 * are not declared in `PACKAGE_GRAPH`.
 *
 * @param {string} root
 * @returns {Violation[]}
 */
export function checkBoundaries(root) {
  const packagesDir = path.join(root, 'packages');
  /** @type {Violation[]} */
  const violations = [];

  let entries;
  try {
    // Sorted explicitly: `readdirSync` order is filesystem-dependent, and this list decides which
    // violations get reported and in what order — QUALITY-BAR.md R10.
    entries = readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  } catch {
    // No packages/ directory at all — nothing to check. True for the workspace before M1's first
    // real package landed, and for a fixture tree that only wants to exercise one package.
    return violations;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(packagesDir, entry.name, 'package.json');

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    // `JSON.parse('null')` and `JSON.parse('[]')` both succeed — valid JSON, not a manifest. Reading
    // `.dependencies` off either crashed the whole check with a raw TypeError, which meant every
    // violation later in the (sorted, but still finite) directory listing went unreported too.
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) continue;

    const fromPkg = entry.name;
    const dependencies =
      typeof manifest.dependencies === 'object' && manifest.dependencies !== null
        ? manifest.dependencies
        : {};

    for (const depName of Object.keys(dependencies)) {
      if (!depName.startsWith('@forge/')) continue;
      const toPkg = depName.slice('@forge/'.length);
      if (toPkg === fromPkg) continue;

      const fromKnown = isForgePackage(fromPkg);
      const allowed = fromKnown && isForgePackage(toPkg) && PACKAGE_GRAPH[fromPkg].includes(toPkg);
      if (allowed) continue;

      violations.push({
        from: fromPkg,
        to: toPkg,
        reason: fromKnown
          ? `packages/${fromPkg} declares a dependency on @forge/${toPkg}, which is not in its ` +
            `specs/02 §2.2 edge list.`
          : `packages/${fromPkg} is not a package specs/02 §2.2 declares, so none of its ` +
            `dependencies can be checked against the graph.`,
      });
    }
  }

  return violations;
}
