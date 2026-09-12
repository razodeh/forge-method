/**
 * `resolveInstalledModules` — `19` §19.1's own cross-module checks: every `requires` present, every
 * `conflicts` absent, every `forgeVersion` range satisfied, and `provides` overlaps resolved by
 * install order and reported, never silently overridden.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { ForgeError, ProjectPaths, type AbsolutePath } from '@forge/core';
import path from 'node:path';

import { parseModule } from './parse.ts';
import { satisfiesForgeVersionRange } from './version-range.ts';
import { MODULE_ID_PATTERN } from './schema.ts';
import { MODULE_PROVIDES_KINDS } from './types.ts';
import type {
  ModuleDefinition,
  ModuleResolution,
  ProvideConflict,
  ResolveInstalledModulesOptions,
} from './types.ts';

/**
 * Byte-value order on `kind` then `id` — the same "never filesystem/insertion order" reasoning
 * `@forge/core/fs`'s own `listDirSorted` documents, applied here to a report readers will diff
 * between compiles. A standalone, exported function (not an inline comparator passed to `.sort`)
 * so both comparison directions can be tested directly, deterministically, rather than depending on
 * which pairs a given sort algorithm's own internal call pattern happens to compare.
 */
export function compareProvideConflicts(a: ProvideConflict, b: ProvideConflict): -1 | 0 | 1 {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Every `provides` id claimed by more than one installed module, one `ProvideConflict` per id,
 * resolved by install order — `19` §19.1's own literal "resolve by install order": the module
 * installed *latest* wins, the same "a later, more specific layer overrides an earlier one" direction
 * `@forge/extensions/resolve`'s own `Resolver` already uses for L0→L4 overlay layering
 * (`SPEC-QUESTIONS.md` records the recorded choice for the module-install-order case specifically,
 * since `19` §19.1's own prose names the rule but not which end of the list wins).
 */
function findProvideConflicts(
  modules: ReadonlyMap<string, ModuleDefinition>,
): readonly ProvideConflict[] {
  const conflicts: ProvideConflict[] = [];

  for (const kind of MODULE_PROVIDES_KINDS) {
    // `contributors` and `winner` live in one map entry, updated together on every contribution —
    // never two maps a caller could read out of step with each other, which is what would force an
    // "impossible, but TypeScript can't see that" undefined check on `winner` alone.
    const byId = new Map<string, { readonly contributors: string[]; winner: string }>();
    // `modules` is a `Map`, and `Map` iterates in insertion order — the exact order
    // `resolveInstalledModules` inserted each entry in, i.e. install order — so the last
    // contribution seen for a given id is always its most-recently-installed contributor.
    for (const [moduleId, definition] of modules) {
      const ids = (definition.provides[kind] ?? []) as readonly string[];
      for (const id of ids) {
        const existing = byId.get(id);
        if (existing === undefined) {
          byId.set(id, { contributors: [moduleId], winner: moduleId });
        } else {
          existing.contributors.push(moduleId);
          existing.winner = moduleId;
        }
      }
    }
    for (const [id, { contributors, winner }] of byId) {
      if (contributors.length < 2) continue;
      conflicts.push({ kind, id, winner, contributors });
    }
  }

  return [...conflicts].sort(compareProvideConflicts);
}

function checkRequiresAndConflicts(modules: ReadonlyMap<string, ModuleDefinition>): void {
  for (const [moduleId, definition] of modules) {
    for (const requires of definition.requires) {
      if (!modules.has(requires)) {
        throw new ForgeError('CFG-022', { moduleId, requires });
      }
    }
    for (const conflictsWith of definition.conflicts) {
      if (modules.has(conflictsWith)) {
        throw new ForgeError('CFG-023', { moduleId, conflictsWith });
      }
    }
  }
}

function checkForgeVersions(
  modules: ReadonlyMap<string, ModuleDefinition>,
  forgeVersion: string,
): void {
  for (const [moduleId, definition] of modules) {
    if (!satisfiesForgeVersionRange(forgeVersion, definition.forgeVersion)) {
      throw new ForgeError('CFG-024', {
        moduleId,
        forgeVersion,
        required: definition.forgeVersion,
      });
    }
  }
}

/**
 * Parses every module named in `installOrder` from `modulesDir/<id>/module.yaml`, then checks the
 * whole installed set against itself: every `requires` present, every `conflicts` absent, every
 * `forgeVersion` range satisfied against `options.forgeVersion` — real, typed `ForgeError`s, never a
 * silent skip of a module that fails one of these checks.
 *
 * Requires/conflicts/forgeVersion are checked only after every module has parsed successfully, so a
 * malformed manifest (`CFG-021`) is always the failure reported, rather than a `requires` check
 * failing first merely because an unrelated module further down `installOrder` never got the chance
 * to parse.
 *
 * @throws {ForgeError} `CFG-025` if any entry in `installOrder` is not a valid, lower-kebab-case
 * module id — checked before it is ever joined into a filesystem path (see `MODULE_ID_PATTERN`'s
 * own doc comment for why this is a real containment check, not merely a shape check).
 * @throws {ForgeError} `CFG-003` if a module id that does pass `MODULE_ID_PATTERN` names a directory
 * under `modulesDir` that is itself a symlink escaping `modulesDir` — a real hole a `MODULE_ID_PATTERN`
 * string check alone cannot close (a legal-looking id can still be a symlink whose *target* is
 * outside `modulesDir`), so the manifest path is resolved through `@forge/core`'s own
 * `ProjectPaths.resolveWithin` — the same real, symlink-aware containment primitive `specs/02` §2.5
 * establishes for every other write/read boundary in this codebase — rather than a raw `path.join`.
 * @throws {ForgeError} `CFG-021` if any installed module's own `module.yaml` fails to parse.
 * @throws {ForgeError} `CFG-022` if any installed module `requires` a module not present in
 * `installOrder`.
 * @throws {ForgeError} `CFG-023` if any installed module `conflicts` with another module present in
 * `installOrder`.
 * @throws {ForgeError} `CFG-024` if any installed module's `forgeVersion` range does not admit
 * `options.forgeVersion`.
 */
export async function resolveInstalledModules(
  installOrder: readonly string[],
  modulesDir: AbsolutePath,
  options: ResolveInstalledModulesOptions,
): Promise<ModuleResolution> {
  const modules = new Map<string, ModuleDefinition>();
  // Constructed lazily, only once `installOrder` is known to be non-empty: `ProjectPaths`'
  // constructor eagerly requires its root to exist, and an empty `installOrder` (a project with no
  // modules resolved yet) must not force `modulesDir` to exist for no reason.
  let modulesPaths: ProjectPaths | undefined;
  for (const moduleId of installOrder) {
    if (!MODULE_ID_PATTERN.test(moduleId)) {
      throw new ForgeError('CFG-025', { moduleId });
    }
    modulesPaths ??= new ProjectPaths(modulesDir);
    const manifestPath = modulesPaths.resolveWithin(path.posix.join(moduleId, 'module.yaml'));
    modules.set(moduleId, await parseModule(manifestPath));
  }

  checkRequiresAndConflicts(modules);
  checkForgeVersions(modules, options.forgeVersion);

  return { modules, provideConflicts: findProvideConflicts(modules) };
}
