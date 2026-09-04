/**
 * `pnpm boundaries` — the command wrapper around `checkBoundaries`.
 *
 * A thin CLI: read the tree, report, set the exit code. The decision logic lives in
 * `scripts/lib/check-boundaries.mjs`, covered by `tools/eslint-plugin-forge-boundaries/test/
 * check-boundaries.test.ts`, following the same split `scripts/lib/coverage-ratchet.mjs` uses and
 * for the same reason — a check nobody has exercised is indistinguishable from one that always
 * passes.
 *
 * Usage:
 *   node scripts/check-boundaries.mjs               # check this repository
 *   node scripts/check-boundaries.mjs --root <dir>   # check a fixture tree instead
 *
 * @see specs/02 §2.2
 * @see PLAN-M1.md P2
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBoundaries } from './lib/check-boundaries.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

/** `--root <dir>`, or the repository this script lives in. */
function resolveRoot() {
  const flagIndex = process.argv.indexOf('--root');
  if (flagIndex === -1) return realpathSync(path.resolve(scriptDir, '..'));
  const given = process.argv[flagIndex + 1];
  if (given === undefined) {
    console.error('--root requires a path argument.');
    process.exit(2);
  }
  return realpathSync(path.resolve(given));
}

function main() {
  const root = resolveRoot();
  const violations = checkBoundaries(root);

  if (violations.length === 0) {
    return 0;
  }

  console.error(
    `Boundary check failed (specs/02 §2.2): ${String(violations.length)} undeclared ` +
      `@forge/* ${violations.length === 1 ? 'dependency' : 'dependencies'}.\n`,
  );
  for (const violation of violations) {
    console.error(`  - ${violation.reason}`);
  }
  console.error(
    '\nAdd the edge to PACKAGE_GRAPH in tools/eslint-plugin-forge-boundaries/src/graph.mjs if it ' +
      'belongs there, or remove the dependency.',
  );
  return 1;
}

process.exitCode = main();
