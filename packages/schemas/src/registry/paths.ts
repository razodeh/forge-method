/**
 * `renderArtifactPath` — substitutes an artifact type's `pathTemplate` placeholders.
 *
 * Pure and POSIX-only: `specs/02` §2.7 reserves `path.posix` (and, here, plain string templates) for
 * repo-relative artifact ids, distinct from a disk path — this never touches the filesystem, and the
 * string it returns is not itself write-safe until a caller resolves it through
 * `@forge/core/fs`'s `ProjectPaths`. `@forge/schemas` sits below `@forge/core` in `specs/02` §2.2's
 * dependency graph and cannot import it to do that resolution itself.
 *
 * Returns a result rather than throwing: `SPEC-QUESTIONS.md` Q3 answers the same
 * `schemas ← (no forge deps)` tension for `ForgeError` by having `@forge/schemas` "never throw...
 * expose typed validation results," leaving `@forge/core` as the only place a failure becomes a
 * thrown `ForgeError`. A missing template variable is an ordinary, well-typed caller mistake (the
 * `type` itself cannot be unregistered — `ArtifactTypeId` is closed — but nothing stops a caller
 * from omitting a `vars` entry a specific template needs), so it is exactly the kind of failure Q3
 * says belongs in a typed result, not a bare `throw new Error`.
 *
 * @see specs/02 §2.7
 * @see specs/18 §18.7
 * @see SPEC-QUESTIONS.md Q3
 */
import { definitionForType, type ArtifactTypeId } from './artifact-types.ts';

const PLACEHOLDER = /\{(\w+)\}/g;

export type RenderArtifactPathResult =
  | { readonly success: true; readonly path: string }
  | { readonly success: false; readonly missingVariable: string };

/**
 * Renders `type`'s `pathTemplate`, substituting `{name}`-shaped placeholders from `vars`.
 *
 * Fails rather than emitting the literal `{id}` when a placeholder has no matching entry in `vars` —
 * a path that looks plausible and is wrong is worse than one that visibly did not render. `vars` is
 * read through a `Map` built from `Object.entries`, not by bracket-indexing `vars` directly: a direct
 * `vars[name]` would resolve through the prototype chain for a name like `"constructor"` or
 * `"toString"` and return a function instead of `undefined`, silently defeating the missing-variable
 * check for a template that ever used such a name as a placeholder — `Object.entries` only ever
 * enumerates `vars`'s own properties, so the `Map` cannot contain an inherited one. None of the 22
 * registered templates use such a name today, so this specific defense is not exercised by a test
 * against real registry data — recorded as residual risk rather than tested against a synthetic
 * template the public API has no way to register.
 */
export function renderArtifactPath(
  type: ArtifactTypeId,
  vars: Readonly<Record<string, string>>,
): RenderArtifactPathResult {
  const definition = definitionForType(type);
  const ownVars = new Map(Object.entries(vars));
  let missingVariable: string | undefined;

  const path = definition.pathTemplate.replace(PLACEHOLDER, (_placeholder, name: string) => {
    if (missingVariable !== undefined) return ''; // Already failing; the exact text no longer matters.
    const value = ownVars.get(name);
    if (value === undefined) {
      missingVariable = name;
      return '';
    }
    return value;
  });

  return missingVariable === undefined
    ? { success: true, path }
    : { success: false, missingVariable };
}
