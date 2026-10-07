/**
 * `runHunkMutationCheck` — `specs/22` M16 P12's own "Tests first" section, against real git
 * repositories and a real vitest subprocess (this monorepo's own already-installed binary, the
 * identical `resolveRealVitestEntry` pattern `binding.test.ts` already establishes) — never a mocked
 * test tool or a simulated git history.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P12
 * @see process/SPEC-QUESTIONS.md Q294 Decision 8
 */
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { listOrphanedWorktrees } from '@forge/vcs';

import {
  runBindingCheck,
  type BindingCheckInput,
} from '../../../../src/commands/loop/test/binding.ts';
import {
  DEFAULT_MAX_HUNKS,
  runHunkMutationCheck,
  type HunkMutationEntry,
} from '../../../../src/commands/loop/test/hunk-mutation.ts';

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
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-hunk-mutation-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
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

async function headSha(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

let runCounter = 0;
function baseInput(projectRoot: string, storyId: string, baseRevision: string): BindingCheckInput {
  runCounter += 1;
  return {
    projectRoot,
    runId: `run-hm-${String(runCounter)}`,
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

function byPath(
  entries: readonly HunkMutationEntry[],
  filePath: string,
): readonly HunkMutationEntry[] {
  return entries.filter((entry) => entry.path === filePath);
}

describe('runHunkMutationCheck — one killed, one uncovered, in one implementation file (specs/22 M16 P12)', () => {
  it('names each by id and path: the test-exercised hunk is killed, the dead one is uncovered', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, {
      'impl.js':
        'export function add(a, b) {\n  return 0;\n}\n\nexport function sub(a, b) {\n  return 0;\n}\n',
    });
    const baseSha = await commit(dir, 'base: both functions are buggy stubs');
    await writeFiles(dir, {
      'impl.js':
        'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: fix add() and sub(), but only add() is tested');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-KILL-UNCOVER', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    if (result.outcome.outcome !== 'completed') {
      throw new Error(`expected 'completed', got ${result.outcome.outcome}`);
    }
    if (result.hunkMutation === undefined) throw new Error('expected a hunkMutation report');
    expect(result.hunkMutation.granularity).toBe('hunk');
    const implHunks = byPath(result.hunkMutation.hunks, 'impl.js');
    expect(implHunks).toHaveLength(2);

    const addHunk = implHunks.find((entry) => entry.verdict.kind === 'killed');
    const subHunk = implHunks.find((entry) => entry.verdict.kind === 'uncovered');
    if (addHunk === undefined || subHunk === undefined) {
      throw new Error(`expected one killed and one uncovered, got ${JSON.stringify(implHunks)}`);
    }
    if (addHunk.verdict.kind !== 'killed') throw new Error('unreachable');
    expect(addHunk.verdict.killedBy).toEqual(['adds']);
    // Every id is real and distinct -- `03` §3.2.5 row 117's own "the hunk's own id from P11".
    expect(addHunk.id).not.toBe(subHunk.id);
    expect(addHunk.id.length).toBeGreaterThan(0);
  }, 30_000);
});

describe('runHunkMutationCheck — a comment-only hunk (specs/22 M16 P12) (13 F-TEST-10)', () => {
  it('reads uncovered -- a named, deliberate sharp edge, not a bug', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, { 'impl.js': 'export function add(a, b) {\n  return a + b;\n}\n' });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, {
      'impl.js': '// adds two numbers together\nexport function add(a, b) {\n  return a + b;\n}\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: a comment, no behaviour change');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-COMMENT-ONLY', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    expect(result.hunkMutation.hunks).toHaveLength(1);
    expect(result.hunkMutation.hunks[0]?.verdict).toEqual({ kind: 'uncovered' });
  }, 30_000);
});

