/**
 * `REQUIRED_ROLES`, `checkRequiredRoles`, `checkCustomAgents`, `checkSplitFileOwnership` — `15`
 * §15.3.3's roster rules.
 *
 * @see specs/15 §15.3.3
 * @see specs/15 §15.3.4
 * @see PLAN-M2.md P3
 * @see SPEC-QUESTIONS.md Q32
 */
import type { RosterConfig } from './schema.ts';
import { PROJECT_LEVEL_ORDER, type ProjectLevel, type RequiredRole } from './types.ts';

/**
 * `15` §15.3.3's own list, verbatim: "orchestrator, pm (L2+), architect (L2+), test-architect (L1+),
 * reviewer, diagnostician" — the three named with no level qualifier are required from `L0`.
 */
export const REQUIRED_ROLES: readonly RequiredRole[] = [
  { role: 'orchestrator', minLevel: 'L0' },
  { role: 'pm', minLevel: 'L2' },
  { role: 'architect', minLevel: 'L2' },
  { role: 'test-architect', minLevel: 'L1' },
  { role: 'reviewer', minLevel: 'L0' },
  { role: 'diagnostician', minLevel: 'L0' },
] as const;

/** Roles whose refusal message names the specific failure mode disabling them causes. */
const NAMED_FAILURE_MODE_ROLES = new Set(['reviewer', 'test-architect']);

export function isLevelAtLeast(level: ProjectLevel, minLevel: ProjectLevel): boolean {
  return PROJECT_LEVEL_ORDER.indexOf(level) >= PROJECT_LEVEL_ORDER.indexOf(minLevel);
}

export interface RoleViolation {
  readonly kind:
    'required-role-disabled' | 'custom-agent-unconstrained' | 'overlapping-file-ownership';
  readonly detail: string;
}

/**
 * Every required role `roster.disable` turns off at or above its own `minLevel`.
 *
 * `roster.enable` ("turn on optional roles") is netted against `disable` first: composing a preset
 * (which may disable a role) with a project override that re-enables it (`disable: [...], enable:
 * [...]` both naming the same role in the one resolved roster `15` §15.3.3 describes) is the
 * documented way to undo a preset's disable, and `enable` — the more specific, deliberate signal —
 * wins when both name the same role, exactly like a later customization layer overriding an earlier
 * one.
 */
export function checkRequiredRoles(
  roster: RosterConfig,
  currentLevel: ProjectLevel,
): readonly RoleViolation[] {
  const enabled = new Set(roster.enable ?? []);
  const disabled = new Set((roster.disable ?? []).filter((role) => !enabled.has(role)));
  const violations: RoleViolation[] = [];
  for (const required of REQUIRED_ROLES) {
    if (!isLevelAtLeast(currentLevel, required.minLevel)) continue;
    if (!disabled.has(required.role)) continue;
    violations.push({
      kind: 'required-role-disabled',
      detail: NAMED_FAILURE_MODE_ROLES.has(required.role)
        ? `Disabling "${required.role}" is refused: it is the fast path to the failure modes FORGE exists to prevent. Use "autonomy" settings instead.`
        : `"${required.role}" is required at ${currentLevel} and cannot be disabled.`,
    });
  }
  return violations;
}

const CUSTOM_AGENT_REQUIRED_FIELDS = [
  'decisions_owned',
  'outputs',
  'file_ownership',
  'tools',
] as const;

/** `15` §15.3.4: "there is no unconstrained agent" — every `roster.add` entry must declare all four. */
export function checkCustomAgents(roster: RosterConfig): readonly RoleViolation[] {
  const violations: RoleViolation[] = [];
  for (const agent of roster.add ?? []) {
    const missing = CUSTOM_AGENT_REQUIRED_FIELDS.filter((field) => {
      const value = agent[field];
      return value === undefined || (Array.isArray(value) && value.length === 0);
    });
    if (missing.length > 0) {
      violations.push({
        kind: 'custom-agent-unconstrained',
        detail: `Custom agent "${agent.id}" is missing ${missing.join(', ')} — there is no unconstrained agent.`,
      });
    }
  }
  return violations;
}

/**
 * `15` §15.3.3: `roster.split` siblings' `file_ownership` claims must be disjoint. Exact-path
 * comparison only — detecting that two glob patterns like `src/api/**` and `src/api/admin/**`
 * overlap semantically needs a real glob-intersection algorithm this piece does not have a spec
 * source to justify inventing; two siblings claiming the identical literal pattern is what this
 * catches.
 */
export function checkSplitFileOwnership(roster: RosterConfig): readonly RoleViolation[] {
  const violations: RoleViolation[] = [];
  for (const [baseRole, siblings] of Object.entries(roster.split ?? {})) {
    for (const [i, first] of siblings.entries()) {
      for (const second of siblings.slice(i + 1)) {
        const firstClaims = new Set(first.file_ownership ?? []);
        const overlap = (second.file_ownership ?? []).filter((path) => firstClaims.has(path));
        if (overlap.length > 0) {
          violations.push({
            kind: 'overlapping-file-ownership',
            detail: `"${baseRole}" split siblings "${first.id}" and "${second.id}" both claim: ${overlap.join(', ')}.`,
          });
        }
      }
    }
  }
  return violations;
}
