/**
 * `evaluateGate` fails CLOSED (`PLAN-M13.md` P35, `10` §10.3 rule 1: "a gate cannot be approved with a failing
 * deterministic check present, only waived"). A check that cannot positively demonstrate success has failed:
 * `errors > 0` evaluated against an output that has no `errors` field used to read `undefined > 0`, which is
 * false, so a refusal envelope, a renamed field, or a crash that printed JSON all passed the gate.
 *
 * The rule, precisely:
 *  1. A check passes only if its command exited 0 or 1 (a verdict; any other code is not one) AND its output is
 *     a JSON object that carries no failure marker (`ok` other than true, `success: false`, a top-level `error`
 *     other than null/false/empty) AND `failOn` reads at least one path AND every path it reads resolves to a
 *     defined, non-null value of a type that expression can use AND `failOn` then evaluates false.
 *  2. Anything else fails, with a reason that names what was wrong.
 *
 * @see specs/10 §10.3
 * @see PLAN-M13.md P35
 */
import { describe, expect, it } from 'vitest';

import { applyWaiver, buildGateReport, evaluateGate } from '../../src/gates/index.ts';
import type {
  CheckRunner,
  DeterministicCheck,
  DeterministicCheckResult,
  GateDefinition,
} from '../../src/gates/types.ts';

function one(failOn: string, stdout: string, exitCode = 0): Promise<DeterministicCheckResult> {
  const check: DeterministicCheck = { id: 'c', run: 'forge x --json', failOn };
  const gate: GateDefinition = {
    id: 'G-Test',
    checks: { deterministic: [check], advisory: [] },
    openQuestionsPolicy: 'block',
  };
  const runner: CheckRunner = () => Promise.resolve({ stdout, exitCode });
  return evaluateGate(gate, '/repo', runner).then((result) => {
    const first = result.checks[0];
    if (first === undefined) throw new Error('no check result');
    expect(result.passed).toBe(first.passed);
    return first;
  });
}

const REFUSAL =
  '{"v":1,"ok":false,"error":{"code":"CFG-001","message":"bad config","remedy":"fix it","exitCode":2}}';

describe('a refusal is a failed check, not a pass', () => {
  it('fails the refusal envelope `forge` prints for a thrown ForgeError (exit 2)', async () => {
    const result = await one('errors > 0', REFUSAL, 2);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('refusal');
    expect(result.stdout).toBe(REFUSAL);
    expect(result.exitCode).toBe(2);
  });

  it('fails the refusal envelope even when the exit code was (wrongly) 0', async () => {
    const result = await one('errors > 0', REFUSAL, 0);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('refusal');
  });

  it('fails a refusal that also happens to carry the field failOn reads as a passing value', async () => {
    const result = await one('errors > 0', '{"v":1,"ok":false,"errors":0,"error":{"code":"X"}}', 0);
    expect(result.passed).toBe(false);
  });

  it('fails `ok: false` on its own', async () => {
    const result = await one('errors > 0', '{"v":1,"ok":false,"errors":0}');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('ok');
  });

  it('fails a top-level `error` object, and a non-empty `error` string', async () => {
    expect((await one('errors > 0', '{"errors":0,"error":{"code":"X"}}')).passed).toBe(false);
    expect((await one('errors > 0', '{"errors":0,"error":"it broke"}')).passed).toBe(false);
  });

  it('fails every other spelling of a refusal: `error: true`, `error: 0`, `ok: "false"`, `ok: 0`, `success: false`', async () => {
    for (const marker of [
      '"error":true',
      '"error":0',
      '"ok":"false"',
      '"ok":0',
      '"success":false',
    ]) {
      const result = await one('errors > 0', `{"errors":0,${marker}}`);
      expect(result.passed, marker).toBe(false);
      expect(result.reason, marker).toBeDefined();
    }
  });

  it('does not treat `ok: true`, `error: null`, `error: false` or an empty `error` string as a failure marker', async () => {
    expect((await one('errors > 0', '{"error":false,"errors":0}')).passed).toBe(true);
    expect((await one('errors > 0', '{"ok":true,"errors":0}')).passed).toBe(true);
    expect((await one('errors > 0', '{"ok":null,"errors":0}')).passed).toBe(false);
    expect((await one('errors > 0', '{"error":null,"errors":0}')).passed).toBe(true);
    expect((await one('errors > 0', '{"error":"","errors":0}')).passed).toBe(true);
  });
});

