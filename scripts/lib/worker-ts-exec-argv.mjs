/**
 * `getWorkerTsExecArgv()` — the `execArgv` a `node:worker_threads.Worker` needs to understand real
 * TypeScript syntax in its own entry file, chosen for the Node binary this process is actually
 * running under. A LAZY, memoized FUNCTION, not an eager top-level constant — deliberately, and not
 * merely out of caution: `packages/cli/src/commands/parity/normalize-budget.ts`, the one real
 * production (shipped) caller, is bundled into the published `dist/forge.mjs`; its own module
 * top-level code runs unconditionally the instant the CLI starts, for every command, before any
 * dispatch or argument parsing happens at all. A critic confirmed live, against the real built
 * artifact, that an EAGER version of this computation turned a narrow "this one worker path is
 * broken on Node 20" finding into "the published CLI does not start on Node 20 at all" — every single
 * invocation crashed with `Cannot find module` the instant the module loaded (`SPEC-QUESTIONS.md`
 * Q340). Calling this lazily, only at the point a `Worker` actually needs it, means that crash can
 * only ever happen if and when this specific code path is genuinely exercised — and
 * `normalize-budget.ts`'s own dist-vs-source branching (see its header) means it is not even called
 * at all in the published artifact's normal, default path, which uses a precompiled, plain-JS worker
 * needing no flag in the first place.
 *
 * Deliberately depends on `./node-version.mjs`, NEVER on `./node-ts-flag.mjs`: that file's own
 * `TS_NODE_FLAG` eagerly resolves `tsx/esm` (a devDependency never shipped to a real npm consumer) the
 * instant ANY of its exports are imported — ES module semantics run a module's whole top-level body
 * on any import, not only the specific binding actually used — so importing anything from it here
 * would silently reintroduce the identical class of bug this whole split exists to prevent.
 *
 * NOT simply "the same mechanism `TS_NODE_FLAG` uses": confirmed live, empirically, that `tsx` does
 * not work for a `Worker`'s own module loading on Node 20.x at all — `tsx`'s own hooks module
 * silently installs nothing when loaded via `--import` through a `Worker`'s own `execArgv` (the `.ts`
 * load then fails downstream with `ERR_UNKNOWN_FILE_EXTENSION`, as if no loader were registered at
 * all), and throws its own explicit error ("tsx must be loaded with --import instead of --loader")
 * when registered the modern `module.register()` way instead — a real, specific `tsx` limitation
 * around worker threads, not a Node limitation. `./worker-ts-strip-loader.mjs` is a hand-written,
 * generic `--import`-registered `load` hook (using the real TypeScript compiler,
 * `ts.transpileModule`, for the actual syntax stripping) that IS confirmed to work for a `Worker`'s
 * own `execArgv` on a real Node 20.19.6 binary.
 *
 * @see scripts/lib/node-version.mjs
 * @see scripts/lib/worker-ts-strip-loader.mjs
 * @see packages/cli/src/commands/parity/normalize-budget.ts
 * @see SPEC-QUESTIONS.md Q340
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { SUPPORTS_NATIVE_STRIP_TYPES } from './node-version.mjs';

const require = createRequire(import.meta.url);

/** @type {readonly string[] | undefined} */
let cached;

/** @returns {readonly string[]} */
export function getWorkerTsExecArgv() {
  if (cached === undefined) {
    cached = SUPPORTS_NATIVE_STRIP_TYPES
      ? ['--experimental-strip-types']
      : [`--import=${pathToFileURL(require.resolve('./worker-ts-strip-loader.mjs')).href}`];
  }
  return cached;
}
