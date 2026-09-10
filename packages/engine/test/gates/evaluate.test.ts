/**
 * `evaluateGate` — `10` §10.3's own gate mechanism. `PLAN-M5.md` P14's own Checks text: a gate with one
 * passing and one failing deterministic check fails overall, and the report names which check failed with
 * its real command output; an advisory check's own failure never flips the gate's pass/fail (rule 2); a
 * gate re-evaluated twice with identical inputs produces an identical report (rule 3, idempotent).
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 */
import { describe, expect, it } from 'vitest';

import { evaluateGate } from '../../src/gates/evaluate.ts';
import type { CheckRunner, DeterministicCheck, GateDefinition } from '../../src/gates/types.ts';

function check(
  overrides: Partial<DeterministicCheck> & { readonly id: string },
): DeterministicCheck {
  return { run: `run ${overrides.id}`, failOn: 'errors > 0', ...overrides };
}

function gate(overrides: Partial<GateDefinition> & { readonly id: string }): GateDefinition {
  return {
    checks: { deterministic: [], advisory: [] },
    openQuestionsPolicy: 'block',
    ...overrides,
  };
}

function stubRunner(
  responses: Readonly<Record<string, { readonly stdout: string; readonly exitCode: number }>>,
): CheckRunner {
  return (c) => {
    const response = responses[c.id];
    if (response === undefined) throw new Error(`no stubbed response for check ${c.id}`);
    return Promise.resolve(response);
  };
}

