/**
 * `parseTap` — the built-in `tap` format (`13` F-TEST-7 point 2, `18` §18.3).
 *
 * `NODE_TEST_TAP` below is real `node --test` output (Node 22, TAP version 13), captured directly
 * during this piece's own build against the identical four-test fixture (`AC-014-2` pass,
 * `AC-014-3` fail, a plain pass, a skip) the other parser tests in this directory reuse.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import { describe, expect, it } from 'vitest';

import { parseTap } from '../../../../../src/commands/loop/test/parsers/tap.ts';

const NODE_TEST_TAP = `TAP version 13
# Subtest: AC-014-2 returns 422 for an empty invoice
ok 1 - AC-014-2 returns 422 for an empty invoice
  ---
  duration_ms: 0.248292
  ...
# Subtest: AC-014-3 fails on purpose
not ok 2 - AC-014-3 fails on purpose
  ---
  duration_ms: 0.27825
  location: '/fixture/sample.test.js:5:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    1 !== 2

  code: 'ERR_ASSERTION'
  ...
# Subtest: a plain test with no AC prefix
ok 3 - a plain test with no AC prefix
  ---
  duration_ms: 0.050708
  ...
# Subtest: a skipped test
ok 4 - a skipped test # SKIP
  ---
  duration_ms: 0.029458
  ...
1..4
# tests 4
# suites 0
# pass 2
# fail 1
# cancelled 0
# skipped 1
# todo 0
# duration_ms 26.987125
`;

describe('parseTap (specs/22 M17 P3)', () => {
  it('real node --test TAP: pass, fail, plain pass and skip are each read correctly', () => {
    const result = parseTap(NODE_TEST_TAP);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    const byName = new Map(result.tests.map((entry) => [entry.name, entry]));
    expect(byName.get('AC-014-2 returns 422 for an empty invoice')?.status).toBe('pass');
    expect(byName.get('AC-014-3 fails on purpose')).toMatchObject({
      status: 'fail',
      kind: 'assertion',
    });
    expect(byName.get('a plain test with no AC prefix')?.status).toBe('pass');
    expect(byName.get('a skipped test')?.status).toBe('skip');
  });

  it('09 §9.5: TAP carries no finer failure signal than pass/fail -- every fail reads kind "assertion"', () => {
    const result = parseTap('not ok 1 - something broke\n');
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'something broke', status: 'fail', kind: 'assertion' }]);
  });

  it('a YAML diagnostic block is skipped over, never mistaken for a new test point', () => {
    const tap =
      'ok 1 - one\n  ---\n  not ok 99 - this is diagnostic text, not a test\n  ...\nok 2 - two\n';
    const result = parseTap(tap);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests.map((entry) => entry.name)).toEqual(['one', 'two']);
  });

  it('a # TODO directive is also read as skip, not as a real pass or fail', () => {
    const result = parseTap('ok 1 - something not yet implemented # TODO\n');
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'something not yet implemented', status: 'skip' }]);
  });

  it('a skip directive on a failing line is still read as skip, never fail', () => {
    const result = parseTap('not ok 1 - name # SKIP reason text\n');
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'name', status: 'skip' }]);
  });

  it('the plan line (1..N), the version line, and bare comment lines are ignored, not read as tests', () => {
    const tap = 'TAP version 13\n1..1\n# a comment\nok 1 - the one real test\n# tests 1\n';
    const result = parseTap(tap);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'the one real test', status: 'pass' }]);
  });

  it('a test point number is optional per TAP13; a point with no number still parses', () => {
    const result = parseTap('ok - a test with no number\nnot ok - another with no number\n');
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests.map((entry) => entry.status)).toEqual(['pass', 'fail']);
  });

  it('a genuinely empty stream is ok with zero tests, never a tool-error', () => {
    const result = parseTap('');
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(() => parseTap('garbage\nnot even close to TAP\n')).not.toThrow();
    expect(() => parseTap('  ---\nunterminated yaml block')).not.toThrow();
  });

  it('a bare test point with no description at all (not even a hyphen) reports nothing, never a fabricated empty name', () => {
    const result = parseTap('ok 1\nnot ok 2\n');
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });
});
