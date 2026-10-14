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
import type { StructuredTestCommand } from '@forge/schemas/config';
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

/** A REAL `createTempPath` (`QUALITY-BAR.md` R10's own injected-source requirement) for the one
 * structured-command test whose own `translate` needs FORGE to materialise captured stdout into a
 * real file (`runTranslator`'s own doc comment, `reporter.ts`) -- `UNUSED_TEMP_PATH` above is for
 * every OTHER test here, which never reaches that code path at all. */
let translatorTempCounter = 0;
function makeRealTempPath(dir: string): () => string {
  return () => path.join(dir, `tmp-translate-output-${String((translatorTempCounter += 1))}.raw`);
}

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

/** `baseInput`'s own structured-layer sibling (`specs/22` M17 P4) -- identical common fields, a
 * `structuredCommand` instead of the legacy `testCommand`/`ecosystem` pair. */
function structuredInput(
  projectRoot: string,
  storyId: string,
  baseRevision: string,
  structuredCommand: StructuredTestCommand,
): BindingCheckInput {
  runCounter += 1;
  return {
    projectRoot,
    runId: `run-${String(runCounter)}`,
    storyId,
    filesExpected: [],
    structuredCommand,
    integrationBase: 'HEAD',
    baseRevision,
    clock: FAKE_CLOCK,
    createTempPath: UNUSED_TEMP_PATH,
  };
}

/** A real, scoped structured `unit` layer (`specs/22` M17 P4): vitest's own native JSON reporter,
 * read directly (`format: 'vitest-json'`), with a `scope` template rendering `{files}` into a second
 * vitest invocation positionally scoped to exactly those files -- the identical real binary
 * `TEST_COMMAND` above already resolves, just through the structured form instead of the legacy
 * bare string. */
