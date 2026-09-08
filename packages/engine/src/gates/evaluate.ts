/**
 * `evaluateGate` — `10` §10.3's own gate mechanism, generically: run every deterministic check, parse its
 * output, evaluate `failOn` against it, and never let any of that (a bad command, unparseable output, a
 * malformed expression) throw past this function — a failure to *determine* a check's own outcome
 * conservatively fails that check, the same "describe a failure as data, not an escaped exception" shape
 * `@forge/engine/plan`'s own `compileRunPlan` (P11) already established for this whole package.
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 */
import { ForgeError } from '@forge/core/errors';

import { evaluate, parseExpression } from '../expr/index.ts';
import type { CheckRunner, DeterministicCheck, DeterministicCheckResult, GateDefinition, GateEvaluationResult } from './types.ts';

const SUPPORTED_PARSERS = new Set(['forge-json', 'json']);

function failed(check: DeterministicCheck, stdout: string, exitCode: number, reason: string): DeterministicCheckResult {
  return { checkId: check.id, run: check.run, passed: false, stdout, exitCode, reason };
}

/** One deterministic check's own full pipeline: run it, parse its declared-format output, evaluate
 * `failOn` against the parsed result. `Boolean(...)` around the evaluated value, not a strict `=== true`:
 * `10` §10.1's own comparison/logical/`in`/`length` expressions already return real booleans for every
 * shape `failOn` is ever shown as (`"errors > 0"`), but `evaluate`'s own return type is `unknown` — the
 * identical "truthy, not strictly boolean" reading `evaluateAtDepth`'s own `&&`/`||` cases already use
 * internally, kept consistent here rather than narrowing to a stricter contract `failOn` itself never
 * promises. */
async function evaluateDeterministicCheck(check: DeterministicCheck, cwd: string, runner: CheckRunner): Promise<DeterministicCheckResult> {
  let stdout: string;
  let exitCode: number;
  try {
    ({ stdout, exitCode } = await runner(check, cwd));
  } catch (cause) {
    return failed(check, '', -1, `check runner threw: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  if (check.parser !== undefined && !SUPPORTED_PARSERS.has(check.parser)) {
    return failed(check, stdout, exitCode, `unsupported parser ${JSON.stringify(check.parser)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return failed(check, stdout, exitCode, 'check output could not be parsed as JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failed(check, stdout, exitCode, 'parsed check output was not a JSON object');
  }

  const parseResult = parseExpression(check.failOn);
  if (!parseResult.success) {
    return failed(check, stdout, exitCode, `failOn expression is invalid: ${parseResult.error.message}`);
  }

  let failOnTriggered: unknown;
  try {
    failOnTriggered = evaluate(parseResult.expr, parsed);
  } catch (cause) {
    // `evaluate`'s own one thrown exception (`CFG-016`, a pathologically deep expression) — caught
    // specifically, not a bare `catch {}`, matching this codebase's own "catch the one expected type,
    // rethrow anything else" convention: anything else escaping `evaluate` would be a genuine bug in that
    // module, not a reason to silently fail this one check.
    if (!(cause instanceof ForgeError)) throw cause;
    return failed(check, stdout, exitCode, `failOn evaluation failed: ${cause.message}`);
  }

  const shouldFail = Boolean(failOnTriggered);
  return { checkId: check.id, run: check.run, passed: !shouldFail, stdout, exitCode };
}

/** `10` §10.3's own gate mechanism. Every deterministic check runs (concurrently — nothing here requires
 * or benefits from running them one at a time, and rule 4's own audit trail wants every check's own real
 * output regardless of whether an earlier one already failed); `passed` is `true` only if every one of them
 * is. Advisory checks are carried straight through into the result, never executed or consulted for
 * `passed` (`AdvisoryCheck`'s own doc comment has the fuller reasoning for why this piece stops there).
 * `openQuestionsPolicy` is likewise carried straight through — this piece produces no open-question data
 * of its own for it to police (advisory checks are never actually run here), so there is nothing yet for
 * "block" vs "warn" to act on; propagated for whichever later piece does generate that data. */
export async function evaluateGate(gate: GateDefinition, cwd: string, runner: CheckRunner): Promise<GateEvaluationResult> {
  const checks = await Promise.all(gate.checks.deterministic.map((check) => evaluateDeterministicCheck(check, cwd, runner)));
  return {
    gateId: gate.id,
    passed: checks.every((check) => check.passed),
    checks,
    advisory: gate.checks.advisory,
    openQuestionsPolicy: gate.openQuestionsPolicy,
    waiver: undefined,
    waiverAppliedAt: undefined,
  };
}
