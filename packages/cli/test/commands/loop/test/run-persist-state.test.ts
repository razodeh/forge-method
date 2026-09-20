/**
 * `TestRunContext.persistState` (`PLAN-M13.md` P22, Q213): a caller that runs one layer for its own purpose
 * (`forge story verify`) must be able to run the tests without `testRun` replacing the project-wide
 * `test-results.json` or rewriting `flaky.json`. `forge test run` (the default, `persistState` absent) must keep
 * writing both, or nothing else in the gate chain would see a result.
 *
 * @see specs/13 §13.1 F-TEST-6, F-TEST-7
 * @see PLAN-M13.md P22
 */
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { testRun } from '../../../../src/commands/loop/test/run.ts';

const require = createRequire(import.meta.url);
const vitestPackage = require.resolve('vitest/package.json');
const vitestBin = (require(vitestPackage) as { bin: Record<string, string> }).bin['vitest'];
if (vitestBin === undefined) throw new Error('vitest has no bin entry');
const VITEST_CMD = `${process.execPath} ${path.join(path.dirname(vitestPackage), vitestBin)} run --root .`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-testrun-persist-'));
  dirs.push(dir);
  await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
  await writeFile(
    path.join(dir, 'sample.test.js'),
    `import { test, expect } from 'vitest'; test('AC-001-1 adds', () => { expect(1).toBe(1); });`,
    'utf8',
  );
  return dir;
}

const noTempPath = (): string => {
  throw new Error('createTempPath should not be called on this branch');
};

const exists = (file: string): Promise<boolean> =>
  stat(file).then(
    () => true,
    () => false,
  );

describe('testRun persistState', () => {
  it('by default writes test-results.json and flaky.json (forge test run is unchanged)', async () => {
    const dir = await project();
    const result = await testRun(
      { paths: new ProjectPaths(dir), projectRoot: dir, testCommands: { unit: VITEST_CMD } },
      {},
      noTempPath,
    );
    expect(result.failed).toBe(0);
    expect(await exists(path.join(dir, 'docs/forge/reports/test-results.json'))).toBe(true);
    expect(await exists(path.join(dir, 'docs/forge/reports/flaky.json'))).toBe(true);
  }, 120_000);

  it('with persistState false it reports the same result and creates neither file', async () => {
    const dir = await project();
    const result = await testRun(
      {
        paths: new ProjectPaths(dir),
        projectRoot: dir,
        testCommands: { unit: VITEST_CMD },
        persistState: false,
      },
      {},
      noTempPath,
    );
    expect(result.failed).toBe(0);
    expect(result.outcomes?.map((outcome) => outcome.status)).toEqual(['pass']);
    expect(await exists(path.join(dir, 'docs/forge/reports/test-results.json'))).toBe(false);
    expect(await exists(path.join(dir, 'docs/forge/reports/flaky.json'))).toBe(false);
  }, 120_000);

  it('with persistState false an existing flaky.json (a quarantined record) and test-results.json are left byte-identical', async () => {
    const dir = await project();
    const reports = path.join(dir, 'docs/forge/reports');
    await mkdir(reports, { recursive: true });
    // A valid record for a test this run will NOT see: a normal run would prune it, `persistState: false` must not.
    const flaky = JSON.stringify({
      v: 1,
      tests: { 'gone.test.js::elsewhere': { outcomes: ['pass', 'fail'], quarantined: true } },
    });
    await writeFile(path.join(reports, 'flaky.json'), flaky, 'utf8');
    await writeFile(path.join(reports, 'test-results.json'), '{"outcomes":[]}', 'utf8');
    await testRun(
      {
        paths: new ProjectPaths(dir),
        projectRoot: dir,
        testCommands: { unit: VITEST_CMD },
        persistState: false,
      },
      {},
      noTempPath,
    );
    expect(await readFile(path.join(reports, 'flaky.json'), 'utf8')).toBe(flaky);
    expect(await readFile(path.join(reports, 'test-results.json'), 'utf8')).toBe('{"outcomes":[]}');
  }, 120_000);

  it('control: the same seeded state IS rewritten when persistState is absent (so the previous case proves something)', async () => {
    const dir = await project();
    const reports = path.join(dir, 'docs/forge/reports');
    await mkdir(reports, { recursive: true });
    const flaky = JSON.stringify({
      v: 1,
      tests: { 'gone.test.js::elsewhere': { outcomes: ['pass', 'fail'], quarantined: true } },
    });
    await writeFile(path.join(reports, 'flaky.json'), flaky, 'utf8');
    await writeFile(path.join(reports, 'test-results.json'), '{"outcomes":[]}', 'utf8');
    await testRun(
      { paths: new ProjectPaths(dir), projectRoot: dir, testCommands: { unit: VITEST_CMD } },
      {},
      noTempPath,
    );
    expect(await readFile(path.join(reports, 'flaky.json'), 'utf8')).not.toBe(flaky);
    expect(await readFile(path.join(reports, 'test-results.json'), 'utf8')).not.toBe(
      '{"outcomes":[]}',
    );
  }, 120_000);
});
