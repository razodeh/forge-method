/**
 * `testRun` — `PLAN-M8.md` P4's own Checks section. Real subprocess fixtures throughout (this
 * monorepo's own installed vitest/eslint/tsc binaries, resolved via Node's own module resolution —
 * the same pattern `reporter.test.ts` already establishes).
 *
 * @see specs/13 §13.1 F-TEST-7
 * @see PLAN-M8.md P4
 */
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { testRun, type TestCommands } from '../../../../src/commands/loop/test/run.ts';

function resolveRealBinEntry(pkgName: string, binName: string): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve(`${pkgName}/package.json`);
  const packageJson = require(packageJsonPath) as {
    readonly bin?: Readonly<Record<string, string>>;
  };
  const binRelative = packageJson.bin?.[binName];
  if (binRelative === undefined)
    throw new Error(`${pkgName}/package.json has no real "${binName}" bin entry.`);
  return path.join(path.dirname(packageJsonPath), binRelative);
}

const NODE = process.execPath;
const REAL_VITEST_ENTRY = resolveRealBinEntry('vitest', 'vitest');
const REAL_ESLINT_ENTRY = resolveRealBinEntry('eslint', 'eslint');
const VITEST_CMD = `${NODE} ${REAL_VITEST_ENTRY} run --root .`;
const ESLINT_CMD = `${NODE} ${REAL_ESLINT_ENTRY} .`;
const TSC_CMD = `${NODE} ${resolveRealBinEntry('typescript', 'tsc')} -p tsconfig.json`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-testrun-'));
  dirs.push(dir);
  return dir;
}

const UNUSED_TEMP_PATH = (): string => {
  throw new Error('createTempPath should not be called on this branch');
};

function ctx(dir: string, testCommands: TestCommands) {
  return { paths: new ProjectPaths(dir), projectRoot: dir, testCommands };
}

describe('testRun — default rule (real vitest)', () => {
  it('reports failed: 1 against a real, deliberately failing unit test', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `import { test, expect } from 'vitest'; test('fails', () => { expect(1).toBe(2); });`,
      'utf8',
    );

    const result = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    expect(result.failed).toBe(1);
    expect(result.problems).toBeUndefined();
  });

  it('reports failed: 0 against a real, clean fixture', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `import { test, expect } from 'vitest'; test('passes', () => { expect(1).toBe(1); });`,
      'utf8',
    );

    const result = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    expect(result.failed).toBe(0);
    expect(result.problems).toBeUndefined();
  });

  it('aggregates failures across two declared layers', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'a.test.js'),
      `import { test, expect } from 'vitest'; test('fails a', () => { expect(1).toBe(2); });`,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'b.test.js'),
      `import { test, expect } from 'vitest'; test('fails b', () => { expect(1).toBe(2); });`,
      'utf8',
    );
    const unitCmd = `${VITEST_CMD} a.test.js`;
    const integrationCmd = `${VITEST_CMD} b.test.js`;

    const result = await testRun(
      ctx(dir, { unit: unitCmd, integration: integrationCmd }),
      {},
      UNUSED_TEMP_PATH,
    );

    expect(result.failed).toBe(2);
  });

  it('reports a real problem and forces failed >= 1 when no layer command is configured', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');

    const result = await testRun(ctx(dir, {}), {}, UNUSED_TEMP_PATH);

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.problems?.length).toBeGreaterThan(0);
  });

  it('reports a real problem when the project ecosystem cannot be determined', async () => {
    const dir = await tempDir();

    const result = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.problems?.some((p) => p.includes('ecosystem'))).toBe(true);
  });

  it('reports a real problem, not a thrown exception, when a declared command fails to run', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');

    const result = await testRun(
      ctx(dir, { unit: 'this-command-does-not-exist-at-all' }),
      {},
      UNUSED_TEMP_PATH,
    );

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.problems?.length).toBeGreaterThan(0);
  });

  it('reports a real problem, not a silent pass, when a declared command matches zero tests', async () => {
    // A fresh critic round reproduced this directly: a real vitest invocation that runs but matches
    // no test files reports `outcome: 'ran'` with an empty `outcomes` array — indistinguishable,
    // without this check, from "ran and everything passed."
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');

    const result = await testRun(
      ctx(dir, { unit: `${VITEST_CMD} no-such-file.test.js` }),
      {},
      UNUSED_TEMP_PATH,
    );

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.problems?.some((p) => p.includes('zero tests'))).toBe(true);
  });
});

