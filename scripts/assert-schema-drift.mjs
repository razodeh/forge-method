/**
 * `specs/22` M1's exit test: `node -e "require('./scripts/assert-schema-drift.mjs')"` — exits
 * non-zero, naming the file, when a committed `packages/schemas/json/*.schema.json` no longer
 * matches what `emitJsonSchemas()` produces.
 *
 * Must stay loadable by a bare, unflagged `node -e "require(...)"`: only statically imports
 * `node:fs`, `node:path`, `node:url`, and `./lib/schema-drift.mjs` (itself flag-free — see its own
 * doc comment for why the TypeScript-loading step is pushed into a child process instead).
 *
 * `--root <dir>` is accepted (checking `<dir>/packages/schemas/json` instead of this repository's
 * own), the same escape hatch `scripts/check-boundaries.mjs` gives itself, so a test can exercise
 * "a committed file was mutated/deleted/orphaned" against a disposable fixture tree rather than this
 * repository's real, committed schemas. `specs/22`'s exit test passes no arguments, so it is
 * unaffected.
 *
 * @see specs/22 M1 exit test
 * @see PLAN-M1.md P9
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findSchemaDrift } from './lib/schema-drift.mjs';

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

const jsonDir = path.join(resolveRoot(), 'packages', 'schemas', 'json');
const drift = findSchemaDrift(jsonDir);

if (drift.length > 0) {
  console.error(
    `Schema drift detected (specs/22 M1 exit test): ${String(drift.length)} ` +
      `file${drift.length === 1 ? '' : 's'}.\n`,
  );
  for (const description of drift) {
    console.error(`  - ${description}`);
  }
  console.error('\nRun `pnpm emit-schemas` and commit the result.');
  process.exitCode = 1;
} else {
  console.log('Committed JSON Schemas match the emitted output. No drift.');
}
