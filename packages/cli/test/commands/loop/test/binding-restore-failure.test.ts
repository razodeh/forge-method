/**
 * `runBindingCheck` — a failing restore (`PLAN-M15.md` P3's own "Tests first" line: "a failing restore
 * (reported as an engine failure, never as 'binding')"). No real fixture can force `resetLaneWorktree`
 * itself to fail while everything before it (lane creation, the baseline run, the revert, the mutated
 * run) succeeds for real, so `vi.mock` mocks `@forge/vcs`'s `resetLaneWorktree` alone, in a file of its
 * own (the identical reason `config-commit-rollback-failure.test.ts` already establishes) — every
 * other real `@forge/vcs` export, including the real `createLaneWorktree`/`removeLaneWorktree`/
 * `revertPathsToRevision` this same run still needs, stays untouched.
 *
 * @see specs/22 M15 P3
 * @see PLAN-M15.md P3
 */
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type * as ForgeVcs from '@forge/vcs';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { resetLaneWorktreeMock } = vi.hoisted(() => ({ resetLaneWorktreeMock: vi.fn() }));

vi.mock('@forge/vcs', async (importOriginal) => {
  const actual = await importOriginal<typeof ForgeVcs>();
  resetLaneWorktreeMock.mockImplementation(actual.resetLaneWorktree);
  return { ...actual, resetLaneWorktree: resetLaneWorktreeMock };
});

const { runBindingCheck } = await import('../../../../src/commands/loop/test/binding.ts');
const { listOrphanedWorktrees, VcsError } = await import('@forge/vcs');

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
const TEST_COMMAND = `${process.execPath} ${REAL_VITEST_ENTRY} run --root .`;
const UNUSED_TEMP_PATH = (): string => {
  throw new Error('createTempPath should not be called by the js/vitest branch');
};
const FAKE_CLOCK = { now: (): string => '2026-09-30T12:00:00.000Z' };

const dirs: string[] = [];
afterEach(async () => {
  resetLaneWorktreeMock.mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-binding-restore-fail-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function writeFiles(dir: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(dir, relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
}

async function commit(dir: string, message: string): Promise<void> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
}

async function headSha(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

describe('runBindingCheck — a failing restore', () => {
  it('propagates the real VcsError rather than reporting a binding verdict', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    resetLaneWorktreeMock.mockRejectedValueOnce(
      new VcsError({
        code: 'VCS-GIT-OPERATION-FAILED',
        message: 'simulated restore failure',
        remedy: 'n/a — a simulated failure for this test',
      }),
    );

    await expect(
      runBindingCheck({
        projectRoot: dir,
        runId: 'run-restore-fail',
        storyId: 'STORY-RESTORE-FAILS',
        filesExpected: ['impl.js', 'impl.test.js'],
        testCommand: TEST_COMMAND,
        ecosystem: 'js',
        integrationBase: 'HEAD',
        baseRevision: baseSha,
        clock: FAKE_CLOCK,
        createTempPath: UNUSED_TEMP_PATH,
      }),
    ).rejects.toBeInstanceOf(VcsError);
  });

  it('still removes the lane worktree, even though restore itself failed', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    resetLaneWorktreeMock.mockRejectedValueOnce(
      new VcsError({
        code: 'VCS-GIT-OPERATION-FAILED',
        message: 'simulated restore failure',
        remedy: 'n/a — a simulated failure for this test',
      }),
    );

    await runBindingCheck({
      projectRoot: dir,
      runId: 'run-restore-fail-cleanup',
      storyId: 'STORY-RESTORE-FAILS-CLEANUP',
      filesExpected: ['impl.js', 'impl.test.js'],
      testCommand: TEST_COMMAND,
      ecosystem: 'js',
      integrationBase: 'HEAD',
      baseRevision: baseSha,
      clock: FAKE_CLOCK,
      createTempPath: UNUSED_TEMP_PATH,
    }).catch(() => undefined);

    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});