describe('runHunkMutationCheck — a hunk whose reversal leaves unbalanced syntax (specs/22 M16 P12) (13 F-TEST-10)', () => {
  it('reads invalid, never killed: the real test runner reports a load failure, proving nothing about an assertion', async () => {
    const dir = await freshRepo();
    // The story's own hunk is PURELY an inserted closing brace -- base is missing it entirely, so
    // reversing the hunk (removing that one line) leaves `mul` permanently unclosed.
    await writeFiles(dir, {
      'impl.js': 'export function mul(a, b) {\n  return a * b;\nexport const unused = 1;\n',
    });
    const baseSha = await commit(dir, 'base: a missing closing brace');
    await writeFiles(dir, {
      'impl.js': 'export function mul(a, b) {\n  return a * b;\n}\nexport const unused = 1;\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { mul } from './impl.js';\n" +
        "test('mul', () => { expect(mul(2, 3)).toBe(6); });\n",
    });
    await commit(dir, 'the story: close the brace');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-UNBALANCED-SYNTAX', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    expect(result.hunkMutation.hunks).toHaveLength(1);
    expect(result.hunkMutation.hunks[0]?.verdict).toEqual({
      kind: 'invalid',
      reason: 'load-failure',
    });
  }, 30_000);
});

describe('runHunkMutationCheck — a hung mutant (specs/22 M16 P12) (13 F-TEST-10)', () => {
  it('reads timeout, and the verb terminates near the declared bound', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, {
      'impl.js':
        'export function a_value() { return 0; }\n\nexport function b_value() { return 0; }\n',
    });
    const baseSha = await commit(dir, 'base: both buggy stubs');
    await writeFiles(dir, {
      'impl.js':
        'export function a_value() { return 1; }\n\nexport function b_value() { return 1; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { a_value, b_value } from './impl.js';\n" +
        "test('combo', () => {\n" +
        '  if (a_value() === 0 && b_value() === 1) {\n' +
        '    for (;;) { /* busy: only when hunk A alone is reverted */ }\n' +
        '  }\n' +
        '  expect(a_value() + b_value()).toBe(2);\n' +
        '});\n',
    });
    await commit(dir, 'the story: fix both stubs');

    const started = Date.now();
    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-HUNG-MUTANT', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
        timeoutMs: 3_000,
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(25_000);
    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    const hunks = result.hunkMutation.hunks;
    expect(hunks).toHaveLength(2);
    const verdictKinds = hunks.map((entry) => entry.verdict.kind).sort();
    // Hunk A (reverted alone) hangs; hunk B (reverted alone, A stays fixed) is a real, ordinary kill.
    expect(verdictKinds).toEqual(['killed', 'timeout']);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 40_000);
});

