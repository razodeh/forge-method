/**
 * `findSchemaDrift` and `runEmitSchemas` — the decision logic behind `scripts/emit-schemas.mjs` and
 * `scripts/assert-schema-drift.mjs`, split out and covered by its own tests, the same
 * `scripts/lib/check-boundaries.mjs` split and for the same reason.
 *
 * `runEmitSchemas` spawns a child process with `--experimental-strip-types`, rather than importing
 * `@forge/schemas` (TypeScript source) directly here: `specs/22` M1's exit test is
 * `node -e "require('./scripts/assert-schema-drift.mjs')"` — a bare `node`, no flags — and this file
 * is imported by that script. `require()` can load an ESM file that itself statically imports other
 * ESM/builtin modules (verified directly: Node's `require(esm)` support handles it), but it cannot
 * make a plain, unflagged `node` process understand `.ts` syntax. Spawning a child with the flag
 * keeps the constraint local to one function, rather than requiring every caller of this file to
 * somehow already be running with the flag.
 *
 * @see specs/02 §2.1
 * @see specs/22 M1 exit test
 * @see PLAN-M1.md P9
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// @forge/core/fs's listDirSorted (TypeScript source) cannot be imported from this plain, unflagged
// `.mjs` file for the same reason described at the top of this file — sorted explicitly below.
// eslint-disable-next-line no-restricted-imports -- see comment above
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const emitChildScript = path.join(scriptDir, 'emit-schemas-child.mjs');

/**
 * Runs `emitJsonSchemas()` (from `@forge/schemas/json-schema`) in a child process and returns the
 * same `filename -> content` data, as a `Map`.
 *
 * `stdio`'s stderr is piped, not inherited: type-stripping a real file (unlike a no-op `-e` script)
 * makes Node print an `ExperimentalWarning` on every single invocation, which would otherwise land
 * in the output of a command that is supposed to be silent on success (`assert-schema-drift.mjs`,
 * `specs/22` M1's exit test). Captured rather than discarded outright, so a genuine child failure
 * still surfaces its stderr in the thrown error.
 * @returns {Map<string, string>}
 */
export function runEmitSchemas() {
  const output = execFileSync(process.execPath, ['--experimental-strip-types', emitChildScript], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Map(JSON.parse(output));
}

/**
 * Compares a fresh emission against the `*.schema.json` files committed in `jsonDir`.
 * @param {string} jsonDir
 * @returns {readonly string[]} one description per drifted, missing, or orphaned file; empty if none.
 */
export function findSchemaDrift(jsonDir) {
  const fresh = runEmitSchemas();
  const drift = [];

  for (const [filename, freshContent] of fresh) {
    const committedPath = path.join(jsonDir, filename);
    let committedContent;
    try {
      committedContent = readFileSync(committedPath, 'utf8');
    } catch {
      drift.push(`${filename}: missing — never committed. Run \`pnpm emit-schemas\`.`);
      continue;
    }
    if (committedContent !== freshContent) {
      drift.push(`${filename}: committed content does not match the freshly emitted schema.`);
    }
  }

  // Order here does not need to be sorted at the source: `drift` is sorted explicitly before
  // returning, below, so the filesystem's readdir order cannot reach this function's observable
  // output either way.
  /** @type {string[]} */
  let committedFiles;
  try {
    committedFiles = readdirSync(jsonDir);
  } catch {
    committedFiles = [];
  }
  const freshNames = new Set(fresh.keys());
  for (const file of committedFiles) {
    if (file.endsWith('.schema.json') && !freshNames.has(file)) {
      drift.push(`${file}: committed, but no schema emits it anymore.`);
    }
  }

  return drift.sort();
}
