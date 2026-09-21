/**
 * The one way the design and delivery gate checks of `PLAN-M13.md` P26 print a verdict: `forge spec interfaces
 * --check-frozen`, `forge diagram validate --gate`, `forge diagram generate --all --check`, `forge deploy
 * --dry-run` and `forge deploy --rollback-check`. (`forge spec validate --rule` has its own printer in `bin.ts`.)
 *
 * A gate reads one JSON object from stdout (`10` §10.3) and, since `PLAN-M13.md` P35, a check passes only when the
 * body carries every field its `failOn` reads. So every check prints its verdict fields on BOTH the passing and the
 * failing path, and a project the command cannot read (an invalid `.forge/config.yaml`, a corrupt document) is a
 * failing verdict that says why, never a refusal envelope a gate can only report as "a refusal".
 *
 * Exit codes match the sibling rule commands: `0` no violation, `1` with one. Usage errors (a flag the command does
 * not have) stay the dispatcher's `2`.
 *
 * @see specs/10 §10.3
 * @see PLAN-M13.md P26, P35
 */
import { EXIT_CODES } from '@forge/core/errors';

import { describeRefusal, printable, type OutputPort } from './output-port.ts';

/** One thing a check found wrong. `remedy` starts with an imperative verb: an error that does not say how to clear it
 * fails review (`QUALITY-BAR.md`). */
export interface GateViolation {
  readonly subject: string;
  readonly message: string;
  readonly remedy: string;
}

/** What a check computed: the numeric fields its gate reads plus every violation. `fields` must include every field
 * the shipped `failOn` reads, and `errors`. */
export interface GateCheckOutcome {
  /** Extra top-level fields for the envelope (counts, `check`, breakdowns). Reserved keys are set by the printer. */
  readonly fields: Readonly<Record<string, unknown>>;
  readonly violations: readonly GateViolation[];
  /** Findings that do not fail the check (`diagrams.driftPolicy: warn`, `08` §8.11.6). */
  readonly warnings?: readonly GateViolation[];
}

/** More than this many violations are counted, not listed: `errors` (the number a gate reads) needs only to be
 * positive, and a hostile tree can hold tens of thousands of offending items. */
export const MAX_LISTED_VIOLATIONS = 200;

export interface GateCheckSpec {
  /** Names the command in the human form (`forge spec interfaces --check-frozen`). */
  readonly command: string;
  /** Every numeric field the gate's `failOn` reads: set to `1` when the check could not run at all, so the failing
   * verdict trips the gate's own condition instead of only failing it closed. */
  readonly refusalFields: Readonly<Record<string, number>>;
  readonly json: boolean;
  readonly out: OutputPort;
}

/** Runs `compute` and prints its verdict. Never throws for an input the check cannot read: any failure becomes one
 * violation naming what could not be read. */
export async function runGateCheck(
  spec: GateCheckSpec,
  compute: () => Promise<GateCheckOutcome>,
): Promise<number> {
  let outcome: GateCheckOutcome;
  try {
    outcome = await compute();
  } catch (cause) {
    const refusal = describeRefusal(cause);
    outcome = {
      fields: { ...spec.refusalFields },
      violations: [
        {
          subject: 'forge',
          message: `The check could not run: ${refusal.message}`,
          remedy: refusal.remedy,
        },
      ],
    };
  }
  const errors = outcome.violations.length;
  const warnings = outcome.warnings ?? [];
  if (spec.json) {
    spec.out.log(
      JSON.stringify({
        v: 1,
        ...outcome.fields,
        errors,
        violations: outcome.violations.slice(0, MAX_LISTED_VIOLATIONS),
        ...(errors > MAX_LISTED_VIOLATIONS ? { truncated: true } : {}),
        ...(warnings.length > 0 ? { warnings: warnings.slice(0, MAX_LISTED_VIOLATIONS) } : {}),
      }),
    );
  } else if (errors === 0) {
    spec.out.log(
      `${spec.command}: no violations.${warnings.length > 0 ? ` ${String(warnings.length)} warning(s).` : ''}`,
    );
    for (const warning of warnings) {
      spec.out.error(printable(`warn ${warning.subject}: ${warning.message} ${warning.remedy}`));
    }
  } else {
    for (const violation of outcome.violations.slice(0, MAX_LISTED_VIOLATIONS)) {
      spec.out.error(printable(`${violation.subject}: ${violation.message} ${violation.remedy}`));
    }
    if (errors > MAX_LISTED_VIOLATIONS) {
      spec.out.error(
        `${String(errors)} violations in all; only the first ${String(MAX_LISTED_VIOLATIONS)} are listed.`,
      );
    }
  }
  return errors > 0 ? EXIT_CODES.failure : EXIT_CODES.success;
}
