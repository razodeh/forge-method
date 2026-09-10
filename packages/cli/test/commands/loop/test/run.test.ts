/**
 * `testRun` — `PLAN-M8.md` P4's own Checks section. Real subprocess fixtures throughout (this
 * monorepo's own installed vitest/eslint/tsc binaries, resolved via Node's own module resolution —
 * the same pattern `reporter.test.ts` already establishes).
 *
 * @see specs/13 §13.1 F-TEST-7
 * @see PLAN-M8.md P4
 */
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import {
  readFlakyState,
  writeFlakyState,
  type FlakyState,
} from '../../../../src/commands/loop/test/flaky.ts';
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

  it('does not record a real, deliberate skip into flaky.json — nothing was actually exercised', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `import { test, expect } from 'vitest';
test('passes', () => { expect(1).toBe(1); });
test.skip('a deliberate skip', () => { expect(1).toBe(1); });`,
      'utf8',
    );

    const result = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    expect(result.failed).toBe(0);
    expect(result.problems).toBeUndefined();
    const state = await readFlakyState(new ProjectPaths(dir));
    expect(findFlakyRecord(state, 'a deliberate skip')).toBeUndefined();
  });

  it('reports a real problem, not a thrown exception, when docs/forge/reports/flaky.json is corrupt', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `import { test, expect } from 'vitest'; test('passes', () => { expect(1).toBe(1); });`,
      'utf8',
    );
    await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
    await writeFile(path.join(dir, 'docs/forge/reports/flaky.json'), 'not json', 'utf8');

    const result = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    expect(result.problems?.some((p) => p.includes('flaky.json'))).toBe(true);
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

  it('reports a real problem, not a thrown exception, when the lint command produces non-JSON output', async () => {
    // A real, if unusual, misconfiguration — `testCommands.lint` pointed at something that is not
    // actually eslint at all — is a genuine way a project-authored command can produce output
    // `--format json`'s own real shape assumption does not hold for; this must degrade to a real
    // `problems` entry, never a thrown exception or a silently wrong error count.
    const dir = await tempDir();

    const result = await testRun(
      // Wrapped in `sh -c '...'`: `runLintRule` always appends ` --format json` by literal string
      // concatenation, and `node -e`'s own CLI parser rejects a trailing flag-shaped argument
      // outright (confirmed directly) — the wrapper's inner `sh` absorbs it as an inert extra
      // positional argument instead, the same technique `reporter.test.ts`'s own header doc
      // establishes is unnecessary there only because real vitest/pytest tolerate the appended flag
      // themselves. `NaN` (bare, no string literal needed at all) is real, valid JS whose own
      // stdout ("NaN") is not valid JSON — no mocking of eslint's own behaviour, just a genuinely
      // non-JSON-shaped real command, the same real misconfiguration a project could make by
      // accident.
      ctx(dir, { lint: `sh -c '${NODE} -e "console.log(NaN)"'` }),
      { rule: 'lint' },
      UNUSED_TEMP_PATH,
    );

    expect(result.problems?.some((p) => p.includes('unparseable'))).toBe(true);
  });

  it('reports a real problem, not a thrown exception, when the lint command produces valid JSON that is not an array', async () => {
    const dir = await tempDir();

    const result = await testRun(
      ctx(dir, { lint: `sh -c '${NODE} -e "console.log(JSON.stringify({ok:1}))"'` }),
      { rule: 'lint' },
      UNUSED_TEMP_PATH,
    );

    expect(result.problems?.some((p) => p.includes('unparseable'))).toBe(true);
  });

  it('counts a real eslint-shaped file result with no errorCount field as zero, not a thrown exception', async () => {
    const dir = await tempDir();

    const result = await testRun(
      ctx(dir, { lint: `sh -c '${NODE} -e "console.log(JSON.stringify([{filePath:1}]))"'` }),
      { rule: 'lint' },
      UNUSED_TEMP_PATH,
    );

    expect(result.errors).toBe(0);
    expect(result.problems).toBeUndefined();
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

  it('reports a real problem, not a thrown exception, when the typecheck command fails to run at all', async () => {
    // A real, nonexistent command exits nonzero with no real `error TSxxxx:`-shaped diagnostic line
    // anywhere in its own stdout/stderr — indistinguishable, before this check, from "ran and found
    // zero real type errors."
    const dir = await tempDir();

    const result = await testRun(
      ctx(dir, { typecheck: 'this-command-does-not-exist-at-all' }),
      { rule: 'typecheck' },
      UNUSED_TEMP_PATH,
    );

    expect(result.problems?.length).toBeGreaterThan(0);
    expect(result.errors).toBeGreaterThanOrEqual(1);
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

  it('forwards a real problem from runOracleLint verbatim, rather than a silent clean pass', async () => {
    const dir = await tempDir();
    const blockedDir = path.join(dir, 'blocked');
    await mkdir(blockedDir, { recursive: true });
    await writeFile(
      path.join(blockedDir, 'weak.test.js'),
      `test('AC-900-3 returns a result', () => { expect(doSomething()).toBeDefined(); });`,
      'utf8',
    );
    await chmod(blockedDir, 0o000);

    try {
      const result = await testRun(ctx(dir, {}), { rule: 'oracle-lint' }, UNUSED_TEMP_PATH);
      expect(result.problems?.length).toBeGreaterThan(0);
    } finally {
      await chmod(blockedDir, 0o755);
    }
  });
});

/** Finds `state.tests`' own real entry for `testName` by qualified-key suffix — the real key is
 * `<file>::<name>` (`run.ts`'s own `flakyKey`), and `file` is vitest's own real, possibly
 * realpath-resolved absolute path (which need not match a plain `path.join(dir, ...)` literally on
 * every platform) — matching by suffix avoids hardcoding that exact value in these tests. */
function findFlakyRecord(
  state: Awaited<ReturnType<typeof readFlakyState>>,
  testName: string,
): FlakyState['tests'][string] | undefined {
  const entry = Object.entries(state.tests).find(([key]) => key.endsWith(`::${testName}`));
  return entry?.[1];
}

describe('testRun — default rule, F-TEST-6 retry-in-isolation and flake tracking (P7)', () => {
  it('retrying a genuinely, consistently-failing test never removes it from failed, and records it as a real (non-flaky) pass in flaky.json', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'always-fails.test.js'),
      `import { test, expect } from 'vitest'; test('AC-910-1 always fails', () => { expect(1).toBe(2); });`,
      'utf8',
    );

    const result = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    expect(result.failed).toBe(1);
    const flakyState = await readFlakyState(new ProjectPaths(dir));
    // Retried, found consistent, and therefore recorded as "pass" (not flaky) — this rolling window
    // measures flakiness specifically, not raw first-pass reliability (`flaky.ts`'s own doc comment).
    const record = findFlakyRecord(flakyState, 'AC-910-1 always fails');
    expect(record?.outcomes).toEqual(['pass']);
    expect(record?.quarantined).toBe(false);
  });

  it('records a real flake occurrence (fails on the first pass, passes on the isolated retry) as "fail" in flaky.json, without affecting failed', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    // A real, deterministic flake fixture: fails on this process's first real invocation only (a
    // file-based counter), passes on the second — the isolated retry `run.ts` performs is a genuinely
    // separate subprocess invocation, confirmed directly to reload this module fresh.
    await writeFile(
      path.join(dir, 'flakes.test.js'),
      `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from 'vitest';
const counterPath = './counter.txt';
const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) + 1 : 1;
writeFileSync(counterPath, String(count));
test('AC-910-2 flakes on the first real invocation only', () => {
  expect(count).toBeGreaterThan(1);
});
`,
      'utf8',
    );

    const result = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    // "Retries are never used to make a gate pass" (F-TEST-6) — the original failing run still
    // counts, even though the isolated retry itself passed.
    expect(result.failed).toBe(1);
    const flakyState = await readFlakyState(new ProjectPaths(dir));
    const record = findFlakyRecord(flakyState, 'AC-910-2 flakes on the first real invocation only');
    expect(record?.outcomes).toEqual(['fail']);
  });

  it('excludes a test already quarantined before this run started from the failed count', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'quarantined.test.js'),
      `import { test, expect } from 'vitest'; test('AC-910-3 is already quarantined', () => { expect(1).toBe(2); });`,
      'utf8',
    );
    const paths = new ProjectPaths(dir);
    // A real coverage/test collector records real, symlink-resolved paths — `realpath(dir)` mirrors
    // that here (`coverage.test.ts`'s own identical precedent), since `mkdtemp`'s own `dir` can itself
    // sit behind a symlink (macOS's `/var` -> `/private/var`).
    const realFile = path.join(await realpath(dir), 'quarantined.test.js');
    await writeFlakyState(paths, {
      v: 1,
      tests: {
        [`${realFile}::AC-910-3 is already quarantined`]: {
          outcomes: ['fail', 'pass', 'pass', 'pass'],
          quarantined: true,
        },
      },
    });

    const result = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    // F-TEST-6: "excluded from the gate" — a real first-pass failure, but already quarantined before
    // this run started, so it never reaches `failed`.
    expect(result.failed).toBe(0);
  });

  it('crosses the quarantine threshold on the run that reaches it, but only excludes it from failed on the NEXT run (F-TEST-6: "on the next forge test run")', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'crosses.test.js'),
      `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from 'vitest';
const counterPath = './counter.txt';
const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) + 1 : 1;
writeFileSync(counterPath, String(count));
test('AC-910-4 crosses the threshold this run', () => {
  expect(count).toBeGreaterThan(1);
});
`,
      'utf8',
    );
    const paths = new ProjectPaths(dir);
    const realFile = path.join(await realpath(dir), 'crosses.test.js');
    // 19 real, prior flake occurrences already recorded — one more (this run's own) crosses the 2%
    // default threshold (1/20 = 5%).
    await writeFlakyState(paths, {
      v: 1,
      tests: {
        [`${realFile}::AC-910-4 crosses the threshold this run`]: {
          outcomes: Array(19).fill('pass') as readonly ('pass' | 'fail')[],
          quarantined: false,
        },
      },
    });

    const result = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    expect(result.failed).toBe(1);
    const flakyState = await readFlakyState(paths);
    const record = findFlakyRecord(flakyState, 'AC-910-4 crosses the threshold this run');
    expect(record?.quarantined).toBe(true);
  });

  it('does not misclassify a real, deterministic failure as a flake when a DIFFERENT file has a passing test of the identical name', async () => {
    // A fresh critic round reproduced this directly: `TestOutcome.name` is not unique across files,
    // and the first draft's retry-in-isolation matched purely by name — a same-named passing test in
    // a different file made the isolated retry (unscoped to any one file) report a false pass,
    // permanently quarantining the real, broken test and silently excluding it from every later run's
    // own `failed` count.
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'broken.test.js'),
      `import { test, expect } from 'vitest'; test('handles empty input', () => { expect(1).toBe(2); });`,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'healthy.test.js'),
      `import { test, expect } from 'vitest'; test('handles empty input', () => { expect(1).toBe(1); });`,
      'utf8',
    );

    const run1 = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);
    expect(run1.failed).toBe(1);
    const stateAfterRun1 = await readFlakyState(new ProjectPaths(dir));
    const brokenRecord = findFlakyRecord(stateAfterRun1, 'handles empty input');
    // The real, broken test's own qualified record — never conflated with the healthy one's.
    expect(brokenRecord?.outcomes).toEqual(['pass']);
    expect(brokenRecord?.quarantined).toBe(false);

    // A second, independent run: the real failure must still count — never silently excluded because
    // an earlier run wrongly latched a quarantine.
    const run2 = await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);
    expect(run2.failed).toBe(1);
  });

  it('prunes a stale, quarantined record for a test that no longer exists, on a clean run', async () => {
    // A fresh critic round reproduced this directly: nothing else in this system ever removes a
    // `flaky.json` entry, so a deleted or renamed test's own quarantine latch (if it had one)
    // otherwise accumulates forever — permanently blocking `test:quarantine-cap`/`test:flaky` on a
    // test that does not exist any more, with no way to fix it short of a hand edit.
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(dir, 'current.test.js'),
      `import { test, expect } from 'vitest'; test('AC-910-5 still exists', () => { expect(1).toBe(1); });`,
      'utf8',
    );
    const paths = new ProjectPaths(dir);
    await writeFlakyState(paths, {
      v: 1,
      tests: {
        'some/deleted/file.test.js::a test that was removed long ago': {
          outcomes: ['fail'],
          quarantined: true,
        },
      },
    });

    await testRun(ctx(dir, { unit: VITEST_CMD }), {}, UNUSED_TEMP_PATH);

    const flakyState = await readFlakyState(paths);
    expect(Object.keys(flakyState.tests)).not.toContain(
      'some/deleted/file.test.js::a test that was removed long ago',
    );
  });

  it('does NOT prune a stale record when this run had a real problem (a tool failure must never be read as "this test no longer exists")', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    const paths = new ProjectPaths(dir);
    const staleKey = 'some/deleted/file.test.js::a test that was removed long ago';
    await writeFlakyState(paths, {
      v: 1,
      tests: { [staleKey]: { outcomes: ['fail'], quarantined: true } },
    });

    // No declared layer command at all — a real, guaranteed `problems` entry (`!declaredAny`).
    await testRun(ctx(dir, {}), {}, UNUSED_TEMP_PATH);

    const flakyState = await readFlakyState(paths);
    expect(Object.keys(flakyState.tests)).toContain(staleKey);
  });
});
