/**
 * `parseJunitXml` — the built-in `junit-xml` format (`13` F-TEST-7 point 2, `18` §18.3).
 *
 * Every fixture below is REAL tool output, captured directly during this piece's own build (not
 * assumed from documentation): pytest 8.4.2's `--junitxml`, Node 22's own `--test-reporter=junit`,
 * Jest 30.5.2 + `jest-junit` 17's reporter, Mocha 10 + `mocha-junit-reporter` 2's reporter, and this
 * monorepo's own installed Vitest's `--reporter=junit` — each run against the identical four-test
 * fixture (`AC-014-2` pass, `AC-014-3` fail, a plain pass, a skip) this file's own sibling parser
 * tests (`vitest-json.test.ts`, `jest-json.test.ts`) reuse. Long, irrelevant stack-trace bodies
 * inside a captured `<failure>` element are trimmed for readability; every attribute and element
 * this parser actually reads is verbatim.
 *
 * The five real captures disagree sharply on what `classname` means (pytest/Vitest: the real test
 * module/file; Jest+jest-junit: a redundant copy of `name` with a stray leading space; Mocha: the
 * REVERSE of pytest's convention — `name` carries the describe-block prefix, `classname` does not;
 * Node: the literal, useless string `"test"` for every case) and on whether a skipped test appears
 * in the report at all (Mocha's own reporter drops it from the per-testcase list entirely, despite
 * still counting it in the aggregate `skipped="1"`) — confirmed directly, not assumed. This is why
 * `parseJunitXml` never reads `classname` as a file (13 F-TEST-7 point 5's own degradation: no
 * reliable per-test file attribution in this format, so every entry omits `file`).
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2, point 5
 * @see specs/22 M17 P3
 */
import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it, vi } from 'vitest';

import { parseJunitXml } from '../../../../../src/commands/loop/test/parsers/junit-xml.ts';

const PYTEST_XML =
  '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests">' +
  '<testsuite name="pytest" errors="0" failures="1" skipped="1" tests="4" time="0.026">' +
  '<testcase classname="test_sample" name="test_AC_014_2_returns_422_for_an_empty_invoice" time="0.014" />' +
  '<testcase classname="test_sample" name="test_AC_014_3_fails_on_purpose" time="0.000">' +
  '<failure message="assert 1 == 2">def test_AC_014_3_fails_on_purpose():\n' +
  '&gt;       assert 1 == 2\nE       assert 1 == 2</failure></testcase>' +
  '<testcase classname="test_sample" name="test_a_plain_test_with_no_AC_prefix" time="0.000" />' +
  '<testcase classname="test_sample" name="test_a_skipped_test" time="0.000">' +
  '<skipped type="pytest.skip" message="demo">test_sample.py:12: demo</skipped>' +
  '</testcase></testsuite></testsuites>';

const NODE_TEST_XML = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="AC-014-2 returns 422 for an empty invoice" time="0.000291" classname="test"/>
	<testcase name="AC-014-3 fails on purpose" time="0.000326" classname="test" failure="Expected values to be strictly equal:1 !== 2">
		<failure type="testCodeFailure" message="Expected values to be strictly equal:1 !== 2">
[Error [ERR_TEST_FAILURE]: Expected values to be strictly equal: 1 !== 2]
		</failure>
	</testcase>
	<testcase name="a plain test with no AC prefix" time="0.000059" classname="test"/>
	<testcase name="a skipped test" time="0.000034" classname="test">
		<skipped type="skipped" message="true"/>
	</testcase>
	<!-- tests 4 -->
	<!-- pass 2 -->
	<!-- fail 1 -->
	<!-- skipped 1 -->
</testsuites>`;

const JEST_JUNIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="4" failures="1" errors="0" time="0.11">
  <testsuite name="undefined" errors="0" failures="1" skipped="1" tests="4">
    <testcase classname=" AC-014-2 returns 422 for an empty invoice" name=" AC-014-2 returns 422 for an empty invoice" time="0.001">
    </testcase>
    <testcase classname=" AC-014-3 fails on purpose" name=" AC-014-3 fails on purpose" time="0">
      <failure>Error: expect(received).toBe(expected) // Object.is equality

Expected: 2
Received: 1</failure>
    </testcase>
    <testcase classname=" a plain test with no AC prefix" name=" a plain test with no AC prefix" time="0">
    </testcase>
    <testcase classname=" a skipped test" name=" a skipped test" time="0">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>`;

