/**
 * `runOracleLint` — `PLAN-M8.md` P5's own Checks section.
 *
 * @see specs/13 §13.1 F-TEST-2
 * @see PLAN-M8.md P5
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { runOracleLint } from '../../../../src/commands/loop/test/oracle-lint.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<{ readonly dir: string; readonly paths: ProjectPaths }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-oracle-lint-'));
  dirs.push(dir);
  return { dir, paths: new ProjectPaths(dir) };
}

async function writeTestFile(dir: string, name: string, content: string): Promise<void> {
  const relPath = name;
  await mkdir(path.dirname(path.join(dir, relPath)), { recursive: true });
  await writeFile(path.join(dir, relPath), content, 'utf8');
}

describe('runOracleLint — weak assertion (toBeDefined/toBeTruthy as the sole assertion)', () => {
  it('flags a test whose only assertion is toBeDefined()', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'weak.test.js',
      `
import { test, expect } from 'vitest';
test('AC-001-1 returns a result', () => {
  const result = doSomething();
  expect(result).toBeDefined();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
    expect(result.violations[0]?.pattern).toBe('weak-assertion');
  });

  it('flags a test whose only assertion is toBeTruthy()', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'weak2.test.js',
      `
test('AC-001-2 returns a truthy result', () => {
  expect(doSomething()).toBeTruthy();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
  });

  it('does not flag a test with a real value assertion alongside toBeDefined()', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'strong.test.js',
      `
test('AC-001-3 computes the real total', () => {
  const result = compute();
  expect(result).toBeDefined();
  expect(result.total).toBe(110);
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(0);
  });
});

describe('runOracleLint — empty catch (swallowed failure)', () => {
  it('flags a bare try/catch with an empty catch body and no assertion', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'catch.test.js',
      `
test('AC-002-1 does not throw', () => {
  try {
    risky();
  } catch {
  }
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.violations.some((v) => v.pattern === 'empty-catch')).toBe(true);
  });

  it('does not flag a catch block that contains a real assertion', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'catch-ok.test.js',
      `
test('AC-002-2 throws the right error', () => {
  try {
    risky();
    expect(true).toBe(false);
  } catch (error) {
    expect(error.message).toBe('boom');
  }
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.violations.some((v) => v.pattern === 'empty-catch')).toBe(false);
  });
});

describe('runOracleLint — tautological assertion', () => {
  it('flags an unconditional expect(true).toBe(true)', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'tautology.test.js',
      `
test('AC-003-1 always passes', () => {
  doSomething();
  expect(true).toBe(true);
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.violations.some((v) => v.pattern === 'tautological-assertion')).toBe(true);
  });
});

describe('runOracleLint — unapproved snapshot', () => {
  it('flags a snapshot test with no approval header', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'snapshot.test.js',
      `
test('AC-004-1 renders the invoice', () => {
  expect(render()).toMatchSnapshot();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.violations.some((v) => v.pattern === 'unapproved-snapshot')).toBe(true);
  });

  it('does not flag a snapshot test with a real approval header', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'snapshot-ok.test.js',
      `
test('AC-004-2 renders the invoice', () => {
  // approved-by: alice against AC-014-2
  expect(render()).toMatchSnapshot();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.violations.some((v) => v.pattern === 'unapproved-snapshot')).toBe(false);
  });
});

describe('runOracleLint — a clean, well-oracled file', () => {
  it('produces zero violations', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'clean.test.js',
      `
test('AC-005-1 computes the real total to the cent', () => {
  const result = compute({ items: 3, taxRate: 0.1 });
  expect(result.total).toBe(110);
});
test('AC-005-2 rejects an empty invoice', () => {
  expect(() => compute({ items: 0 })).toThrow('INVOICE_EMPTY');
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(0);
    expect(result.violations).toEqual([]);
  });
});

describe('runOracleLint — adversarial fixtures a fresh critic round found', () => {
  it("scans the real body of a test using vitest's own documented test-context destructuring form", async () => {
    // `test('name', ({ expect }) => { ... })` — a real, documented Vitest API for concurrent
    // tests. The first draft's "find the next '{' at all" heuristic found the *parameter*
    // destructuring's own brace, not the real function body, silently scanning nothing.
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'destructured.test.js',
      `
test('AC-950-1 uses vitest test-context destructuring', ({ expect }) => {
  const result = doSomething();
  expect(result).toBeDefined();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
    expect(result.violations[0]?.pattern).toBe('weak-assertion');
  });

  it('does not truncate a test body at an ordinary regex literal with an odd brace count', async () => {
    // `/\}/` contains one real, un-stringed `}` — the first draft's brace-matcher had no
    // regex-literal awareness and closed the "test body" right there, hiding everything after it.
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'regex-brace.test.js',
      `
test('AC-960-1 an ordinary regex literal does not truncate the body', () => {
  const pattern = /\\}/;
  const result = doSomething();
  expect(result).toBeDefined();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
    expect(result.violations[0]?.pattern).toBe('weak-assertion');
  });

  it('flags two separate weak-only expect() calls with no strong assertion anywhere', async () => {
    // The first draft's "exactly one expect() call total" heuristic let this through clean —
    // there is no real, stronger assertion anywhere in this test, which is exactly what F-TEST-2
    // bans, regardless of how many separate weak calls there are.
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'double-weak.test.js',
      `
test('AC-970-1 has no real assertion at all', () => {
  const result = compute();
  expect(result).toBeDefined();
  expect(result.data).toBeTruthy();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
    expect(result.violations[0]?.pattern).toBe('weak-assertion');
  });

  it('reports a real problem, not a silent clean pass, when a subtree cannot be read', async () => {
    const { dir, paths } = await project();
    const blockedDir = path.join(dir, 'blocked');
    await mkdir(blockedDir, { recursive: true });
    await writeFile(
      path.join(blockedDir, 'weak.test.js'),
      `test('AC-980-1 returns a result', () => { expect(doSomething()).toBeDefined(); });`,
      'utf8',
    );
    await chmod(blockedDir, 0o000);

    try {
      const result = await runOracleLint(paths);
      expect(result.problems?.length).toBeGreaterThan(0);
    } finally {
      await chmod(blockedDir, 0o755);
    }
  });

  it('reports a real problem, not a silent clean pass, when one real file (not a whole subtree) cannot be read', async () => {
    // `readTextFileRelative`'s own catch, distinct from `discoverTestFiles`'s — a real, individually
    // unreadable file (a permissions error on the file itself, listed successfully but not openable)
    // is a genuinely different failure point than an unlistable directory.
    const { dir, paths } = await project();
    const filePath = path.join(dir, 'unreadable.test.js');
    await writeFile(
      filePath,
      `test('AC-981-1 returns a result', () => { expect(doSomething()).toBeDefined(); });`,
      'utf8',
    );
    await chmod(filePath, 0o000);

    try {
      const result = await runOracleLint(paths);
      expect(result.problems?.length).toBeGreaterThan(0);
      expect(result.violations).toEqual([]);
    } finally {
      await chmod(filePath, 0o644);
    }
  });
});

describe("runOracleLint — real scanner edge cases (closing this scanner's own coverage floor)", () => {
  it('recognises a real pytest-convention Python test file by name alone (test_ prefix)', async () => {
    const { dir, paths } = await project();
    await writeTestFile(dir, 'test_invoice.py', 'def test_computes_total():\n    assert 1 == 1\n');

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(0);
  });

  it('recognises a real pytest-convention Python test file by name alone (_test suffix)', async () => {
    const { dir, paths } = await project();
    await writeTestFile(dir, 'invoice_test.py', 'def test_computes_total():\n    assert 1 == 1\n');

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(0);
  });

  it('scans a real plain `function` test callback, not only arrow functions', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'plain-function.test.js',
      `
test('AC-990-1 uses a plain function callback', function () {
  expect(doSomething()).toBeDefined();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
    expect(result.violations[0]?.pattern).toBe('weak-assertion');
  });

  it('skips a real concise arrow test body with no braces at all, rather than mis-scanning past it', async () => {
    // No `{` anywhere in the file at all — `findCallbackBodyStart` falls back to `source.indexOf('{',
    // ...)`, finds none, and `discoverTestBlocks` skips this block rather than reading garbage.
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'concise-body.test.js',
      `test('AC-991-1 a concise arrow body with no block at all', () => expect(doSomething()).toBeDefined());`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(0);
  });

  it('does not throw on a real truncated file whose test body brace never closes', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'truncated.test.js',
      `
test('AC-992-1 a file truncated mid-body', () => {
  expect(doSomething()).toBeDefined();
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(0);
  });

  it('does not flag a real test whose only expect() call has an unmatched, malformed paren', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'malformed-call.test.js',
      `
test('AC-993-1 a malformed expect call with no closing paren', () => {
  expect(doSomething(
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(0);
  });

  it('correctly scans past a real regex literal containing a character class and flags', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'regex-charclass.test.js',
      `
test('AC-994-1 a regex with a character class and flags does not confuse the scanner', () => {
  const pattern = /[a-z]+/gi;
  const result = doSomething();
  expect(result).toBeDefined();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
    expect(result.violations[0]?.pattern).toBe('weak-assertion');
  });

  it('bails out of a regex-context slash at a real newline, rather than swallowing the rest of the file', async () => {
    // `skipRegexLiteral`'s own defensive bail-out: a real regex literal never spans a newline. A
    // regex-context slash (preceded by `=`) with no closing `/` before the next newline is malformed,
    // not ordinary code — the scanner is a deliberately minimal source scanner, not a real parser
    // (this file's own header), and must not silently swallow every real brace after it while looking
    // for a closing `/` that never comes on that line.
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'regex-newline.test.js',
      `
test('AC-995-1 a regex-context slash with no closing slash before its own newline', () => {
  const bad = /abc
def/;
  expect(doSomething()).toBeDefined();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
    expect(result.violations[0]?.pattern).toBe('weak-assertion');
  });

  it('correctly scans past a real string literal containing an escaped quote', async () => {
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'string-escape.test.js',
      `
test('AC-996-1 a string with an escaped quote does not confuse the scanner', () => {
  const label = 'it\\'s a test';
  const result = doSomething();
  expect(result).toBeDefined();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
    expect(result.violations[0]?.pattern).toBe('weak-assertion');
  });

  it('correctly scans past real line and block comments inside a test body', async () => {
    // Both comment forms are stripped by `findMatchingDelimiter` itself (not just
    // `detectEmptyCatch`'s own `stripComments`) — a stray `}` inside either comment form must never
    // miscount this scanner's own brace/paren depth tracking.
    const { dir, paths } = await project();
    await writeTestFile(
      dir,
      'comments.test.js',
      `
test('AC-997-1 comments containing a stray brace do not confuse the scanner', () => {
  // a line comment mentioning a stray } brace
  /* a block comment mentioning a stray } brace too */
  const result = doSomething();
  expect(result).toBeDefined();
});
`,
    );

    const result = await runOracleLint(paths);

    expect(result.errors).toBe(1);
    expect(result.violations[0]?.pattern).toBe('weak-assertion');
  });
});
