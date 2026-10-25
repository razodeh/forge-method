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
 * Resolved once per process from `process.versions.node` (the CURRENTLY RUNNING node, i.e. the
 * parent's own binary) — every real call site in this repository spawns a child with either
 * `process.execPath` or the bare string `'node'` resolved via `PATH`, which in every real environment
 * this repo runs in (local dev, CI) is the identical binary the parent is already running; there is no
 * mechanism anywhere in this codebase that spawns a *different* Node version as a child.
 *
 * @see SPEC-QUESTIONS.md Q340
 * @see specs/02 §2.1
 * @see PLAN-M17.md P16
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * True iff the given `node` version string (`process.versions.node`'s own format, e.g. `"22.6.0"`)
 * understands `--experimental-strip-types` natively (Node >=22.6.0). A pure function of its one
 * argument, with no dependency on the currently running process, so `node-ts-flag.test.ts` can pin
 * the exact version boundary (22.5.x false, 22.6.0 true, every 20.x false, every 24.x true) without
 * needing a second real Node binary installed to prove it.
 *
 * @param {string} nodeVersion
 */
export function supportsNativeStripTypes(nodeVersion) {
  const [majorStr, minorStr] = nodeVersion.split('.');
  const major = Number(majorStr);
  const minor = Number(minorStr);
  return major > 22 || (major === 22 && minor >= 6);
}

/** True iff the CURRENTLY RUNNING `node` binary understands `--experimental-strip-types` natively
 * (Node >=22.6.0) — exported so a caller that needs to branch on more than just the flag string
 * itself (e.g. whether to also expect Node's own `ExperimentalWarning`) does not have to re-derive
 * this from `process.versions.node` a second time. */
export const SUPPORTS_NATIVE_STRIP_TYPES = supportsNativeStripTypes(process.versions.node);

/** The single `node` CLI argv element that makes a child `node <TS_NODE_FLAG> some-file.ts`
 * invocation understand TypeScript syntax, chosen for the Node binary this process is actually
 * running under. On Node 20.x, `tsx/esm` is resolved to an absolute path HERE (not left as a bare
 * specifier for the spawned child to resolve on its own, which would depend on that child's own
 * `cwd` — see the module doc comment above) so this works regardless of where a caller spawns its
 * child from. */
export const TS_NODE_FLAG = SUPPORTS_NATIVE_STRIP_TYPES
  ? '--experimental-strip-types'
  : `--import=${require.resolve('tsx/esm')}`;
