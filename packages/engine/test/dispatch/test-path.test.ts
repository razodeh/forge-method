/**
 * `isTestPath` (moved verbatim from `packages/cli/src/commands/run/run-plan.ts:57-61`) and
 * `validateTestPath`/`expandTrustedInvocation` (`PLAN-M14.md` P5, `SPEC-QUESTIONS.md` Q230's "whole-layer
 * reproduction" problem). Written from the spec text: `20` §20.1's exec allowlist stays exact strings; this
 * is the validator that lets a proposed command extend one of those exact strings with one real,
 * project-relative test file, never a wildcard, never an unexpanded placeholder, never a path that leaves
 * the project even through a symlinked ancestor directory.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  expandTrustedInvocation,
  isTestPath,
  trustedCommandFilterFlag,
  validateTestPath,
  type TestPathProblem,
} from '../../src/dispatch/test-path.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function lane(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'forge-test-path-')));
  dirs.push(dir);
  return dir;
}

async function problemOf(
  rawPath: string,
  root: string,
  testRoots?: readonly string[],
): Promise<TestPathProblem | undefined> {
  const checked = await validateTestPath(rawPath, { root, testRoots });
  return checked.ok ? undefined : checked.problem;
}

describe('isTestPath', () => {
  it.each([
    ['tests/foo.ts', true],
    ['src/tests/foo.ts', true],
    ['__tests__/foo.ts', true],
    ['e2e/foo.ts', true],
    ['src/foo.test.ts', true],
    ['src/foo.spec.tsx', true],
    ['src/foo_test.py', true],
    ['src/foo.ts', false],
    ['docs/tests-note.md', false],
  ])('%s -> %s', (glob, expected) => {
    expect(isTestPath(glob)).toBe(expected);
  });
});

describe('packages/cli/src no longer defines TEST_PATH (moved verbatim to dispatch/test-path.ts)', () => {
  it('git grep finds no TEST_PATH under packages/cli/src', async () => {
    const result = await execa('git', ['grep', '-l', 'TEST_PATH', '--', 'packages/cli/src'], {
      cwd: repoRoot,
      reject: false,
    });
    expect(result.stdout.trim()).toBe('');
  });
});

describe('validateTestPath: the validator matrix', () => {
  it('".." is refused as path-escape, whether leading or embedded', async () => {
    const root = await lane();
    expect(await problemOf('../x.test.ts', root)).toBe('path-escape');
    expect(await problemOf('tests/../x.test.ts', root)).toBe('path-escape');
  });

  it('an absolute path is refused as path-escape', async () => {
    const root = await lane();
    expect(await problemOf('/etc/passwd', root)).toBe('path-escape');
  });

  it('a leading "-" is refused as malformed (never read as an option by a runner)', async () => {
    const root = await lane();
    expect(await problemOf('-rf', root)).toBe('malformed');
  });

  it('a space is refused as malformed (two words, not one token)', async () => {
    const root = await lane();
    expect(await problemOf('tests/a b.test.ts', root)).toBe('malformed');
  });

  it('a quote character is refused as malformed', async () => {
    const root = await lane();
    expect(await problemOf('tests/"x".test.ts', root)).toBe('malformed');
    expect(await problemOf("tests/'x'.test.ts", root)).toBe('malformed');
  });

  it('"$x" is refused as malformed (never expanded)', async () => {
    const root = await lane();
    expect(await problemOf('tests/$x.test.ts', root)).toBe('malformed');
  });

  it('a glob ("*.test.ts") is refused as malformed, never expanded', async () => {
    const root = await lane();
    expect(await problemOf('tests/*.test.ts', root)).toBe('malformed');
  });

  it('a NUL byte is refused as malformed', async () => {
    const root = await lane();
    expect(await problemOf('tests/x\0.test.ts', root)).toBe('malformed');
  });

  it('a directory is refused as not-a-file', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests', 'sub'), { recursive: true });
    expect(await problemOf('tests/sub', root)).toBe('not-a-file');
  });

  it('a missing path is refused as not-a-file', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    expect(await problemOf('tests/missing.test.ts', root)).toBe('not-a-file');
  });

  it('a symlink AS the test file itself is refused as not-a-file, whether it points inside or outside the root', async () => {
    const root = await lane();
    const outside = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'real.test.ts'), '');
    await writeFile(path.join(outside, 'evil.test.ts'), '');
    await symlink(
      path.join(root, 'tests', 'real.test.ts'),
      path.join(root, 'tests', 'link-in.test.ts'),
    );
    await symlink(path.join(outside, 'evil.test.ts'), path.join(root, 'tests', 'link-out.test.ts'));
    expect(await problemOf('tests/link-in.test.ts', root)).toBe('not-a-file');
    expect(await problemOf('tests/link-out.test.ts', root)).toBe('not-a-file');
  });

  it('a symlinked ANCESTOR directory that resolves outside the root is refused as path-escape, even though the leaf itself is a real file', async () => {
    const root = await lane();
    const outside = await lane();
    await writeFile(path.join(outside, 'x.test.ts'), '');
    await symlink(outside, path.join(root, 'tests'));
    expect(await problemOf('tests/x.test.ts', root)).toBe('path-escape');
  });

  it('a symlinked ancestor directory that resolves back inside the root is accepted', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'real-tests'));
    await writeFile(path.join(root, 'real-tests', 'x.test.ts'), '');
    await symlink(path.join(root, 'real-tests'), path.join(root, 'tests'));
    const checked = await validateTestPath('tests/x.test.ts', { root });
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
  });

  it('a real file outside every configured testRoots entry is refused as outside-test-roots', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'index.ts'), '');
    expect(await problemOf('src/index.ts', root, ['tests'])).toBe('outside-test-roots');
  });

  it('outside-test-roots respects a segment boundary (tests-extra does not match a root of tests)', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests-extra'));
    await writeFile(path.join(root, 'tests-extra', 'x.test.ts'), '');
    expect(await problemOf('tests-extra/x.test.ts', root, ['tests'])).toBe('outside-test-roots');
  });

  it('testRoots explicitly set to an empty list accepts no path at all (fails closed, not open)', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    expect(await problemOf('tests/x.test.ts', root, [])).toBe('outside-test-roots');
  });

  it('a real file under a configured testRoots entry is accepted', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    const checked = await validateTestPath('tests/x.test.ts', { root, testRoots: ['tests'] });
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    expect(checked.ok && checked.path).toBe('tests/x.test.ts');
  });

  it('configuring testRoots narrows, not extends: a path only the built-in rule would accept is refused when testRoots is set to something else', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    expect(await problemOf('tests/x.test.ts', root, ['e2e'])).toBe('outside-test-roots');
  });

  it('a configured testRoots entry is a DIRECTORY allowlist, not a filename allowlist: a real file under it with no test-shaped name is accepted once configured, refused by the unconfigured default', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'spec'));
    await writeFile(path.join(root, 'spec', 'helper.ts'), '');
    // Unconfigured: "spec" is not in the built-in rule's directory alternation, and the filename does not
    // match ".test."/".spec."/"_test" either, so the default rule refuses it.
    expect(await problemOf('spec/helper.ts', root)).toBe('outside-test-roots');
    // Configured to "spec": accepted purely by directory containment — the filename is not re-checked
    // against the built-in rule. A deliberate, disclosed design property (see the piece's own
    // SPEC-QUESTIONS.md record): the boundary is the project's own execution.testRoots value, not the
    // file's own name.
    const checked = await validateTestPath('spec/helper.ts', { root, testRoots: ['spec'] });
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
  });
});

describe('validateTestPath: default (unconfigured) testRoots reproduces isTestPath', () => {
  const samples: readonly string[] = [
    'tests/foo.ts',
    'src/foo.test.ts',
    'e2e/foo.ts',
    '__tests__/foo.ts',
    'src/foo_test.py',
    'src/foo.ts',
    'lib/helpers.ts',
  ];

  it.each(samples)('%s: ok matches isTestPath', async (sample) => {
    const root = await lane();
    await mkdir(path.join(root, path.dirname(sample)), { recursive: true });
    await writeFile(path.join(root, sample), '');
    const checked = await validateTestPath(sample, { root });
    expect(checked.ok, sample).toBe(isTestPath(sample));
  });
});

describe('expandTrustedInvocation: shape matching', () => {
  it('matches false for the bare trusted command (no extra words): the caller’s exact-string check handles it', async () => {
    const root = await lane();
    const result = await expandTrustedInvocation(['pnpm', 'vitest', 'run'], ['pnpm vitest run'], {
      root,
    });
    expect(result).toEqual({ matched: false });
  });

  it('matches false when the words do not start with any trusted command', async () => {
    const root = await lane();
    const result = await expandTrustedInvocation(['node', '-e', '1'], ['pnpm vitest run'], {
      root,
    });
    expect(result).toEqual({ matched: false });
  });

  it('matches false for two extra words (not a recognised shape)', async () => {
    const root = await lane();
    const result = await expandTrustedInvocation(
      ['pnpm', 'vitest', 'run', 'a.test.ts', 'b.test.ts'],
      ['pnpm vitest run'],
      { root },
    );
    expect(result).toEqual({ matched: false });
  });

  it('matches false for a filter flag after a runner the table does not recognise (pnpm test)', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    const result = await expandTrustedInvocation(
      ['pnpm', 'test', 'tests/x.test.ts', '-t', 'name'],
      ['pnpm test'],
      { root },
    );
    expect(result).toEqual({ matched: false });
  });

  it('matches true, ok true for a recognised runner’s own flag and a plain token (vitest -t)', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    const result = await expandTrustedInvocation(
      ['pnpm', 'vitest', 'run', 'tests/x.test.ts', '-t', 'my-test-name'],
      ['pnpm vitest run'],
      { root },
    );
    expect(result).toEqual({
      matched: true,
      ok: true,
      path: 'tests/x.test.ts',
      token: 'my-test-name',
    });
  });

  it('mocha takes -g, pytest takes -k, the wrong flag for a recognised runner does not match', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    const mochaOk = await expandTrustedInvocation(
      ['mocha', 'tests/x.test.ts', '-g', 'name'],
      ['mocha'],
      { root },
    );
    expect(mochaOk).toEqual({ matched: true, ok: true, path: 'tests/x.test.ts', token: 'name' });

    const pytestOk = await expandTrustedInvocation(
      ['python', '-m', 'pytest', 'tests/x.test.ts', '-k', 'name'],
      ['python -m pytest'],
      { root },
    );
    expect(pytestOk).toEqual({
      matched: true,
      ok: true,
      path: 'tests/x.test.ts',
      token: 'name',
    });

    const wrongFlag = await expandTrustedInvocation(
      ['mocha', 'tests/x.test.ts', '-k', 'name'],
      ['mocha'],
      { root },
    );
    expect(wrongFlag).toEqual({ matched: false });
  });

  it('a token with a space or other non-plain character is matched, ok false, problem malformed', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    const result = await expandTrustedInvocation(
      ['pnpm', 'vitest', 'run', 'tests/x.test.ts', '-t', 'a b'],
      ['pnpm vitest run'],
      { root },
    );
    expect(result.matched).toBe(true);
    expect(result.matched && !result.ok && result.problem).toBe('malformed');
  });

  it('the longest matching trusted command wins when one is a prefix of another', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    const result = await expandTrustedInvocation(
      ['pnpm', 'vitest', 'run', 'tests/x.test.ts'],
      ['pnpm', 'pnpm vitest run'],
      { root },
    );
    // "pnpm" alone would leave 3 extra words (no match); "pnpm vitest run" leaves exactly 1 (the path).
    expect(result).toEqual({ matched: true, ok: true, path: 'tests/x.test.ts' });
  });

  it('a literal, unexpanded "{path}" placeholder is matched, ok false, problem malformed (never treated as a real path)', async () => {
    const root = await lane();
    const result = await expandTrustedInvocation(
      ['pnpm', 'vitest', 'run', '{path}'],
      ['pnpm vitest run'],
      {
        root,
      },
    );
    expect(result.matched).toBe(true);
    expect(result.matched && !result.ok && result.problem).toBe('malformed');
  });
});

describe('trustedCommandFilterFlag: the identical table expandTrustedInvocation itself vets against, exposed so a caller can say what a command supports before any command is proposed (PLAN-M14.md P24)', () => {
  it.each([
    ['vitest', '-t'],
    ['pnpm vitest run', '-t'],
    ['jest', '-t'],
    ['npx jest', '-t'],
    ['mocha', '-g'],
    ['pytest', '-k'],
    ['python -m pytest', '-k'],
  ] as const)('%s -> %s', (trusted, flag) => {
    expect(trustedCommandFilterFlag(trusted)).toBe(flag);
  });

  it.each(['pnpm test', 'npm run test:unit', 'go test ./...', 'true'])(
    '%s -> undefined (a wrapper or a program RUNNER_FILTER_FLAGS does not know)',
    (trusted) => {
      expect(trustedCommandFilterFlag(trusted)).toBeUndefined();
    },
  );

  it('agrees with expandTrustedInvocation itself: whenever the flag is defined, a proposal using it (with a real path) actually matches, and the wrong flag does not', async () => {
    const root = await lane();
    await mkdir(path.join(root, 'tests'), { recursive: true });
    await writeFile(path.join(root, 'tests', 'x.test.ts'), '');
    const flag = trustedCommandFilterFlag('vitest');
    expect(flag).toBe('-t');
    const right = await expandTrustedInvocation(
      ['vitest', 'tests/x.test.ts', flag as string, 'name'],
      ['vitest'],
      { root },
    );
    expect(right).toEqual({ matched: true, ok: true, path: 'tests/x.test.ts', token: 'name' });
    const wrong = await expandTrustedInvocation(
      ['vitest', 'tests/x.test.ts', '-k', 'name'],
      ['vitest'],
      { root },
    );
    expect(wrong).toEqual({ matched: false });
  });
});
