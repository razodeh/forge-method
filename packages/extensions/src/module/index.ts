/**
 * `@forge/extensions/module` — L1 module compilation: `module.yaml` schema, parsing, and
 * `requires`/`conflicts`/`forgeVersion`/ceiling enforcement (`19` §19.1).
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
export { checkModuleCeilings, isModuleEscalationActive, moduleOwning } from './ceiling.ts';
export { parseModule } from './parse.ts';
export { compareProvideConflicts, resolveInstalledModules } from './resolve.ts';
export { moduleSchema } from './schema.ts';
export {
  MODULE_PROVIDES_KINDS,
  type ModuleCeilingCheckInput,
  type ModuleDefinition,
  type ModuleEscalation,
  type ModuleLevel,
  type ModuleProvidesKind,
  type ModuleResolution,
  type ProvideConflict,
  type ResolveInstalledModulesOptions,
} from './types.ts';
export { parseModuleVersionRange, satisfiesForgeVersionRange } from './version-range.ts';
