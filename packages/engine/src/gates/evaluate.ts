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

import { evaluate, parseExpression, type Expr } from '../expr/index.ts';
import type {
  CheckRunner,
  DeterministicCheck,
  DeterministicCheckResult,
  GateDefinition,
  GateEvaluationResult,
} from './types.ts';

const SUPPORTED_PARSERS = new Set(['forge-json', 'json']);

/** The same ceiling `evaluate` enforces (`CFG-016`): the fail-closed walk below is recursive over the same tree,
 * so it must stop where `evaluate` would, before a flat 5000-term `&&` chain can overflow the real call stack. */
const MAX_WALK_DEPTH = 200;

function failed(
  check: DeterministicCheck,
  stdout: string,
  exitCode: number,
  reason: string,
): DeterministicCheckResult {
  return { checkId: check.id, run: check.run, passed: false, stdout, exitCode, reason };
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/** A failure marker in the output itself: `forge`'s own refusal envelope (`{"v":1,"ok":false,"error":{...}}`,
 * printed for a thrown refusal under `--json`) and any output that says it did not succeed. The check's
 * command did not run to a verdict, so nothing it says about `failOn`'s field can be believed. A command that
 * succeeds may print `ok: true`, `error: null`, `error: false` or an empty `error` string; anything else in
 * those two keys, or `success: false`, is a refusal (`"false"`, `0` and `true` included: a marker is not
 * something a check gets to spell creatively). */
function failureMarker(output: Readonly<Record<string, unknown>>): string | undefined {
  if (Object.hasOwn(output, 'ok') && output['ok'] !== true) {
    return 'check output says "ok" is not true (a refusal, not a verdict)';
  }
  if (output['success'] === false) {
    return 'check output says "success": false (not a verdict)';
  }
  const error = output['error'];
  if (error !== undefined && error !== null && error !== false && error !== '') {
    return 'check output carries a top-level "error" (a refusal, not a verdict)';
  }
  return undefined;
}

/** Whether `value` can be ordered by `<`/`<=`/`>`/`>=` without `evaluate` quietly answering "false" for it:
 * a finite number (JSON has no NaN or Infinity, but a value that arrived some other way is refused too). */
function isUsableNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function operandLabel(expr: Expr, value: unknown): string {
  return expr.kind === 'path'
    ? `"${pathName(expr)}" (${describeType(value)})`
    : describeType(value);
}

function pathName(expr: Expr & { readonly kind: 'path' }): string {
  return expr.segments.join('.');
}

/** The first reason `failOn`, evaluated against `output`, could not be trusted to mean "success", or
 * `undefined` when every part of it is backed by real data.
 *
 * `evaluate` reads a missing path as `undefined`, and every comparison against `undefined` is `false`, so
 * `errors > 0` "passes" an output that has no `errors` at all. That is right for a workflow `when:` (a missing
 * value is "no signal") and wrong for a gate, where no signal is not success. Rather than change `evaluate`
 * (whose contract `10` §10.1 and the workflow engine rely on) the gate walks the parsed expression itself,
 * visiting EVERY node (not only the ones a short-circuiting `&&`/`||` would reach) and requiring:
 *  - every path resolves to a defined, non-null value (own properties only, as `evaluate` reads them);
 *  - an ordering comparison (`<`, `<=`, `>`, `>=`) has two finite numbers or two strings (a numeric string
 *    such as `"3"` is a wrong type, not a number); `==`/`!=` compare two values of the same type;
 *  - a path used as a yes/no value (an operand of `!`, `&&`, `||`, or the whole expression) is a boolean;
 *  - `length(...)` is over a string or an array, and `in` searches an array, or a string for a string;
 *  - the expression reads at least one path (a constant such as `false` can never show success; the caller
 *    counts them through `state`).
 * The tree is walked, never the source text, so a path inside a nested `!`, `length` or a comparison is found
 * the same way as a bare one. Throws `CFG-016` for a tree deeper than `evaluate` accepts. */
function unreliableFailOn(
  expr: Expr,
  output: Readonly<Record<string, unknown>>,
  state: { paths: number },
  truthy = true,
  depth = 0,
): string | undefined {
  if (depth > MAX_WALK_DEPTH) throw new ForgeError('CFG-016', { maxDepth: MAX_WALK_DEPTH });
  const next = depth + 1;
  switch (expr.kind) {
    case 'literal':
      return undefined;
    case 'path': {
      state.paths += 1;
      const value = evaluate(expr, output);
      if (value === undefined) {
        return `failOn reads "${pathName(expr)}", which the check output does not have`;
      }
      if (value === null)
        return `failOn reads "${pathName(expr)}", which is null in the check output`;
      if (truthy && typeof value !== 'boolean') {
        return `failOn uses "${pathName(expr)}" as a yes/no value, but the check output gives ${describeType(
          value,
        )}`;
      }
      return undefined;
    }
    case 'not':
      return unreliableFailOn(expr.operand, output, state, true, next);
    case 'logical':
      return (
        unreliableFailOn(expr.left, output, state, true, next) ??
        unreliableFailOn(expr.right, output, state, true, next)
      );
    case 'comparison': {
      const problem =
        unreliableFailOn(expr.left, output, state, false, next) ??
        unreliableFailOn(expr.right, output, state, false, next);
      if (problem !== undefined) return problem;
      const left = evaluate(expr.left, output);
      const right = evaluate(expr.right, output);
      if (expr.operator === '==' || expr.operator === '!=') {
        // `evaluate` compares with `===`, so `errors == 0` against `"0"` is quietly false, and `errors != 0`
        // quietly true: two sides of different types are a wrong-typed output, not an answer.
        const primitive = (value: unknown): boolean =>
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
        return typeof left === typeof right && primitive(left)
          ? undefined
          : `failOn compares ${operandLabel(expr.left, left)} with ${operandLabel(
              expr.right,
              right,
            )} using "${expr.operator}", but they are not two values of the same primitive type`;
      }
      if (
        (isUsableNumber(left) && isUsableNumber(right)) ||
        (typeof left === 'string' && typeof right === 'string')
      ) {
        return undefined;
      }
      return `failOn compares ${operandLabel(expr.left, left)} with ${operandLabel(
        expr.right,
        right,
      )} using "${expr.operator}", which needs two numbers (or two strings)`;
    }
    case 'in': {
      const problem =
        unreliableFailOn(expr.value, output, state, false, next) ??
        unreliableFailOn(expr.collection, output, state, false, next);
      if (problem !== undefined) return problem;
      const value = evaluate(expr.value, output);
      const collection = evaluate(expr.collection, output);
      if (Array.isArray(collection)) return undefined;
      if (typeof collection === 'string') {
        return typeof value === 'string'
          ? undefined
          : `failOn looks for ${describeType(value)} inside a string with "in", which needs a string`;
      }
      return `failOn searches ${describeType(collection)} with "in", which is neither an array nor a string`;
    }
    case 'length': {
      const problem = unreliableFailOn(expr.operand, output, state, false, next);
      if (problem !== undefined) return problem;
      const operand = evaluate(expr.operand, output);
      return Array.isArray(operand) || typeof operand === 'string'
        ? undefined
        : `failOn takes length() of ${describeType(operand)}, which is neither an array nor a string`;
    }
  }
}

/** One deterministic check's own full pipeline: run it, parse its declared-format output, evaluate
 * `failOn` against the parsed result. `Boolean(...)` around the evaluated value, not a strict `=== true`:
 * `10` §10.1's own comparison/logical/`in`/`length` expressions already return real booleans for every
 * shape `failOn` is ever shown as (`"errors > 0"`), but `evaluate`'s own return type is `unknown` — the
 * identical "truthy, not strictly boolean" reading `evaluateAtDepth`'s own `&&`/`||` cases already use
 * internally, kept consistent here rather than narrowing to a stricter contract `failOn` itself never
 * promises. */
async function evaluateDeterministicCheck(
  check: DeterministicCheck,
  cwd: string,
  runner: CheckRunner,
): Promise<DeterministicCheckResult> {
  let stdout: string;
  let exitCode: number;
  try {
    ({ stdout, exitCode } = await runner(check, cwd));
  } catch (cause) {
    return failed(
      check,
      '',
      -1,
      `check runner threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
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

  if (typeof check.failOn !== 'string') {
    return failed(check, stdout, exitCode, 'failOn is missing: a check without one cannot pass');
  }

  const parseResult = parseExpression(check.failOn);
  if (!parseResult.success) {
    return failed(
      check,
      stdout,
      exitCode,
      `failOn expression is invalid: ${parseResult.error.message}`,
    );
  }

  const marker = failureMarker(parsed as Readonly<Record<string, unknown>>);
  if (marker !== undefined) return failed(check, stdout, exitCode, marker);

  let failOnTriggered: unknown;
  try {
    const state = { paths: 0 };
    const unreliable = unreliableFailOn(
      parseResult.expr,
      parsed as Readonly<Record<string, unknown>>,
      state,
    );
    if (unreliable !== undefined) return failed(check, stdout, exitCode, unreliable);
    if (state.paths === 0) {
      return failed(
        check,
        stdout,
        exitCode,
        `failOn (${JSON.stringify(check.failOn)}) reads nothing from the check output, so it can never show the check succeeded`,
      );
    }
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
  if (shouldFail) {
    // `failOn` itself spoke: the normal failing path, no separate reason needed.
    return { checkId: check.id, run: check.run, passed: false, stdout, exitCode };
  }
  if (exitCode !== 0 && exitCode !== 1) {
    // Exit 0 (ok) and exit 1 (`EXIT_CODES.failure`: the command ran and reports findings in its body) are the two
    // codes a command that reached a verdict uses. Every other code (2 usage, 3..6, a signal, a spawn failure)
    // means the command did not reach one, whatever its stdout happens to hold.
    return failed(
      check,
      stdout,
      exitCode,
      `check command exited ${String(exitCode)}, which is not a verdict (0 or 1); its output is not trusted`,
    );
  }
  if (exitCode === 1 && (parsed as Readonly<Record<string, unknown>>)['v'] !== 1) {
    // One `forge` command can serve two gates with different thresholds (`forge test flaky --json` exits 1 above
    // ANY flaky test for a human, G-Stable reads `flaky > 0`, G-Verify's cap reads `quarantined > 5`), so at exit 1
    // the body of a `forge` command (its `{"v":1,...}` envelope) is the verdict. Any other program that exits 1
    // beside a body that does not trip `failOn` is a contradiction, and a crash exits 1 too (a signal reads as 1
    // in `runShellCommand`): not a pass.
    return failed(
      check,
      stdout,
      exitCode,
      `check command exited 1 but its output is not a forge {"v":1} envelope and does not trip failOn (${JSON.stringify(
        check.failOn,
      )}); a program that reports findings must say so in the output`,
    );
  }
  return { checkId: check.id, run: check.run, passed: true, stdout, exitCode };
}

/** `10` §10.3's own gate mechanism. Every deterministic check runs (concurrently — nothing here requires
 * or benefits from running them one at a time, and rule 4's own audit trail wants every check's own real
 * output regardless of whether an earlier one already failed); `passed` is `true` only if every one of them
 * is. Advisory checks are carried straight through into the result, never executed or consulted for
 * `passed` (`AdvisoryCheck`'s own doc comment has the fuller reasoning for why this piece stops there).
 * `openQuestionsPolicy` is likewise carried straight through — this piece produces no open-question data
 * of its own for it to police (advisory checks are never actually run here), so there is nothing yet for
 * "block" vs "warn" to act on; propagated for whichever later piece does generate that data. */
export async function evaluateGate(
  gate: GateDefinition,
  cwd: string,
  runner: CheckRunner,
): Promise<GateEvaluationResult> {
  const checks = await Promise.all(
    gate.checks.deterministic.map((check) => evaluateDeterministicCheck(check, cwd, runner)),
  );
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
