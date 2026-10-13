/**
 * `parseGoTestJson` — the built-in `go-test-json` format (`13` F-TEST-7 point 2, `18` §18.3):
 * `go test -json`'s own NDJSON event stream, produced by Go's stable, standard-library
 * `cmd/test2json` ({"Time","Action","Package","Test"?,"Output"?,"Elapsed"?}, one JSON object per
 * line).
 *
 * DISCLOSED: this environment has no Go toolchain (confirmed: no `go` binary found anywhere on
 * `PATH` or in a standard install location), so — unlike every other built-in parser in this
 * directory, each grounded in a real tool run captured during this piece's own build — the fixtures
 * below are hand-constructed from `cmd/test2json`'s own long-stable, extensively documented event
 * schema, not captured from a real `go test -json` invocation. The schema itself has not changed in
 * years and is one of the most widely depended-on structured test-output formats in the ecosystem
 * (`gotestsum` and most Go CI tooling read it directly), so this is a documented, not a guessed,
 * shape — but it is still the one parser in this piece without a real-run fixture, and is named as
 * such in this piece's own report.
 *
 * @see specs/09 §9.5
 * @see specs/13 F-TEST-7 point 2
 * @see specs/22 M17 P3
 */
import { describe, expect, it } from 'vitest';

import { parseGoTestJson } from '../../../../../src/commands/loop/test/parsers/go-test-json.ts';

function line(event: Record<string, unknown>): string {
  return JSON.stringify({ Time: '2026-10-12T00:00:00Z', ...event });
}

const BASE_STREAM = [
  line({ Action: 'run', Package: 'example.com/mod/pkg', Test: 'TestPass' }),
  line({
    Action: 'output',
    Package: 'example.com/mod/pkg',
    Test: 'TestPass',
    Output: '=== RUN   TestPass\n',
  }),
  line({ Action: 'pass', Package: 'example.com/mod/pkg', Test: 'TestPass', Elapsed: 0.01 }),
  line({ Action: 'run', Package: 'example.com/mod/pkg', Test: 'TestFail' }),
  line({
    Action: 'output',
    Package: 'example.com/mod/pkg',
    Test: 'TestFail',
    Output: '--- FAIL: TestFail\n',
  }),
  line({ Action: 'fail', Package: 'example.com/mod/pkg', Test: 'TestFail', Elapsed: 0.02 }),
  line({ Action: 'run', Package: 'example.com/mod/pkg', Test: 'TestSkip' }),
  line({ Action: 'skip', Package: 'example.com/mod/pkg', Test: 'TestSkip', Elapsed: 0 }),
  line({ Action: 'fail', Package: 'example.com/mod/pkg', Elapsed: 0.05 }),
].join('\n');