describe('the field failOn reads must be present', () => {
  it('fails an object that lacks the field, naming the field', async () => {
    const result = await one('errors > 0', '{"v":1,"findings":[]}');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('errors');
  });

  it('fails an empty object and a renamed field', async () => {
    expect((await one('errors > 0', '{}')).passed).toBe(false);
    expect((await one('errors > 0', '{"error_count":0}')).passed).toBe(false);
  });

  it("fails when the field is only inherited, not the output's own", async () => {
    const result = await one('constructor > 0', '{"errors":0}');
    expect(result.passed).toBe(false);
  });

  it('a well-formed pass still passes and a well-formed fail still fails (reason absent, failOn spoke)', async () => {
    const pass = await one('errors > 0', '{"v":1,"errors":0}');
    expect(pass.passed).toBe(true);
    expect(pass.reason).toBeUndefined();
    const fail = await one('errors > 0', '{"v":1,"errors":2}', 1);
    expect(fail.passed).toBe(false);
    expect(fail.reason).toBeUndefined();
  });
});

describe('the field failOn reads must have a usable type', () => {
  it.each([
    ['a string', '{"errors":"0"}'],
    ['a numeric-looking string', '{"errors":"3"}'],
    ['null', '{"errors":null}'],
    ['a boolean', '{"errors":false}'],
    ['an array', '{"errors":[]}'],
    ['an object', '{"errors":{"n":0}}'],
  ])('fails when the numeric field is %s', async (_name, stdout) => {
    const result = await one('errors > 0', stdout);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('errors');
  });

  it('accepts a negative, a zero and a fractional number', async () => {
    expect((await one('coverage < 80', '{"coverage":91.5}')).passed).toBe(true);
    expect((await one('coverage < 80', '{"coverage":0}')).passed).toBe(false);
    expect((await one('errors > 0', '{"errors":-1}')).passed).toBe(true);
  });

  it('fails a `length(...)` over something that is not a string or array', async () => {
    expect((await one('length(items) > 0', '{"items":3}')).passed).toBe(false);
    expect((await one('length(items) > 0', '{"items":[]}')).passed).toBe(true);
    expect((await one('length(items) > 0', '{"items":["a"]}')).passed).toBe(false);
    expect((await one('length(items) > 5', '{"items":["a"]}')).passed).toBe(true);
  });

  it('fails an `in` whose collection is not an array or a string', async () => {
    expect((await one("'a' in tags", '{"tags":7}')).passed).toBe(false);
    expect((await one("'a' in name", '{"name":"bcd"}')).passed).toBe(true);
    expect((await one("'a' in name", '{"name":"bad"}')).passed).toBe(false);
    expect((await one("'a' in tags", '{"tags":["b"]}')).passed).toBe(true);
    expect((await one("'a' in tags", '{"tags":["a"]}')).passed).toBe(false);
  });
});

