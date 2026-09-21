/**
 * The audit trail keeps a check's stderr (sanitised, capped), and `in` checks element types (`PLAN-M13.md` P41).
 *
 * @see specs/10 §10.3 rule 4
 */
import { describe, expect, it } from 'vitest';

import { evaluateGate, MAX_CHECK_STDERR_CHARS } from '../../src/gates/evaluate.ts';
import type { GateDefinition } from '../../src/gates/types.ts';

function one(failOn: string): GateDefinition {
  return {
    id: 'G',
    checks: { deterministic: [{ id: 'c', run: 'c', failOn }], advisory: [] },
    openQuestionsPolicy: 'warn',
  };
}

const run =
  (stdout: string, stderr?: string, exitCode = 0) =>
  () =>
    Promise.resolve({
      stdout,
      exitCode,
      ...(stderr === undefined ? {} : { stderr }),
    });

describe('stderr in the audit trail', () => {
  it('keeps the stderr of a check that crashed, beside the reason', async () => {
    const result = await evaluateGate(
      one('errors > 0'),
      '/',
      run('', 'TypeError: boom\n    at x', 1),
    );
    expect(result.checks[0]).toMatchObject({ passed: false, stderr: 'TypeError: boom\n    at x' });
    expect(result.checks[0]?.reason).toBeDefined();
  });

  it('keeps stderr for a passing check and for one whose failOn tripped', async () => {
    const pass = await evaluateGate(
      one('errors > 0'),
      '/',
      run('{"errors":0}', 'warning: deprecated'),
    );
    expect(pass.checks[0]).toMatchObject({ passed: true, stderr: 'warning: deprecated' });
    const fail = await evaluateGate(one('errors > 0'), '/', run('{"errors":2}', 'two problems'));
    expect(fail.checks[0]).toMatchObject({ passed: false, stderr: 'two problems' });
  });

  it('records no stderr key when the command wrote nothing (or only whitespace), and when the runner has none', async () => {
    for (const stderr of [undefined, '', '  \n']) {
      const result = await evaluateGate(one('errors > 0'), '/', run('{"errors":0}', stderr));
      expect(result.checks[0]).not.toHaveProperty('stderr');
    }
  });

  it('redacts secret shapes and strips terminal escapes and control bytes', async () => {
    const stderr = `token ghp_${'a'.repeat(36)} \u001b[31mred\u001b[0m\u0007 AKIAABCDEFGHIJKLMNOP`;
    const result = await evaluateGate(one('errors > 0'), '/', run('', stderr, 1));
    const kept = result.checks[0]?.stderr ?? '';
    expect(kept).not.toContain('ghp_');
    expect(kept).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(kept).not.toContain('\u001b');
    expect(kept).not.toContain('\u0007');
    expect(kept).toContain('[REDACTED]');
    expect(kept).toContain('red');
  });

  it('caps a huge stderr and says how much was cut; a secret straddling the cap is still redacted', async () => {
    const secret = `ghp_${'b'.repeat(36)}`;
    const stderr = `${'x'.repeat(MAX_CHECK_STDERR_CHARS - 10)}${secret}${'y'.repeat(50_000)}`;
    const result = await evaluateGate(one('errors > 0'), '/', run('', stderr, 1));
    const kept = result.checks[0]?.stderr ?? '';
    expect(kept.length).toBeLessThan(MAX_CHECK_STDERR_CHARS + 100);
    expect(kept).toMatch(/\[stderr truncated: \d+ more characters\]$/);
    // the cap cuts inside the key: redaction must have run first, or its first characters would survive
    expect(kept).not.toContain('ghp_');
    expect(kept).toContain('[REDACTED]');
  });

  it('the runner throwing still leaves a failed result (no stderr to record)', async () => {
    const result = await evaluateGate(one('errors > 0'), '/', () => {
      throw new Error('spawn failed');
    });
    expect(result.checks[0]).toMatchObject({ passed: false, exitCode: -1 });
  });
});

describe('`in` needs matching element types (it was quietly false)', () => {
  const inGate = one('severity in bad');
  it.each([
    ['a string against numbers', '{"severity":"a","bad":[1,2]}'],
    ['a number against strings', '{"severity":1,"bad":["a"]}'],
    ['a string against a mixed list', '{"severity":"a","bad":["a",1]}'],
    ['a string against objects', '{"severity":"a","bad":[{"x":1}]}'],
  ])('fails %s with a reason', async (_l, stdout) => {
    const result = await evaluateGate(inGate, '/', run(stdout));
    expect(result.checks[0]?.passed).toBe(false);
    expect(result.checks[0]?.reason).toContain('same type');
  });

  it('still answers for matching types: a hit fails the gate with no reason, a miss passes, an empty list passes', async () => {
    const hit = await evaluateGate(inGate, '/', run('{"severity":"a","bad":["a","b"]}'));
    expect(hit.checks[0]).toMatchObject({ passed: false });
    expect(hit.checks[0]?.reason).toBeUndefined();
    const miss = await evaluateGate(inGate, '/', run('{"severity":"c","bad":["a","b"]}'));
    expect(miss.checks[0]?.passed).toBe(true);
    const empty = await evaluateGate(inGate, '/', run('{"severity":"c","bad":[]}'));
    expect(empty.checks[0]?.passed).toBe(true);
  });
});