describe('parseGoTestJson (specs/22 M17 P3) (disclosed: hand-constructed from the documented test2json schema, no Go toolchain in this environment)', () => {
  it('a real pass, fail and skip are each read correctly', () => {
    const result = parseGoTestJson(BASE_STREAM);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    const byName = new Map(result.tests.map((entry) => [entry.name, entry]));
    expect(byName.get('TestPass')?.status).toBe('pass');
    expect(byName.get('TestFail')).toMatchObject({ status: 'fail', kind: 'assertion' });
    expect(byName.get('TestSkip')?.status).toBe('skip');
  });

  it('never attributes a file: "Package" is an import path, not a file (13 F-TEST-7 point 5)', () => {
    const result = parseGoTestJson(BASE_STREAM);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    for (const entry of result.tests) expect(entry.file).toBeUndefined();
  });

  it('Elapsed (seconds) is converted to durationMs', () => {
    const result = parseGoTestJson(BASE_STREAM);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests.find((entry) => entry.name === 'TestPass')?.durationMs).toBeCloseTo(10, 0);
  });

  it('ignores package-level events (no "Test" field) when at least one real per-test event exists', () => {
    const result = parseGoTestJson(BASE_STREAM);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(3);
  });

  it('a package-level fail with zero per-test events (a build failure) is one synthetic load failure', () => {
    const stream = [
      line({
        Action: 'output',
        Package: 'example.com/mod/broken',
        Output: '# example.com/mod/broken\n',
      }),
      line({
        Action: 'output',
        Package: 'example.com/mod/broken',
        Output: 'broken.go:3: undefined: foo\n',
      }),
      line({ Action: 'fail', Package: 'example.com/mod/broken', Elapsed: 0 }),
    ].join('\n');
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]).toMatchObject({ status: 'fail', kind: 'load' });
    expect(result.tests[0]?.name).toContain('example.com/mod/broken');
  });

  it('a package-level pass with zero per-test events (an empty package) reports zero tests, not a fake pass', () => {
    const stream = line({ Action: 'pass', Package: 'example.com/mod/empty', Elapsed: 0 });
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('ignores run/pause/cont/bench/start/output actions -- only pass/fail/skip become entries', () => {
    const stream = [
      line({ Action: 'run', Package: 'p', Test: 'T' }),
      line({ Action: 'pause', Package: 'p', Test: 'T' }),
      line({ Action: 'cont', Package: 'p', Test: 'T' }),
      line({ Action: 'output', Package: 'p', Test: 'T', Output: 'noise\n' }),
      line({ Action: 'pass', Package: 'p', Test: 'T', Elapsed: 0.001 }),
    ].join('\n');
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(1);
  });

  it('a subtest name (Test: "TestFoo/bar") is reported as-is, with no special splitting', () => {
    const stream = line({ Action: 'fail', Package: 'p', Test: 'TestFoo/bar', Elapsed: 0 });
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests[0]?.name).toBe('TestFoo/bar');
  });

  it('a genuinely empty stream is ok with zero tests, never a tool-error', () => {
    const result = parseGoTestJson('');
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('a line that is not valid JSON is skipped, never a whole-stream tool-error (go test -json is NDJSON: one bad line should not void the rest)', () => {
    const stream = [
      'not json at all',
      line({ Action: 'pass', Package: 'p', Test: 'T', Elapsed: 0 }),
    ].join('\n');
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toHaveLength(1);
  });

  it('never throws on malformed input', () => {
    expect(() => parseGoTestJson('{{{')).not.toThrow();
    expect(() => parseGoTestJson('null\nundefined\n')).not.toThrow();
  });

  it('a non-finite Elapsed (e.g. a string) is honestly absent, never a guessed zero', () => {
    const stream = line({ Action: 'pass', Package: 'p', Test: 'T', Elapsed: 'not-a-number' });
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'T', status: 'pass' }]);
  });

  it('a terminal-shaped event with no real Action at all is ignored, never guessed as a status', () => {
    const stream = line({ Package: 'p', Test: 'T' });
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('a per-test event with no real Package at all still reports the test', () => {
    const stream = line({ Action: 'pass', Test: 'T', Elapsed: 0.01 });
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([{ name: 'T', status: 'pass', durationMs: 10 }]);
  });

  it('a terminal event with neither Test nor Package at all is ignored', () => {
    const stream = line({ Action: 'pass' });
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([]);
  });

  it('a fail, a skip and a pass each with no Elapsed at all omit durationMs', () => {
    const stream = [
      line({ Action: 'fail', Package: 'p', Test: 'TestFail' }),
      line({ Action: 'skip', Package: 'p', Test: 'TestSkip' }),
      line({ Action: 'pass', Package: 'p', Test: 'TestPass' }),
    ].join('\n');
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([
      { name: 'TestFail', status: 'fail', kind: 'assertion' },
      { name: 'TestSkip', status: 'skip' },
      { name: 'TestPass', status: 'pass' },
    ]);
  });

  it('a package-level build failure with no Elapsed at all omits durationMs from the synthetic entry', () => {
    const stream = line({ Action: 'fail', Package: 'example.com/mod/broken' });
    const result = parseGoTestJson(stream);
    if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
    expect(result.tests).toEqual([
      {
        name: 'example.com/mod/broken (package failed to build or run)',
        status: 'fail',
        kind: 'load',
      },
    ]);
  });
});