function structuredVitestCommand(): StructuredTestCommand {
  const base = `${process.execPath} ${REAL_VITEST_ENTRY} run --root . --reporter=json`;
  return {
    run: base,
    output: { source: 'stdout' },
    format: 'vitest-json',
    scope: `${base} {files}`,
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

describe('runBindingCheck — a structured execution.testCommands.unit entry (specs/22 M17 P4)', () => {
  it('with a declared "scope" template: runs for real and reports the identical binding verdict a legacy string would', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds two numbers', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: add()');

    const result = await runBindingCheck({
      ...structuredInput(dir, 'STORY-STRUCTURED-BIND', baseSha, structuredVitestCommand()),
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect(result.namedTests).toEqual(['adds two numbers']);
    expect(result.failedUnderMutation).toEqual(['adds two numbers']);
    expect(result.restoreVerified).toBe(true);
  }, 30_000);

  it('with NO "scope" template declared: a typed structured-layer-needs-scope refusal, before any lane is ever created', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds two numbers', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: add()');
    // The same real command `structuredVitestCommand()` builds, minus its own `scope` field --
    // written out directly rather than destructured away, so nothing here is declared and unused.
    const noScope: StructuredTestCommand = {
      run: `${process.execPath} ${REAL_VITEST_ENTRY} run --root . --reporter=json`,
      output: { source: 'stdout' },
      format: 'vitest-json',
    };

    const result = await runBindingCheck({
      ...structuredInput(dir, 'STORY-NO-SCOPE', baseSha, noScope),
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    expect(result).toEqual({ outcome: 'structured-layer-needs-scope' });
    // Cheap: checked before any git operation, the identical "no-test-paths" precedent above.
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });

  it('input.timeoutMs reaches a structured, scoped run too: a genuinely hung baseline is killed near the declared bound', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds two numbers', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: add()');
    const hungCommand: StructuredTestCommand = {
      run: `${process.execPath} -e "setTimeout(() => {}, 60000)"`,
      output: { source: 'stdout' },
      format: 'vitest-json',
      scope: `${process.execPath} -e "setTimeout(() => {}, 60000)"`,
    };
    const started = Date.now();

    const result = await runBindingCheck({
      ...structuredInput(dir, 'STORY-STRUCTURED-TIMEOUT', baseSha, hungCommand),
      filesExpected: ['impl.js', 'impl.test.js'],
      timeoutMs: 400,
    });

    // Killed near the declared 400ms bound, not left to run out `runStructuredTestLayer`'s own
    // default (`DEFAULT_TEST_RUN_TIMEOUT_MS`, 20 minutes) -- proof `input.timeoutMs` genuinely
    // reached the structured, `scope`-rendered run `runScopedLayer` dispatched to.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.outcome).toBe('baseline-timeout');
  }, 15_000);

  it('MUTATION EVIDENCE / regression (critic-reproduced): a "node --test via JUnit" whole-file crash on revert is credited as bound, never silently read as non-binding', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
      // `require`s `impl.js` at the TOP of the file, deliberately -- the exact, ordinary shape a
      // critic round reproduced directly: reverting `impl.js` (to nonexistent, at `baseSha`)
      // crashes the WHOLE FILE at `require`-time, before the real test even registers. Node's own
      // `--test-reporter=junit` reports this as one synthetic `<testcase name="impl.test.js">` --
      // named after the FILE, not the real test, with NO file attribute at all (confirmed directly;
      // `junit-xml.ts`'s own parser, P3's file, never reads one for pytest/Jest+jest-junit/this
      // monorepo's own Vitest/Node's own junit reporter either). Before `namesFailedUnderMutation`'s
      // own widened fallback (`specs/22` M17 P4), this unmatched, unattributed outcome was silently
      // DROPPED, reporting "adds two numbers" as non-binding even though the revert broke
      // everything -- the single most severe finding against this piece. This fixture is that exact
      // reproduction, kept deliberately crash-prone rather than defensively wrapped.
      'impl.test.js':
        "const test = require('node:test');\nconst assert = require('node:assert');\nconst { add } = require('./impl.js');\ntest('adds two numbers', () => { assert.strictEqual(add(1, 2), 3); });\n",
    });
    await commit(dir, 'the story: add(), run by node --test via JUnit');
    const nodeTestJunitCommand: StructuredTestCommand = {
      run: `${process.execPath} --test --test-reporter=junit`,
      output: { source: 'stdout' },
      format: 'junit-xml',
      scope: `${process.execPath} --test --test-reporter=junit {files}`,
    };

    const result = await runBindingCheck({
      ...structuredInput(dir, 'STORY-NODE-TEST-JUNIT', baseSha, nodeTestJunitCommand),
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect(result.namedTests).toEqual(['adds two numbers']);
    expect(result.failedUnderMutation).toEqual(['adds two numbers']);
    expect(result.restoreVerified).toBe(true);
  }, 30_000);

  it('MUTATION EVIDENCE / regression (second critic round, real reproduction): the project-wide fallback never over-credits a genuinely non-binding test that has its own, separately-observed passing outcome in the same run', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
      // Identical crash-on-revert shape as the sibling test above: this file's own whole-file
      // crash is what triggers `namesFailedUnderMutation`'s project-wide fallback.
      'impl.test.js':
        "const test = require('node:test');\nconst assert = require('node:assert');\nconst { add } = require('./impl.js');\ntest('adds two numbers', () => { assert.strictEqual(add(1, 2), 3); });\n",
      // A genuinely non-binding test, in its OWN, completely unaffected file -- never imports
      // impl.js, never crashes, reports its own real "pass" outcome in the identical mutated run
      // that ALSO contains the impl.test.js crash marker above. Before the fallback's own
      // `confirmedPassing` exclusion (`specs/22` M17 P4, a second critic round's own direct
      // construction), this test was swept up as "bound" purely because an UNRELATED file in the
      // same run happened to crash -- the exact false "this is bound" result `test:binding` exists
      // to prevent, the mirror image of the original silent-drop bug.
      'tautology.test.js':
        "const test = require('node:test');\nconst assert = require('node:assert');\ntest('a pure tautology', () => { assert.strictEqual(true, true); });\n",
    });
    await commit(dir, 'the story: add(), plus an unrelated, genuinely non-binding tautology');
    const nodeTestJunitCommand: StructuredTestCommand = {
      run: `${process.execPath} --test --test-reporter=junit`,
      output: { source: 'stdout' },
      format: 'junit-xml',
      scope: `${process.execPath} --test --test-reporter=junit {files}`,
    };

    const result = await runBindingCheck({
      ...structuredInput(dir, 'STORY-TAUTOLOGY-UNRELATED-CRASH', baseSha, nodeTestJunitCommand),
      filesExpected: ['impl.js', 'impl.test.js', 'tautology.test.js'],
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect([...result.namedTests].sort()).toEqual(['a pure tautology', 'adds two numbers']);
    // The real, crashed test is still correctly credited (the original fix still holds)...
    expect(result.failedUnderMutation).toContain('adds two numbers');
    // ...but the unrelated, genuinely non-binding tautology is NOT swept up by the fallback.
    expect(result.failedUnderMutation).not.toContain('a pure tautology');
    expect(result.failedUnderMutation).toEqual(['adds two numbers']);
  }, 30_000);

  it('a mutated outcome with a DEFINED file value that matches no file the baseline ever saw hits the same project-wide fallback as "no file at all", never silently dropped', async () => {
    // A direct, fully-controlled `forge-json` construction (never a real tool's own quirk) --
    // targets the specific sub-case a critic round mutation-tested and found correct but
    // unguarded: `outcome.file !== undefined`, but `namedTestsByFile.get(outcome.file)` itself
    // returns `undefined` because the baseline never reported that file at all (as opposed to
    // `outcome.file === undefined`, the sub-case every other test in this describe block already
    // covers).
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
      'impl.test.js': '// a placeholder: this in-house runner never reads this file\n',
      'run-report.cjs': `
const fs = require('fs');
const exists = fs.existsSync('impl.js');
const report = exists
  ? { forgeTestReport: 1, tests: [{ name: 'adds two numbers', status: 'pass', file: 'impl.test.js' }] }
  : { forgeTestReport: 1, tests: [{ name: 'UNRECOGNIZED', status: 'fail', file: 'a-file-the-baseline-never-saw.js' }] };
console.log(JSON.stringify(report));
`,
    });
    await commit(dir, 'the story: add(), run by an in-house runner reporting a real file field');
    const customRunnerCommand: StructuredTestCommand = {
      run: `${process.execPath} run-report.cjs`,
      output: { source: 'stdout' },
      format: 'forge-json',
      scope: `${process.execPath} run-report.cjs`,
    };

    const result = await runBindingCheck({
      ...structuredInput(dir, 'STORY-UNRECOGNIZED-FILE', baseSha, customRunnerCommand),
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect(result.namedTests).toEqual(['adds two numbers']);
    expect(result.failedUnderMutation).toEqual(['adds two numbers']);
    expect(result.restoreVerified).toBe(true);
  }, 30_000);

  it('a "custom runner via translator" structured command flows through the real baseline/mutated/restore lifecycle (PLAN-M17.md P4\'s own "Tests first" line, third of three runner configs)', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        '// a placeholder: this in-house runner below has its own idiosyncratic invocation, never reads this file\n',
      'run-tests.cjs': `
const fs = require('fs');
let pass = false;
try {
  const content = fs.readFileSync('impl.js', 'utf8');
  pass = content.includes('a + b');
} catch (e) { pass = false; }
console.log('RESULT:' + (pass ? 'PASS' : 'FAIL') + ':adds two numbers');
`,
      'translate.cjs': `
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8').trim();
const parts = raw.split(':');
process.stdout.write(JSON.stringify({ forgeTestReport: 1, tests: [{ name: parts[2], status: parts[1] === 'PASS' ? 'pass' : 'fail' }] }));
`,
    });
    await commit(dir, 'the story: add(), run by an in-house runner with its own raw format');
    const customRunnerCommand: StructuredTestCommand = {
      run: `${process.execPath} run-tests.cjs`,
      output: { source: 'stdout' },
      format: 'tap', // irrelevant: translate, when present, always wins over format.
      translate: `${process.execPath} translate.cjs {output}`,
      // This in-house runner ignores {files} entirely (it always checks the one impl.js it knows
      // about) -- declared anyway so canScopeTestLayer passes; `{files}` genuinely narrowing a run
      // is already proven by this file's own dedicated "declared scope template" test above.
      scope: `${process.execPath} run-tests.cjs`,
    };

    const result = await runBindingCheck({
      ...structuredInput(dir, 'STORY-CUSTOM-RUNNER', baseSha, customRunnerCommand),
      filesExpected: ['impl.js', 'impl.test.js'],
      // `output.source: 'stdout'` + a declared `translate`: FORGE materialises the captured
      // stdout into a real file for the translator (`runTranslator`'s own doc comment,
      // `reporter.ts`) -- needs a REAL `createTempPath`, unlike every other test in this
      // describe block, which never reaches that code path.
      createTempPath: makeRealTempPath(dir),
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect(result.namedTests).toEqual(['adds two numbers']);
    expect(result.failedUnderMutation).toEqual(['adds two numbers']);
    expect(result.restoreVerified).toBe(true);
  }, 30_000);
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

