/**
 * `proposeLevel` — `01` §1.9's own level-selection heuristic ("implemented in
 * `@forge/methods/level.ts`... MUST show its reasoning and MUST be overridable"), `03` §3.3 step 4's
 * own "auto-proposed L0-L4 with reasoning shown; confirm or override."
 *
 * `01` §1.9 names the seven signals this heuristic considers but gives the table of levels, not a
 * derivation algorithm -- the actual decision rules below are this piece's own invented resolution of
 * that spec silence (recorded in `SPEC-QUESTIONS.md`), not a literal spec quote.
 *
 * @see specs/01 §1.9
 * @see PLAN-M6.md M3
 */
import type { LevelProposal, LevelSignals } from './types.ts';

/** Pure, deterministic (R10): identical `signals` always propose the identical level and reasoning. */
export function proposeLevel(signals: LevelSignals): LevelProposal {
  const {
    greenfield,
    userFacingCapabilities,
    deployableUnits,
    hasPersistentState,
    hasExternalIntegrations,
    regulatory,
    multiRuntime,
  } = signals;

  // L4 (Platform): "multi-service/multi-team system, migrations, compliance" -- any one of a
  // regulatory flag, more than one runtime/language, or more than one deployable unit already puts a
  // project in that shape, regardless of every other signal.
  if (regulatory)
    return { level: 'L4', reasoning: 'regulatory flags are set (01 §1.9 Platform row).' };
  if (multiRuntime) {
    return {
      level: 'L4',
      reasoning: 'more than one runtime/language is involved (01 §1.9 Platform row).',
    };
  }
  if (deployableUnits > 1) {
    return {
      level: 'L4',
      reasoning: `${String(deployableUnits)} deployable units (multi-service, 01 §1.9 Platform row).`,
    };
  }

  // L3 (Product): "new product, greenfield".
  if (greenfield) {
    return { level: 'L3', reasoning: 'greenfield (01 §1.9 Product row).' };
  }

  // L2 (Capability): "new subsystem/service in an existing product" -- more than one new user-facing
  // capability, persistent state, or an external integration all signal a real subsystem, not a small
  // feature slotted into what already exists.
  if (userFacingCapabilities >= 2) {
    return {
      level: 'L2',
      reasoning: `${String(userFacingCapabilities)} user-facing capabilities (01 §1.9 Capability row).`,
    };
  }
  if (hasPersistentState) {
    return { level: 'L2', reasoning: 'introduces persistent state (01 §1.9 Capability row).' };
  }
  if (hasExternalIntegrations) {
    return {
      level: 'L2',
      reasoning: 'introduces an external integration (01 §1.9 Capability row).',
    };
  }

  // L1 (Feature): "1-3 stories inside an existing system" -- one new user-facing capability, brownfield,
  // with no persistent-state or integration signal.
  if (userFacingCapabilities === 1) {
    return {
      level: 'L1',
      reasoning: 'one user-facing capability, brownfield (01 §1.9 Feature row).',
    };
  }

  // L0 (Patch): everything else -- brownfield, no new user-facing capability, no state/integration/
  // multi-service/regulatory signal at all.
  return {
    level: 'L0',
    reasoning: 'no new user-facing capability, state, or integration signal (01 §1.9 Patch row).',
  };
}