describe('testRun — --rule lint (real eslint)', () => {
  it("reports errors: 1 via eslint's own real --format json output", async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'eslint.config.js'),
      `export default [{ rules: { 'no-unused-vars': 'error' } }];`,
      'utf8',
    );
    await writeFile(path.join(dir, 'bad.js'), 'const unused = 1;\n', 'utf8');

    const result = await testRun(
      ctx(dir, { lint: ESLINT_CMD }),
      { rule: 'lint' },
      UNUSED_TEMP_PATH,
    );

    expect(result.errors).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('reports a real problem, forcing errors >= 1, when no lint command is configured', async () => {
    const dir = await tempDir();

    const result = await testRun(ctx(dir, {}), { rule: 'lint' }, UNUSED_TEMP_PATH);

    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(result.problems?.length).toBeGreaterThan(0);
  });

  it('reports a real problem for a chained lint command, on a clean project, rather than a false positive', async () => {
    // A fresh critic round reproduced this directly: `"<eslint> . && echo done"` (an entirely
    // ordinary chained package.json-script pattern) misroutes `--format json` onto `echo`, and the
    // original code reported this as a false `errors: 1` even though eslint itself found nothing.
    const dir = await tempDir();
    await writeFile(path.join(dir, 'eslint.config.js'), `export default [];`, 'utf8');
    await writeFile(path.join(dir, 'clean.js'), 'export const x = 1;\n', 'utf8');

    const result = await testRun(
      ctx(dir, { lint: `${ESLINT_CMD} && echo done` }),
      { rule: 'lint' },
      UNUSED_TEMP_PATH,
    );

    expect(result.problems?.length).toBeGreaterThan(0);
  });
});

describe('testRun — --rule typecheck (real tsc)', () => {
  it('reports errors >= 1 against a real, deliberate type error', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['bad.ts'] }),
      'utf8',
    );
    await writeFile(path.join(dir, 'bad.ts'), 'const x: number = "not a number";\n', 'utf8');

    const result = await testRun(
      ctx(dir, { typecheck: TSC_CMD }),
      { rule: 'typecheck' },
      UNUSED_TEMP_PATH,
    );

    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
  });

  it('reports a real problem, forcing errors >= 1, when no typecheck command is configured', async () => {
    const dir = await tempDir();

    const result = await testRun(ctx(dir, {}), { rule: 'typecheck' }, UNUSED_TEMP_PATH);

    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(result.problems?.length).toBeGreaterThan(0);
  });

  it('counts a real, prefix-less global tsc diagnostic mixed with a real file-prefixed one', async () => {
    // A fresh critic round reproduced this directly: a broken tsconfig "extends" path alongside a
    // real type error in an included file produces both a file-prefixed diagnostic
    // (`a.ts(1,7): error TS2322: ...`) and a bare, global one with no file:line prefix at all
    // (`error TS5083: Cannot read file ...`) — the original regex only matched the first shape.
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        extends: './does-not-exist.json',
        compilerOptions: { strict: true, noEmit: true },
        include: ['bad.ts'],
      }),
      'utf8',
    );
    await writeFile(path.join(dir, 'bad.ts'), 'const x: number = "not a number";\n', 'utf8');

    const result = await testRun(
      ctx(dir, { typecheck: TSC_CMD }),
      { rule: 'typecheck' },
      UNUSED_TEMP_PATH,
    );

    expect(result.errors).toBeGreaterThanOrEqual(2);
  });

  it('reports errors: 0 against a real, clean fixture', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['good.ts'] }),
      'utf8',
    );
    await writeFile(path.join(dir, 'good.ts'), 'const x: number = 42;\n', 'utf8');

    const result = await testRun(
      ctx(dir, { typecheck: TSC_CMD }),
      { rule: 'typecheck' },
      UNUSED_TEMP_PATH,
    );

    expect(result.errors).toBe(0);
  });
});

describe('testRun — --rule oracle-lint (F-TEST-2)', () => {
  it('delegates to runOracleLint and reports a real violation as errors', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'weak.test.js'),
      `test('AC-900-1 returns a result', () => { expect(doSomething()).toBeDefined(); });`,
      'utf8',
    );

    const result = await testRun(ctx(dir, {}), { rule: 'oracle-lint' }, UNUSED_TEMP_PATH);

    expect(result.errors).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('reports errors: 0 for a clean fixture, needing no testCommands entry at all', async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'clean.test.js'),
      `test('AC-900-2 computes the real total', () => { expect(compute()).toBe(110); });`,
      'utf8',
    );

    const result = await testRun(ctx(dir, {}), { rule: 'oracle-lint' }, UNUSED_TEMP_PATH);

    expect(result.errors).toBe(0);
  });
});
