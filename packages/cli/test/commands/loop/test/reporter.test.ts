/**
 * `runAndNormalize` — `PLAN-M8.md` P3's own Checks section. Real subprocess fixtures throughout:
 * a real vitest invocation (this monorepo's own already-installed binary, pointed at a real, throwaway
 * fixture directory via `--root`) and a real pytest invocation (this environment's own installed
 * `pytest`, confirmed present during this piece's own build) — never a mocked test-tool output.
 *
 * @see specs/09 §9.5
 * @see PLAN-M8.md P3
 */
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TEST_RUN_TIMEOUT_MS,
  readNormalizedReport,
  runAndNormalize,
  writeNormalizedReport,
} from '../../../../src/commands/loop/test/reporter.ts';

/** Node's own module resolution, not a hand-counted `../../../../../../` relative URL — the
 * original draft's own fixed-depth coupling would silently repoint at a nonexistent or unrelated
 * path the moment this test file moved one directory shallower or deeper, a fresh critic round
 * pointed out. `vitest`'s own real `package.json.bin.vitest` names the real entry point relative to
 * its own package directory, resolved the same way Node itself would. */
function resolveRealVitestEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('vitest/package.json');
  const packageJson = require(packageJsonPath) as {
    readonly bin?: Readonly<Record<string, string>>;
  };
  const binRelative = packageJson.bin?.['vitest'];
  if (binRelative === undefined)
    throw new Error('vitest/package.json has no real "vitest" bin entry.');
  return path.join(path.dirname(packageJsonPath), binRelative);
}

const REAL_VITEST_ENTRY = resolveRealVitestEntry();

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-reporter-'));
  dirs.push(dir);
  return dir;
}

const UNUSED_TEMP_PATH = (): string => {
  throw new Error('createTempPath should not be called on this branch');
};

describe('runAndNormalize — missing command', () => {
  it('reports outcome "missing-command" for an undefined command, never throwing', async () => {
    const result = await runAndNormalize(undefined, await tempDir(), 'js', UNUSED_TEMP_PATH);
    expect(result.outcome).toBe('missing-command');
  });
});

