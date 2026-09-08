/**
 * `applyRules` — `11` §11.0's own execution contract, step 1: "run rules → eliminate".
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M2
 */
import { evaluateCondition } from '../expr.ts';
import type { FrameworkDefinition } from '../schema/types.ts';
import type { RuleResult } from './types.ts';

/** Evaluates every `framework.rules[].if` against `derivedValues` (a caller's own already-resolved
 * `inputs.derived` results -- this function is pure, given resolved values, not itself an
 * expression-evaluation orchestrator over live KB/artifact data). Every matching rule's own
 * `then.eliminate` ids are unioned into the returned map; `then.prefer` follows "last matching rule
 * wins" when more than one rule sets it. */
export function applyRules(
  framework: FrameworkDefinition,
  derivedValues: Readonly<Record<string, unknown>>,
): RuleResult {
  const eliminated = new Map<string, string>();
  let preferred: string | undefined;

  for (const rule of framework.rules ?? []) {
    if (!evaluateCondition(rule.if, derivedValues)) continue;

    for (const optionId of rule.then.eliminate ?? []) {
      if (!eliminated.has(optionId)) eliminated.set(optionId, rule.if);
    }

    if (rule.then.prefer !== undefined) preferred = rule.then.prefer;
  }

  // A later rule can eliminate the option an earlier rule preferred (author error, or a deliberately
  // narrowing framework) -- `preferred` naming an eliminated option would be self-contradictory for any
  // caller building a recommendation from it, so the elimination wins.
  if (preferred !== undefined && eliminated.has(preferred)) preferred = undefined;

  return { eliminated, preferred };
}
