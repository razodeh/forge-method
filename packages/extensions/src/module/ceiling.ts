/**
 * `ceilingForAgent`, `checkModuleCeilings` — `19` §19.1's own ceiling-enforcement line: "a project
 * overlay can narrow within the ceiling or widen up to it, but exceeding it requires a recorded,
 * expiring escalation."
 *
 * The actual grant-vs-ceiling diffing is not reimplemented here: `@forge/extensions/agents`' own
 * `checkToolCeiling` (`15` §15.3.2) already does exactly this, and `@forge/extensions/invariants`' own
 * `checkToolCeilings` (I7, `CFG-507`) already wires it into the whole-resolved-set compile report.
 * What is genuinely new at this layer is `expires`: `checkToolCeiling` matches an escalation by agent
 * id alone and never reads its own `expires` field, so a lapsed escalation record currently still
 * suppresses a ceiling violation there — this module's own job (`PLAN-M10.md` P2's own Checks: "an
 * expired escalation record does not [suppress it]") is filtering to only the escalations that are
 * still active *before* handing off to the already-real, already-tested ceiling check, not a second
 * copy of that check's own field-by-field diffing logic.
 *
 * @see specs/19 §19.1
 * @see PLAN-M10.md P2
 */
import { checkToolCeilings, type InvariantViolation } from '../invariants/index.ts';
import type {
  ModuleCeilingCheckInput,
  ModuleDefinition,
  ModuleEscalation,
  ModuleResolution,
} from './types.ts';

/**
 * Whether `escalation` is still active at `now` (epoch milliseconds, caller-injected — the identical
 * "never an uninjected `Date.now()`" determinism rule `@forge/engine/gates`' own `applyWaiver`
 * documents for its own `expiresAt`, applied here to a module ceiling escalation's `expires` instead).
 *
 * An escalation expiring at exactly `now`, or whose `expires` does not even parse as a real instant,
 * is treated as already lapsed — fail closed, the same direction `applyWaiver`/`isApproved` already
 * take for a gate waiver's own expiry.
 */
export function isModuleEscalationActive(escalation: ModuleEscalation, now: number): boolean {
  const expiresAt = Date.parse(escalation.expires);
  return !Number.isNaN(expiresAt) && expiresAt > now;
}

/**
 * Which installed module's own `ceilings` entry governs `agentId`, after `provideConflicts` has
 * already resolved which module wins a `provides.agents` overlap — `undefined` if no installed module
 * `provides.agents` names `agentId` at all (nothing to enforce a ceiling from).
 */
export function moduleOwning(
  agentId: string,
  resolution: ModuleResolution,
): ModuleDefinition | undefined {
  const conflict = resolution.provideConflicts.find(
    (entry) => entry.kind === 'agents' && entry.id === agentId,
  );
  if (conflict !== undefined) return resolution.modules.get(conflict.winner);

  for (const definition of resolution.modules.values()) {
    if ((definition.provides.agents ?? []).includes(agentId)) return definition;
  }
  return undefined;
}

/**
 * `checks`, with every input's own `escalations` narrowed to only those still active at `now`, then
 * handed to the real, already-tested `checkToolCeilings` (I7, `CFG-507`) — so a lapsed escalation
 * record reads exactly as if it were never recorded at all, and a compile report naming the offending
 * grant and the ceiling it exceeds comes from the one place that already renders that message.
 */
export function checkModuleCeilings(
  checks: readonly ModuleCeilingCheckInput[],
  now: number,
): readonly InvariantViolation[] {
  return checkToolCeilings(
    checks.map((check) => ({
      ...check,
      escalations: check.escalations.filter((escalation) =>
        isModuleEscalationActive(escalation, now),
      ),
    })),
  );
}
