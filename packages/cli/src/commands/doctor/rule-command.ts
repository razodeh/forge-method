/**
 * The CLI face of `forge doctor --rule <name>`: prints the `{v:1, rule, errors, violations}` envelope a gate reads
 * (`failOn: 'errors > 0'`) or the human form, and returns the exit code. Kept out of `bin.ts`, which only routes to it.
 *
 * Exit codes match the sibling rule command `forge spec validate --rule`: `0` clean, `1` with violations, `2` for
 * a rule name that is not one of these (the gate coverage test relies on that to pin names owned by a later piece).
 *
 * @see PLAN-M13.md P25
 */
import { describeRefusal, printable, type OutputPort } from '../output-port.ts';
import {
  DOCTOR_RULE_IDS,
  doctorRule,
  isDoctorRuleId,
  type DoctorRuleContext,
  type DoctorRuleResult,
} from './rules.ts';

/** `buildContext` is a thunk, not a value, so a project that cannot even provide its configuration (an invalid
 * `.forge/config.yaml`) is a failing verdict here rather than a refusal that escapes before any rule runs. */
export async function runDoctorRuleCommand(
  buildContext: () => Promise<DoctorRuleContext>,
  rule: string,
  json: boolean,
  out: OutputPort,
): Promise<number> {
  if (!isDoctorRuleId(rule)) {
    out.error(
      `forge: "doctor" needs a real --rule <name> (one of: ${DOCTOR_RULE_IDS.join(', ')}); got ${JSON.stringify(rule)}.`,
    );
    return 2;
  }
  let result: DoctorRuleResult;
  try {
    result = await doctorRule(await buildContext(), rule);
  } catch (error) {
    const refusal = describeRefusal(error);
    result = {
      rule,
      violations: [
        {
          subject: 'forge',
          message: `The check could not run: ${refusal.message}`,
          remedy: refusal.remedy,
        },
      ],
      // `buildContext` failed before any rule ran, so `test-command`'s own `granted` derivation never ran either;
      // `[]` here (not absent) keeps `DoctorRuleResult.granted`'s own invariant true even on this path ("`[]` when
      // none", never merely omitted for `test-command`).
      ...(rule === 'test-command' ? { granted: [] } : {}),
    };
  }
  if (json) {
    out.log(
      JSON.stringify({
        v: 1,
        rule,
        errors: result.violations.length,
        violations: result.violations,
        // `test-command` only (`DoctorRuleResult.granted`); `JSON.stringify` drops an `undefined` value, so every
        // other rule's envelope is unchanged.
        granted: result.granted,
      }),
    );
  } else if (result.violations.length === 0) {
    out.log(`forge doctor --rule ${rule}: no violations.`);
  } else {
    for (const violation of result.violations) {
      out.error(printable(`${violation.subject}: ${violation.message} ${violation.remedy}`));
    }
  }
  return result.violations.length > 0 ? 1 : 0;
}