describe('runHunkMutationCheck — degrading above --max-hunks (specs/22 M16 P12) (13 F-TEST-10)', () => {
  it('degrades to granularity "file": every hunk of one file shares the one whole-file verdict', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, {
      'impl.js':
        'export function add(a, b) {\n  return 0;\n}\n\nexport function sub(a, b) {\n  return 0;\n}\n',
    });
    const baseSha = await commit(dir, 'base: two buggy stubs, one file');
    await writeFiles(dir, {
      'impl.js':
        'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add, sub } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n" +
        "test('subtracts', () => { expect(sub(3, 1)).toBe(2); });\n",
    });
    await commit(dir, 'the story: fix both, one file, two hunks');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-DEGRADE-FILE', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: 1 },
    );

    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    expect(result.hunkMutation.granularity).toBe('file');
    // Never samples: both real hunks are still named, never a dropped subset.
    const implHunks = byPath(result.hunkMutation.hunks, 'impl.js');
    expect(implHunks).toHaveLength(2);
    // One whole-file revert-and-run killed by BOTH tests at once -- the identical verdict shared.
    expect(implHunks[0]?.verdict).toEqual(implHunks[1]?.verdict);
    if (implHunks[0]?.verdict.kind !== 'killed') {
      throw new Error(`expected 'killed', got ${JSON.stringify(implHunks[0]?.verdict)}`);
    }
    expect([...implHunks[0].verdict.killedBy].sort()).toEqual(['adds', 'subtracts']);
  }, 30_000);

  it('degrades further to granularity "change": every hunk across every file shares the identical, already-computed change-level verdict', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, {
      'a.js': 'export function a_value() { return 0; }\n',
      'b.js': 'export function b_value() { return 0; }\n',
    });
    const baseSha = await commit(dir, 'base: two buggy stubs, two files');
    await writeFiles(dir, {
      'a.js': 'export function a_value() { return 1; }\n',
      'b.js': 'export function b_value() { return 1; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { a_value } from './a.js';\n" +
        "import { b_value } from './b.js';\n" +
        "test('combo', () => { expect(a_value() + b_value()).toBe(2); });\n",
    });
    await commit(dir, 'the story: fix both, two files, two hunks');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-DEGRADE-CHANGE', baseSha),
        filesExpected: ['a.js', 'b.js', 'impl.test.js'],
      },
      { maxHunks: 1 },
    );

    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    expect(result.hunkMutation.granularity).toBe('change');
    expect(result.hunkMutation.hunks).toHaveLength(2);
    // The SAME verdict on every hunk: the one, already-run whole-change mutant, relabelled.
    const verdict = result.hunkMutation.hunks[0]?.verdict;
    expect(result.hunkMutation.hunks[1]?.verdict).toEqual(verdict);
    if (verdict?.kind !== 'killed')
      throw new Error(`expected 'killed', got ${JSON.stringify(verdict)}`);
    expect(verdict.killedBy).toEqual(['combo']);
  }, 30_000);
});

describe('runHunkMutationCheck — the golden: --base equal to the default range (specs/22 M16 P12) (13 F-TEST-10)', () => {
  it('every M15 field is byte-identical to a plain runBindingCheck call against the identical input', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) {\n  return a + b;\n}\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    const plain = await runBindingCheck({
      ...baseInput(dir, 'STORY-GOLDEN', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
    });
    const hunked = await runHunkMutationCheck(
      { ...baseInput(dir, 'STORY-GOLDEN', baseSha), filesExpected: ['impl.js', 'impl.test.js'] },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    expect(hunked.outcome).toEqual(plain);
    if (hunked.hunkMutation === undefined) throw new Error('expected a hunkMutation report too');
    expect(hunked.hunkMutation.hunks.length).toBeGreaterThan(0);
  }, 30_000);
});

describe('runHunkMutationCheck — a change-level outcome that never reaches "completed" (specs/22 M16 P12)', () => {
  it('a failing baseline: hunkMutation is omitted entirely, and the plain outcome is unaffected by --hunks', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) {\n  return a + b;\n}\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('already broken', () => { expect(add(1, 2)).toBe(999); });\n",
    });
    await commit(dir, 'the story ships with a pre-existing failing test');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-FAILING-BASELINE', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    expect(result.outcome).toEqual({ outcome: 'baseline-not-green', failing: ['already broken'] });
    expect(result.hunkMutation).toBeUndefined();
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 30_000);

  it('no-test-paths: hunkMutation is omitted, and no lane is ever created', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, { 'impl.js': 'export function add(a, b) { return a + b; }\n' });
    await commit(dir, 'the story: only impl.js, no test path declared');

    const result = await runHunkMutationCheck(
      { ...baseInput(dir, 'STORY-NO-TEST-PATHS-HM', baseSha), filesExpected: ['impl.js'] },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    expect(result).toEqual({ outcome: { outcome: 'no-test-paths' } });
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});