describe('runAndNormalize — js (real vitest)', () => {
  it('binds a real AC-prefixed test name, reports a real failure as fail, and skips as skip', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `
import { test, expect } from 'vitest';
test('AC-014-2 returns 422 for an empty invoice', () => { expect(1 + 1).toBe(2); });
test('AC-014-3 fails on purpose', () => { expect(1).toBe(2); });
test('a plain test with no AC prefix', () => { expect(true).toBe(true); });
test.skip('a skipped test', () => { expect(true).toBe(true); });
`,
      'utf8',
    );

    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const byName = new Map(result.report.outcomes.map((outcome) => [outcome.name, outcome]));
    expect(byName.get('AC-014-2 returns 422 for an empty invoice')).toMatchObject({
      acId: 'AC-014-2',
      status: 'pass',
    });
    expect(byName.get('AC-014-3 fails on purpose')).toMatchObject({
      acId: 'AC-014-3',
      status: 'fail',
    });
    expect(byName.get('a plain test with no AC prefix')).toMatchObject({
      acId: undefined,
      status: 'pass',
    });
    expect(byName.get('a skipped test')?.status).toBe('skip');
  });

  it('reports a test file that fails to load as a real failure, not a silent absence', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'broken.test.js'),
      `
import { test } from 'vitest';
import 'this-module-does-not-exist';
test('AC-200-1 never actually runs', () => {});
`,
      'utf8',
    );

    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]?.status).toBe('fail');
  });

  it('reports a test that never ran because a beforeAll hook threw as a real failure, not skip', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'hook.test.js'),
      `
import { test, expect, beforeAll } from 'vitest';
beforeAll(() => { throw new Error('setup exploded'); });
test('AC-201-1 never actually runs', () => { expect(true).toBe(true); });
`,
      'utf8',
    );

    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const outcome = result.report.outcomes.find((candidate) => candidate.acId === 'AC-201-1');
    expect(outcome?.status).toBe('fail');
  });

  it('does not reclassify a real, deliberate skip sitting next to an unrelated failure in the same file', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'mixed.test.js'),
      `
import { test, expect } from 'vitest';
test.skip('AC-202-1 deliberately skipped', () => { expect(true).toBe(true); });
test('AC-202-2 genuinely fails', () => { expect(1).toBe(2); });
`,
      'utf8',
    );

    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const byAcId = new Map(result.report.outcomes.map((outcome) => [outcome.acId, outcome]));
    expect(byAcId.get('AC-202-1')?.status).toBe('skip');
    expect(byAcId.get('AC-202-2')?.status).toBe('fail');
  });

  it("reports a typo'd command as a real tool-error, not a thrown exception", async () => {
    const result = await runAndNormalize(
      'this-command-does-not-exist-at-all',
      await tempDir(),
      'js',
      UNUSED_TEMP_PATH,
    );
    expect(result.outcome).toBe('tool-error');
  });

  it('reports a real tool-error for a chained command, rather than misrouting --reporter=json', async () => {
    // A fresh critic round (P4) reproduced this directly: blindly appending a flag onto a chained
    // shell command silently misroutes it.
    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root . && echo done`,
      await tempDir(),
      'js',
      UNUSED_TEMP_PATH,
    );
    expect(result.outcome).toBe('tool-error');
  });

  it('testNameFilter + fileFilter (P7 retry-in-isolation) selects only the one real test in the one real file, even when a different file has a same-named test', async () => {
    // A fresh critic round (M8 P7) reproduced this directly: a name-only filter (no `fileFilter`)
    // would match a same-named test in *either* file, silently retrying the wrong one.
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'a.test.js'),
      `import { test, expect } from 'vitest'; test('dup name', () => { expect(1).toBe(2); });`,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'b.test.js'),
      `import { test, expect } from 'vitest'; test('dup name', () => { expect(1).toBe(1); });`,
      'utf8',
    );

    // A real vitest invocation always reports a realpath-resolved absolute file path (confirmed
    // directly) — `realpath(dir)` here mirrors that, since `mkdtemp`'s own real temp directories can
    // themselves sit behind a symlink (macOS's `/tmp` -> `/private/tmp`).
    const realFile = path.join(await realpath(dir), 'a.test.js');
    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
      'dup name',
      realFile,
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]?.status).toBe('fail');
  });

  it('falls back to an unqualified name when a file-result JSON shape names no real file at all (a failed-to-load file)', async () => {
    // `VitestFileResult.name` is `unknown`, not `string` — a real, if never-observed-from-real-vitest,
    // JSON shape this function's own type signature already admits. Proven here against a real
    // subprocess (a small, throwaway script file, not `-e`: `runVitest` always appends
    // ` --reporter=json`, and a real script *file*'s own trailing argv tolerates that harmlessly,
    // unlike `node -e`'s own stricter CLI parser, confirmed directly) that emits this exact shape —
    // not a claim about what real vitest itself ever produces.
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'fake-vitest.mjs'),
      `console.log(JSON.stringify({ testResults: [ { assertionResults: [], status: 'failed', message: 'crashed before naming its own file' } ] }));`,
      'utf8',
    );

    const result = await runAndNormalize(
      `${process.execPath} ${path.join(dir, 'fake-vitest.mjs')}`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]?.status).toBe('fail');
    expect(result.report.outcomes[0]?.file).toBeUndefined();
    expect(result.report.outcomes[0]?.name).toContain('(unknown file)');
  });

  it('falls back to an unqualified name when a per-assertion file-result JSON shape names no real file at all', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'fake-vitest.mjs'),
      `console.log(JSON.stringify({ testResults: [ { assertionResults: [ { title: 'a test with no file name', status: 'passed' } ], status: 'passed', message: '' } ] }));`,
      'utf8',
    );

    const result = await runAndNormalize(
      `${process.execPath} ${path.join(dir, 'fake-vitest.mjs')}`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toEqual([
      { name: 'a test with no file name', acId: undefined, status: 'pass' },
    ]);
  });

  it('`files` (PLAN-M14.md P26) scopes a real run to exactly the given files, positionally — a file left out never runs', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'a.test.js'),
      `import { test, expect } from 'vitest'; test('AC-400-1 in scope', () => { expect(1).toBe(1); });`,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'b.test.js'),
      // Would fail if it ran — proves `files` really narrows the run rather than running the whole
      // layer anyway ("files dropped" would turn this green).
      `import { test, expect } from 'vitest'; test('AC-400-2 out of scope', () => { expect(1).toBe(2); });`,
      'utf8',
    );

    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
      undefined,
      undefined,
      ['a.test.js'],
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]).toMatchObject({ acId: 'AC-400-1', status: 'pass' });
  });
});

describe('runAndNormalize — python (real pytest)', () => {
  it('binds a real Python-safe underscore AC name and reports pass/fail/skip correctly', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'test_sample.py'),
      `
import pytest

def test_AC_014_2_returns_422_for_empty_invoice():
    assert 1 + 1 == 2

def test_AC_014_3_fails_on_purpose():
    assert 1 == 2

def test_a_plain_test_with_no_ac_prefix():
    assert True

@pytest.mark.skip(reason="demo")
def test_a_skipped_test():
    assert True
`,
      'utf8',
    );

    const result = await runAndNormalize('pytest -q', dir, 'python', () => path.join(dir, 'junit'));

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const byName = new Map(result.report.outcomes.map((outcome) => [outcome.name, outcome]));
    expect(byName.get('test_AC_014_2_returns_422_for_empty_invoice')).toMatchObject({
      acId: 'AC-014-2',
      status: 'pass',
    });
    expect(byName.get('test_AC_014_3_fails_on_purpose')).toMatchObject({
      acId: 'AC-014-3',
      status: 'fail',
    });
    expect(byName.get('test_a_plain_test_with_no_ac_prefix')).toMatchObject({
      acId: undefined,
      status: 'pass',
    });
    expect(byName.get('test_a_skipped_test')?.status).toBe('skip');
  });

  it('reports a real setup/fixture error as fail, not pass — pytest emits <error>, not <failure>', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'test_error.py'),
      `
def test_AC_300_1_uses_missing_fixture(nonexistent_fixture):
    assert True
`,
      'utf8',
    );

    const result = await runAndNormalize('pytest -q', dir, 'python', () => path.join(dir, 'junit'));

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const outcome = result.report.outcomes.find((candidate) => candidate.acId === 'AC-300-1');
    expect(outcome?.status).toBe('fail');
  });

  it("reports a typo'd pytest command as a real tool-error, not a thrown exception", async () => {
    const dir = await tempDir();
    const result = await runAndNormalize('this-command-does-not-exist-at-all', dir, 'python', () =>
      path.join(dir, 'junit'),
    );
    expect(result.outcome).toBe('tool-error');
  });

  it('still runs correctly when the injected temp path contains a space', async () => {
    // `os.tmpdir()` commonly contains a space on a real per-user macOS/Windows temp root — a fresh
    // critic round found the junit-xml path was being interpolated into the shell command unquoted.
    const dir = await tempDir();
    const spacedDir = path.join(dir, 'a dir with spaces');
    await mkdir(spacedDir, { recursive: true });
    await writeFile(
      path.join(dir, 'test_spaced.py'),
      `
def test_AC_301_1_passes():
    assert True
`,
      'utf8',
    );

    const result = await runAndNormalize('pytest -q', dir, 'python', () =>
      path.join(spacedDir, 'junit with spaces'),
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes.find((o) => o.acId === 'AC-301-1')?.status).toBe('pass');
  });

  it('reports a real tool-error for a chained pytest command, rather than misrouting --junitxml', async () => {
    const dir = await tempDir();
    const result = await runAndNormalize('pytest -q && echo done', dir, 'python', () =>
      path.join(dir, 'junit'),
    );
    expect(result.outcome).toBe('tool-error');
  });

  it('testNameFilter + fileFilter (P7 retry-in-isolation) addresses a real, exact pytest node id — even a same-named test in a DIFFERENT file', async () => {
    // A fresh critic round (M8 P7) reproduced this directly against the first draft's own `-k <name>`
    // substring match: it selected every test whose name merely *contained* the given name, including
    // a same-named test in a different file entirely.
    const dir = await tempDir();
    await writeFile(path.join(dir, 'test_a.py'), `def test_dup():\n    assert 1 == 0\n`, 'utf8');
    await writeFile(path.join(dir, 'test_b.py'), `def test_dup():\n    assert 1 == 1\n`, 'utf8');

    const result = await runAndNormalize(
      'pytest -q',
      dir,
      'python',
      () => path.join(dir, 'junit'),
      'test_dup',
      'test_a',
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]?.status).toBe('fail');
  });

  it('testNameFilter + fileFilter correctly addresses a real, parametrized test id containing brackets and a space — the exact shape that broke the old -k expression parser', async () => {
    // A fresh critic round (M8 P7) reproduced this directly: `-k "test_param[a b]"` is a real pytest
    // parse error (a space inside `[...]` is not valid `-k` expression syntax) — pytest still exits
    // with a *valid*, empty junit-xml in that failure case, which the first draft silently read as
    // "ran, found nothing to retry" rather than a real problem.
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'test_param.py'),
      `
import pytest

@pytest.mark.parametrize("x", ["a b"])
def test_param(x):
    assert x == "a b"
`,
      'utf8',
    );

    const result = await runAndNormalize(
      'pytest -q',
      dir,
      'python',
      () => path.join(dir, 'junit'),
      'test_param[a b]',
      'test_param',
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]?.status).toBe('pass');
  });

  it('`files` (PLAN-M14.md P26) addresses real files positionally, with no testNameFilter, quoting a path that contains a space', async () => {
    const dir = await tempDir();
    const spacedDir = path.join(dir, 'a dir with spaces');
    await mkdir(spacedDir, { recursive: true });
    await writeFile(
      path.join(spacedDir, 'test_in_scope.py'),
      `def test_AC_401_1_passes():\n    assert True\n`,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'test_out_of_scope.py'),
      // Would fail if it ran — proves the positional form really narrows the run.
      `def test_AC_401_2_would_fail():\n    assert False\n`,
      'utf8',
    );

    const result = await runAndNormalize(
      'pytest -q',
      dir,
      'python',
      () => path.join(dir, 'junit'),
      undefined,
      undefined,
      ['a dir with spaces/test_in_scope.py'],
    );

    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]).toMatchObject({ acId: 'AC-401-1', status: 'pass' });
  });
});

describe('writeNormalizedReport / readNormalizedReport', () => {
  it('round-trips: written then re-read produces the identical report', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    const report = {
      outcomes: [
        { name: 'AC-014-2 returns 422', acId: 'AC-014-2', status: 'pass' as const },
        { name: 'a plain test', acId: undefined, status: 'fail' as const },
      ],
    };

    await writeNormalizedReport(paths, report);
    const readBack = await readNormalizedReport(paths);

    expect(readBack).toEqual(report);
  });

  it('rejects a real, malformed test-results.json with a typed RUN-058, not an untyped exception', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/reports/test-results.json'),
      '{"v": 1, "outcomes": [{"name": "x", "status": "not-a-real-status"}]}',
      'utf8',
    );

    await expect(readNormalizedReport(paths)).rejects.toMatchObject({ code: 'RUN-058' });
  });

  it('rejects genuinely corrupt (non-JSON) content with the same typed RUN-058', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/reports/test-results.json'),
      'not real json at all {{{',
      'utf8',
    );

    await expect(readNormalizedReport(paths)).rejects.toMatchObject({ code: 'RUN-058' });
  });

  it("round-trips a 'fail' outcome's own kind (specs/22 M16 P10) — additive, so an old report with no kind at all still reads back fine", async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    const report = {
      outcomes: [
        {
          name: 'AC-500-1 has a kind',
          acId: 'AC-500-1',
          status: 'fail' as const,
          kind: 'load' as const,
        },
        { name: 'a plain pre-P10-shaped fail', acId: undefined, status: 'fail' as const },
      ],
    };

    await writeNormalizedReport(paths, report);
    const readBack = await readNormalizedReport(paths);

    expect(readBack).toEqual(report);
  });

  it('rejects a kind value outside the real, closed enum with the same typed RUN-058', async () => {
    const dir = await tempDir();
    const paths = new ProjectPaths(dir);
    await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/reports/test-results.json'),
      '{"v": 1, "outcomes": [{"name": "x", "status": "fail", "kind": "not-a-real-kind"}]}',
      'utf8',
    );

    await expect(readNormalizedReport(paths)).rejects.toMatchObject({ code: 'RUN-058' });
  });
});

// --- specs/22 M16 P10: failure-kind classification, per-run timeouts, the load-failure asymmetry ---

const PYTEST_COMMAND = 'pytest -q';

/** Polls for `filePath` to exist, for up to `timeoutMs` — distinct from, and generous relative to,
 * the SHORT kill timeout a hang test passes to `runAndNormalize` itself: this proves the worker
 * genuinely started (wrote its own marker) BEFORE the kill fires, so a pass here is never merely "the
 * process never got the chance to start." */
async function waitForFile(filePath: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`${filePath} did not appear within ${String(timeoutMs)}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

/** Whether a process is still alive, by the standard `kill -0` probe (sends no real signal) — the OS
 * itself is the oracle here, not a trust in whether `runAndNormalize` merely claims to have killed
 * something. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('TestOutcome.kind — the classification table (specs/22 M16 P10, 13 F-TEST-10)', () => {
  it('vitest: an ordinary assertion failure (the test ran and lost) is kind "assertion"', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'assert.test.js'),
      "import { test, expect } from 'vitest';\ntest('AC-500-1 fails on purpose', () => { expect(1).toBe(2); });\n",
      'utf8',
    );
    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]).toMatchObject({ status: 'fail', kind: 'assertion' });
  });

  it('vitest: a whole-file load failure (an unresolved import) is kind "load"', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'broken.test.js'),
      "import { test } from 'vitest';\nimport 'this-module-does-not-exist-p10';\ntest('AC-500-2 never runs', () => {});\n",
      'utf8',
    );
    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]).toMatchObject({ status: 'fail', kind: 'load' });
  });

  it('vitest: a beforeAll hook exception is kind "crash" — not "load" (the file loaded fine) and not "assertion" (the test body never ran)', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'hook.test.js'),
      "import { test, expect, beforeAll } from 'vitest';\nbeforeAll(() => { throw new Error('setup exploded'); });\ntest('AC-500-3 never actually runs', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    const result = await runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const outcome = result.report.outcomes.find((candidate) => candidate.acId === 'AC-500-3');
    expect(outcome).toMatchObject({ status: 'fail', kind: 'crash' });
  });

  it('pytest: an ordinary assertion failure (the test ran and lost) is kind "assertion"', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'test_assert.py'),
      'def test_AC_501_1_fails():\n    assert 1 == 2\n',
      'utf8',
    );
    const result = await runAndNormalize(PYTEST_COMMAND, dir, 'python', () =>
      path.join(dir, 'junit'),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]).toMatchObject({ status: 'fail', kind: 'assertion' });
  });

  it('pytest: a per-test setup/fixture error on a real, named, COLLECTED test is kind "crash" — distinct from a whole-module collection failure', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'test_fixture_error.py'),
      'def test_AC_501_2_uses_missing_fixture(nonexistent_fixture):\n    assert True\n',
      'utf8',
    );
    const result = await runAndNormalize(PYTEST_COMMAND, dir, 'python', () =>
      path.join(dir, 'junit'),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const outcome = result.report.outcomes.find((candidate) => candidate.acId === 'AC-501-2');
    expect(outcome).toMatchObject({ status: 'fail', kind: 'crash' });
  });

  it('pytest: a whole-MODULE collection failure (a broken import) is kind "load", with `file` set to the module\'s own dotted path — the asymmetry fix itself', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'test_broken_module.py'),
      'import this_module_does_not_exist_p10\n\n\ndef test_AC_501_3_never_runs():\n    assert True\n',
      'utf8',
    );
    const result = await runAndNormalize(PYTEST_COMMAND, dir, 'python', () =>
      path.join(dir, 'junit'),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]).toMatchObject({
      status: 'fail',
      kind: 'load',
      file: 'test_broken_module',
    });
    expect(result.report.outcomes[0]?.name).toContain('file failed to load');
  });

  it('pytest: --continue-on-collection-errors lets a sibling, healthy module still run and report, rather than the whole session silently dropping it', async () => {
    // Confirmed directly, before this piece's own fix, that WITHOUT this flag pytest prints
    // "Interrupted: 1 error during collection" and refuses to collect or run ANY other file at all —
    // `test_healthy.py`'s own real, passing test would be completely ABSENT from the junit-xml, not
    // failed and not skipped, just never attempted. This is the real parity gap `binding.ts`/`run.ts`
    // need closed, since either can scope one invocation to more than one file.
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'test_broken_sibling.py'),
      'import this_module_does_not_exist_p10_sibling\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'test_healthy_sibling.py'),
      'def test_AC_501_4_passes():\n    assert True\n',
      'utf8',
    );
    const result = await runAndNormalize(PYTEST_COMMAND, dir, 'python', () =>
      path.join(dir, 'junit'),
    );
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    const healthy = result.report.outcomes.find((candidate) => candidate.acId === 'AC-501-4');
    expect(healthy).toMatchObject({ status: 'pass' });
    const broken = result.report.outcomes.find((candidate) => candidate.kind === 'load');
    expect(broken?.file).toBe('test_broken_sibling');
  });
});

describe('runAndNormalize — per-run timeout (specs/22 M16 P10)', () => {
  it('DEFAULT_TEST_RUN_TIMEOUT_MS is finite, positive, and generous (minutes, not seconds)', () => {
    expect(DEFAULT_TEST_RUN_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(DEFAULT_TEST_RUN_TIMEOUT_MS).toBeLessThanOrEqual(3_600_000);
  });

  it('a real, genuinely hung vitest run is killed within the override timeout, reports a typed "timeout" outcome, and leaves no process behind', async () => {
    const dir = await tempDir();
    const markerPath = path.join(dir, 'pid.marker');
    // A synchronous, unconditional busy loop — unlike an unresolved Promise, this blocks the whole
    // worker's own event loop (vitest's own per-test timeout relies on `setTimeout`, which this
    // starves), so only an external, process-group SIGKILL can ever end it. Writes its own real pid
    // to a marker file FIRST, synchronously, so the test can confirm (a) the worker genuinely started
    // and (b) that exact process is gone afterwards — never merely trusting that `runShellCommand`
    // claims to have killed something.
    await writeFile(
      path.join(dir, 'hang.test.js'),
      `import { test } from 'vitest';\nimport { writeFileSync } from 'node:fs';\ntest('hangs forever', () => {\n  writeFileSync(${JSON.stringify(markerPath)}, String(process.pid));\n  for (;;) { /* busy */ }\n});\n`,
      'utf8',
    );

    const started = Date.now();
    const resultPromise = runAndNormalize(
      `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
      undefined,
      undefined,
      undefined,
      3_000,
    );
    const pid = Number((await waitForFile(markerPath, 15_000)).trim());
    expect(isProcessAlive(pid)).toBe(true);

    const result = await resultPromise;
    const elapsedMs = Date.now() - started;

    // Well under what an UN-timed hang would take (it would never return at all) — proves the kill
    // actually fired near the declared 3s bound, not merely that the promise eventually settled.
    expect(elapsedMs).toBeLessThan(15_000);
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]).toMatchObject({ status: 'fail', kind: 'timeout' });
    expect(isProcessAlive(pid)).toBe(false);
  }, 30_000);

  it('a real, genuinely hung pytest run is killed within the override timeout, reports a typed "timeout" outcome, and leaves no process behind', async () => {
    const dir = await tempDir();
    const markerPath = path.join(dir, 'pid.marker');
    await writeFile(
      path.join(dir, 'test_hang.py'),
      `import os\n\n\ndef test_hangs_forever():\n    with open(${JSON.stringify(markerPath)}, "w") as f:\n        f.write(str(os.getpid()))\n    while True:\n        pass\n`,
      'utf8',
    );

    const started = Date.now();
    const resultPromise = runAndNormalize(
      PYTEST_COMMAND,
      dir,
      'python',
      () => path.join(dir, 'junit'),
      undefined,
      undefined,
      undefined,
      3_000,
    );
    const pid = Number((await waitForFile(markerPath, 15_000)).trim());
    expect(isProcessAlive(pid)).toBe(true);

    const result = await resultPromise;
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(15_000);
    if (result.outcome !== 'ran') throw new Error(`expected 'ran', got ${result.outcome}`);
    expect(result.report.outcomes).toHaveLength(1);
    expect(result.report.outcomes[0]).toMatchObject({ status: 'fail', kind: 'timeout' });
    expect(isProcessAlive(pid)).toBe(false);
  }, 30_000);
});

