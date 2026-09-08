/**
 * `ProjectLevel`/`LevelSignals` — `01` §1.9's own L0-L4 scale-adaptive-level table and the signal set
 * that section names verbatim: "greenfield vs brownfield, number of user-facing capabilities, number of
 * deployable units, presence of persistent state, presence of external integrations, regulatory flags,
 * and whether more than one runtime/language is involved."
 *
 * @see specs/01 §1.9
 * @see PLAN-M6.md M3
 */

/** `@forge/extensions/agents` already declares this identical five-value union (M2), but `02` §2.2's own
 * boundary graph gives `@forge/methods` no `extensions` edge (`methods`/`extensions` are graph peers,
 * neither can import the other) -- a second, independent declaration, the same small, unavoidable
 * duplication `../expr.ts` already accepts for the identical boundary reason. */
export type ProjectLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface LevelSignals {
  readonly greenfield: boolean;
  readonly userFacingCapabilities: number;
  readonly deployableUnits: number;
  readonly hasPersistentState: boolean;
  readonly hasExternalIntegrations: boolean;
  readonly regulatory: boolean;
  readonly multiRuntime: boolean;
}

export interface LevelProposal {
  readonly level: ProjectLevel;
  readonly reasoning: string;
}

/** `10` §10.2's own ten lifecycle phases, `P0`-`P10`. */
export type LifecyclePhase =
  'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9' | 'P10';
