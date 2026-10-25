/**
 * `forge-test-report` v1 — `09` §9.5's own canonical, versioned JSON test-result shape.
 *
 * @see specs/09 §9.5
 * @see specs/22 M17 P3
 */
import { describe, expect, it } from 'vitest';

import { forgeTestReportSchema, parseForgeTestReport } from '../src/test-report.ts';

describe('forgeTestReportSchema (specs/22 M17 P3)', () => {
  it('accepts the minimal shape: only name and status on each entry', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'AC-014-2 returns 422 for an empty invoice', status: 'pass' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an entry with every optional field set', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [
        {
          name: 'AC-014-3 fails on purpose',
          file: 'src/sample.test.js',
          status: 'fail',
          kind: 'assertion',
          durationMs: 12.5,
          acId: 'AC-014-3',
          message: 'expected 4, got 5',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('a failing entry\'s "message" round-trips through the schema unchanged (Q346)', () => {
    const report = {
      forgeTestReport: 1,
      tests: [{ name: 'AC-014-3 fails on purpose', status: 'fail', message: 'expected 4, got 5' }],
    };
    const result = forgeTestReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.tests[0]?.message).toBe('expected 4, got 5');
  });

  it('09 §9.5 (Q346): "message" applies only when status is fail -- refuses message on a pass', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'pass', message: 'should not be here' }],
    });
    expect(result.success).toBe(false);
  });

  it('09 §9.5 (Q346): "message" applies only when status is fail -- refuses message on a skip', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'skip', message: 'should not be here' }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses an empty message (Q346: non-blank, same convention as file/acId/name)', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'fail', message: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('a fail entry with no message is still valid (Q346: not every translator can populate it)', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'fail', kind: 'assertion' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a genuinely empty tests array (09 §9.5: no minimum count at the schema level)', () => {
    const result = forgeTestReportSchema.safeParse({ forgeTestReport: 1, tests: [] });
    expect(result.success).toBe(true);
  });

  it('refuses forgeTestReport values other than the literal 1', () => {
    expect(forgeTestReportSchema.safeParse({ forgeTestReport: 2, tests: [] }).success).toBe(false);
    expect(forgeTestReportSchema.safeParse({ forgeTestReport: '1', tests: [] }).success).toBe(
      false,
    );
  });

  it('requires both forgeTestReport and tests', () => {
    expect(forgeTestReportSchema.safeParse({ tests: [] }).success).toBe(false);
    expect(forgeTestReportSchema.safeParse({ forgeTestReport: 1 }).success).toBe(false);
  });

  it('refuses an entry missing name or status', () => {
    expect(
      forgeTestReportSchema.safeParse({ forgeTestReport: 1, tests: [{ status: 'pass' }] }).success,
    ).toBe(false);
    expect(
      forgeTestReportSchema.safeParse({ forgeTestReport: 1, tests: [{ name: 'x' }] }).success,
    ).toBe(false);
  });

  it('refuses a status outside pass|fail|skip', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'errored' }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a kind outside assertion|load|timeout|crash', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'fail', kind: 'oops' }],
    });
    expect(result.success).toBe(false);
  });

  it('09 §9.5: "kind applies only when status is fail" — refuses kind on a pass', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'pass', kind: 'assertion' }],
    });
    expect(result.success).toBe(false);
  });

  it('09 §9.5: "kind applies only when status is fail" — refuses kind on a skip', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'skip', kind: 'crash' }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a negative durationMs', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'pass', durationMs: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses an unknown top-level key', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [],
      extra: true,
    });
    expect(result.success).toBe(false);
  });

  it('refuses an unknown key on one entry', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: 'x', status: 'pass', extra: true }],
    });
    expect(result.success).toBe(false);
  });

  it('refuses an empty name (09 §9.5 names it required, which means non-blank, not merely present)', () => {
    const result = forgeTestReportSchema.safeParse({
      forgeTestReport: 1,
      tests: [{ name: '', status: 'pass' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('parseForgeTestReport (specs/22 M17 P3)', () => {
  it('parses a valid report', () => {
    const result = parseForgeTestReport(
      JSON.stringify({ forgeTestReport: 1, tests: [{ name: 'AC-1 x', status: 'pass' }] }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.report.tests).toHaveLength(1);
    expect(result.report.tests[0]).toMatchObject({ name: 'AC-1 x', status: 'pass' });
  });

  it('parses a failing entry\'s "message" through to the result (Q346)', () => {
    const result = parseForgeTestReport(
      JSON.stringify({
        forgeTestReport: 1,
        tests: [{ name: 'AC-1 x', status: 'fail', message: 'boom' }],
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.report.tests[0]).toMatchObject({
      name: 'AC-1 x',
      status: 'fail',
      message: 'boom',
    });
  });

  it('a genuinely empty tests array is still "ok" -- emptiness is not this function\'s own concern', () => {
    const result = parseForgeTestReport(JSON.stringify({ forgeTestReport: 1, tests: [] }));
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.report.tests).toEqual([]);
  });

  it('reports a real, diagnosable message for text that is not valid JSON at all', () => {
    const result = parseForgeTestReport('this is not { json');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected not ok');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('reports a real, diagnosable message for valid JSON that is not forge-test-report shaped', () => {
    const result = parseForgeTestReport(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected not ok');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('reports a real, diagnosable message for a JSON array (valid JSON, wrong top-level shape)', () => {
    const result = parseForgeTestReport('[]');
    expect(result.ok).toBe(false);
  });

  it('never throws on malformed input', () => {
    expect(() => parseForgeTestReport('')).not.toThrow();
    expect(() => parseForgeTestReport('null')).not.toThrow();
    expect(() =>
      parseForgeTestReport('{"forgeTestReport":1,"tests":[{"status":"pass"}]}'),
    ).not.toThrow();
  });
});
