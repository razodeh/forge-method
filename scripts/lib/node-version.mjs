/**
 * Pure, side-effect-free Node-version detection — no `require.resolve`, no filesystem access, no
 * dependency resolution of any kind. Safe to import from ANY context, including code that ends up
 * bundled into a published npm artifact (`packages/cli/dist/forge.mjs`).
 *
 * Split out of `./node-ts-flag.mjs` specifically because THAT file's own `TS_NODE_FLAG` constant
 * eagerly resolves `tsx/esm` (a devDependency never shipped to a real npm consumer) the instant ANY
 * of its exports are imported — ES module semantics run a module's whole top-level body on any
 * import, not only the specific binding actually used. `packages/cli/src/commands/parity/
 * normalize-budget.ts` (a real, shipped production file) importing anything from `node-ts-flag.mjs`
 * at all would therefore pull that eager resolve into the published bundle too — exactly what turned
 * a narrow "one worker path is broken on Node 20" finding into "the published CLI does not start at
 * all on Node 20" (a real critic finding, confirmed live against the actual built artifact,
 * `SPEC-QUESTIONS.md` Q340). `./worker-ts-exec-argv.mjs` depends on this file instead, never on
 * `node-ts-flag.mjs`.
 *
 * @see SPEC-QUESTIONS.md Q340
 */

/**
 * True iff the given `node` version string (`process.versions.node`'s own format, e.g. `"22.6.0"`)
 * understands `--experimental-strip-types` natively (Node >=22.6.0). A pure function of its one
 * argument, with no dependency on the currently running process, so a test can pin the exact version
 * boundary (22.5.x false, 22.6.0 true, every 20.x false, every 24.x true) without needing a second
 * real Node binary installed to prove it.
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
 * (Node >=22.6.0). */
export const SUPPORTS_NATIVE_STRIP_TYPES = supportsNativeStripTypes(process.versions.node);