// Mocha + mocha-junit-reporter: confirmed directly that a deliberately `.skip()`-ed test is DROPPED
// from the per-testcase list entirely (only 3 <testcase> elements for 4 real tests), despite the
// aggregate `skipped="1"` still counting it — a real, disclosed limitation of this dialect, not a
// bug in this parser.
const MOCHA_JUNIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Mocha Tests" time="0.001" tests="4" failures="1" skipped="1">
  <testsuite name="Root Suite" tests="0" time="0.000" failures="0">
  </testsuite>
  <testsuite name="invoice suite" tests="4" file="/fixture/sample.test.cjs" time="0.001" failures="1">
    <testcase name="invoice suite AC-014-2 returns 422 for an empty invoice" time="0.000" classname="AC-014-2 returns 422 for an empty invoice">
    </testcase>
    <testcase name="invoice suite AC-014-3 fails on purpose" time="0.000" classname="AC-014-3 fails on purpose">
      <failure message="Expected values to be strictly equal:

1 !== 2
" type="AssertionError"><![CDATA[AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 1 !== 2]]></failure>
    </testcase>
    <testcase name="invoice suite a plain test with no AC prefix" time="0.000" classname="a plain test with no AC prefix">
    </testcase>
  </testsuite>
</testsuites>`;

const VITEST_JUNIT_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="4" failures="1" errors="0" time="0.003676625">
    <testsuite name="sample.test.js" tests="4" failures="1" errors="0" skipped="1" time="0.003676625">
        <testcase classname="sample.test.js" name="AC-014-2 returns 422 for an empty invoice" time="0.000553">
        </testcase>
        <testcase classname="sample.test.js" name="AC-014-3 fails on purpose" time="0.002575458">
            <failure message="expected 1 to be 2 // Object.is equality" type="AssertionError">
AssertionError: expected 1 to be 2 // Object.is equality
            </failure>
        </testcase>
        <testcase classname="sample.test.js" name="a plain test with no AC prefix" time="0.000118917">
        </testcase>
        <testcase classname="sample.test.js" name="a skipped test" time="0">
            <skipped/>
        </testcase>
    </testsuite>
</testsuites>`;

