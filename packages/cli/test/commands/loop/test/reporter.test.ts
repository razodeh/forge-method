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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
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
});
