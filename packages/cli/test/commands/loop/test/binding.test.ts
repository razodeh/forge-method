/**
 * `runBindingCheck` — `PLAN-M15.md` P3's own "Tests first" section, against real git repositories and
 * a real vitest subprocess (this monorepo's own already-installed binary, the identical
 * `resolveRealVitestEntry` pattern `reporter.test.ts` already establishes) — never a mocked test tool
 * or a simulated git history.
 *
 * @see specs/22 M15 P3
 * @see PLAN-M15.md P3
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { listOrphanedWorktrees, VcsError } from '@forge/vcs';

import {
  runBindingCheck,
  splitImplementationAndTestPaths,
  type BindingCheckInput,
} from '../../../../src/commands/loop/test/binding.ts';

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
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-binding-'));
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

async function commit(dir: string, message: string): Promise<string> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

/** `freshRepo` already made a real, non-empty-history init commit — this is that commit's own sha,
 * never a second, redundant "base" commit with nothing new to add (git refuses that outright). */
async function headSha(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

let runCounter = 0;
function baseInput(projectRoot: string, storyId: string, baseRevision: string): BindingCheckInput {
  runCounter += 1;
  return {
    projectRoot,
    runId: `run-${String(runCounter)}`,
    storyId,
    filesExpected: [],
    testCommand: TEST_COMMAND,
    ecosystem: 'js',
    integrationBase: 'HEAD',
    baseRevision,
    clock: FAKE_CLOCK,
    createTempPath: UNUSED_TEMP_PATH,
  };
}

describe('splitImplementationAndTestPaths', () => {
  it('separates test-shaped paths from implementation paths, via the shared isTestPath heuristic', () => {
    const result = splitImplementationAndTestPaths([
      'src/impl.ts',
      'src/impl.test.ts',
      'test/other.ts',
      'src/helper.ts',
    ]);
    expect(result.implementationPaths).toEqual(['src/impl.ts', 'src/helper.ts']);
    expect(result.testPaths).toEqual(['src/impl.test.ts', 'test/other.ts']);
  });
});

describe('runBindingCheck — a genuinely binding test', () => {
  it('reports the test as failing under mutation: it imports the implementation and asserts on it', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds two numbers', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: add()');

    const input = baseInput(dir, 'STORY-BIND', baseSha);
    const result = await runBindingCheck({
      ...input,
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect(result.namedTests).toEqual(['adds two numbers']);
    expect(result.failedUnderMutation).toEqual(['adds two numbers']);
    expect(result.restoreVerified).toBe(true);
  });
});

describe('runBindingCheck — a tautological test', () => {
  it('reports the test as non-binding, by name: it keeps passing with the implementation reverted', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
    });
    await commit(dir, 'the story: a tautological test');

    const input = baseInput(dir, 'STORY-TAUTOLOGY', baseSha);
    const result = await runBindingCheck({
      ...input,
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect(result.namedTests).toEqual(['tautology']);
    expect(result.failedUnderMutation).toEqual([]);
    expect(result.restoreVerified).toBe(true);
  });
});

describe('runBindingCheck — a test asserting only on a constant', () => {
  it('reports the test as non-binding: it never touches the implementation at all', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\ntest('constant', () => { expect(1).toBe(1); });\n",
    });
    await commit(dir, 'the story: a constant-only test');

    const input = baseInput(dir, 'STORY-CONSTANT', baseSha);
    const result = await runBindingCheck({
      ...input,
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect(result.failedUnderMutation).toEqual([]);
  });
});