describe('runAndNormalize — malformed-but-parseable output is a real tool-error, never a silent "ran, found nothing" (specs/22 M16 P10)', () => {
  // A fresh critic round confirmed directly: `JSON.parse`/`fast-xml-parser` never throw on genuinely
  // wrong-shaped-but-syntactically-valid input (`{}`, an empty string, garbage text) -- before this
  // fix, each of the three cases below silently reported `outcome: 'ran'` with `outcomes: []`,
  // indistinguishable from a real run that completed and genuinely found nothing to do (which a real,
  // zero-tests-matched vitest/pytest run always reports differently -- a real, present, EMPTY
  // `testResults`/`<testsuite tests="0">`, confirmed directly, never an absent or garbage top level).

  it('vitest: a fake command that prints valid JSON with no real "testResults" array is a tool-error, not zero outcomes', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'fake-vitest.mjs'), 'console.log(JSON.stringify({}));', 'utf8');

    const result = await runAndNormalize(
      `${process.execPath} ${path.join(dir, 'fake-vitest.mjs')}`,
      dir,
      'js',
      UNUSED_TEMP_PATH,
    );

    expect(result.outcome).toBe('tool-error');
  });

  it('pytest: an empty junit-xml file is a tool-error, not zero outcomes', async () => {
    const dir = await tempDir();
    // A fake pytest stand-in: writes a real, existing, but completely empty junit-xml file at the
    // path `runPytest` passes via `--junitxml=`, then exits 0 -- the exact shape a real pytest
    // produces if it crashes mid-write just after creating the file.
    const fakePytestPath = path.join(dir, 'fake-pytest.sh');
    await writeFile(
      fakePytestPath,
      '#!/bin/sh\nfor arg in "$@"; do\n  case "$arg" in\n    --junitxml=*) touch "${arg#--junitxml=}" ;;\n  esac\ndone\nexit 0\n',
      'utf8',
    );
    await chmod(fakePytestPath, 0o755);

    const result = await runAndNormalize(fakePytestPath, dir, 'python', () =>
      path.join(dir, 'junit'),
    );

    expect(result.outcome).toBe('tool-error');
  });

  it('pytest: a junit-xml file full of garbage text is a tool-error, not zero outcomes', async () => {
    const dir = await tempDir();
    const fakePytestPath = path.join(dir, 'fake-pytest.sh');
    await writeFile(
      fakePytestPath,
      '#!/bin/sh\nfor arg in "$@"; do\n  case "$arg" in\n    --junitxml=*) echo "this is not xml at all {{{ garbage" > "${arg#--junitxml=}" ;;\n  esac\ndone\nexit 0\n',
      'utf8',
    );
    await chmod(fakePytestPath, 0o755);

    const result = await runAndNormalize(fakePytestPath, dir, 'python', () =>
      path.join(dir, 'junit'),
    );

    expect(result.outcome).toBe('tool-error');
  });
});
