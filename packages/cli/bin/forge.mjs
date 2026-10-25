#!/usr/bin/env node
/**
 * `forge` — the real, minimal executable entry point `pnpm forge <cmd>` resolves to.
 *
 * A thin spawn wrapper, the identical shape `scripts/run-tests.mjs` already establishes for the
 * identical reason: `packages/cli/src/bin.ts` is real TypeScript source, run with no build step —
 * spawning a child with the real type-stripping flag, rather than relying on a shebang line's own
 * (non-portable, `env -S`-only) ability to pass it, keeps this launcher working the same way on every
 * real shell this codebase's own CI/dev machines use.
 *
 * **Correction (`SPEC-QUESTIONS.md` Q340):** this file's own prior doc comment claimed
 * `--experimental-strip-types` was "backported" to this repository's own Node floor (`>=20.19`) — that
 * was never true: confirmed live, a real Node 20.19.6/20.20.2 binary rejects the flag outright as an
 * unrecognized option, not a no-op. It only exists from Node 22.6.0 onward. `./lib/node-ts-flag.mjs`'s
 * own `TS_NODE_FLAG` (resolved in `scripts/`, imported here across the `packages/cli` boundary since
 * it is tooling, not a package `export`) picks the real, working equivalent for whichever Node this
 * launcher is actually running under.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 * @see SPEC-QUESTIONS.md Q340
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TS_NODE_FLAG } from '../../../scripts/lib/node-ts-flag.mjs';

const binDir = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(binDir, '..', 'src', 'bin.ts');

const child = spawn(
  process.execPath,
  [TS_NODE_FLAG, '--disable-warning=ExperimentalWarning', entryPath, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
