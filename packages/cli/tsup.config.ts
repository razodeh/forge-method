import { defineConfig } from 'tsup';

/**
 * Produces the real, single-file `dist/forge.mjs` `02` §2.7 names as the published CLI's own `bin`
 * target ("forge-method publishes a single bundled CLI... the CLI does not resolve them at runtime
 * from npm"). Every workspace `@forge/*` dependency stays `"private": true` (SPEC-QUESTIONS.md /
 * `specs/23` decision #1's own P8 update) and is never published to npm, so `@forge/cli` cannot ship
 * as raw TypeScript with `workspace:*` dependencies the way it runs inside this monorepo today — an
 * external consumer's `node_modules` would have no `@forge/core` etc. to resolve. Bundling everything
 * this package's own module graph reaches (workspace packages included) into one file is therefore not
 * a style preference; it is the only way the published package is self-contained.
 *
 * `better-sqlite3` stays external and unbundled: it is a native addon (a compiled `.node` binary, not
 * JS), which esbuild/tsup cannot inline into a text bundle. `@forge/kb`'s own three-tier fallback
 * (`better-sqlite3` optional → `node:sqlite` → JSON index, `specs/23` decision #4) already treats a
 * missing native addon as an expected, handled runtime path, so leaving it external and marking it
 * `optionalDependencies` in the published `package.json` is consistent with that existing design, not
 * a new risk.
 *
 * @see specs/02 §2.7
 * @see specs/23 (open decision #1, P8 update)
 */
export default defineConfig({
  entry: { forge: 'src/bin.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  shims: true,
  minify: false,
  // Every real npm package reachable through the bundled `@forge/*` workspace graph (not just
  // `@forge/cli`'s own direct `dependencies`) must be listed here, or esbuild bundles it in — which
  // silently breaks for any dependency that isn't clean, side-effect-free ESM (confirmed the hard way:
  // `simple-git`'s own `@kwsites/file-exists` dependency uses a dynamic `require("fs")` that a bundled
  // context cannot satisfy, throwing at runtime instead of at build time). Externalizing every real
  // npm dependency — bundling only this repository's own `@forge/*` source — avoids re-implementing
  // per-package CJS/ESM interop fixes for dependencies this project does not own.
  external: [
    'better-sqlite3',
    'node:sqlite',
    '@anthropic-ai/claude-agent-sdk',
    '@modelcontextprotocol/sdk',
    'execa',
    'fast-xml-parser',
    'jsdom',
    'mermaid',
    'minimatch',
    'simple-git',
    'string-width',
    'yaml',
    'zod',
    'zod-to-json-schema',
  ],
  noExternal: [/^@forge\//],
  banner: { js: '#!/usr/bin/env node' },
  outExtension: () => ({ js: '.mjs' }),
});
