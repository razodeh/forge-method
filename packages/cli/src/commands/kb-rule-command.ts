/**
 * The CLI face of `forge kb lint --rule <name>`: prints the `{v:1, rule, errors, findings}` envelope a gate reads
 * (`failOn: 'errors > 0'`) or the human form, and returns the exit code. Exit codes match `forge kb lint`: `0` with
 * no `error` finding, `1` with one, and `2` for a rule name that is not one of these.
 *
 * @see PLAN-M13.md P25
 */
import { EXIT_CODES } from '@forge/core/errors';

import type { KbCommandContext } from './kb.ts';
import { describeRefusal, printable, type OutputPort } from './output-port.ts';
import { KB_LINT_RULE_IDS, isKbLintRuleId, kbLintRule, type KbLintRuleResult } from './kb-rules.ts';

/** `buildContext` is a thunk so a project whose configuration cannot be read is a failing verdict, not an escaping
 * refusal (see `describeRefusal`). */
export async function runKbLintRuleCommand(
  buildContext: () => Promise<KbCommandContext>,
  rule: string,
  json: boolean,
  out: OutputPort,
): Promise<number> {
  if (!isKbLintRuleId(rule)) {
    out.error(
      `forge: "kb lint" needs a real --rule <name> (one of: ${KB_LINT_RULE_IDS.join(', ')}); got ${JSON.stringify(rule)}.`,
    );
    return EXIT_CODES.usage;
  }
  let result: KbLintRuleResult;
  try {
    result = await kbLintRule(await buildContext(), rule);
  } catch (error) {
    const refusal = describeRefusal(error);
    result = {
      rule,
      findings: [
        {
          ruleId: 'kb:refused',
          severity: 'error',
          message: `The check could not run: ${refusal.message}`,
          remedy: refusal.remedy,
        },
      ],
    };
  }
  const errors = result.findings.filter((finding) => finding.severity === 'error').length;
  if (json) {
    out.log(JSON.stringify({ v: 1, rule, errors, findings: result.findings }));
  } else if (result.findings.length === 0) {
    out.log(`forge kb lint --rule ${rule}: no findings.`);
  } else {
    for (const finding of result.findings) {
      out.error(
        printable(
          `${finding.severity} ${finding.ruleId}${finding.entryId === undefined ? '' : ` ${finding.entryId}`}: ${finding.message} ${finding.remedy}`,
        ),
      );
    }
  }
  return errors > 0 ? EXIT_CODES.failure : EXIT_CODES.success;
}
