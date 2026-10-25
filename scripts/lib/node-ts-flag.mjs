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
 * existed. On Node 20.x, this resolves to `--import=tsx/esm` instead — `tsx` (a real devDependency,
 * confirmed working end to end against this repository's own real `.ts` sources, including the real
 * `packages/cli/src/bin.ts` entry point, on a real Node 20.19.6 binary) is Node 20's own stand-in.
 * Deliberately kept as the identical "one flag, then the script path" argv shape
 * `--experimental-strip-types` already has (`--import=X`, not `--import X`, is one argv element, not
 * two) — every existing call site only has to replace the hardcoded string literal with this module's
 * own export, never restructure its own argv array.
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

function supportsNativeStripTypes() {
  const [majorStr, minorStr] = process.versions.node.split('.');
  const major = Number(majorStr);
  const minor = Number(minorStr);
  return major > 22 || (major === 22 && minor >= 6);
}

/** True iff the CURRENTLY RUNNING `node` binary understands `--experimental-strip-types` natively
 * (Node >=22.6.0) — exported so a caller that needs to branch on more than just the flag string
 * itself (e.g. whether to also expect Node's own `ExperimentalWarning`) does not have to re-derive
 * this from `process.versions.node` a second time. */
export const SUPPORTS_NATIVE_STRIP_TYPES = supportsNativeStripTypes();

/** The single `node` CLI argv element that makes a child `node <TS_NODE_FLAG> some-file.ts`
 * invocation understand TypeScript syntax, chosen for the Node binary this process is actually
 * running under. */
export const TS_NODE_FLAG = SUPPORTS_NATIVE_STRIP_TYPES
  ? '--experimental-strip-types'
  : '--import=tsx/esm';
