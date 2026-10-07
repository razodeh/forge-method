/**
 * `runHunkMutationCheck` — a throw genuinely MID-MUTANT (`specs/22` M16 P12's own "Tests first"
 * line: the lane worktree is gone... after a throw mid-mutant, inject one, do not just assume cleanup
 * runs). No real fixture can force one specific `resetLaneWorktree` call, among the several real ones
 * this engine makes (once for the change-level check's own restore, then once per mutant), to fail
 * while everything around it succeeds for real — the identical reason `binding-restore-failure.test.ts`
 * already gives for mocking the SAME function, in a file of its own: `vi.mock('@forge/vcs', ...)`
 * mocks `resetLaneWorktree` alone; every other real `@forge/vcs` export (`createLaneWorktree`,
 * `removeLaneWorktree`, `revertPathsToRevision`) stays untouched, and calls to the mock that are not
 * explicitly queued to reject fall through to the real implementation.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P12
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
  // The one, persistent DEFAULT implementation — real passthrough — set once, here. Each test below
  // queues its own `mockImplementationOnce` calls ahead of it (consumed in order, falling back to
  // this default once the queue is empty) rather than replacing it, and `afterEach` below uses
  // `mockClear()`, never `mockReset()`, specifically so this default survives between tests (`mockReset`
  // would erase it along with the call history, the one real reason `getMockImplementation()` would
  // otherwise return `undefined` on every test after the first).
  resetLaneWorktreeMock.mockImplementation(actual.resetLaneWorktree);
  return { ...actual, resetLaneWorktree: resetLaneWorktreeMock };
});

const { runHunkMutationCheck, DEFAULT_MAX_HUNKS } =
  await import('../../../../src/commands/loop/test/hunk-mutation.ts');
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
  // `mockClear()`, never `mockReset()`: clears call history (so each test's own `toHaveBeenCalledTimes`
  // starts fresh) without erasing the real-passthrough default `vi.mock`'s own factory set above.
  resetLaneWorktreeMock.mockClear();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-hunk-mutation-throw-'));
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

/** Builds the real two-hunk fixture both tests below share, and queues `resetLaneWorktree`'s mock so
 * that calls 1 and 2 (the change-level check's own restore, then the hunk loop's reset before hunk
 * #1) pass through to the real implementation — hunk #1 genuinely runs — and call 3 (the hunk loop's
 * reset before hunk #2) rejects: a throw genuinely BETWEEN two real mutants, never "somewhere in the
 * function" by construction alone. */
async function buildFixtureAndQueueMidMutantThrow(): Promise<{
  readonly dir: string;
  readonly baseSha: string;
}> {
  const dir = await freshRepo();
  const baseSha = await headSha(dir);
  await writeFiles(dir, {
    'impl.js':
      'export function a_value() { return 0; }\n\nexport function b_value() { return 0; }\n',
  });
  await commit(dir, 'base: two buggy stubs');
  await writeFiles(dir, {
    'impl.js':
      'export function a_value() { return 1; }\n\nexport function b_value() { return 1; }\n',
    'impl.test.js':
      "import { test, expect } from 'vitest';\n" +
      "import { a_value, b_value } from './impl.js';\n" +
      "test('combo', () => { expect(a_value() + b_value()).toBe(2); });\n",
  });
  await commit(dir, 'the story: fix both stubs, two hunks');

  // The real, factory-set passthrough (`vi.mock`'s own default implementation above) — fetched back
  // out through vitest's own mock introspection rather than a second, hand-rolled holder, and queued
  // explicitly for calls 1 and 2 so call 3 (queued below) is unambiguously the third.
  const passthrough = resetLaneWorktreeMock.getMockImplementation();
  if (passthrough === undefined) {
    throw new Error(
      "expected vi.mock's own factory to have set a default passthrough implementation",
    );
  }
  resetLaneWorktreeMock.mockImplementationOnce(passthrough);
  resetLaneWorktreeMock.mockImplementationOnce(passthrough);
  resetLaneWorktreeMock.mockImplementationOnce(() => {
    throw new VcsError({
      code: 'VCS-GIT-OPERATION-FAILED',
      message: 'simulated mid-mutant reset failure',
      remedy: 'n/a — a simulated failure for this test',
    });
  });

  return { dir, baseSha };
}

describe('runHunkMutationCheck — a throw genuinely mid-mutant (specs/22 M16 P12)', () => {
  it('propagates the real VcsError rather than reporting any outcome at all', async () => {
    const { dir, baseSha } = await buildFixtureAndQueueMidMutantThrow();

    await expect(
      runHunkMutationCheck(
        {
          projectRoot: dir,
          runId: 'run-hm-throw',
          storyId: 'STORY-HM-MID-MUTANT-THROW',
          filesExpected: ['impl.js', 'impl.test.js'],
          testCommand: TEST_COMMAND,
          ecosystem: 'js' as const,
          integrationBase: 'HEAD',
          baseRevision: baseSha,
          clock: FAKE_CLOCK,
          createTempPath: UNUSED_TEMP_PATH,
        },
        { maxHunks: DEFAULT_MAX_HUNKS },
      ),
    ).rejects.toBeInstanceOf(VcsError);
    expect(resetLaneWorktreeMock).toHaveBeenCalledTimes(3);
  }, 30_000);

  it('still removes the lane worktree even though the throw happened mid-mutant', async () => {
    const { dir, baseSha } = await buildFixtureAndQueueMidMutantThrow();

    await runHunkMutationCheck(
      {
        projectRoot: dir,
        runId: 'run-hm-throw-cleanup',
        storyId: 'STORY-HM-MID-MUTANT-THROW-CLEANUP',
        filesExpected: ['impl.js', 'impl.test.js'],
        testCommand: TEST_COMMAND,
        ecosystem: 'js' as const,
        integrationBase: 'HEAD',
        baseRevision: baseSha,
        clock: FAKE_CLOCK,
        createTempPath: UNUSED_TEMP_PATH,
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    ).catch(() => undefined);

    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 30_000);
});
