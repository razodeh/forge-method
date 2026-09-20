/**
 * `forge doctor --rule <name>` — the deterministic environment checks the shipped gates name (`10` §10.3, `14`
 * §14.9): `clean-build`, `reproducible-install`, `ci-skeleton` (`G-Foundation`), `secrets-resolved` (`G-Deliver`)
 * and `skeleton-deployed` (`G-Foundation`, added by `PLAN-M13.md` P25 to close the spec-versus-gate gap of `11`
 * F-INIT-7 / `14` §14.9). `test-command` is also named by `G-Foundation` and is owned by P23; it is not accepted
 * here, and the coverage test pins that.
 *
 * Every rule is deterministic and reads project state only (committed files, project documents, the environment
 * snapshot it is handed): no build, no install, no network, no clock, no model. A rule that cannot read its input
 * reports a violation naming what it could not read; it never skips and never passes. The gate reads `errors` from
 * the envelope `bin.ts` prints (`{v:1, rule, errors, violations}`), like `spec validate --rule`, and each
 * violation carries a `remedy` because an error without one fails review (`QUALITY-BAR.md`).
 *
 * @see specs/10 §10.3
 * @see specs/14 §14.9
 * @see PLAN-M13.md P25
 */
import type { ProjectPaths } from '@forge/core/fs';

import {
  ciSkeletonViolations,
  cleanBuildViolations,
  reproducibleInstallViolations,
} from './rules-foundation.ts';
import { secretsResolvedViolations, skeletonDeployedViolations } from './rules-delivery.ts';

export const DOCTOR_RULE_IDS = [
  'clean-build',
  'reproducible-install',
  'ci-skeleton',
  'secrets-resolved',
  'skeleton-deployed',
] as const;

export type DoctorRuleId = (typeof DOCTOR_RULE_IDS)[number];

/** Narrows a `--rule` value to one this command implements; anything else (including `test-command`, which P23
 * owns) is refused with exit 2 so the gate coverage test can pin it. */
export function isDoctorRuleId(value: string | undefined): value is DoctorRuleId {
  return value !== undefined && (DOCTOR_RULE_IDS as readonly string[]).includes(value);
}

export interface DoctorRuleViolation {
  /** What the violation is about: a file path, an ecosystem, `git`, a secret name. Never a bare index. */
  readonly subject: string;
  readonly message: string;
  /** The action that would clear it. Starts with an imperative verb. */
  readonly remedy: string;
}

export interface DoctorRuleResult {
  readonly rule: DoctorRuleId;
  readonly violations: readonly DoctorRuleViolation[];
}

export interface DoctorRuleContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  /** The KB root relative to the project (`paths.kb`). */
  readonly kbRoot: string;
  /** The reports root relative to the project (`paths.reports`), where deployment records live. */
  readonly reportsRoot: string;
  /** The environment snapshot the caller read once; rules never read `process.env`. */
  readonly env: Readonly<Record<string, string>>;
}

/** More than this many violations are counted, not listed: `errors` (the number the gate reads) needs only to be
 * positive, and a hostile tree can hold tens of thousands of offending files. */
const MAX_LISTED_VIOLATIONS = 200;

function capped(rule: DoctorRuleId, violations: readonly DoctorRuleViolation[]): DoctorRuleResult {
  if (violations.length <= MAX_LISTED_VIOLATIONS) return { rule, violations };
  return {
    rule,
    violations: [
      ...violations.slice(0, MAX_LISTED_VIOLATIONS),
      {
        subject: rule,
        message: `${String(violations.length)} violations in all; only the first ${String(MAX_LISTED_VIOLATIONS)} are listed.`,
        remedy: 'Fix the listed violations and run the check again to see the rest.',
      },
    ],
  };
}

/** Runs one rule. Never throws for an input it cannot read: an unexpected failure inside a rule becomes a
 * violation naming the rule, so the gate still gets a parseable envelope with `errors > 0` instead of an empty
 * stdout it can only report as "could not be parsed". */
export async function doctorRule(
  ctx: DoctorRuleContext,
  rule: DoctorRuleId,
): Promise<DoctorRuleResult> {
  try {
    switch (rule) {
      case 'clean-build':
        return capped(rule, await cleanBuildViolations(ctx));
      case 'reproducible-install':
        return capped(rule, await reproducibleInstallViolations(ctx));
      case 'ci-skeleton':
        return capped(rule, await ciSkeletonViolations(ctx));
      case 'secrets-resolved':
        return capped(rule, await secretsResolvedViolations(ctx));
      case 'skeleton-deployed':
        return capped(rule, await skeletonDeployedViolations(ctx));
    }
  } catch (cause) {
    return {
      rule,
      violations: [
        {
          subject: rule,
          message: `The check could not complete: ${cause instanceof Error ? cause.message : String(cause)}.`,
          remedy: `Fix what the message names, then run \`forge doctor --rule ${rule}\` again.`,
        },
      ],
    };
  }
}
