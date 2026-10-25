import { defineConfig, type Options } from 'tsup';

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
 * A SECOND entry, `normalize-worker`, produces `dist/normalize-worker.mjs` — a real, precompiled,
 * plain-JS build of `normalize-budget.ts`'s own `node:worker_threads.Worker` entry file
 * (`normalize-worker.ts`). `normalize-worker.ts` itself is never published (`package.json`'s own
 * `files` lists only `dist` and `bin/preflight.cjs`), so without this, the published CLI's worker
 * would try to spawn a `.ts` source file that simply does not exist in a real npm install — a real,
 * confirmed bug this second entry fixes, not a hypothetical one (`SPEC-QUESTIONS.md` Q340):
 * `normalize-budget.ts` checks for this file's own existence at runtime and prefers it over the raw
 * `.ts` source whenever it is present (a built package, dev included), needing no Node-version-aware
 * TypeScript-stripping flag for it at all, since it is already plain, compiled JS.
 *
 * A THIRD entry, `normalize-library-worker`, produces `dist/normalize-library-worker.mjs` — the
 * identical treatment for `normalize-library-budget.ts`'s own worker entry file
 * (`normalize-library-worker.ts`, `SPEC-QUESTIONS.md` Q317 Decision 8's `redact-json-pointers`
 * ReDoS-bound mechanism), landed without a build entry of its own at first: caught and fixed during
 * this piece's own landing, not by a dedicated gauntlet round, since no critic worked against a real
 * built artifact the way `Q340` itself was eventually caught. Without this entry, the published CLI's
 * `library`-surface worker would try to spawn a `.ts` source file that does not exist in a real npm
 * install — the exact Q340 regression, reincarnated for this second worker.
 *
 * @see specs/02 §2.7
 * @see specs/23 (open decision #1, P8 update)
 * @see SPEC-QUESTIONS.md Q340
 * @see SPEC-QUESTIONS.md Q317 Decision 8
 */
const common = {
  format: ['esm'] satisfies Options['format'],
  platform: 'node' as const,
  target: 'node20',
  outDir: 'dist',
  splitting: false,
  sourcemap: false,
  dts: false,
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
  outExtension: () => ({ js: '.mjs' }) as const,
};

export default defineConfig([
  {
    ...common,
    entry: { forge: 'src/bin.ts' },
    clean: true,
    shims: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    ...common,
    entry: { 'normalize-worker': 'src/commands/parity/normalize-worker.ts' },
    // Not the CLI's own entry point and never run via a shebang — no banner, and `clean: false` so
    // this second build does not wipe out the first one's own `dist/forge.mjs` (tsup/esbuild's
    // `clean` option empties the whole `outDir` once, regardless of which entry triggers it; only
    // ONE of this array's three configs may safely set it `true`).
    clean: false,
    shims: false,
  },
  {
    ...common,
    entry: { 'normalize-library-worker': 'src/commands/parity/normalize-library-worker.ts' },
    // Same reasoning as the `normalize-worker` entry immediately above, for the `library`-surface
    // sibling worker — never the CLI's own entry point, no banner, and `clean: false` for the
    // identical reason (only one of this array's three configs may wipe `outDir`).
    clean: false,
    shims: false,
  },
]);
