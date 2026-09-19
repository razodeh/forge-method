/**
 * `checkToolCeiling` — `15` §15.3.2: an overlay may narrow within a module's declared ceiling, or
 * widen up to it; widening past it needs a matching, non-refused escalation.
 *
 * @see specs/15 §15.3.2
 * @see PLAN-M2.md P3
 */
import type { Escalation, ToolGrant } from './types.ts';

const NETWORK_ORDER: Record<NonNullable<ToolGrant['network']>, number> = {
  none: 0,
  allowlist: 1,
  full: 2,
};

function exceedsBoolean(requested: boolean | undefined, ceiling: boolean | undefined): boolean {
  return (requested ?? false) && !(ceiling ?? false);
}

function resolvedNetwork(value: ToolGrant['network']): NonNullable<ToolGrant['network']> {
  return value ?? 'none';
}

function exceedsNetwork(requested: ToolGrant['network'], ceiling: ToolGrant['network']): boolean {
  return NETWORK_ORDER[resolvedNetwork(requested)] > NETWORK_ORDER[resolvedNetwork(ceiling)];
}

/** The requested array items not present in the ceiling's own array — empty when fully within it. */
function excessItems(
  requested: readonly string[] | undefined,
  ceiling: readonly string[] | undefined,
): readonly string[] {
  const allowed = new Set(ceiling ?? []);
  return (requested ?? []).filter((item) => !allowed.has(item));
}

export interface CeilingViolation {
  readonly field: 'write' | 'deploy' | 'network' | 'exec' | 'allowlistHosts';
  readonly detail: string;
}

export type CeilingResult =
  | { readonly allowed: true; readonly usedEscalation: boolean }
  | { readonly allowed: false; readonly violations: readonly CeilingViolation[] };

/** Every dimension `requested` exceeds `ceiling` on, empty when `requested` is fully within it. */
function findViolations(ceiling: ToolGrant, requested: ToolGrant): readonly CeilingViolation[] {
  const violations: CeilingViolation[] = [];
  if (exceedsBoolean(requested.write, ceiling.write)) {
    violations.push({ field: 'write', detail: 'requests write access the ceiling does not grant' });
  }
  if (exceedsBoolean(requested.deploy, ceiling.deploy)) {
    violations.push({
      field: 'deploy',
      detail: 'requests deploy access the ceiling does not grant',
    });
  }
  if (exceedsNetwork(requested.network, ceiling.network)) {
    violations.push({
      field: 'network',
      detail: `requests network ${resolvedNetwork(requested.network)}, above the ceiling of ${resolvedNetwork(ceiling.network)}`,
    });
  }
  const extraExec = excessItems(requested.exec, ceiling.exec);
  if (extraExec.length > 0) {
    violations.push({
      field: 'exec',
      detail: `requests exec patterns outside the ceiling: ${extraExec.join(', ')}`,
    });
  }
  const extraHosts = excessItems(requested.allowlistHosts, ceiling.allowlistHosts);
  if (extraHosts.length > 0) {
    violations.push({
      field: 'allowlistHosts',
      detail: `requests allowlist hosts outside the ceiling: ${extraHosts.join(', ')}`,
    });
  }
  return violations;
}

/**
 * Whether `escalation` is itself a legal escalation, per `15` §15.3.2's named exception — never a
 * general ceiling rule, so this does not depend on `ceiling`/`requested` at all.
 */
export function isEscalationRefused(
  escalation: Escalation,
  roleTags: { readonly isReviewOrCritic: boolean; readonly isOps: boolean },
): boolean {
  if (escalation.grant.write === true && roleTags.isReviewOrCritic) return true;
  if (escalation.grant.deploy === true && !roleTags.isOps) return true;
  return false;
}

/**
 * `ceiling` with `escalation`'s own fields overriding it — `15` §15.3.2's own worked example states
 * an escalation's `grant` as only the fields it widens (`{ deploy: true, network: full }`, nothing
 * about `write`/`exec`), so checking a request against `escalation.grant` alone would treat every
 * field the escalation is silent on as denied, refusing a request the *ceiling* already permits.
 *
 * Exported: this is a generic "base grant, then an override's own defined fields win" merge, not
 * inherently escalation-specific — `PLAN-M13.md` P4 reuses it unchanged for the identical operation
 * applying a project overlay's own requested `tools:` on top of an agent's base declared grant, rather
 * than a second, drifting copy of this same field-by-field merge.
 */
export function mergeGrants(ceiling: ToolGrant, escalation: ToolGrant): ToolGrant {
  // Spreading `escalation` directly could set a key to a literal `undefined` (`exactOptionalPropertyTypes`
  // treats "key absent" and "key present with value undefined" as different things) if `escalation`
  // itself ever carried one — filtering first means only escalation's genuinely-defined fields
  // override the ceiling's.
  const overrides = Object.fromEntries(
    Object.entries(escalation).filter(([, value]) => value !== undefined),
  );
  return { ...ceiling, ...overrides };
}

/**
 * `agentId`'s `requested` grant against `ceiling`, consulting `escalations` (already scoped to
 * whichever ones name `agentId`) only for the dimensions that actually exceed the ceiling.
 */
export function checkToolCeiling(
  agentId: string,
  roleTags: { readonly isReviewOrCritic: boolean; readonly isOps: boolean },
  ceiling: ToolGrant,
  requested: ToolGrant,
  escalations: readonly Escalation[],
): CeilingResult {
  const violations = findViolations(ceiling, requested);
  if (violations.length === 0) return { allowed: true, usedEscalation: false };

  const escalation = escalations.find((entry) => entry.agent === agentId);
  if (escalation === undefined || isEscalationRefused(escalation, roleTags)) {
    return { allowed: false, violations };
  }

  const stillViolated = findViolations(mergeGrants(ceiling, escalation.grant), requested);
  if (stillViolated.length > 0) {
    return { allowed: false, violations: stillViolated };
  }
  return { allowed: true, usedEscalation: true };
}
