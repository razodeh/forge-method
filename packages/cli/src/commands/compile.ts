/**
 * `forge compile [--check]` — `03` §3.2.8, a thin wrapper over `@forge/extensions/compile`'s own
 * already-built `compile()` (M2).
 *
 * `CompileSources` (every entity's own raw layer contributions, across all six document kinds) is
 * gathered from a real project's own real files — `.forge/agents/`, `.forge/overrides/`, module
 * source, etc. — by a real "gather sources from a project" mechanism that does not exist anywhere in
 * this codebase yet (the same real gap `forge doctor`'s own `checkManifest`/`checkDiagrams` already
 * name for adjacent problems: no concrete "locate my own real project content at runtime" resolver has
 * been built). Rather than fabricate one here, this command takes `sources` as a caller-supplied
 * parameter — the identical "this package cannot gather it itself... passed straight through from the
 * caller" shape `forge diagram generate`/`forge diagram diff`'s own `generatorInput` parameter already
 * establishes in `diagram.ts` for a structurally identical situation. See `SPEC-QUESTIONS.md`.
 *
 * @see specs/03 §3.2.8
 * @see specs/15 §15.2
 */
import {
  compile,
  type CompileOptions,
  type CompileResult,
  type CompileSources,
} from '@forge/extensions/compile';

export function forgeCompile(sources: CompileSources, options: CompileOptions = {}): CompileResult {
  return compile(sources, options);
}