/**
 * Round-2 gauntlet fix (`specs/22` M16 P13). A real, reachable state the first round missed: `--base`
 * resolved further back than the story's own implementation last really changed (checking whether a
 * newly-added test binds code that has not itself changed since that earlier point) makes
 * `computeHunks` find ZERO real hunks over `implementationPaths` while the change-level check still
 * reaches `'completed'` — the revert of an UNCHANGED path is a real no-op, so every named test reads
 * non-binding at the CHANGE level too (a real, correct signal the change-level check already gives),
 * but nothing before this fix stopped `runHunkMutants` from still returning a well-formed
 * `HunkMutationReport` with `hunks: []`. That report's own counts (`uncoveredHunks`, `invalidHunks`,
 * `timeoutHunks`, `skippedHunks`) are then ALL zero — observably IDENTICAL, to a project-authored
 * `failOn: 'uncoveredHunks > 0'` check reading only that one field, to "every hunk is genuinely
 * covered". `hunkRunSchema.hunks` has no `.min(1)` of its own (defence in depth is added there too,
 * `mutation-evidence.ts`), so nothing short of this engine-level guard previously stopped a real
 * `schemaVersion: 2`/`revert-hunks` record from being written in this exact state.
 *
 * DECISION: treated the identical way a change-level outcome that never reaches `'completed'` already
 * is (the describe block just above) — `hunkMutation` is omitted entirely, never a `revert-hunks`
 * record or a `--json` envelope with an empty `hunks: []`. This is a narrower, more honest signal than
 * "ran, found nothing": a project-authored check reading `uncoveredHunks` off a MISSING field fails
 * closed (`evaluateGate`'s own `unreliableFailOn`: a path the check output does not have can never
 * show success), the identical fail-closed stance `13` F-TEST-9's own parity-oracle counting algebra
 * already takes for "a check that would print no passing and no failing case" — reapplied here rather
 * than invented fresh. Rejected: writing `hunks: []` anyway (the exact vacuous-pass bug this fix
 * closes); a distinct new field such as `hunksComputed: 0` to let a careful gate author tell "nothing
 * to check" apart from "fully covered" (real schema/envelope surface for a case `--hunks` mode's own
 * report-only contract does not need to distinguish, since the change-level `incomplete`/`nonBinding`
 * fields already carry the real signal for this exact scenario, as the test below confirms); and a
 * typed refusal of the whole command (removes a real, legitimate diagnostic use — checking whether a
 * test binds code from an earlier point in history — for no compensating benefit).
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P13
 */
