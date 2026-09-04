/**
 * Launches vitest with the environment `specs/21` §21.1 requires, set *before* Node starts.
 *
 * Two of §21.1's guarantees cannot be established from inside the process:
 *
 * 1. **Locale.** ICU resolves the default locale at startup, so assigning `LC_ALL` in a setup file
 *    is a no-op that merely looks like a pin. Set here, it takes effect.
 * 2. **The network guard in worker threads.** A worker inherits the real `execArgv` its parent was
 *    started with; it never runs vitest's setup file, and `Worker` cannot be patched in a way an
 *    `import { Worker }` binding would see. `NODE_OPTIONS` puts the guard's `--import` into the
 *    execArgv of every process vitest forks, and nested workers inherit it from there.
 *
 * This wrapper exists for those two reasons only. Everything else belongs in `vitest.config.ts`.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guardUrl = pathToFileURL(path.join(repoRoot, 'test', 'network-guard.mjs')).href;
const vitestBin = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

const child = spawn(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    TZ: 'UTC',
    LC_ALL: 'C.UTF-8',
    LANG: 'C.UTF-8',
    NODE_OPTIONS: [process.env['NODE_OPTIONS'], `--import ${guardUrl}`].filter(Boolean).join(' '),
  },
});

child.on('exit', (code, signal) => {
  // Preserve the distinction between a clean failure and a signal: a suite killed by SIGKILL must
  // not report the same exit status as a suite whose assertions failed.
  if (signal !== null) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