describe('evaluateGate', () => {
  it('passes when every deterministic check passes', async () => {
    const g = gate({ id: 'G-Test', checks: { deterministic: [check({ id: 'a' })], advisory: [] } });
    const runner = stubRunner({ a: { stdout: '{"errors":0}', exitCode: 0 } });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.passed).toBe(true);
  });

  it('fails overall when one of two deterministic checks fails, and the report names which check failed with its real command output', async () => {
    const g = gate({
      id: 'G-Test',
      checks: { deterministic: [check({ id: 'passing' }), check({ id: 'failing' })], advisory: [] },
    });
    const runner = stubRunner({
      passing: { stdout: '{"errors":0}', exitCode: 0 },
      failing: { stdout: '{"errors":3}', exitCode: 1 },
    });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.passed).toBe(false);
    const passing = result.checks.find((c) => c.checkId === 'passing');
    const failing = result.checks.find((c) => c.checkId === 'failing');
    expect(passing?.passed).toBe(true);
    expect(failing?.passed).toBe(false);
    expect(failing?.stdout).toBe('{"errors":3}');
    expect(failing?.exitCode).toBe(1);
  });

  it("never lets an advisory check's own presence flip pass/fail -- proven with a gate whose only deterministic checks all pass and one advisory check is declared", async () => {
    // Advisory checks are agent-dispatched, not run/parsed the way deterministic checks are (`agent`/
    // `brief`, not `run`/`failOn`) -- evaluateGate must never even attempt to treat one as if it needed a
    // failOn evaluation.
    const g = gate({
      id: 'G-Test',
      checks: {
        deterministic: [check({ id: 'a' })],
        advisory: [{ id: 'architect-review', agent: 'critic', brief: 'briefs/critique.md' }],
      },
    });
    const runner = stubRunner({ a: { stdout: '{"errors":0}', exitCode: 0 } });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.passed).toBe(true);
    expect(result.advisory).toEqual([
      { id: 'architect-review', agent: 'critic', brief: 'briefs/critique.md' },
    ]);
  });

  it('resolves a bare, unnested failOn identifier directly against the parsed output\'s own top-level fields -- the real spec shape ("errors > 0", "undefined_refs > 0"), not a path nested under one of ExpressionContext\'s own named helper slots', async () => {
    const g = gate({
      id: 'G-Design',
      checks: {
        deterministic: [check({ id: 'interfaces:frozen', failOn: 'undefined_refs > 0' })],
        advisory: [],
      },
    });
    const runner = stubRunner({
      'interfaces:frozen': { stdout: '{"undefined_refs":2}', exitCode: 0 },
    });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.passed).toBe(false);
  });

  it("runs every deterministic check regardless of an earlier one failing, and correctly attributes each check's own stdout/exitCode rather than mixing them up under concurrent dispatch", async () => {
    const checks = Array.from({ length: 6 }, (_, i) =>
      check({ id: `c${String(i)}`, failOn: 'errors > 0' }),
    );
    const g = gate({ id: 'G-Test', checks: { deterministic: checks, advisory: [] } });
    const runner = stubRunner(
      Object.fromEntries(
        checks.map((c, i) => [c.id, { stdout: `{"errors":${String(i)}}`, exitCode: i }]),
      ),
    );
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.checks).toHaveLength(6);
    for (const [i, c] of checks.entries()) {
      const own = result.checks.find((r) => r.checkId === c.id);
      expect(own?.exitCode).toBe(i);
      expect(own?.stdout).toBe(`{"errors":${String(i)}}`);
      expect(own?.passed).toBe(i === 0);
    }
  });

  it("does not mix up any two checks' own output even when they genuinely resolve out of declaration order -- a real async race, not just a same-tick Promise.resolve() that never actually interleaves", async () => {
    // A critic round found the previous concurrency test's stub resolved every response synchronously, so
    // it could not have caught a real crosstalk bug even if one existed. Each check's own runner call here
    // waits a genuinely different, REVERSED amount of real time (the check declared *last* resolves
    // *first*), so this exercises a real interleaving Promise.all must still keep straight.
    const checks = Array.from({ length: 8 }, (_, i) =>
      check({ id: `c${String(i)}`, failOn: 'errors > 0' }),
    );
    const g = gate({ id: 'G-Test', checks: { deterministic: checks, advisory: [] } });
    const runner: CheckRunner = (c) => {
      const index = Number(c.id.slice(1));
      const delayMs = (checks.length - index) * 3;
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ stdout: `{"errors":${String(index)}}`, exitCode: index });
        }, delayMs);
      });
    };
    const result = await evaluateGate(g, '/repo', runner);
    for (const [i, c] of checks.entries()) {
      const own = result.checks.find((r) => r.checkId === c.id);
      expect(own?.exitCode).toBe(i);
      expect(own?.stdout).toBe(`{"errors":${String(i)}}`);
    }
  });

  it('never lets a nonzero exit code alone fail a check whose failOn does not trigger', async () => {
    const g = gate({ id: 'G-Test', checks: { deterministic: [check({ id: 'a' })], advisory: [] } });
    const runner = stubRunner({ a: { stdout: '{"errors":0}', exitCode: 17 } });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.passed).toBe(true);
    expect(result.checks[0]?.passed).toBe(true);
  });

  it('never lets a zero (successful) exit code alone save a check whose failOn does trigger', async () => {
    const g = gate({ id: 'G-Test', checks: { deterministic: [check({ id: 'a' })], advisory: [] } });
    const runner = stubRunner({ a: { stdout: '{"errors":5}', exitCode: 0 } });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.passed).toBe(false);
  });

  it('conservatively fails a check whose output is not valid JSON, rather than crashing the whole evaluation', async () => {
    const g = gate({ id: 'G-Test', checks: { deterministic: [check({ id: 'a' })], advisory: [] } });
    const runner = stubRunner({ a: { stdout: 'not json at all', exitCode: 0 } });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.reason).toContain('JSON');
  });

  it('conservatively fails a check whose parsed output is not a JSON object (an array or a bare primitive)', async () => {
    const g = gate({ id: 'G-Test', checks: { deterministic: [check({ id: 'a' })], advisory: [] } });
    const runner = stubRunner({ a: { stdout: '[1,2,3]', exitCode: 0 } });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.checks[0]?.passed).toBe(false);
    expect(result.checks[0]?.reason).toContain('object');
  });

  it('conservatively fails a check declaring an unsupported parser, rather than silently JSON-parsing it anyway', async () => {
    const g = gate({
      id: 'G-Test',
      checks: { deterministic: [check({ id: 'a', parser: 'xml' })], advisory: [] },
    });
    const runner = stubRunner({ a: { stdout: '<errors>0</errors>', exitCode: 0 } });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.checks[0]?.passed).toBe(false);
    expect(result.checks[0]?.reason).toContain('parser');
  });

  it('treats an absent parser and an explicit "forge-json"/"json" parser identically, all parsing stdout as JSON', async () => {
    const g = gate({
      id: 'G-Test',
      checks: {
        deterministic: [
          check({ id: 'no-parser' }),
          check({ id: 'forge-json', parser: 'forge-json' }),
          check({ id: 'json', parser: 'json' }),
        ],
        advisory: [],
      },
    });
    const runner = stubRunner({
      'no-parser': { stdout: '{"errors":0}', exitCode: 0 },
      'forge-json': { stdout: '{"errors":0}', exitCode: 0 },
      json: { stdout: '{"errors":0}', exitCode: 0 },
    });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('conservatively fails a check whose failOn expression is syntactically invalid, rather than throwing out of evaluateGate', async () => {
    const g = gate({
      id: 'G-Test',
      checks: { deterministic: [check({ id: 'a', failOn: 'errors >' })], advisory: [] },
    });
    const runner = stubRunner({ a: { stdout: '{"errors":0}', exitCode: 0 } });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.checks[0]?.passed).toBe(false);
    expect(result.checks[0]?.reason).toContain('failOn');
  });

  it('conservatively fails a check whose own runner throws, rather than letting the rejection escape evaluateGate', async () => {
    const g = gate({ id: 'G-Test', checks: { deterministic: [check({ id: 'a' })], advisory: [] } });
    const runner: CheckRunner = () => Promise.reject(new Error('spawn ENOENT'));
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.checks[0]?.passed).toBe(false);
    expect(result.checks[0]?.reason).toContain('spawn ENOENT');
  });

  it('conservatively fails a check whose own runner rejects with a non-Error value, still describing the failure in the reason rather than producing "[object Object]" or crashing', async () => {
    const g = gate({ id: 'G-Test', checks: { deterministic: [check({ id: 'a' })], advisory: [] } });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately a non-Error rejection, the exact shape this test exercises
    const runner: CheckRunner = () => Promise.reject('ECONNREFUSED');
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.checks[0]?.passed).toBe(false);
    expect(result.checks[0]?.reason).toContain('ECONNREFUSED');
  });

  it("conservatively fails a check whose failOn expression blows evaluate's own separate depth guard (CFG-016), rather than letting that ForgeError escape evaluateGate", async () => {
    // The identical technique @forge/engine/plan's own compile.test.ts already uses: a flat, non-nested-
    // looking &&-chain of 200+ terms parses cleanly (parseAnd is iterative) but still builds a left-deep
    // Expr tree that blows evaluate's own recursive walk, at a depth parseExpression's own guard never sees.
    const deepFailOn = Array.from({ length: 250 }, () => 'a == a').join(' && ');
    const g = gate({
      id: 'G-Test',
      checks: { deterministic: [check({ id: 'a', failOn: deepFailOn })], advisory: [] },
    });
    const runner = stubRunner({ a: { stdout: '{}', exitCode: 0 } });
    const result = await evaluateGate(g, '/repo', runner);
    expect(result.checks[0]?.passed).toBe(false);
    expect(result.checks[0]?.reason).toContain('failOn evaluation failed');
  });

  it('is idempotent: re-evaluating the identical gate against a runner that always returns the same output produces a byte-identical result (rule 3)', async () => {
    const g = gate({
      id: 'G-Test',
      checks: {
        deterministic: [check({ id: 'a' }), check({ id: 'b', failOn: 'errors > 5' })],
        advisory: [],
      },
    });
    const runner = stubRunner({
      a: { stdout: '{"errors":0}', exitCode: 0 },
      b: { stdout: '{"errors":2}', exitCode: 0 },
    });
    const first = await evaluateGate(g, '/repo', runner);
    const second = await evaluateGate(g, '/repo', runner);
    expect(second).toEqual(first);
  });

  it("passes vacuously (no deterministic checks to fail) when a gate declares none -- rejecting that shape at all is a different, already-built package's own job (GATE-502)", async () => {
    const g = gate({ id: 'G-Empty', checks: { deterministic: [], advisory: [] } });
    const result = await evaluateGate(g, '/repo', stubRunner({}));
    expect(result.passed).toBe(true);
    expect(result.checks).toEqual([]);
  });

  it('carries openQuestionsPolicy straight through into the result, unmodified', async () => {
    const g = gate({
      id: 'G-Test',
      openQuestionsPolicy: 'warn',
      checks: { deterministic: [], advisory: [] },
    });
    const result = await evaluateGate(g, '/repo', stubRunner({}));
    expect(result.openQuestionsPolicy).toBe('warn');
  });
});
