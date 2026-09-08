/**
 * `resolvePackageRoot`/`readPackageManifest` — locating and reading another workspace package's own
 * install directory from inside `@forge/cli`, the way `@forge/diagrams/render/bundle.ts` already does
 * for `mermaid` (`import.meta.resolve` + `fileURLToPath`, this repository's own established pattern
 * for reading a dependency's own shipped files at runtime).
 *
 * Not `import.meta.resolve('<pkg>/package.json')` directly: none of this workspace's own `@forge/*`
 * packages declare a `./package.json` subpath in their own `exports` map (only `mermaid` happens to),
 * so that specifier fails to resolve at all. Every package's `"."` entry, by contrast, is guaranteed
 * to exist — resolved once, then walked upward to the first ancestor directory whose own
 * `package.json` really is `name`'s, which works regardless of how deep that package nests its own
 * entry file under `src/`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The upward walk itself, separated from `import.meta.resolve` so it can be exercised directly
 * against a real, hand-built directory tree — `import.meta.resolve` only ever resolves this
 * workspace's own real installed packages, which cannot exhibit the "found *a* package.json, but the
 * wrong one" or "found none at all" cases this function also has to handle correctly.
 */
export function walkUpForPackageJson(startDir: string, name: string): string {
  let dir = startDir;
  for (;;) {
    const manifestPath = path.join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        readonly name?: unknown;
      };
      if (manifest.name === name) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find package.json for ${name} above ${startDir}`);
    }
    dir = parent;
  }
}

export function resolvePackageRoot(name: string): string {
  return walkUpForPackageJson(path.dirname(fileURLToPath(import.meta.resolve(name))), name);
}

export function readPackageVersion(name: string): string {
  const manifestPath = path.join(resolvePackageRoot(name), 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { readonly version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
}