// --- specs/22 M16 P10: the vitest/pytest load-failure asymmetry, and the two timeout outcomes -----

const PYTEST_COMMAND = 'pytest -q';

let junitCounter = 0;
/** A real, unique junit-xml temp path per pytest invocation — `UNUSED_TEMP_PATH` above is only valid
 * for the js/vitest branch, which never calls this. */
function createPythonTempPath(dir: string): () => string {
  return () => {
    junitCounter += 1;
    return path.join(dir, `junit-${String(junitCounter)}`);
  };
}

describe('runBindingCheck — the vitest/pytest load-failure asymmetry (specs/22 M16 P10) (13 F-TEST-10)', () => {
  // One shared test, looped over both ecosystems with an EQUIVALENT fixture shape, per the piece's own
  // brief: "so a regression in either runner's path is caught by one test, not two that could silently
  // diverge." The shape is the exact one `13` F-TEST-10 and M15's shipped vitest behaviour already
  // credit: a BRAND NEW module (does not exist at `baseRevision` at all) whose own test imports it —
  // reverting to base does not just change behaviour, it REMOVES the file outright
  // (`revertPathsToRevision`'s own "or removal when the file is new"), so the test's own import fails
  // to resolve, not merely a changed return value.
  const cases: readonly {
    readonly ecosystem: 'js' | 'python';
    readonly testCommand: string;
    readonly implPath: string;
    readonly testPath: string;
    readonly implContent: string;
    readonly testContent: string;
    readonly expectedNames: readonly string[];
  }[] = [
    {
      ecosystem: 'js',
      testCommand: TEST_COMMAND,
      implPath: 'impl.js',
      testPath: 'impl.test.js',
      implContent:
        'export function add(a, b) { return a + b; }\nexport function sub(a, b) { return a - b; }\n',
      testContent:
        "import { test, expect } from 'vitest';\n" +
        "import { add, sub } from './impl.js';\n" +
        "test('adds', () => { expect(add(1, 2)).toBe(3); });\n" +
        "test('subtracts', () => { expect(sub(3, 1)).toBe(2); });\n",
      expectedNames: ['adds', 'subtracts'],
    },
    {
      // `impl_test.py`, not `test_impl.py`: `isTestPath` (`@forge/engine/dispatch`,
      // `splitImplementationAndTestPaths`'s own heuristic) only recognises the Python SUFFIX
      // convention (`_test\.[a-z]+$`), not the equally-real, pytest-discovered PREFIX convention
      // (`test_*.py`) every other pytest fixture in this file's own sibling `reporter.test.ts` uses —
      // confirmed directly (a round of this exact test with `test_impl.py` instead refused
      // `'no-test-paths'`, a real, pre-existing, out-of-scope limitation of that heuristic, not a bug
      // this piece's own Mandate covers). pytest itself discovers both (`python_files` defaults to
      // `test_*.py *_test.py`), so `impl_test.py` is still real, ordinary, pytest-collected input.
      ecosystem: 'python',
      testCommand: PYTEST_COMMAND,
      implPath: 'impl.py',
      testPath: 'impl_test.py',
      implContent: 'def add(a, b):\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n',
      testContent:
        'from impl import add, sub\n\n\ndef test_adds():\n    assert add(1, 2) == 3\n\n\ndef test_subtracts():\n    assert sub(3, 1) == 2\n',
      expectedNames: ['test_adds', 'test_subtracts'],
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.ecosystem}: a revert that removes a brand new module credits EVERY baseline-passing test in its own test file as bound`, async () => {
      const dir = await freshRepo();
      // The module does not exist at all at `baseSha` — the revert below removes it outright.
      const baseSha = await headSha(dir);
      await writeFiles(dir, {
        [testCase.implPath]: testCase.implContent,
        [testCase.testPath]: testCase.testContent,
      });
      await commit(dir, 'the story: adds a brand new module and its own test file');

      const result = await runBindingCheck({
        projectRoot: dir,
        runId: `run-asymmetry-${testCase.ecosystem}`,
        storyId: `STORY-ASYMMETRY-${testCase.ecosystem.toUpperCase()}`,
        filesExpected: [testCase.implPath, testCase.testPath],
        testCommand: testCase.testCommand,
        ecosystem: testCase.ecosystem,
        integrationBase: 'HEAD',
        baseRevision: baseSha,
        clock: FAKE_CLOCK,
        createTempPath:
          testCase.ecosystem === 'python' ? createPythonTempPath(dir) : UNUSED_TEMP_PATH,
      });

      if (result.outcome !== 'completed') {
        throw new Error(`expected 'completed', got ${result.outcome}`);
      }
      expect([...result.namedTests].sort()).toEqual([...testCase.expectedNames].sort());
      // The real proof: EVERY one of this file's own baseline-passing tests is credited, exactly as
      // vitest's own shipped M15 behaviour already did — before this piece's fix, the pytest row of
      // this same table credited NOTHING (an empty array), which is the asymmetry this test exists to
      // close.
      expect([...result.failedUnderMutation].sort()).toEqual([...testCase.expectedNames].sort());
      expect(result.restoreVerified).toBe(true);
    });
  }
});

describe('runBindingCheck — a baseline that times out (specs/22 M16 P10)', () => {
  it('reports the typed, distinct "baseline-timeout" outcome, never "baseline-not-green"', async () => {
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      // A synchronous, unconditional infinite loop — unlike an unresolved Promise, this blocks the
      // WHOLE worker's event loop (vitest's own per-test timeout relies on `setTimeout`, which this
      // starves), so only an external process-group kill can ever end it. Hangs at BASELINE
      // (unmutated, HEAD state) regardless of the implementation, so this check never even reaches a
      // revert.
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('hangs forever', () => { expect(add(1, 2)).toBe(3); for (;;) { /* busy */ } });\n",
    });
    await commit(dir, 'the story: a test that hangs forever at baseline');

    const started = Date.now();
    const result = await runBindingCheck({
      ...baseInput(dir, 'STORY-BASELINE-TIMEOUT', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
      timeoutMs: 3_000,
    });
    const elapsedMs = Date.now() - started;

    // Well under what an untimed hang would take (it would never return at all) — proves the kill
    // actually fired near the declared bound, not merely that the function eventually resolved.
    expect(elapsedMs).toBeLessThan(15_000);
    expect(result).toEqual({ outcome: 'baseline-timeout' });
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 30_000);
});

describe('runBindingCheck — a mutated (reverted) run that times out (specs/22 M16 P10)', () => {
  it('reports the typed, distinct "mutated-timeout" outcome and credits NOTHING as bound', async () => {
    const dir = await freshRepo();
    // `impl.js` hangs at BASE (the revert target) and resolves normally at HEAD (the story's own
    // implementation) — baseline (HEAD, unmutated) passes quickly; the revert sends the test back to
    // the hanging version, so only the MUTATED run ever hangs.
    await writeFiles(dir, {
      'impl.js':
        'export function add(a, b) { for (;;) { /* busy: this base version never returns */ } }\n',
    });
    const baseSha = await commit(dir, 'base: add() hangs forever');
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story: add() now returns immediately');

    const started = Date.now();
    const result = await runBindingCheck({
      ...baseInput(dir, 'STORY-MUTATED-TIMEOUT', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
      timeoutMs: 3_000,
    });
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(20_000);
    expect(result).toEqual({ outcome: 'mutated-timeout' });
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 40_000);

  it('MUTATION-TARGET PROOF: without the dedicated check, a timed-out mutated run falls through to "completed" with nothing credited — asserting BOTH facts so the dedicated-outcome mutation (#4) has something real to break', async () => {
    // This test exists so the brief's own mutation evidence item 4 ("classify a mutated-run timeout
    // as 'fail' and credit it as bound") has a real assertion to falsify: it pins the CURRENT, correct
    // behaviour (a distinct outcome tag) precisely so that removing the dedicated check in
    // `runBindingCheck` — which would make this fall through to `namesFailedUnderMutation` instead —
    // changes the OUTCOME TAG itself from `'mutated-timeout'` to `'completed'`, a difference this
    // assertion catches even though `failedUnderMutation` would stay `[]` either way (the synthetic
    // timeout outcome's own missing `file` already prevents crediting on its own, structurally).
    const dir = await freshRepo();
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { for (;;) { /* busy */ } }\n',
    });
    const baseSha = await commit(dir, 'base: add() hangs forever');
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');

    const result = await runBindingCheck({
      ...baseInput(dir, 'STORY-MUTATED-TIMEOUT-PROOF', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
      timeoutMs: 3_000,
    });

    expect(result.outcome).toBe('mutated-timeout');
  }, 40_000);
});

describe('runBindingCheck — ONLY the restore-verification run hangs (specs/22 M16 P10)', () => {
  it('baseline and mutated both complete normally and quickly; restoreVerified is false, never true or a hang, when only the THIRD run hangs', async () => {
    // Decision 4 (the piece's own report): a restore-run timeout gets no dedicated outcome of its
    // own, folded instead into `restoreVerified: false` -- reasoned from the synthetic timeout
    // outcome's own `status: 'fail'` making `.every(... === 'pass')` false. Proven here with a REAL
    // hang isolated to ONLY the third (restore) run: a counter file on disk, read and incremented by
    // the test itself (never reverted -- `revertPathsToRevision` only ever touches implementation
    // paths), busy-loops on the third invocation only. Calls 1 (baseline, HEAD state) and 2 (mutated,
    // reverted to base) both complete fast and for real; only call 3 (restore, back to HEAD state)
    // hangs.
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    const counterPath = path.join(dir, 'restore-hang-counter.txt');
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\n" +
        "import { existsSync, readFileSync, writeFileSync } from 'node:fs';\n" +
        `const counterPath = ${JSON.stringify(counterPath)};\n` +
        "test('adds', () => {\n" +
        "  let n = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0;\n" +
        '  n += 1;\n' +
        '  writeFileSync(counterPath, String(n));\n' +
        '  if (n >= 3) { for (;;) { /* busy: only the THIRD (restore) run reaches this */ } }\n' +
        '  expect(1).toBe(1);\n' +
        '});\n',
    });
    await commit(dir, 'the story');

    const started = Date.now();
    const result = await runBindingCheck({
      ...baseInput(dir, 'STORY-RESTORE-ONLY-HANG', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
      timeoutMs: 3_000,
    });
    const elapsedMs = Date.now() - started;

    // Well under what an UN-timed hang would take (it would never return at all) -- proves the kill
    // fired near the declared 3s bound for the restore run specifically.
    expect(elapsedMs).toBeLessThan(15_000);
    if (result.outcome !== 'completed') {
      throw new Error(
        `expected 'completed' (baseline and mutated both ran for real), got ${result.outcome}`,
      );
    }
    // Baseline (call 1) genuinely ran and passed, so this check's own "completed" shape is reached
    // honestly, not vacuously -- confirming calls 1 and 2 were real, fast, and uninterrupted.
    expect(result.namedTests).toEqual(['adds']);
    expect(result.restoreVerified).toBe(false);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 30_000);
});

describe('runBindingCheck — a run that completes but matches or collects zero tests (specs/22 M16 P10)', () => {
  it('a fake command that prints valid JSON with no real "testResults" array is a baseline-tool-error, never a vacuous "completed" pass', async () => {
    // The critic's own exact repro: `{}` is valid JSON but not a real vitest report at all --
    // `reporter.ts`'s own shape-validation (M16 P10) now refuses it outright as a tool-error, before
    // this ever reaches the dedicated zero-outcomes guard below (a genuinely different, well-formed
    // empty report, not a malformed one).
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n',
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'the story');
    const fakeCmd = path.join(dir, 'fake-unit.mjs');
    await writeFile(fakeCmd, 'console.log(JSON.stringify({}));', 'utf8');

    const result = await runBindingCheck({
      ...baseInput(dir, 'STORY-FAKE-EMPTY-JSON', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
      testCommand: `${process.execPath} ${fakeCmd}`,
    });

    expect(result.outcome).toBe('baseline-tool-error');
    expect(result).not.toEqual(
      expect.objectContaining({ outcome: 'completed', namedTests: [], failedUnderMutation: [] }),
    );
  });

  it('a real baseline run whose own testPaths resolves to no real file on disk is baseline-zero-outcomes, never a vacuous "completed" pass', async () => {
    // Confirmed directly: a real vitest invocation whose positional file argument matches nothing on
    // disk still exits with a genuine, well-formed, EMPTY `testResults: []` -- not an error of any
    // kind `reporter.ts`'s own shape-validation (M16 P10) can or should catch, since it is not
    // malformed, just empty.
    const dir = await freshRepo();
    const baseSha = await headSha(dir);
    await writeFiles(dir, { 'impl.js': 'export function add(a, b) { return a + b; }\n' });
    await commit(dir, 'the story');

    const result = await runBindingCheck({
      ...baseInput(dir, 'STORY-BASELINE-ZERO-OUTCOMES', baseSha),
      // `impl.test.js` is declared but does not exist on disk at all.
      filesExpected: ['impl.js', 'impl.test.js'],
    });

    expect(result).toEqual({ outcome: 'baseline-zero-outcomes' });
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });

  it('a mutated run that matches or collects zero tests, after a real, non-empty baseline, is mutated-zero-outcomes, crediting nothing', async () => {
    // No natural vitest/pytest fixture reaches this (a test FILE is never reverted, so its own
    // collection behaviour cannot legitimately change between baseline and mutated) -- a real, hand-
    // written fake test runner that counts its own real invocations on disk, so the first (baseline)
    // call reports a real, passing test and every call after it reports a real, well-formed, EMPTY
    // report. A genuinely different, more "real" stand-in than mocking `runAndNormalize`, since this
    // is a real subprocess producing real, varying stdout.
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
        'const report = n === 1\n' +
        "  ? { testResults: [{ assertionResults: [{ title: 'adds', status: 'passed' }], status: 'passed', name: 'impl.test.js' }] }\n" +
        '  : { testResults: [] };\n' +
        'console.log(JSON.stringify(report));\n',
      'utf8',
    );

    const result = await runBindingCheck({
      ...baseInput(dir, 'STORY-MUTATED-ZERO-OUTCOMES', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
      testCommand: `${process.execPath} ${fakeCmd}`,
    });

    expect(result).toEqual({ outcome: 'mutated-zero-outcomes' });
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });

  it('a restore-verification run that matches or collects zero tests is restoreVerified: false, never vacuously true', async () => {
    // `[].every(...)` is vacuously `true` in JS -- the same class of bug the mutated/baseline checks
    // above close, here at the THIRD phase, which `runBindingCheck` folds into the existing boolean
    // rather than a dedicated outcome (symmetric with how a restore-timeout is already handled).
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
        'const report = n <= 2\n' +
        "  ? { testResults: [{ assertionResults: [{ title: 'adds', status: 'passed' }], status: 'passed', name: 'impl.test.js' }] }\n" +
        '  : { testResults: [] };\n' +
        'console.log(JSON.stringify(report));\n',
      'utf8',
    );

    const result = await runBindingCheck({
      ...baseInput(dir, 'STORY-RESTORE-ZERO-OUTCOMES', baseSha),
      filesExpected: ['impl.js', 'impl.test.js'],
      testCommand: `${process.execPath} ${fakeCmd}`,
    });

    if (result.outcome !== 'completed')
      throw new Error(`expected 'completed', got ${result.outcome}`);
    expect(result.restoreVerified).toBe(false);
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});