describe('parseJunitXml (specs/22 M17 P3)', () => {
  it.each([
    ['pytest 8.4.2', PYTEST_XML],
    ['node --test --test-reporter=junit (Node 22)', NODE_TEST_XML],
    ['jest 30.5.2 + jest-junit 17', JEST_JUNIT_XML],
    ['mocha 10 + mocha-junit-reporter 2', MOCHA_JUNIT_XML],
    ["this monorepo's own installed vitest --reporter=junit", VITEST_JUNIT_XML],
  ])('%s: a real pass, fail and plain test are each read correctly', (_label, xml) => {
    const result = parseJunitXml(xml);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    const byName = new Map(result.tests.map((entry) => [entry.name.trim(), entry]));
    const pass = [...byName.entries()].find(([name]) => /AC.?014.?2/.test(name));
    const fail = [...byName.entries()].find(([name]) => /AC.?014.?3/.test(name));
    expect(pass?.[1].status, 'the pass entry').toBe('pass');
    expect(pass?.[1].kind, 'the pass entry').toBeUndefined();
    expect(fail?.[1].status, 'the fail entry').toBe('fail');
    expect(fail?.[1].kind, 'the fail entry').toBe('assertion');
    // `message` (Q346, round 3): every one of these five real dialects' own `<failure>` carries
    // either real text or a real attribute, so every one is captured, non-empty.
    expect(fail?.[1].message, 'the fail entry').toBeTruthy();
  });

  it('never attributes a file from classname: pytest/node/jest-junit/vitest set no <testsuite file> attribute at all, so every entry omits file', () => {
    for (const xml of [PYTEST_XML, NODE_TEST_XML, JEST_JUNIT_XML, VITEST_JUNIT_XML]) {
      const result = parseJunitXml(xml);
      if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
      for (const entry of result.tests) expect(entry.file, entry.name).toBeUndefined();
    }
  });

  it('DOES attribute a file from a real <testsuite file="..."> attribute (mocha-junit-reporter) -- a dialect-unambiguous signal, unlike classname', () => {
    const result = parseJunitXml(MOCHA_JUNIT_XML);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests.length).toBeGreaterThan(0);
    for (const entry of result.tests) {
      expect(entry.file, entry.name).toBe('/fixture/sample.test.cjs');
    }
  });

  it('node --test: testcases are direct children of <testsuites>, with no <testsuite> wrapper at all', () => {
    const result = parseJunitXml(NODE_TEST_XML);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(4);
  });

  it('mocha-junit-reporter: a deliberately skipped test is absent from the real report (disclosed dialect limitation)', () => {
    const result = parseJunitXml(MOCHA_JUNIT_XML);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(3);
    expect(result.tests.some((entry) => entry.status === 'skip')).toBe(false);
  });

  it('pytest/vitest/node report the real skip as status "skip", with no kind', () => {
    for (const xml of [PYTEST_XML, VITEST_JUNIT_XML, NODE_TEST_XML]) {
      const result = parseJunitXml(xml);
      if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
      const skip = result.tests.find((entry) => entry.status === 'skip');
      expect(skip, xml.slice(0, 40)).toBeDefined();
      expect(skip?.kind).toBeUndefined();
    }
  });

  it('a <error> element (pytest-style setup/fixture failure) reads as fail, kind crash', () => {
    const xml =
      '<testsuites><testsuite><testcase classname="m" name="t1"><error message="boom">traceback</error></testcase></testsuite></testsuites>';
    const result = parseJunitXml(xml);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    // `message` (Q346, round 3): "traceback" (the real text content), not "boom" (the attribute) --
    // `detailOfJunitElement` prefers text, confirmed directly against fast-xml-parser's own shape.
    expect(result.tests).toEqual([
      { name: 't1', status: 'fail', kind: 'crash', message: 'traceback' },
    ]);
  });

  it('a real @_time attribute (seconds) is converted to durationMs (confirmed present in every real dialect above)', () => {
    const result = parseJunitXml(PYTEST_XML);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    const first = result.tests.find((entry) => /AC.?014.?2/.test(entry.name));
    expect(first?.durationMs).toBeCloseTo(14, 0);
  });

  it('a genuinely empty <testsuites/> is ok with zero tests, never a tool-error', () => {
    const result = parseJunitXml('<testsuites/>');
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('text with no real "testsuites" root at all is a real, diagnosable tool-error', () => {
    expect(parseJunitXml('not xml at all').ok).toBe(false);
    expect(parseJunitXml('<?xml version="1.0"?><somethingElse/>').ok).toBe(false);
    expect(parseJunitXml('').ok).toBe(false);
  });

  it('never throws on malformed input', () => {
    expect(() => parseJunitXml('<testsuites><testsuite><testcase')).not.toThrow();
    expect(() => parseJunitXml('{}')).not.toThrow();
  });

  it('a testcase with no real @_name at all is dropped, never fabricated as an empty-named entry', () => {
    const xml = '<testsuites><testsuite><testcase time="0.1"/></testsuite></testsuites>';
    const result = parseJunitXml(xml);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('a non-numeric @_time is honestly absent, never a guessed zero', () => {
    const xml =
      '<testsuites><testsuite><testcase name="t1" time="not-a-number"/></testsuite></testsuites>';
    const result = parseJunitXml(xml);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 't1', status: 'pass' }]);
  });

  it('a pass, a failure, and a skip each with no @_time at all omit durationMs (not every dialect sets it)', () => {
    const xml =
      '<testsuites><testsuite>' +
      '<testcase name="p1"/>' +
      '<testcase name="f1"><failure>boom</failure></testcase>' +
      '<testcase name="s1"><skipped/></testcase>' +
      '</testsuite></testsuites>';
    const result = parseJunitXml(xml);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([
      { name: 'p1', status: 'pass' },
      // `<failure>boom</failure>` (no attributes at all) parses to the bare string "boom" -- read as
      // `message` too (Q346, round 3), confirmed directly against fast-xml-parser's own real shape.
      { name: 'f1', status: 'fail', kind: 'assertion', message: 'boom' },
      // `<skipped/>` (self-closing, no attributes, no text) parses to `''`, which `detailOfJunitElement`
      // reads as honestly absent, not an empty message -- `s1` carries no `message` field at all.
      { name: 's1', status: 'skip' },
    ]);
  });

  it('a crash (<error>) testcase WITH a real @_time carries durationMs too', () => {
    const xml =
      '<testsuites><testsuite><testcase name="e1" time="0.5"><error message="boom">trace</error></testcase></testsuite></testsuites>';
    const result = parseJunitXml(xml);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([
      { name: 'e1', status: 'fail', kind: 'crash', durationMs: 500, message: 'trace' },
    ]);
  });

  describe('message (specs/22 M17 P21) (Q346, round 3): read from <failure>/<error>/<skipped>', () => {
    it('prefers the real text content over the "message" attribute, when both are present -- pytest\'s own collection-failure convention (reporter.ts\'s pre-existing detailOfJunitError), confirmed to apply here too', () => {
      const xml =
        '<testsuites><testsuite><testcase name="f1">' +
        '<failure message="short summary">the real, fuller traceback text</failure>' +
        '</testcase></testsuite></testsuites>';
      const result = parseJunitXml(xml);
      if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
      expect(result.tests[0]?.message).toBe('the real, fuller traceback text');
    });

    it('falls back to the "message" attribute when there is no real text content at all', () => {
      const xml =
        '<testsuites><testsuite><testcase name="f1">' +
        '<failure message="assert 1 == 2"></failure>' +
        '</testcase></testsuite></testsuites>';
      const result = parseJunitXml(xml);
      if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
      expect(result.tests[0]?.message).toBe('assert 1 == 2');
    });

    it('a real skip reason (pytest\'s own <skipped message="...">...) IS captured -- message is valid on skip, not only fail (09 §9.5, Q346)', () => {
      const result = parseJunitXml(PYTEST_XML);
      if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
      const skip = result.tests.find((entry) => entry.status === 'skip');
      // The real fixture's own text content ("test_sample.py:12: demo") wins over the "demo"
      // attribute, the identical text-preferred-over-attribute rule as the fail/crash cases above.
      expect(skip?.message).toBe('test_sample.py:12: demo');
    });

    it("a bare <skipped/> (no attributes, no text -- jest-junit, this monorepo's own vitest) carries no message at all, never a fabricated empty string", () => {
      for (const xml of [VITEST_JUNIT_XML, JEST_JUNIT_XML]) {
        const result = parseJunitXml(xml);
        if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
        const skip = result.tests.find((entry) => entry.status === 'skip');
        expect(skip, xml.slice(0, 40)).toBeDefined();
        expect(skip?.message).toBeUndefined();
      }
    });

    it('node --test-reporter=junit\'s own real skip is NOT bare: <skipped type="skipped" message="true"/> carries the literal, not-very-useful string "true" -- transcribed honestly, not filtered out', () => {
      const result = parseJunitXml(NODE_TEST_XML);
      if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
      const skip = result.tests.find((entry) => entry.status === 'skip');
      expect(skip?.message).toBe('true');
    });

    it('a real pass carries no message at all -- there is no <failure>/<error>/<skipped> element to read one from', () => {
      const result = parseJunitXml(PYTEST_XML);
      if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
      const pass = result.tests.find((entry) => /AC.?014.?2/.test(entry.name));
      expect(pass?.message).toBeUndefined();
    });
  });

  it('describeCause: a non-Error thrown value (forced: XMLParser.parse mocked for this one call) still produces a real message, never a crash', () => {
    // Deliberately forcing the non-Error branch of this file's own describeCause, which
    // fast-xml-parser itself never actually throws in practice -- the only way to prove that
    // defensive branch is sound.
    const spy = vi.spyOn(XMLParser.prototype, 'parse').mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'a non-Error throw';
    });
    try {
      const result = parseJunitXml('<testsuites/>');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('a non-Error throw');
    } finally {
      spy.mockRestore();
    }
  });
});
