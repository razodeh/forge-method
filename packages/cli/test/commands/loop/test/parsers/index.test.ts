/**
 * `PARSERS` — the dispatch table from a structured layer's own declared `format` (`18` §18.3) to the
 * built-in parser that reads it.
 *
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import { TEST_REPORT_FORMATS } from '@forge/schemas/config';
import { describe, expect, it } from 'vitest';

import { PARSERS } from '../../../../../src/commands/loop/test/parsers/index.ts';

describe('PARSERS (specs/22 M17 P3)', () => {
  it('has exactly one entry per built-in format named in 18 §18.3 / 13 F-TEST-7 point 2, no more, no fewer', () => {
    expect(Object.keys(PARSERS).sort()).toEqual([...TEST_REPORT_FORMATS].sort());
  });

  it('every entry is a callable parser function', () => {
    for (const format of TEST_REPORT_FORMATS) {
      expect(typeof PARSERS[format]).toBe('function');
    }
  });

  it("every entry, called on genuinely empty input, never throws (each parser's own test file covers whether empty input is ok or a tool-error for its own real format)", () => {
    for (const format of TEST_REPORT_FORMATS) {
      expect(() => PARSERS[format](''), format).not.toThrow();
    }
  });

  it('dispatches forge-json correctly end to end', () => {
    const result = PARSERS['forge-json'](
      JSON.stringify({ forgeTestReport: 1, tests: [{ name: 'x', status: 'pass' }] }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'x', status: 'pass' }]);
  });
});
