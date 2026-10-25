/**
 * Thin, Node-version-aware spawn wrapper for `scripts/bench.mjs` — the identical shape
 * `packages/cli/bin/forge.mjs` and `scripts/run-tests.mjs` already establish for the identical
 * reason: `bench.mjs` imports real TypeScript workspace package source (`@forge/kb`,
 * `@forge/extensions`, `@forge/core`) at its own top level, so its own process — not a child it
 * spawns — needs type stripping, which `package.json`'s own static `scripts` entry cannot express
 * conditionally on the Node version actually running it.
 *
 * `./lib/node-ts-flag.mjs`'s own `TS_NODE_FLAG` resolves the real, working, Node-version-aware flag
 * (`--experimental-strip-types` on Node >=22.6, `--import=tsx/esm` on Node 20.x, where the native flag
 * does not exist at all — confirmed live, `SPEC-QUESTIONS.md` Q340).
 *
 * @see scripts/bench.mjs
 * @see SPEC-QUESTIONS.md Q340
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TS_NODE_FLAG } from './lib/node-ts-flag.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchScript = path.join(repoRoot, 'scripts', 'bench.mjs');

const child = spawn(process.execPath, [TS_NODE_FLAG, benchScript, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  // Preserve the distinction between a clean failure and a signal, the same convention
  // `scripts/run-tests.mjs` and `packages/cli/bin/forge.mjs` already use.
  if (signal !== null) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