describe('every path the expression reads must resolve, on every branch', () => {
  it('nested paths: passes when present, fails when any segment is missing or not an object', async () => {
    expect((await one('summary.errors > 0', '{"summary":{"errors":0}}')).passed).toBe(true);
    expect((await one('summary.errors > 0', '{"summary":{"errors":4}}')).passed).toBe(false);
    for (const stdout of ['{}', '{"summary":{}}', '{"summary":"x"}', '{"summary":null}']) {
      const result = await one('summary.errors > 0', stdout);
      expect(result.passed, stdout).toBe(false);
      expect(result.reason, stdout).toContain('summary.errors');
    }
  });

  it('`&&`: the right-hand path is required even when the left short-circuits to false', async () => {
    expect((await one('errors > 0 && failed > 0', '{"errors":0,"failed":0}')).passed).toBe(true);
    const result = await one('errors > 0 && failed > 0', '{"errors":0}');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('failed');
  });

  it('`||`: the right-hand path is required even when the left already decided', async () => {
    expect((await one('errors > 0 || failed > 0', '{"errors":0,"failed":0}')).passed).toBe(true);
    const result = await one('errors > 0 || failed > 0', '{"errors":0}');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('failed');
  });

  it('`!`: the negated path is required', async () => {
    expect((await one('!clean', '{"clean":false}')).passed).toBe(false);
    expect((await one('!clean', '{"clean":true}')).passed).toBe(true);
    expect((await one('!clean', '{}')).passed).toBe(false);
  });

  it('a path on each side of a comparison (`bytes > budgetBytes`): both are required', async () => {
    expect((await one('bytes > budgetBytes', '{"bytes":10,"budgetBytes":20}')).passed).toBe(true);
    expect((await one('bytes > budgetBytes', '{"bytes":30,"budgetBytes":20}')).passed).toBe(false);
    expect((await one('bytes > budgetBytes', '{"bytes":10}')).passed).toBe(false);
    expect((await one('bytes > budgetBytes', '{"budgetBytes":10}')).passed).toBe(false);
  });

  it('a hyphenated path segment (`failures.test-failure`) is required too', async () => {
    expect((await one('failures.test-failure > 2', '{"failures":{"test-failure":1}}')).passed).toBe(
      true,
    );
    expect((await one('failures.test-failure > 2', '{"failures":{}}')).passed).toBe(false);
  });

  it('an expression that reads no path can never show success, so it fails (a constant is not evidence)', async () => {
    for (const failOn of ['false', '1 > 2', '!true']) {
      const result = await one(failOn, '{"errors":0}');
      expect(result.passed, failOn).toBe(false);
      expect(result.reason, failOn).toContain('reads nothing');
    }
    // A constant beside a real path is still judged on the path.
    expect((await one('errors > 0 && false', '{"errors":0}')).passed).toBe(true);
  });

  it('a yes/no path must be a boolean, and `==`/`!=` compare like with like', async () => {
    expect((await one('!passed', '{"passed":true}')).passed).toBe(true);
    expect((await one('!passed', '{"passed":"false"}')).passed).toBe(false);
    expect((await one('!passed', '{"passed":[]}')).passed).toBe(false);
    expect((await one('!passed', '{"passed":0}')).passed).toBe(false);
    expect((await one('failed || errors > 0', '{"failed":"no","errors":0}')).passed).toBe(false);
    expect((await one('errors == 1', '{"errors":"lots"}')).reason).toContain('same primitive type');
    expect((await one('errors == 0', '{"errors":"3"}')).passed).toBe(false);
    expect((await one('errors != 0', '{"errors":"0"}')).passed).toBe(false);
    expect((await one('errors == 1', '{"errors":0}')).passed).toBe(true);
    expect((await one("mode == 'strict'", '{"mode":"loose"}')).passed).toBe(true);
    expect((await one("mode == 'strict'", '{"mode":"strict"}')).passed).toBe(false);
    expect((await one('n in errors', '{"n":1,"errors":"abc"}')).passed).toBe(false);
  });
});

