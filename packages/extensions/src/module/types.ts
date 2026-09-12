/**
 * Types for `@forge/extensions/module` — `19` §19.1's L1 module layer: `module.yaml`'s own manifest
 * shape, plus what resolving a project's installed set of modules against each other produces.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import type { z } from 'zod';
import type { ProjectLevel, ToolGrant } from '../agents/index.ts';
import type { moduleSchema } from './schema.ts';

/** `19` §19.1's own module-layout diagram: every kind of thing a module's `provides` may list. */
export const MODULE_PROVIDES_KINDS = [
  'agents',
  'workflows',
  'frameworks',
  'gates',
  'checks',
  'skills',
  'artifactTypes',
  'catalog',
  'techniques',
] as const;

export type ModuleProvidesKind = (typeof MODULE_PROVIDES_KINDS)[number];

/** The validated `module.yaml` shape — `z.infer` off `moduleSchema` so the type can never drift from
 * what actually parses. */
export type ModuleDefinition = z.infer<typeof moduleSchema>;

/** `moduleSchema`'s own `levels` field, reusing `@forge/extensions/agents`' `ProjectLevel` rather than
 * a second `L0`-`L4` literal union — the identical axis `19` §19.1's own module-layout diagram and
 * `agents/types.ts`'s own doc comment on `PROJECT_LEVEL_ORDER` both already name. */
export type ModuleLevel = ProjectLevel;

/**
 * One `provides` id two or more installed modules both declare — `19` §19.1's own literal
 * "conflicts... resolve by install order and are reported at compile," distinct from the `conflicts:`
 * field's own hard-failure meaning (`CFG-023`). `contributors` is every module naming this id, in
 * install order; `winner` is whichever one actually supplies it after resolution.
 */
export interface ProvideConflict {
  readonly kind: ModuleProvidesKind;
  readonly id: string;
  readonly winner: string;
  readonly contributors: readonly string[];
}

/** The result of resolving a project's full installed-module set against each other. */
export interface ModuleResolution {
  /** Every installed module's own parsed manifest, keyed by id, in install order. */
  readonly modules: ReadonlyMap<string, ModuleDefinition>;
  /** Every `provides` id more than one installed module declares — `[]` when none overlap. */
  readonly provideConflicts: readonly ProvideConflict[];
}

/** `resolveInstalledModules`'s own extra input the manifest itself cannot supply: the FORGE version
 * actually running, checked against each module's own `forgeVersion` range. Caller-injected rather
 * than read from a hidden global — the same determinism reasoning `@forge/core`'s own `Clock`
 * documents for "now," applied here to "which FORGE version is running." */
export interface ResolveInstalledModulesOptions {
  readonly forgeVersion: string;
}

/** One resolved agent's requested tool grant, ready for `checkModuleCeilings` — the module-layer
 * counterpart of `@forge/extensions/invariants`' own `ToolCeilingCheckInput` (I7), with an `expires`
 * on each escalation this layer actually enforces rather than ignores. */
export interface ModuleCeilingCheckInput {
  readonly agentId: string;
  readonly roleTags: { readonly isReviewOrCritic: boolean; readonly isOps: boolean };
  readonly ceiling: ToolGrant;
  readonly requested: ToolGrant;
  readonly escalations: readonly ModuleEscalation[];
}

/** `19` §19.1's own "exceeding it requires a recorded, expiring escalation" line, as data — the same
 * five fields `@forge/extensions/agents`' own `Escalation` (`15` §15.3.2) already declares, since
 * this is the identical concept (a ceiling widened past its own module, recorded with a reason, an
 * approver, and an expiry) applied at the module-ceiling boundary rather than the agent-overlay one.
 * Kept as its own named type rather than re-exporting `Escalation` verbatim so a future divergence
 * between the two (e.g. a module-level approval chain) is not a breaking rename. */
export interface ModuleEscalation {
  readonly agent: string;
  readonly grant: ToolGrant;
  readonly reason: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly expires: string;
}