describe('runHunkMutationCheck — zero real hunks (specs/22 M16 P13)', () => {
  it('omits hunkMutation entirely when --base resolves further back than the implementation itself last changed, even though the change-level check reaches completed', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, { 'impl.js': 'export function add(a, b) {\n  return a + b;\n}\n' });
    const baseSha = await commit(
      dir,
      'base: a correct implementation already exists, untouched by this story',
    );
    await writeFiles(dir, {
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: only a new test lands; impl.js is byte-identical to baseSha');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-ZERO-HUNKS', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    if (result.outcome.outcome !== 'completed') {
      throw new Error(`expected 'completed', got ${result.outcome.outcome}`);
    }
    // The change-level check already gives the real, honest signal for this scenario: the test is
    // non-binding, because nothing was actually reverted (impl.js has zero diff over this range) --
    // a genuinely different fact from "every hunk is covered", which `incomplete > 0` (`bin.ts`)
    // correctly reports regardless of this fix.
    expect(result.outcome.namedTests).toEqual(['adds']);
    expect(result.outcome.failedUnderMutation).toEqual([]);
    // The real fix: no hunkMutation at all -- never a revert-hunks record or a --json envelope whose
    // all-zero counts would read as "fully covered" to a failOn: 'uncoveredHunks > 0' project check.
    expect(result.hunkMutation).toBeUndefined();
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 30_000);
});

describe('runHunkMutationCheck — a newly-added file (specs/22 M16 P12) (13 F-TEST-10)', () => {
  it('is one FileHunk, killed by its own load failure -- hunk mode cannot attribute finer than the file (pinned, disclosed)', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: adds a brand new module and its own test file');

    const result = await runHunkMutationCheck(
      { ...baseInput(dir, 'STORY-NEW-FILE', baseSha), filesExpected: ['impl.js', 'impl.test.js'] },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    expect(result.hunkMutation.hunks).toHaveLength(1);
    const entry = result.hunkMutation.hunks[0];
    if (entry?.verdict.kind !== 'killed') {
      throw new Error(
        `expected 'killed' (change-level credit for a FileHunk), got ${JSON.stringify(entry)}`,
      );
    }
    expect(entry.verdict.killedBy).toEqual(['adds']);
  }, 30_000);
});

describe('runHunkMutationCheck — cleanup on every exit path (specs/22 M16 P12)', () => {
  it('a normal, successful run removes the lane worktree and branch', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-HM-CLEANUP', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 30_000);

  // A throw mid-mutant (genuinely between two real hunk mutants, not merely "somewhere in the
  // function") is covered in its own file, `hunk-mutation-throw.test.ts`, the identical
  // `binding-restore-failure.test.ts` reason this module's own sibling test already states: no real
  // fixture can force `resetLaneWorktree` itself to fail while everything around it succeeds for
  // real, so that one file mocks `@forge/vcs`'s `resetLaneWorktree` alone, every other real export
  // (including the real `createLaneWorktree`/`removeLaneWorktree`/`revertPathsToRevision` this engine
  // still needs) untouched.
});

describe('runHunkMutationCheck — the lane is reset between mutants (specs/22 M16 P12) (13 F-TEST-10)', () => {
  it("a real contamination construction: hunk B reads uncovered, never killed by hunk A's own lingering reversal", async () => {
    // `a_value()`'s own hunk (BASE 999, a real break) is tested FIRST (file order); `uses_a` is
    // STABLE (never itself a hunk) and is what the one test actually calls; `b_value()`'s own hunk
    // (BASE 2) is tested SECOND and is never called by anything at all. If the lane is genuinely
    // reset back to HEAD before hunk B runs, `a_value()` is back at its real, fixed value (1) when
    // hunk B's own mutant runs, and the test passes (b_value is truly uncovered). If the reset were
    // ever skipped, hunk A's own break would still be active, and hunk B's test would fail for a
    // reason that has NOTHING to do with hunk B at all -- a false "killed" this test exists to catch.
    const dir = await freshRepo();
    await writeFiles(dir, {
      'impl.js':
        'export function a_value() { return 999; }\n\n' +
        'export function uses_a(x) { return x + a_value(); }\n\n' +
        'export function b_value() { return 2; }\n',
    });
    const baseSha = await commit(dir, 'base: a_value is broken, b_value is a stub');
    await writeFiles(dir, {
      'impl.js':
        'export function a_value() { return 1; }\n\n' +
        'export function uses_a(x) { return x + a_value(); }\n\n' +
        'export function b_value() { return 1; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { uses_a } from './impl.js';\n" +
        "test('uses_a', () => { expect(uses_a(5)).toBe(6); });\n",
    });
    await commit(dir, 'the story: fix a_value, and separately touch b_value (never called)');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-CONTAMINATION', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    const hunks = result.hunkMutation.hunks;
    expect(hunks).toHaveLength(2);
    const kinds = hunks.map((entry) => entry.verdict.kind).sort();
    // Hunk A (a_value, real and covered) is killed; hunk B (b_value, never called) is uncovered --
    // never BOTH killed, which is exactly what a skipped reset between mutants would produce (hunk
    // A's own lingering break making hunk B's unrelated test fail too).
    expect(kinds).toEqual(['killed', 'uncovered']);
  }, 30_000);
});

describe('runHunkMutationCheck — ranges and contentHash on every entry (specs/22 M16 P13)', () => {
  it('a TextHunk-driven entry carries its own real oldStart/oldCount/newStart/newCount and contentHash, zero re-derivation', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, {
      'impl.js':
        'export function add(a, b) {\n  return 0;\n}\n\nexport function sub(a, b) {\n  return 0;\n}\n',
    });
    const baseSha = await commit(dir, 'base: both functions are buggy stubs');
    await writeFiles(dir, {
      'impl.js':
        'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: fix add() and sub(), but only add() is tested');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-RANGES-TEXT', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    const implHunks = byPath(result.hunkMutation.hunks, 'impl.js');
    expect(implHunks).toHaveLength(2);
    for (const entry of implHunks) {
      // Real numeric ranges, never a sentinel -- this is the TextHunk case.
      expect(entry.ranges.old.start).toBeGreaterThanOrEqual(0);
      expect(entry.ranges.new.start).toBeGreaterThanOrEqual(0);
      expect(entry.ranges.new.length).toBeGreaterThan(0);
      expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // The two real hunks (add's own line, sub's own line) never share a contentHash or a range.
    expect(implHunks[0]?.contentHash).not.toBe(implHunks[1]?.contentHash);
    expect(implHunks[0]?.ranges).not.toEqual(implHunks[1]?.ranges);
  }, 30_000);

  it("a FileHunk-driven entry (a newly added file) carries the stated sentinel ranges {0,0}/{0,0} and reuses the FileHunk's own id as contentHash -- there is no sub-file range or separate hunk body to hash", async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { add } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: adds a brand new module and its own test file');

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-RANGES-FILE', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    expect(result.hunkMutation.hunks).toHaveLength(1);
    const entry = result.hunkMutation.hunks[0];
    if (entry === undefined) throw new Error('expected one entry');
    expect(entry.ranges).toEqual({ old: { start: 0, length: 0 }, new: { start: 0, length: 0 } });
    expect(entry.contentHash).toBe(entry.id);
    expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);
});

describe('runHunkMutationCheck — a per-mutant tool-error (specs/22 M16 P12) (13 F-TEST-10)', () => {
  it('reads skipped, naming the real tool-error message -- the run could not proceed, distinct from a failing baseline', async () => {
    // A real, hand-written fake test runner that counts its own real invocations on disk (the
    // identical, already-established `binding.test.ts` "fake-counting-vitest.mjs" technique): calls
    // 1-3 (baseline, the change-level mutated run, restore) report a real, well-formed pass; call 4
    // (the ONE hunk's own mutant run) prints genuinely unparseable output, a real `tool-error` this
    // engine has never seen before (distinct from `baseline-tool-error`/`mutated-tool-error`, which
    // only ever cover the change-level phases).
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, { 'impl.js': 'export function add(a, b) { return a + b; }\n' });
    await commit(dir, 'the story');
    const counterPath = path.join(dir, 'counter.txt');
    const fakeCmd = path.join(dir, 'fake-counting-vitest.mjs');
    await writeFile(
      fakeCmd,
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';\n" +
        `const counterPath = ${JSON.stringify(counterPath)};\n` +
        "let n = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;\n" +
        'n += 1;\n' +
        'writeFileSync(counterPath, String(n));\n' +
        'if (n === 4) {\n' +
        "  console.log('not valid json {{{');\n" +
        '} else {\n' +
        "  console.log(JSON.stringify({ testResults: [{ assertionResults: [{ title: 'adds', status: 'passed' }], status: 'passed', name: 'impl.test.js' }] }));\n" +
        '}\n',
      'utf8',
    );

    const result = await runHunkMutationCheck(
      {
        ...baseInput(dir, 'STORY-PER-MUTANT-TOOL-ERROR', baseSha),
        filesExpected: ['impl.js', 'impl.test.js'],
        testCommand: `${process.execPath} ${fakeCmd}`,
      },
      { maxHunks: DEFAULT_MAX_HUNKS },
    );

    if (result.outcome.outcome !== 'completed' || result.hunkMutation === undefined) {
      throw new Error(`expected 'completed' with a report, got ${result.outcome.outcome}`);
    }
    expect(result.hunkMutation.hunks).toHaveLength(1);
    const verdict = result.hunkMutation.hunks[0]?.verdict;
    if (verdict?.kind !== 'skipped')
      throw new Error(`expected 'skipped', got ${JSON.stringify(verdict)}`);
    expect(verdict.reason).toContain('tool-error');
  }, 30_000);
});
