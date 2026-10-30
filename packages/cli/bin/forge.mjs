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
 * **Second correction (`SPEC-QUESTIONS.md` Q369).** `Q369`'s own "disclosed, not yet fixed" note for
 * this file (`packages/cli/test/bin-run-failures.test.ts` failing on Node 20) was itself stale by the
 * time it landed -- the flag-doesn't-exist defect it described was already fixed by the `Q340` change
 * above. Re-run live against a real Node 20.19.6 binary: the launcher itself runs fine (`node
 * packages/cli/bin/forge.mjs` exits 0), and the real, still-live failure was a DIFFERENT defect one
 * layer down, in `tsx` itself (the Node-20 stand-in `TS_NODE_FLAG` resolves to): `tsx`'s own on-disk
 * transform cache defaults to `path.join(os.tmpdir(), 'tsx-' + uid)`, written by every child this file
 * spawns on Node <22.6. 5 of `bin-run-failures.test.ts`'s 20 tests set `TMPDIR` to a disposable scratch
 * directory and assert it holds nothing once a run finishes (the launcher-shim's own no-litter
 * guarantee, `Q208` finding 3) -- on Node 20 that scratch directory also picked up `tsx`'s cache
 * directory, which nothing in this codebase ever removes (it is a deliberately long-lived, uid-keyed
 * cache, not per-run litter). Confirmed live: all 5 failed with a leftover `tsx-<uid>` entry, and
 * setting `TSX_DISABLE_CACHE` (`tsx`'s own documented env var, confirmed present in
 * `tsx@4.23.15`'s own source) made all 20 pass, repeatably, on a real Node 20.19.6 binary -- `tsx` is
 * dev/test-only here (never shipped, see `node-ts-flag.mjs`'s own doc comment), so losing its
 * cross-run transform cache costs nothing a real end user ever pays for.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 * @see SPEC-QUESTIONS.md Q340
 * @see SPEC-QUESTIONS.md Q369
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
  // `TSX_DISABLE_CACHE` is inert on Node >=22.6 (TS_NODE_FLAG is the native flag there; `tsx` is never
  // loaded at all) and, on Node <22.6, stops `tsx` from writing its own cache directory into whatever
  // `TMPDIR` this process inherits -- see the module doc comment above (`Q369`) for the real failure
  // this fixes.
  { stdio: 'inherit', env: { ...process.env, TSX_DISABLE_CACHE: '1' } },
);

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
