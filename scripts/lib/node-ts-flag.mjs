/**
 * The real, Node-version-aware way this repository spawns a child `node` process that must
 * understand real TypeScript syntax with no build step (type stripping only, never type-checking).
 *
 * `Q340` (`SPEC-QUESTIONS.md`): `--experimental-strip-types` does not exist at all on Node 20.x —
 * confirmed live against a real Node 20.19.6 and 20.20.2 binary, both reject it outright as
 * `bad option: --experimental-strip-types`, not merely a no-op or a warning. The flag only exists from
 * Node 22.6.0 onward. `specs/02` §2.1 pins Node >=20.10 as a tested, supported floor — the CI matrix
 * (`ci.yml`) runs 20/22/24 — so every real child-process spawn of a `.ts` file anywhere in this
 * repository must keep working on Node 20, not assume the flag exists everywhere this repo's own Node
 * floor claims to support.
 *
 * On a Node new enough to have the native flag, this resolves to it, unchanged from before this file
 * existed. On Node 20.x, this resolves to `--import=<absolute path to tsx/esm>` instead — `tsx` (a
 * real devDependency, confirmed working end to end against this repository's own real `.ts` sources,
 * including the real `packages/cli/src/bin.ts` entry point, on a real Node 20.19.6 binary) is Node
 * 20's own stand-in. Deliberately kept as the identical "one flag, then the script path" argv shape
 * `--experimental-strip-types` already has (`--import=X`, not `--import X`, is one argv element, not
 * two) — every existing call site only has to replace the hardcoded string literal with this module's
 * own export, never restructure its own argv array.
 *
 * **The bare specifier `--import=tsx/esm` is wrong and was fixed before this ever landed**: unlike
 * `--experimental-strip-types` (a native flag, no module resolution involved at all), `--import`'s
 * value IS resolved as an ESM import specifier — relative to the SPAWNED CHILD's own `cwd`, not to
 * this file's location and not to the repository root. Confirmed live: `cd` to a directory with no
 * `node_modules` ancestry at all and run `node --import=tsx/esm -e "..."` and it throws
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'` — exactly the shape several real call sites in
 * this repository hit (`test/command-steps.test.ts`'s own throwaway project directories, and, most
 * importantly, `packages/cli/bin/forge.mjs` itself, which spawns with no `cwd` override at all, i.e.
 * wherever a real user happens to run `forge` from). `createRequire(import.meta.url).resolve(...)`
 * below resolves `tsx/esm` to an absolute path ONCE, anchored at this file's own location (where
 * `tsx` is a real, installed devDependency), so the child's own `cwd` can never matter.
 *
 * **A plain OS-native absolute path is ALSO wrong on Windows, fixed before this ever landed either**:
 * `--import`'s value goes through the same WHATWG-URL-based ESM specifier algorithm `import()` uses,
 * and on Windows a path beginning with a drive letter (`C:\Users\...`) parses `C:` as a URL *scheme*,
 * not a filesystem root. Confirmed live on a real Node 20.19.6 binary: `node
 * --import='C:\...\index.mjs' noop.mjs` throws `ERR_UNSUPPORTED_ESM_URL_SCHEME ... protocol 'c:'`.
 * `ci.yml`'s own `floor` job runs `windows-latest` x node 20 with no `continue-on-error` — this is the
 * identical bug class `preflight.cjs` (`SPEC-QUESTIONS.md`, commit `1597ab0`) and `scripts/run-tests.
 * mjs` (its own `guardUrl`, line 20) already fix the same way: `pathToFileURL(...).href` turns the
 * OS-native path into a real `file://` URL first, so there is no drive letter sitting where a URL
 * parser looks for a scheme.
 *
 * Resolved once per process from `process.versions.node` (the CURRENTLY RUNNING node, i.e. the
 * parent's own binary) — every real call site in this repository spawns a child with either
 * `process.execPath` or the bare string `'node'` resolved via `PATH`, which in every real environment
 * this repo runs in (local dev, CI) is the identical binary the parent is already running; there is no
 * mechanism anywhere in this codebase that spawns a *different* Node version as a child.
 *
 * **This file is never imported by any SHIPPED production source, and must stay that way.** Its own
 * `TS_NODE_FLAG` eagerly resolves `tsx/esm` (a devDependency never shipped to a real npm consumer) the
 * instant ANY of this module's exports are imported — ES module semantics run a module's whole
 * top-level body on any import, not only the specific binding actually used. Every real caller today
 * is a test file or `packages/cli/bin/forge.mjs` (a dev-only wrapper, excluded from `package.json`'s
 * own `files`, never published) — both fine, since neither is ever bundled into
 * `packages/cli/dist/forge.mjs`. `packages/cli/src/commands/parity/normalize-budget.ts` (a real,
 * shipped file) needs the identical Node-20 stand-in for its own `Worker`'s `execArgv`, which is
 * exactly why that need was split into its own, separate, LAZY module instead of being added here —
 * see `./worker-ts-exec-argv.mjs`'s own doc comment for the real crash this split exists to prevent
 * (a critic found it live, against the real built artifact, `SPEC-QUESTIONS.md` Q340).
 *
 * @see SPEC-QUESTIONS.md Q340
 * @see specs/02 §2.1
 * @see PLAN-M17.md P16
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { SUPPORTS_NATIVE_STRIP_TYPES, supportsNativeStripTypes } from './node-version.mjs';

const require = createRequire(import.meta.url);

export { SUPPORTS_NATIVE_STRIP_TYPES, supportsNativeStripTypes };

/** The single `node` CLI argv element that makes a child `node <TS_NODE_FLAG> some-file.ts`
 * invocation understand TypeScript syntax, chosen for the Node binary this process is actually
 * running under. On Node 20.x, `tsx/esm` is resolved to an absolute `file://` URL HERE (not left as
 * a bare specifier for the spawned child to resolve on its own, which would depend on that child's
 * own `cwd`, and not left as a plain OS-native path, which breaks on Windows — see the module doc
 * comment above) so this works regardless of where a caller spawns its child from, or which OS it
 * runs on. */
export const TS_NODE_FLAG = SUPPORTS_NATIVE_STRIP_TYPES
  ? '--experimental-strip-types'
  : `--import=${pathToFileURL(require.resolve('tsx/esm')).href}`;
