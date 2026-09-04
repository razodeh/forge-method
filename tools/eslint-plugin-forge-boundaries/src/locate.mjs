/**
 * Maps a file path or an import specifier to the workspace package it belongs to.
 *
 * Plain ESM with JSDoc, not TypeScript — see the note at the top of `graph.mjs`: `eslint.config.js`
 * must `import` this plugin directly under plain `node` when ESLint starts, which cannot load a
 * `.ts` file on this repo's Node floor.
 *
 * Shared by every rule in this plugin, so "what package is this" is answered once. Deliberately
 * folder-based rather than derived from `package.json#name`: a rule runs on a file mid-edit, and
 * reading a manifest for every linted file would make the rule slow and would fail the moment a
 * `package.json` is itself invalid — exactly the state a lint run is likely to catch someone in.
 *
 * @see specs/02 §2.2
 */
import path from 'node:path';

/** @typedef {'packages' | 'tools' | 'modules'} WorkspaceRoot */

/**
 * @typedef {object} ForgeLocation
 * @property {WorkspaceRoot} root
 * @property {string} pkg - The folder name under the root — for `packages/`, a `ForgePackage`.
 * @property {string | undefined} subpath - `undefined` at the package root. Always `/`-separated.
 */

const ROOT_SEGMENT = /(?:^|[\\/])(packages|tools|modules)[\\/]([^\\/]+)(?:[\\/](.*))?$/;

/**
 * Locates an absolute filesystem path within the workspace, or `undefined` if it is outside one.
 * @param {string} absolutePath
 * @returns {ForgeLocation | undefined}
 */
export function locateFile(absolutePath) {
  // Explicit replacement, not `path.sep`: this plugin runs on POSIX in CI and in every contributor's
  // editor, so `path.sep` is always `/` there regardless of which platform authored the path being
  // tested (specs/02 §2.7's own Windows-shaped-path test fixtures included).
  const match = ROOT_SEGMENT.exec(absolutePath.replaceAll('\\', '/'));
  if (match === null) return undefined;
  const [, root, pkg, subpath] = match;
  return { root: /** @type {WorkspaceRoot} */ (root), pkg: pkg ?? '', subpath };
}

/**
 * Locates an import specifier without touching the filesystem.
 *
 * A relative specifier (`.`/`..`) is resolved against `fromFile`'s directory and then located the
 * same way a real file would be — this is what lets a rule catch `../../engine/src/x` as reaching
 * into another package, without needing the module resolver to actually run.
 *
 * A bare `@forge/x[/subpath]` specifier is located directly from the specifier text. Its root is
 * always reported as `'packages'`: the npm scope does not encode which workspace root published it,
 * and every package this plugin's rules act on lives under `packages/`. A specifier naming a real
 * `tools/*` package (there is no legitimate reason for one to exist) is therefore located as if it
 * were an unknown `packages/*` entry — which is exactly the outcome a boundary rule wants, since
 * `PACKAGE_GRAPH` has no `tools/*` members and the import is refused as undeclared either way.
 *
 * @param {string} specifier
 * @param {string} fromFile
 * @returns {ForgeLocation | undefined}
 */
export function locateSpecifier(specifier, fromFile) {
  if (specifier.startsWith('@forge/')) {
    const [pkg, ...rest] = specifier.slice('@forge/'.length).split('/');
    if (pkg === undefined || pkg === '') return undefined;
    return { root: 'packages', pkg, subpath: rest.length > 0 ? rest.join('/') : undefined };
  }

  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(fromFile), specifier);
    return locateFile(resolved);
  }

  // A bare specifier that is not `@forge/*` — a real npm dependency, or a `node:` builtin. Not this
  // plugin's concern.
  return undefined;
}
