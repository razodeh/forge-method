#!/usr/bin/env node
/**
 * `forge` — the real, minimal executable entry point `pnpm forge <cmd>` resolves to.
 *
 * A thin spawn wrapper, the identical shape `scripts/run-tests.mjs` already establishes for the
 * identical reason: `packages/cli/src/bin.ts` is real TypeScript source, and this repository's own
 * real Node floor (`>=20.19`, `package.json`'s own `engines` field) is exactly the version line Node
 * backported `--experimental-strip-types` to — spawning a child with that flag, rather than relying on
 * a shebang line's own (non-portable, `env -S`-only) ability to pass it, keeps this launcher working
 * the same way on every real shell this codebase's own CI/dev machines use.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const binDir = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(binDir, '..', 'src', 'bin.ts');

const child = spawn(
  process.execPath,
  [
    '--experimental-strip-types',
    '--disable-warning=ExperimentalWarning',
    entryPath,
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
