/**
 * The bundled Mermaid script's exact text and version, read from this package's own pinned `mermaid`
 * dependency — never fetched over a network, never re-read once loaded, so `renderHtml` stays a pure
 * function of its own explicit inputs plus these build-time constants (R10).
 *
 * `mermaid/dist/mermaid.min.js` is `mermaid`'s own global-scope build: it assigns
 * `globalThis["mermaid"]` and needs no module loader of its own, so it is safe to paste verbatim into
 * an inline `<script>` element with no `type="module"` and no bundler.
 *
 * The 3.5MB script text is loaded lazily, on first actual use, not at module import — a gauntlet
 * critic measured that an eager top-level read cost every consumer of this *package* (not just of
 * `renderHtml`) the full read and heap cost the moment anything imported `@forge/diagrams` at all,
 * since `render` shares one barrel file with `parse`/`lint`/`generate`/`drift` — directly working
 * against `08` §8.11.8's own stated design, that the validate-only path needs "no browser, no
 * network... this is what runs in gates and CI," i.e. stays lightweight. `BUNDLED_MERMAID_VERSION`
 * (a short string, not the 3.5MB script) is cheap enough to stay eager.
 *
 * @see specs/08 §8.11.8
 * @see specs/20 §20.6 ("the bundled Mermaid script ... is version-pinned and integrity-checked" —
 *   satisfied by the exact `package.json` pin plus the committed lockfile's own integrity hash, both
 *   already in force repo-wide; this module does not reimplement that check)
 * @see SPEC-QUESTIONS.md Q48
 * @see PLAN-M3.md P5
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readOwnDependencyFile(specifier: string): string {
  return readFileSync(fileURLToPath(import.meta.resolve(specifier)), 'utf8');
}

interface MermaidPackageJson {
  readonly version: string;
}

let cachedScript: string | undefined;

/** `mermaid`'s own minified global-scope UMD build, verbatim — read from disk once, on first call,
 * and memoized for every call after. */
export function getBundledMermaidScript(): string {
  cachedScript ??= readOwnDependencyFile('mermaid/dist/mermaid.min.js');
  return cachedScript;
}

/** The installed `mermaid` package's own version — kept in lockstep with the bundled script
 * automatically, since both are read from the same installed package rather than maintained as two
 * independent constants. */
export const BUNDLED_MERMAID_VERSION: string = (
  JSON.parse(readOwnDependencyFile('mermaid/package.json')) as MermaidPackageJson
).version;
