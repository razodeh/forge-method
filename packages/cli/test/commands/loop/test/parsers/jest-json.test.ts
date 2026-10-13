/**
 * `parseJestJson` — the built-in `jest-json` format (`13` F-TEST-7 point 2, `18` §18.3).
 *
 * Every fixture below is REAL `jest --json` output (Jest 30.5.2), captured directly during this
 * piece's own build. Structurally close to vitest's own `--reporter=json` shape (`assertionResults`
 * nested under a per-file `testResults` entry) but confirmed to differ in two real ways this parser
 * accounts for: (1) Jest's own skip status is the literal string `"pending"`, not `"skipped"`; (2) a
 * `beforeAll` that throws does NOT need `vitest-json.ts`'s own hook-reclassification — confirmed
 * directly against a real `beforeAll` throw next to a deliberately `.skip()`-ed test: Jest reports
 * the test that would have run as `status: "failed"` DIRECTLY (with the hook's own error in its
 * `failureMessages`), while the genuinely `.skip()`-ed test still reads `status: "pending"` — Jest
 * tells the two apart on its own, so this parser trusts `status` as given, with no reclassification.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import { describe, expect, it, vi } from 'vitest';

import { parseJestJson } from '../../../../../src/commands/loop/test/parsers/jest-json.ts';

const BASE_JSON = JSON.stringify({
  testResults: [
    {
      assertionResults: [
        { fullName: 'AC-014-2 returns 422 for an empty invoice', status: 'passed' },
        { fullName: 'AC-014-3 fails on purpose', status: 'failed' },
        { fullName: 'a plain test with no AC prefix', status: 'passed' },
        { fullName: 'a skipped test', status: 'pending' },
      ],
      status: 'failed',
      name: '/fixture/sample.test.js',
    },
  ],
});

// Real capture: `jest --json --testPathPatterns=broken.test.js` against a file requiring a module
// that does not exist.
const BROKEN_FILE_JSON = JSON.stringify({
  testResults: [
    {
      assertionResults: [],
      status: 'failed',
      message: "Test suite failed to run\n\nCannot find module 'this-module-does-not-exist-xyz'",
      name: '/fixture/broken.test.js',
    },
  ],
});

// Real capture: a `beforeAll` that throws, next to a test that was ALSO deliberately `.skip()`-ed --
// confirmed Jest tells the two apart on its own: the real test that never ran reads "failed"
// directly, the deliberately-skipped one still reads "pending".
const HOOK_THREW_JSON = JSON.stringify({
  testResults: [
    {
      assertionResults: [
        {
          fullName: 'AC-300-1 never actually runs either',
          status: 'failed',
          failureMessages: ['boom in beforeAll'],
        },
        {
          fullName: 'a real skip next to the hook failure',
          status: 'pending',
          failureMessages: ['boom in beforeAll'],
        },
      ],
      status: 'failed',
      name: '/fixture/hook.test.js',
    },
  ],
});

// Re-confirmed directly (critic-prompted, after vitest-json.ts's own identical scenario turned out
// NOT to be recoverable): the IDENTICAL beforeAll, declared INSIDE a describe() block this time --
//   describe('a describe block', () => {
//     beforeAll(() => { throw new Error('boom in nested beforeAll'); });
//     test('AC-300-1 never actually runs either', () => {});
//     test.skip('a real skip next to the hook failure', () => {});
//   });
// Real, byte-for-byte jest --json output (stack trace trimmed for readability; the fields this
// parser reads are verbatim): nesting changes NOTHING -- the real victim still reads "failed" with
// the hook's error in failureMessages, the genuine skip still reads "pending".
const NESTED_HOOK_THREW_JSON = JSON.stringify({
  testResults: [
    {
      assertionResults: [
        {
          ancestorTitles: ['a describe block'],
          fullName: 'a describe block AC-300-1 never actually runs either',
          status: 'failed',
          failureMessages: ['Error: boom in nested beforeAll'],
        },
        {
          ancestorTitles: ['a describe block'],
          fullName: 'a describe block a real skip next to the hook failure',
          status: 'pending',
          failureMessages: ['Error: boom in nested beforeAll'],
        },
      ],
      status: 'failed',
      name: '/fixture/hook-nested.test.js',
    },
  ],
});

describe('parseJestJson (specs/22 M17 P3)', () => {
  it('a real pass, fail, plain pass and skip ("pending") are each read correctly', () => {
    const result = parseJestJson(BASE_JSON);
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

  it('attributes file from the file-level "name"', () => {
    const result = parseJestJson(BASE_JSON);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    for (const entry of result.tests) expect(entry.file).toBe('/fixture/sample.test.js');
  });

  it('a file that fails to run (empty assertionResults, file status failed) is one fail entry, kind load', () => {
    const result = parseJestJson(BROKEN_FILE_JSON);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]).toMatchObject({
      status: 'fail',
      kind: 'load',
      file: '/fixture/broken.test.js',
    });
  });

  it('a thrown beforeAll: jest already tells the real failure from the genuine skip, no reclassification needed', () => {
    const result = parseJestJson(HOOK_THREW_JSON);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    const byName = new Map(result.tests.map((entry) => [entry.name, entry]));
    expect(byName.get('AC-300-1 never actually runs either')).toMatchObject({
      status: 'fail',
      kind: 'assertion',
    });
    expect(byName.get('a real skip next to the hook failure')?.status).toBe('skip');
  });

  it('a thrown beforeAll NESTED inside describe(): re-confirmed nesting changes nothing -- still a clean fail/pending split, no reclassification needed', () => {
    const result = parseJestJson(NESTED_HOOK_THREW_JSON);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    const byName = new Map(result.tests.map((entry) => [entry.name, entry]));
    expect(byName.get('a describe block AC-300-1 never actually runs either')).toMatchObject({
      status: 'fail',
      kind: 'assertion',
    });
    expect(byName.get('a describe block a real skip next to the hook failure')?.status).toBe(
      'skip',
    );
  });

  it('a genuinely empty testResults array is ok with zero tests, never a tool-error', () => {
    const result = parseJestJson(JSON.stringify({ testResults: [] }));
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('JSON with no real "testResults" array at all is a real, diagnosable tool-error', () => {
    expect(parseJestJson(JSON.stringify({})).ok).toBe(false);
    expect(parseJestJson('[]').ok).toBe(false);
  });

  it('not valid JSON at all is a real, diagnosable tool-error', () => {
    expect(parseJestJson('not json').ok).toBe(false);
  });

  it('never throws on malformed input', () => {
    expect(() => parseJestJson('')).not.toThrow();
  });

  it('a genuinely empty file (zero assertions, not a failure) contributes nothing, never a fabricated outcome', () => {
    const result = parseJestJson(
      JSON.stringify({
        testResults: [{ assertionResults: [], status: 'passed', name: '/fixture/empty.test.js' }],
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('a file result whose own assertionResults is missing entirely (not an array) is read the same as empty', () => {
    const result = parseJestJson(JSON.stringify({ testResults: [{ status: 'passed' }] }));
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('a failed-to-load file with no real message at all still reports, with the "failed to run" fallback detail', () => {
    const result = parseJestJson(
      JSON.stringify({ testResults: [{ assertionResults: [], status: 'failed' }] }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]?.name).toContain('failed to run');
    expect(result.tests[0]?.name).toContain('(unknown file)');
    expect(result.tests[0]?.file).toBeUndefined();
  });

  it('an assertion with neither fullName nor title is skipped, not fabricated as an empty-named entry', () => {
    const result = parseJestJson(
      JSON.stringify({
        testResults: [
          {
            assertionResults: [
              { status: 'passed' },
              { fullName: 'AC-1 real one', status: 'passed' },
            ],
            status: 'passed',
            name: '/fixture/x.test.js',
          },
        ],
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([
      { name: 'AC-1 real one', status: 'pass', file: '/fixture/x.test.js' },
    ]);
  });

  it('a file result with real assertions but no "name" field omits file from every entry', () => {
    const result = parseJestJson(
      JSON.stringify({
        testResults: [
          { assertionResults: [{ fullName: 'AC-1 x', status: 'passed' }], status: 'passed' },
        ],
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'AC-1 x', status: 'pass' }]);
  });

  it('an assertion naming only "title" (no fullName) uses it', () => {
    const result = parseJestJson(
      JSON.stringify({
        testResults: [
          { assertionResults: [{ title: 'AC-1 titled', status: 'passed' }], status: 'passed' },
        ],
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests[0]?.name).toBe('AC-1 titled');
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
      const result = parseJestJson('{}');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('a non-Error throw');
    } finally {
      spy.mockRestore();
    }
  });
});
