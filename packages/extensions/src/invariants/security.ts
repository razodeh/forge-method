/**
 * `checkToolCeilings` (I7), `checkNoSecretLiterals` (I8), `checkNoInjectionContent` (I9) —
 * `15` §15.10's security invariants. `SPEC-QUESTIONS.md` Q40 records why these register as
 * `CFG-507`/`CFG-508`/`CFG-509` rather than the spec table's own `SEC-*` codes (and one slot higher
 * than Q40's own first draft, to avoid colliding with a slot `SPEC-QUESTIONS.md` Q35 had already
 * reserved for a different guardrail).
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 * @see SPEC-QUESTIONS.md Q40
 */
import { checkToolCeiling } from '../agents/index.ts';
import { SECRET_REFERENCE_PATTERN } from '../mcp/index.ts';
import { INJECTION_PATTERNS, SECRET_PATTERNS } from '../skills/index.ts';
import { violation } from './violation.ts';
import type { InvariantViolation, ScanTarget, ToolCeilingCheckInput } from './types.ts';

/**
 * The whole-resolved-set re-assertion of `PLAN-M2.md` P3's own `checkToolCeiling` — same check,
 * carrying I7's own code rather than P3's roster-level, code-free `CeilingViolation` shape.
 */
export function checkToolCeilings(
  checks: readonly ToolCeilingCheckInput[],
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const check of checks) {
    const result = checkToolCeiling(
      check.agentId,
      check.roleTags,
      check.ceiling,
      check.requested,
      check.escalations,
    );
    if (result.allowed) continue;
    for (const ceilingViolation of result.violations) {
      violations.push(
        violation('I7', 'CFG-507', {
          role: check.agentId,
          field: ceilingViolation.field,
          detail: ceilingViolation.detail,
        }),
      );
    }
  }
  return violations;
}

/**
 * "Secrets cannot be placed in prompts, artifacts, skills, or the KB." A `${secret:<name>}`
 * reference (`@forge/extensions/mcp`'s own `SECRET_REFERENCE_PATTERN`) is never flagged; a literal
 * matching one of `@forge/extensions/skills`' own `SECRET_PATTERNS` (shared, not re-derived, so this
 * and P4's own skill-level scan can never drift into checking two different things) is.
 */
export function checkNoSecretLiterals(
  targets: readonly ScanTarget[],
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const target of targets) {
    if (SECRET_REFERENCE_PATTERN.test(target.text)) continue;
    if (!SECRET_PATTERNS.some((pattern) => pattern.test(target.text))) continue;
    violations.push(violation('I8', 'CFG-508', { location: target.location }));
  }
  return violations;
}

/**
 * "Skills and MCP results cannot alter the FORGE operating contract, tool grants, or autonomy" —
 * the whole-resolved-set re-assertion of `PLAN-M2.md` P4's own `INJECTION_PATTERNS` (reused, not
 * re-derived, for the same reason as `checkNoSecretLiterals`).
 */
export function checkNoInjectionContent(
  targets: readonly ScanTarget[],
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const target of targets) {
    if (!INJECTION_PATTERNS.some((pattern) => pattern.test(target.text))) continue;
    violations.push(violation('I9', 'CFG-509', { location: target.location }));
  }
  return violations;
}
