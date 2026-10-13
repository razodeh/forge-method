/**
 * `parseVitestJson` — the built-in `vitest-json` format (`13` F-TEST-7 point 2, `18` §18.3), for a
 * structured `testCommands.<layer>` layer that declares `format: vitest-json` directly rather than
 * going through the legacy bare-string path (`reporter.ts`'s own `runVitest`/`outcomesFromVitestJson`,
 * unchanged by this piece).
 *
 * Every fixture below is REAL `vitest --reporter=json` output, captured directly during this piece's
 * own build against this monorepo's own installed Vitest, including the same two edge cases
 * `reporter.ts`'s own legacy vitest handling already documents and this parser mirrors for the
 * identical, confirmed reason: a file that fails to load reports `assertionResults: []` with the
 * file's own `status: 'failed'`; a `beforeAll` hook that throws reports EVERY assertion in that file
 * as `status: 'skipped'` (even one that was never going to run anyway, and one that WAS deliberately
 * `.skip()`-ed), distinguishable only by the file's own non-empty `message`.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import { describe, expect, it, vi } from 'vitest';

import { parseVitestJson } from '../../../../../src/commands/loop/test/parsers/vitest-json.ts';

const BASE_JSON = JSON.stringify({
  testResults: [
    {
      assertionResults: [
        { fullName: 'AC-014-2 returns 422 for an empty invoice', status: 'passed' },
        { fullName: 'AC-014-3 fails on purpose', status: 'failed' },
        { fullName: 'a plain test with no AC prefix', status: 'passed' },
        { fullName: 'a skipped test', status: 'skipped' },
      ],
      status: 'failed',
      message: '',
      name: '/fixture/sample.test.js',
    },
  ],
});

// Real capture: `vitest run --root broken --reporter=json` against a file importing a module that
// does not exist.
const BROKEN_FILE_JSON =
  '{"testResults":[{"assertionResults":[],"status":"failed","message":"Cannot find package \'this-module-does-not-exist-xyz\' imported from /fixture/broken/x.test.js","name":"/fixture/broken/x.test.js"}]}';

// Real capture: `vitest run --root hook --reporter=json` against a `beforeAll` that throws, next to
// a test that was ALSO deliberately `.skip()`-ed -- both report `status: "skipped"`, disambiguated
// only by the file's own non-empty `message`.
const HOOK_THREW_JSON = JSON.stringify({
  testResults: [
    {
      assertionResults: [
        { fullName: 'AC-300-1 never actually runs either', status: 'skipped' },
        { fullName: 'a real skip next to the hook failure', status: 'skipped' },
      ],
      status: 'failed',
      message: 'boom',
      name: '/fixture/hook/x.test.js',
    },
  ],
});

describe('parseVitestJson (specs/22 M17 P3)', () => {
  it('a real pass, fail, plain pass and deliberate skip are each read correctly', () => {
    const result = parseVitestJson(BASE_JSON);
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

  it('attributes file from the file-level "name" (vitest always names the real file)', () => {
    const result = parseVitestJson(BASE_JSON);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    for (const entry of result.tests) expect(entry.file).toBe('/fixture/sample.test.js');
  });

  it('a file that fails to load (empty assertionResults, file status failed) is one fail entry, kind load', () => {
    const result = parseVitestJson(BROKEN_FILE_JSON);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]).toMatchObject({
      status: 'fail',
      kind: 'load',
      file: '/fixture/broken/x.test.js',
    });
  });

  it('a thrown beforeAll reclassifies every "skipped" assertion in that file into fail/crash -- including one that was genuinely .skip()-ed, which this format cannot tell apart from the hook victim', () => {
    const result = parseVitestJson(HOOK_THREW_JSON);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(2);
    for (const entry of result.tests)
      expect(entry).toMatchObject({ status: 'fail', kind: 'crash' });
  });

  it('a genuinely empty testResults array is ok with zero tests, never a tool-error', () => {
    const result = parseVitestJson(JSON.stringify({ testResults: [] }));
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('JSON with no real "testResults" array at all is a real, diagnosable tool-error', () => {
    expect(parseVitestJson(JSON.stringify({})).ok).toBe(false);
    expect(parseVitestJson('[]').ok).toBe(false);
    expect(parseVitestJson('42').ok).toBe(false);
  });

  it('not valid JSON at all is a real, diagnosable tool-error', () => {
    expect(parseVitestJson('not json').ok).toBe(false);
  });

  it('never throws on malformed input', () => {
    expect(() => parseVitestJson('')).not.toThrow();
    expect(() => parseVitestJson('{"testResults": "not an array"}')).not.toThrow();
  });

  it('a genuinely empty file (zero assertions, not a failure) contributes nothing', () => {
    const result = parseVitestJson(
      JSON.stringify({ testResults: [{ assertionResults: [], status: 'passed' }] }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('a file result whose own assertionResults is missing entirely is read the same as empty', () => {
    const result = parseVitestJson(JSON.stringify({ testResults: [{ status: 'passed' }] }));
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('a failed-to-load file with no message and no name: "failed to load"/"(unknown file)" fallbacks, file omitted', () => {
    const result = parseVitestJson(
      JSON.stringify({ testResults: [{ assertionResults: [], status: 'failed' }] }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]?.name).toContain('failed to load');
    expect(result.tests[0]?.name).toContain('(unknown file)');
    expect(result.tests[0]?.file).toBeUndefined();
  });

  it('an assertion naming only "title" (no fullName) uses it', () => {
    const result = parseVitestJson(
      JSON.stringify({
        testResults: [
          { assertionResults: [{ title: 'AC-1 titled', status: 'passed' }], status: 'passed' },
        ],
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests[0]?.name).toBe('AC-1 titled');
  });

  it('an assertion with neither fullName nor title is skipped', () => {
    const result = parseVitestJson(
      JSON.stringify({
        testResults: [
          {
            assertionResults: [{ status: 'passed' }, { fullName: 'AC-1 real', status: 'passed' }],
            status: 'passed',
          },
        ],
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'AC-1 real', status: 'pass' }]);
  });

  it('real assertions in a file result with no "name" at all omit file from every entry', () => {
    const result = parseVitestJson(
      JSON.stringify({
        testResults: [
          { assertionResults: [{ fullName: 'AC-1 x', status: 'passed' }], status: 'passed' },
        ],
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'AC-1 x', status: 'pass' }]);
  });

  it('describeCause: a non-Error thrown value (forced: JSON.parse mocked for this one call) still produces a real message, never a crash', () => {
    // Deliberately forcing the non-Error branch of this file's own describeCause, which JSON.parse
    // itself never actually throws (always a real SyntaxError) -- the only way to prove that
    // defensive branch is sound.
    const spy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'a non-Error throw';
    });
    try {
      const result = parseVitestJson('{}');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('a non-Error throw');
    } finally {
      spy.mockRestore();
    }
  });
});