describe('the exit code', () => {
  it('an exit that is neither 0 nor 1 is not a verdict: it fails even when the body looks clean', async () => {
    for (const exitCode of [2, 3, 4, 5, 6, 17, 127, 130, -1, 1.5, Number.NaN]) {
      const result = await one('errors > 0', '{"errors":0}', exitCode);
      expect(result.passed, String(exitCode)).toBe(false);
      expect(result.exitCode).toBe(exitCode);
      expect(result.reason).toContain(String(exitCode));
      expect(result.stdout).toBe('{"errors":0}');
    }
  });

  it('exit 1 is a verdict-carrying code: the body decides (one command can serve two gates with different thresholds)', async () => {
    // `forge test flaky --json` exits 1 above any flaky test, G-Stable reads `flaky > 0`, G-Verify's cap reads
    // `quarantined > 5`: with 2 quarantined the cap is fine although the exit code is 1.
    const body = '{"v":1,"flaky":2,"quarantined":2}';
    expect((await one('quarantined > 5', body, 1)).passed).toBe(true);
    expect((await one('flaky > 0', body, 1)).passed).toBe(false);
    expect((await one('flaky > 0', body, 1)).reason).toBeUndefined();
  });

  it('exit 1 beside a body that is not a forge {"v":1} envelope and does not trip failOn is a contradiction (a crash exits 1 too)', async () => {
    const result = await one('errors > 0', '{"errors":0}', 1);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('exited 1');
    expect((await one('errors > 0', '{"v":1,"errors":0}', 1)).passed).toBe(true);
    expect((await one('errors > 0', '{"v":2,"errors":0}', 1)).passed).toBe(false);
  });

  it('exit 1 with a well-formed failing body is the normal failing path: it fails on failOn, with no extra reason', async () => {
    const result = await one('errors > 0', '{"errors":3}', 1);
    expect(result.passed).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('exit 0 with a failing body still fails (the data wins over the exit code)', async () => {
    expect((await one('errors > 0', '{"errors":3}', 0)).passed).toBe(false);
  });

  it('exit 1 does not rescue a refusal, a missing field or an empty output', async () => {
    expect((await one('errors > 0', REFUSAL, 1)).passed).toBe(false);
    expect((await one('errors > 0', '{"v":1}', 1)).passed).toBe(false);
    expect((await one('errors > 0', '', 1)).passed).toBe(false);
  });

  it('exit 0 and a clean body passes', async () => {
    expect((await one('errors > 0', '{"errors":0}', 0)).passed).toBe(true);
  });
});

describe('other shapes that must not read as an answer', () => {
  it('`==`/`!=` over arrays or objects compare identity in evaluate, so they are refused', async () => {
    expect((await one('a == b', '{"a":[1],"b":[1]}')).passed).toBe(false);
    expect((await one('a != b', '{"a":{},"b":{}}')).passed).toBe(false);
    expect((await one('a == b', '{"a":1,"b":1}')).passed).toBe(false);
    expect((await one('a == b', '{"a":1,"b":2}')).passed).toBe(true);
  });

  it('a check with no failOn string fails with a reason instead of throwing out of evaluateGate', async () => {
    const check = { id: 'c', run: 'x' } as unknown as DeterministicCheck;
    const gate: GateDefinition = {
      id: 'G-Test',
      checks: { deterministic: [check], advisory: [] },
      openQuestionsPolicy: 'block',
    };
    const result = await evaluateGate(gate, '/repo', () =>
      Promise.resolve({ stdout: '{"errors":0}', exitCode: 0 }),
    );
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.reason).toContain('failOn');
  });
});

describe('what was already failing keeps failing', () => {
  it('unparseable, non-object, invalid failOn', async () => {
    expect((await one('errors > 0', 'nope')).passed).toBe(false);
    expect((await one('errors > 0', '')).passed).toBe(false);
    expect((await one('errors > 0', '[1]')).passed).toBe(false);
    expect((await one('errors > 0', '3')).passed).toBe(false);
    expect((await one('errors > 0', 'null')).passed).toBe(false);
    expect((await one('errors >', '{"errors":0}')).passed).toBe(false);
  });

  it('an infinite number (JSON 1e999) is not a usable count', async () => {
    expect((await one('errors > 0', '{"errors":1e999}')).passed).toBe(false);
  });

  it('a very long flat `&&` chain fails with a reason instead of overflowing the stack', async () => {
    const deep = Array.from({ length: 5000 }, () => 'errors > 0').join(' && ');
    const result = await one(deep, '{"errors":0}');
    expect(result.passed).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

describe('a waiver still covers a check that now fails closed (10 §10.3 rule 1)', () => {
  it('lists every failing check in the waived report, including the fail-closed ones', async () => {
    const gate: GateDefinition = {
      id: 'G-Test',
      checks: {
        deterministic: [
          { id: 'refused', run: 'forge a --json', failOn: 'errors > 0' },
          { id: 'missing', run: 'forge b --json', failOn: 'errors > 0' },
          { id: 'clean', run: 'forge c --json', failOn: 'errors > 0' },
          { id: 'real-fail', run: 'forge d --json', failOn: 'errors > 0' },
        ],
        advisory: [],
      },
      openQuestionsPolicy: 'block',
    };
    const outputs: Record<string, { stdout: string; exitCode: number }> = {
      refused: { stdout: REFUSAL, exitCode: 2 },
      missing: { stdout: '{"v":1}', exitCode: 0 },
      clean: { stdout: '{"errors":0}', exitCode: 0 },
      'real-fail': { stdout: '{"errors":2}', exitCode: 1 },
    };
    const runner: CheckRunner = (check) => {
      const out = outputs[check.id];
      if (out === undefined) throw new Error(check.id);
      return Promise.resolve(out);
    };
    const evaluated = await evaluateGate(gate, '/repo', runner);
    expect(evaluated.passed).toBe(false);
    expect(buildGateReport(gate, evaluated).approved).toBe(false);

    const waived = applyWaiver(
      evaluated,
      { reason: 'walking skeleton is not deployed yet', owner: 'pm', expiresAt: '2099-01-01' },
      Date.parse('2026-01-01'),
    );
    const report = buildGateReport(gate, waived);
    expect(report.passed).toBe(false);
    expect(report.approved).toBe(true);
    expect(report.checks.filter((c) => !c.passed).map((c) => c.checkId)).toEqual([
      'refused',
      'missing',
      'real-fail',
    ]);
  });
});
