/**
 * `parseForgeJson` — the built-in `forge-json` format: `09` §9.5's own canonical shape, read
 * directly (no further mapping) for a project or translator that already emits it.
 *
 * @see specs/09 §9.5
 * @see specs/22 M17 P3
 */
import { describe, expect, it } from 'vitest';

import { parseForgeJson } from '../../../../../src/commands/loop/test/parsers/forge-json.ts';

describe('parseForgeJson (specs/22 M17 P3)', () => {
  it('reads a valid forge-test-report document straight through', () => {
    const result = parseForgeJson(
      JSON.stringify({
        forgeTestReport: 1,
        tests: [
          { name: 'AC-1 x', status: 'pass' },
          { name: 'AC-2 y', status: 'fail', kind: 'assertion' },
        ],
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(2);
    expect(result.tests[1]).toMatchObject({ status: 'fail', kind: 'assertion' });
  });

  it('a genuinely empty tests array is ok, never a tool-error', () => {
    const result = parseForgeJson(JSON.stringify({ forgeTestReport: 1, tests: [] }));
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('a pre-extracted acId passes through verbatim', () => {
    const result = parseForgeJson(
      JSON.stringify({ forgeTestReport: 1, tests: [{ name: 'x', status: 'pass', acId: 'AC-9' }] }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests[0]?.acId).toBe('AC-9');
  });

  it('not valid JSON at all is a real, diagnosable tool-error', () => {
    expect(parseForgeJson('not json').ok).toBe(false);
  });

  it('valid JSON that is not forge-test-report shaped is a real, diagnosable tool-error', () => {
    expect(parseForgeJson(JSON.stringify({ not: 'this shape' })).ok).toBe(false);
  });

  it('never throws on malformed input', () => {
    expect(() => parseForgeJson('')).not.toThrow();
    expect(() => parseForgeJson('{"forgeTestReport":2,"tests":[]}')).not.toThrow();
  });
});
