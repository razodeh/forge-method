/**
 * `runBindingCheck` — the `'mutated-tool-error'`/`'restore-verification-tool-error'` outcomes
 * (`PLAN-M15.md` P3), covered here in-process because no REAL fixture can make `runAndNormalize`
 * fail outright on SPECIFICALLY the second or third call while the first (baseline) call succeeds for
 * real: the test command string is identical across all three calls, and the test FILE itself is
 * never reverted (`revertPathsToRevision` only ever touches implementation paths), so the only thing
 * that legitimately differs between calls is the implementation content a real test imports — never
 * whether the TOOL itself can produce a parseable report at all. `binding-restore-failure.test.ts`
 * already establishes the identical "mock the one dependency no real fixture can force, leave every
 * other real `@forge/vcs` export alone" pattern for `resetLaneWorktree`'s own unforceable failure;
 * this file applies it to `./reporter.ts`'s own `runAndNormalize` instead, call-counted so the first
 * (baseline) call still runs for real against a real vitest fixture and only the later ones are
 * canned.
 *
 * Also closes `forge test binding` subprocess tests' own real, unavoidable gap: `bin-binding.test.ts`
 * spawns the real CLI as a child process (`execFileSync`), which is the right test for "does the real
 * binary work end to end," but a child process is invisible to the parent's own V8 coverage
 * instrumentation — confirmed directly, not assumed (a scoped coverage run of only that file reported
 * 0% for `binding.ts`). Only an in-process call, like this file's, counts toward this module's own
 * measured coverage.
 *
 * @see specs/22 M15 P3
 * @see PLAN-M15.md P3
 */
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOrphanedWorktrees } from '@forge/vcs';

import type * as Reporter from '../../../../src/commands/loop/test/reporter.ts';

const { runAndNormalizeMock } = vi.hoisted(() => ({ runAndNormalizeMock: vi.fn() }));

vi.mock('../../../../src/commands/loop/test/reporter.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Reporter>();
  runAndNormalizeMock.mockImplementation(actual.runAndNormalize);
  return { ...actual, runAndNormalize: runAndNormalizeMock };
});

const { runBindingCheck } = await import('../../../../src/commands/loop/test/binding.ts');

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

/** A REAL vitest invocation — every call this file's own mock does not intercept with a canned
 * result delegates to the real `runAndNormalize`, which genuinely shells this command. */
const TEST_COMMAND = `${process.execPath} ${resolveRealVitestEntry()} run --root .`;
const UNUSED_TEMP_PATH = (): string => {
  throw new Error('createTempPath should not be called by the js/vitest branch');
};
const FAKE_CLOCK = { now: (): string => '2026-09-30T12:00:00.000Z' };

/** Builds a `runAndNormalize` mock implementation that lets the first `realCallCount` calls run for
 * real (delegated to the actual function, against a real subprocess) and returns `canned` for every
 * call after that — `onCall` records how many calls have happened so far, for the test's own
 * assertion that the canned outcome was reached on the expected call and not before. */
function delegateThenCan(
  realCallCount: number,
  canned: Reporter.RunAndNormalizeResult,
  onCall: (count: number) => void,
): (
  ...args: Parameters<typeof Reporter.runAndNormalize>
) => ReturnType<typeof Reporter.runAndNormalize> {
  let calls = 0;
  return async (...args) => {
    calls += 1;
    onCall(calls);
    if (calls > realCallCount) return canned;
    const actual = await vi.importActual<typeof Reporter>(
      '../../../../src/commands/loop/test/reporter.ts',
    );
    return actual.runAndNormalize(...args);
  };
}

const dirs: string[] = [];
afterEach(async () => {
  runAndNormalizeMock.mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-binding-tool-error-'));
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

describe('runBindingCheck — a mutated run whose own runAndNormalize call fails outright (specs/22 M16 P10)', () => {
  it('reports mutated-tool-error, never a binding verdict — the baseline call is still real', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    // Call 1 (baseline) is real; call 2 (the mutated/reverted run) is canned.
    let observedCalls = 0;
    runAndNormalizeMock.mockImplementation(
      delegateThenCan(
        1,
        { outcome: 'tool-error', message: 'simulated mutated-run failure' },
        (count) => {
          observedCalls = count;
        },
      ),
    );

    const result = await runBindingCheck({
      projectRoot: dir,
      runId: 'run-mutated-tool-error',
      storyId: 'STORY-MUTATED-TOOL-ERROR',
      filesExpected: ['impl.js', 'impl.test.js'],
      testCommand: TEST_COMMAND,
      ecosystem: 'js',
      integrationBase: 'HEAD',
      baseRevision: baseSha,
      clock: FAKE_CLOCK,
      createTempPath: UNUSED_TEMP_PATH,
    });

    expect(result).toEqual({
      outcome: 'mutated-tool-error',
      message: 'simulated mutated-run failure',
    });
    // Exactly 2: the real baseline call, then the canned mutated call — the restore step never ran.
    expect(observedCalls).toBe(2);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});

describe('runBindingCheck — a restore-verification run whose own runAndNormalize call fails outright (specs/22 M16 P10)', () => {
  it('reports restore-verification-tool-error, never conflating it with a binding verdict — baseline and mutated are still real', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    // Calls 1 (baseline) and 2 (mutated) are real; call 3 (restore verification) is canned.
    let observedCalls = 0;
    runAndNormalizeMock.mockImplementation(
      delegateThenCan(
        2,
        { outcome: 'tool-error', message: 'simulated restore-verification failure' },
        (count) => {
          observedCalls = count;
        },
      ),
    );

    const result = await runBindingCheck({
      projectRoot: dir,
      runId: 'run-restore-tool-error',
      storyId: 'STORY-RESTORE-TOOL-ERROR',
      filesExpected: ['impl.js', 'impl.test.js'],
      testCommand: TEST_COMMAND,
      ecosystem: 'js',
      integrationBase: 'HEAD',
      baseRevision: baseSha,
      clock: FAKE_CLOCK,
      createTempPath: UNUSED_TEMP_PATH,
    });

    expect(result).toEqual({
      outcome: 'restore-verification-tool-error',
      message: 'simulated restore-verification failure',
    });
    expect(observedCalls).toBe(3);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});