describe('runBindingCheck — implementation lives in a different, un-reverted package', () => {
  it('correctly reports non-binding, not a crash: the test never depended on the reverted path', async () => {
    const dir = await freshRepo();
    // `stable.js` exists BEFORE the story and is never reverted (not named in filesExpected) -- the
    // test imports only this, never `unrelated-impl.js` (the story's own real files_expected entry).
    await writeFiles(dir, { 'stable.js': 'export function stable() { return 42; }\n' });
    const baseSha = await commit(dir, 'base: a stable helper exists already');
    await writeFiles(dir, {
      'unrelated-impl.js': 'export function neverImported() { return "irrelevant"; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { stable } from './stable.js';\ntest('uses only the stable helper', () => { expect(stable()).toBe(42); });\n",
    });
    await commit(dir, 'the story: adds unrelated-impl.js, never imported by its own test');

    const input = baseInput(dir, 'STORY-DIFFERENT-PACKAGE', baseSha);
    const result = await runBindingCheck({
      ...input,
      filesExpected: ['unrelated-impl.js', 'impl.test.js'],
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect(result.namedTests).toEqual(['uses only the stable helper']);
    expect(result.failedUnderMutation).toEqual([]);
    expect(result.restoreVerified).toBe(true);
  });
});

describe('runBindingCheck — a story whose tests are unchanged by revert, several at once', () => {
  it('names every non-binding test individually, never collapsing the list', async () => {
    // Three SEPARATE files, deliberately: `PLAN-M15.md` P3's own Discloses line ("binding to the
    // change as a whole, not per-hunk") means a non-binding test sharing a FILE with a binding test
    // that imports the reverted implementation is itself over-credited as binding too -- the whole
    // file fails to load once the import is gone, which is real, disclosed, honest v1 behaviour, not
    // a bug this test exists to re-litigate. Separate files isolate each test's own real verdict.
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'binding.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('binding: adds', () => { expect(add(1, 2)).toBe(3); });\n",
      'tautology.test.js':
        "import { test, expect } from 'vitest';\ntest('non-binding: tautology', () => { expect(true).toBe(true); });\n",
      'constant.test.js':
        "import { test, expect } from 'vitest';\ntest('non-binding: constant', () => { expect(2).toBe(2); });\n",
    });
    await commit(dir, 'the story');

    const input = baseInput(dir, 'STORY-MIXED', baseSha);
    const result = await runBindingCheck({
      ...input,
      filesExpected: ['impl.js', 'binding.test.js', 'tautology.test.js', 'constant.test.js'],
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect([...result.namedTests].sort()).toEqual(
      ['binding: adds', 'non-binding: tautology', 'non-binding: constant'].sort(),
    );
    expect(result.failedUnderMutation).toEqual(['binding: adds']);
  });
});

describe('runBindingCheck — a test already failing before any mutation', () => {
  it('reports baseline-not-green, naming the failing test, never attempting a binding verdict', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('already broken', () => { expect(add(1, 2)).toBe(999); });\n",
    });
    await commit(dir, 'the story ships with a pre-existing failing test');

    const input = baseInput(dir, 'STORY-ALREADY-RED', baseSha);
    const result = await runBindingCheck({
      ...input,
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    expect(result.outcome).toBe('baseline-not-green');
    if (result.outcome !== 'baseline-not-green') return;
    expect(result.failing).toEqual(['already broken']);
  });
});

describe('runBindingCheck — a story with no declared test paths at all', () => {
  it('refuses outright (no-test-paths), never silently running the whole project suite (M15 P3 round-1 critic finding)', async () => {
    // `runAndNormalize`'s own `files: []` reads identically to "no scoping at all" (reporter.ts's
    // runVitest) -- reproducing the round-1 critic's exact scenario: a project with an UNRELATED,
    // pre-existing test file that must never be discovered or run by this call at all.
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'unrelated.test.js':
        "import { test, expect } from 'vitest';\ntest('an unrelated, pre-existing test', () => { expect(true).toBe(true); });\n",
    });
    await commit(dir, 'the story: only impl.js, no test path declared');

    const input = baseInput(dir, 'STORY-NO-TEST-PATHS', baseSha);
    const result = await runBindingCheck({
      ...input,
      // No test-shaped path at all -- splitImplementationAndTestPaths's own testPaths will be [].
      filesExpected: ['impl.js'],
    });

    expect(result).toEqual({ outcome: 'no-test-paths' });
  });

  it('never creates a lane worktree for this refusal -- checked before any git operation', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, { 'impl.js': 'export function add(a, b) { return a + b; }\n' });
    await commit(dir, 'the story');

    await runBindingCheck({
      ...baseInput(dir, 'STORY-NO-TEST-PATHS-2', baseSha),
      filesExpected: ['impl.js'],
    });

    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});

describe('runBindingCheck — never mutates the main repository', () => {
  it('leaves the main working tree and HEAD completely untouched', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    const storySha = await commit(dir, 'the story');

    const result = await runBindingCheck({
      ...baseInput(dir, 'STORY-NO-SIDE-EFFECTS', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
    });
    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);

    const { stdout: headAfter } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    expect(headAfter.trim()).toBe(storySha);
    const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: dir });
    expect(status.trim()).toBe('');
    expect(existsSync(path.join(dir, 'impl.js'))).toBe(true);
  });

  it('removes the lane worktree and branch on every exit path, including a completed run', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    await runBindingCheck({
      ...baseInput(dir, 'STORY-CLEANUP', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});

describe('runBindingCheck — concurrency', () => {
  it('two binding runs for different stories at once do not collide', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    const [first, second] = await Promise.all([
      runBindingCheck({
        ...baseInput(dir, 'STORY-CONCURRENT-A', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      }),
      runBindingCheck({
        ...baseInput(dir, 'STORY-CONCURRENT-B', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      }),
    ]);

    if (first.outcome !== 'completed' || second.outcome !== 'completed') {
      throw new Error(`expected both 'completed', got ${first.outcome}/${second.outcome}`);
    }
    expect(first.failedUnderMutation).toEqual(['adds']);
    expect(second.failedUnderMutation).toEqual(['adds']);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });

  it('two concurrent runs for the SAME story and SAME runId: one completes, the other fails clean (a typed VcsError, never corrupted state)', async () => {
    // `createLaneWorktree`'s own real collision guard (packages/vcs/src/lanes.ts): two lane creations
    // for the identical (runId, stepId) pair collide on the branch name, surfaced as a VcsError -- the
    // exact hazard a round-1 gauntlet critic on this piece named as real, plausible, and untested (a
    // retry path or an operator re-running `forge test binding` for the same story while a prior
    // invocation is still in flight).
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    const sharedRunId = 'run-same-story-collision';
    const input: BindingCheckInput = {
      projectRoot: dir,
      runId: sharedRunId,
      storyId: 'STORY-SAME-COLLISION',
      filesExpected: ['impl.js', 'impl.test.js'],
      testCommand: TEST_COMMAND,
      ecosystem: 'js',
      integrationBase: 'HEAD',
      baseRevision: baseSha,
      clock: FAKE_CLOCK,
      createTempPath: UNUSED_TEMP_PATH,
    };

    const results = await Promise.allSettled([runBindingCheck(input), runBindingCheck(input)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(VcsError);

    // The surviving lane is still cleaned up normally; nothing is left dangling by the collision.
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});
