/**
 * `forge test binding --story <id> [--json]` (`specs/22` M15 P4) — real subprocess tests, the
 * `bin.test.ts` style `PLAN-M15.md` P4's own "Tests first" line requires: a real, spawned `forge`
 * process against a real, throwaway git project, never a direct function call.
 *
 * @see specs/22 M15 P4
 * @see PLAN-M15.md P4
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { listOrphanedWorktrees } from '@forge/vcs';

const LAUNCHER = fileURLToPath(new URL('../../../../bin/forge.mjs', import.meta.url));

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

const TEST_COMMAND = `${process.execPath} ${resolveRealVitestEntry()} run --root .`;

function run(
  args: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string>>,
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args, '-C', cwd], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const execError = error as {
      readonly status: number | null;
      readonly stdout: string;
      readonly stderr: string;
    };
    return { status: execError.status ?? 1, stdout: execError.stdout, stderr: execError.stderr };
  }
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function storyFixture(
  filesExpected: readonly string[],
  status = 'ready',
  id = 'STORY-001',
): string {
  return `---
id: ${id}
type: Story
schemaVersion: 1
title: Fixture story
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
status: ${status}
owner_role: developer
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected:
${filesExpected.map((file) => `  - ${file}`).join('\n')}
context_refs: []
acceptance:
  - id: AC-001-1
    given: two numbers
    when: add is called
    then: the sum is returned
    kind: functional
tests: []
dod_profile: default
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
---

Fixture story body.
`;
}

/** A real git project: a base commit (the story, no implementation yet) and — unless `implAtBase` —
 * a second commit adding `impl.js`/`impl.test.js`, so `HEAD~1` genuinely lacks the implementation
 * `forge test binding`'s own default `baseRevision` reverts back to. */
async function freshProject(
  options: {
    readonly filesExpected?: readonly string[];
    readonly testBody?: string;
    readonly implAtBase?: boolean;
    readonly skipImpl?: boolean;
    readonly skipPackageJson?: boolean;
    readonly skipTestCommand?: boolean;
    // `specs/22` M17 P4: a plain string (legacy, unchanged) or a structured `testCommands.unit`
    // entry -- `Record<string, unknown>` rather than the real `StructuredTestCommand` type, since
    // `YAML.stringify` only needs a plain, serialisable object and importing the real type here
    // would buy no extra safety this test fixture needs.
    readonly testCommandOverride?: string | Readonly<Record<string, unknown>>;
    readonly status?: string;
  } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-binding-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });

  if (!options.skipPackageJson) {
    await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
  }
  const config = {
    ...DEFAULT_CONFIG,
    execution: {
      ...DEFAULT_CONFIG.execution,
      testCommands: options.skipTestCommand
        ? {}
        : { unit: options.testCommandOverride ?? TEST_COMMAND },
    },
  };
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/kb'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/plans'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/sessions'), { recursive: true });
  await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
    storyFixture(options.filesExpected ?? ['impl.js', 'impl.test.js'], options.status),
    'utf8',
  );

  const testBody =
    options.testBody ??
    "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n";
  if (options.implAtBase) {
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    if (!options.skipImpl) await writeFile(path.join(dir, 'impl.test.js'), testBody, 'utf8');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'base: story and implementation together'], {
      cwd: dir,
    });
    return dir;
  }

  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base: story exists, no implementation yet'], {
    cwd: dir,
  });
  if (!options.skipImpl) {
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(path.join(dir, 'impl.test.js'), testBody, 'utf8');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: implement add()'], { cwd: dir });
  }
  return dir;
}

describe('forge test binding — a genuinely binding suite', () => {
  it('exits 0 with a real v1 JSON envelope, naming the evidence id', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly v: number;
      readonly passed: boolean;
      readonly bound: readonly string[];
      readonly nonBinding: readonly string[];
      readonly exempt: boolean;
      readonly evidenceId: string;
      readonly tests: readonly { readonly name: string; readonly binding: boolean }[];
    };
    expect(parsed.v).toBe(1);
    expect(parsed.passed).toBe(true);
    expect(parsed.bound).toEqual(['adds']);
    expect(parsed.nonBinding).toEqual([]);
    expect(parsed.exempt).toBe(false);
    expect(parsed.evidenceId).toMatch(/^MUT-\d{3}$/);
    // A round-3 gauntlet critic (M15 P4) proved by mutation that `tests`' own per-test `binding`
    // field was asserted nowhere: flipping it to its exact logical opposite still passed every test.
    expect(parsed.tests).toEqual([{ name: 'adds', binding: true }]);
  }, 30_000);

  it('--json stdout is exactly one line', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
  }, 30_000);
});

// `specs/22` M15 P11 metric 1: the real CLI wiring, end to end through a genuine subprocess -- a real
// FORGE_RUN_ID in the child's own env reaches `runOneStoryBinding`'s own telemetry emission.
describe('forge test binding — telemetry (specs/22 M15 P11)', () => {
  it('a real FORGE_RUN_ID in the environment reaches a real CheckRun {kind: "binding"} event on disk', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir, {
      FORGE_RUN_ID: 'run-cli-binding',
    });

    expect(result.status).toBe(0);
    const { readEvents } = await import('@forge/telemetry/events');
    const events = [];
    for await (const event of readEvents(dir, 'run-cli-binding')) events.push(event);
    const checkRuns = events.filter((event) => event.type === 'CheckRun');
    expect(checkRuns).toHaveLength(1);
    expect(checkRuns[0]?.payload).toMatchObject({
      kind: 'binding',
      storyId: 'STORY-001',
      testsNamed: 1,
      bound: 1,
      nonBinding: 0,
      exempted: 0,
    });
  }, 30_000);

  it('no FORGE_RUN_ID at all (the ordinary, standalone human invocation): no run directory is ever created', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(0);
    const { pathExists } = await import('@forge/core/fs');
    const { ProjectPaths } = await import('@forge/core/fs');
    expect(await pathExists(new ProjectPaths(dir).resolveState('runs'))).toBe(false);
  }, 30_000);
});

describe('forge test binding — a failed restore-verification (specs/22 M15 P5)', () => {
  it('exits 1, passed:false, incomplete>0, even though nonBinding stays empty -- the exact mechanism round 1/2 were BLOCKING on', async () => {
    // A round-3 gauntlet critic (M15 P5) found `incomplete`'s own `restoreVerified` contribution
    // (`runSingleStoryBindingCommand`) had no test anywhere exercising it through the real CLI -- every
    // existing `restoreVerified: false` test exercised `forge story verify`'s own, structurally
    // different `checkBinding` function instead. A real (non-mocked), isolated repro: one test that is
    // BOTH genuinely binding (fails under a real implementation revert) AND, independently, fails again
    // on its own third invocation within the same lane worktree via a `.gitignore`'d counter surviving
    // `resetLaneWorktree`'s own `git clean -fd` (skips gitignored paths without `-x`) -- so it fails
    // under mutation for the real reason (binding, `nonBinding` stays empty) and ALSO fails the
    // post-restore verification run for an unrelated, worktree-contamination reason, isolating
    // `restoreVerified`'s own contribution to `incomplete` cleanly from `nonBinding`'s.
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-binding-restore-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
    await writeFile(path.join(dir, '.gitignore'), '.sentinel-count\n', 'utf8');
    const config = {
      ...DEFAULT_CONFIG,
      execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: TEST_COMMAND } },
    };
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
    await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
      storyFixture(['impl.js', 'impl.test.js']),
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'base: story exists, no implementation yet'], {
      cwd: dir,
    });
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl.test.js'),
      // `./impl.js` is DYNAMICALLY imported, inside the test body, never at the top of the module:
      // a static top-level import throws at MODULE-LOAD time once `impl.js` is reverted/missing
      // during the mutated run, which would skip every line below it -- including the sentinel
      // write -- for that one invocation, silently shrinking three real invocations (baseline,
      // mutated, restored) down to two and defeating the whole mechanism (confirmed empirically
      // while building this fixture: with a static import, the mutated run's sentinel write never
      // happened, so the restored run only ever saw count=1, not 2, and never failed).
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';\n" +
        "import { test, expect } from 'vitest';\n" +
        "const COUNT_PATH = './.sentinel-count';\n" +
        'let count = 0;\n' +
        "if (existsSync(COUNT_PATH)) count = Number(readFileSync(COUNT_PATH, 'utf8'));\n" +
        'writeFileSync(COUNT_PATH, String(count + 1));\n' +
        "test('adds', async () => {\n" +
        '  expect(count).toBeLessThan(2);\n' +
        "  const { add } = await import('./impl.js');\n" +
        '  expect(add(1, 2)).toBe(3);\n' +
        '});\n',
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: implement add(), with a sentinel'], {
      cwd: dir,
    });

    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly incomplete: number;
      readonly bound: readonly string[];
      readonly nonBinding: readonly string[];
      readonly restoreVerified: boolean;
    };
    expect(parsed.bound).toEqual(['adds']);
    expect(parsed.nonBinding).toEqual([]);
    expect(parsed.restoreVerified).toBe(false);
    expect(parsed.incomplete).toBeGreaterThan(0);
    expect(parsed.passed).toBe(false);
  }, 30_000);
});

describe('forge test binding — a non-binding test', () => {
  it('exits non-zero, naming each non-binding test, writing evidence anyway', async () => {
    // `skipImpl: true` -- built by hand below, as a test file that genuinely never imports `impl.js`
    // at all (never a shared-file over-credit, `specs/22` M15 P3's own disclosed whole-file-load-
    // failure phenomenon), so the non-binding verdict is real, not an artifact of the fixture.
    const dir = await freshProject({
      filesExpected: ['impl.js', 'tautology.test.js'],
      skipImpl: true,
    });
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'tautology.test.js'),
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: a genuinely unrelated test file'], {
      cwd: dir,
    });

    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).not.toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly nonBinding: readonly string[];
      readonly evidenceId: string;
      readonly tests: readonly { readonly name: string; readonly binding: boolean }[];
    };
    expect(parsed.passed).toBe(false);
    expect(parsed.nonBinding).toEqual(['tautology']);
    expect(parsed.evidenceId).toMatch(/^MUT-\d{3}$/);
    expect(parsed.tests).toEqual([{ name: 'tautology', binding: false }]);
  }, 30_000);
});

describe('forge test binding — a dirty working tree', () => {
  it('is refused before any git work, never reaching the lane/revert/test machinery', async () => {
    const dir = await freshProject();
    await writeFile(path.join(dir, 'untracked.txt'), 'uncommitted\n', 'utf8');

    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(5);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('VCS-010');
    // Nothing was written: the refusal happened before any lane/test/evidence work.
    expect(result.stdout).not.toContain('MUT-');
    // A real, direct check -- not inferred from exit code/stdout alone -- that `createLaneWorktree`
    // (`@forge/vcs`'s own `lanes.ts`) never ran: a round-1 gauntlet critic (M15 P4) found this test's
    // assertions alone would not catch a future regression that reordered `assertCleanWorkingTree` to
    // run after lane creation, since a created-then-torn-down lane leaves no trace in exit code or
    // stdout. Checked against real git state (`listOrphanedWorktrees`), not a guessed path: post-
    // `PLAN-M17.md` P8 nothing is ever created under the project's own `.forge/state/` any more, so a
    // bare directory-absence check there would pass trivially regardless of whether a lane ever ran --
    // exactly the kind of silent regression this check exists to catch.
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 30_000);
});

describe('forge test binding — an unknown story', () => {
  it('is a usage error (exit 2), not a crash', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-999', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('RUN-110');
    expect(result.stderr).not.toContain('at ');
  }, 30_000);
});

describe('forge test binding — no --story at all (specs/22 M15 P5: discover mode)', () => {
  // `--story` omitted entirely is no longer a usage error (M15 P4's own original behavior) -- it is a
  // real, distinct mode of its own: `G-Verify.gate.yaml`'s own `test:binding` check genuinely has no
  // single "current story" to pass (`runDiscoverModeBindingCommand`'s own doc comment has the full
  // reasoning), so omitting the flag now means "check every `done` story," never a refusal.
  it('vacuously passes with zero done stories (freshProject\'s own default story is "ready", never "done")', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--json'], dir);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly bound: readonly string[];
      readonly nonBinding: readonly string[];
      readonly evidenceIds: readonly string[];
      readonly restoreVerified: boolean;
      readonly problems: readonly string[];
    };
    expect(parsed.passed).toBe(true);
    expect(parsed.bound).toEqual([]);
    expect(parsed.nonBinding).toEqual([]);
    expect(parsed.evidenceIds).toEqual([]);
    expect(parsed.restoreVerified).toBe(true);
    expect(parsed.problems).toEqual([]);
  }, 30_000);

  it('discovers a real "done" story and checks it for real, story-prefixing every name in the aggregate envelope', async () => {
    const dir = await freshProject({ status: 'done' });
    const result = run(['test', 'binding', '--json'], dir);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly bound: readonly string[];
      readonly nonBinding: readonly string[];
      readonly evidenceIds: readonly string[];
    };
    expect(parsed.passed).toBe(true);
    expect(parsed.bound).toEqual(['STORY-001: adds']);
    expect(parsed.nonBinding).toEqual([]);
    expect(parsed.evidenceIds).toHaveLength(1);
    expect(parsed.evidenceIds[0]).toMatch(/^MUT-\d{3}$/);
  }, 30_000);

  it('silently skips a "done" story whose files_expected names no test path -- never a refusal in discover mode', async () => {
    const dir = await freshProject({ status: 'done', filesExpected: ['impl.js'] });
    const result = run(['test', 'binding', '--json'], dir);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly bound: readonly string[];
      readonly nonBinding: readonly string[];
      readonly evidenceIds: readonly string[];
      readonly problems: readonly string[];
    };
    expect(parsed.passed).toBe(true);
    expect(parsed.bound).toEqual([]);
    expect(parsed.nonBinding).toEqual([]);
    expect(parsed.evidenceIds).toEqual([]);
    expect(parsed.problems).toEqual([]);
  }, 30_000);

  it('captures a "done" story whose baseline already fails as a story-prefixed problem, without crashing the whole command', async () => {
    const dir = await freshProject({
      status: 'done',
      testBody:
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(999); });\n",
    });
    const result = run(['test', 'binding', '--json'], dir);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly problems: readonly string[];
    };
    expect(parsed.passed).toBe(false);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain('STORY-001');
    expect(parsed.problems[0]).toContain('already failing before any mutation');
  }, 30_000);

  it('discovers and aggregates TWO real "done" stories concurrently, never confusing one story\'s own result for the other\'s', async () => {
    // A round-1 gauntlet critic (M15 P5) found every discover-mode test used exactly one story,
    // leaving the piece's own central new mechanism -- scanning every `done` story and running their
    // binding checks concurrently via Promise.all, unioning the results with story-id prefixes --
    // completely unexercised beyond the single-story case.
    //
    // Built by hand, not via `freshProject` + a later commit: `baseRevision: 'HEAD~1'` (`specs/22` M15
    // P3/P4's own disclosed v1 simplification) is resolved against the real, SHARED repo history, not
    // per story -- stacking STORY-002's own commit on top of `freshProject`'s own two (base, then
    // STORY-001's impl) would make STORY-001's own `HEAD~1` resolve to ITS OWN impl commit, not its
    // pre-impl base, silently breaking the fixture rather than testing aggregation. Both stories'
    // implementations land together, in ONE commit, after a single shared "neither story has an
    // implementation yet" base -- the shape this limitation actually requires for more than one story.
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-binding-multi-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
    const config = {
      ...DEFAULT_CONFIG,
      execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: TEST_COMMAND } },
    };
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(config), 'utf8');
    await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
      storyFixture(['impl1.js', 'impl1.test.js'], 'done', 'STORY-001'),
      'utf8',
    );
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-002-fixture.md'),
      storyFixture(['impl2.js', 'impl2.test.js'], 'done', 'STORY-002'),
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa(
      'git',
      ['commit', '--quiet', '-m', 'base: both stories exist, neither implemented yet'],
      {
        cwd: dir,
      },
    );
    await writeFile(
      path.join(dir, 'impl1.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl1.test.js'),
      "import { test, expect } from 'vitest';\nimport { add } from './impl1.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl2.js'),
      'export function unused() { return true; }\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl2.test.js'),
      "import { test, expect } from 'vitest';\ntest('neverFails', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa(
      'git',
      ['commit', '--quiet', '-m', 'both stories: one genuinely binding, one not'],
      {
        cwd: dir,
      },
    );

    const result = run(['test', 'binding', '--json'], dir);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly bound: readonly string[];
      readonly nonBinding: readonly string[];
      readonly evidenceIds: readonly string[];
    };
    expect(parsed.passed).toBe(false);
    expect(parsed.bound).toEqual(['STORY-001: adds']);
    expect(parsed.nonBinding).toEqual(['STORY-002: neverFails']);
    expect(parsed.evidenceIds).toHaveLength(2);
  }, 30_000);
});

describe('forge test binding — a story document that exists but fails its own schema', () => {
  it('is a distinct RUN-110 message from "no such story" — a round-1 critic (M15 P4) caught these conflated', async () => {
    const dir = await freshProject();
    // A real, correctly-named story (`id: STORY-002`) whose `files_expected` violates the schema
    // (a string, not an array) -- the exact shape a round-1 gauntlet critic reproduced live to show
    // the old, single generic RUN-110 message falsely claimed this story "does not name a real story."
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-002-malformed.md'),
      [
        '---',
        'id: STORY-002',
        'type: Story',
        'schemaVersion: 1',
        'title: Malformed fixture story',
        'files_expected: "this-should-be-an-array-not-a-string"',
        'created: 2026-01-01',
        'updated: 2026-01-01',
        'revision: 1',
        'author: architect',
        'changelog: []',
        '---',
        '',
        'Malformed fixture body.',
        '',
      ].join('\n'),
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'add a malformed story'], { cwd: dir });

    const result = run(['test', 'binding', '--story', 'STORY-002', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as {
      readonly error: { readonly code: string; readonly message: string };
    };
    expect(parsed.error.code).toBe('RUN-110');
    expect(parsed.error.message).toContain('does not validate as a Story');
    expect(parsed.error.message).not.toContain('does not name a real story');
  }, 30_000);
});

describe('forge test binding — no test paths declared', () => {
  it('is a usage error (RUN-111), never silently running the whole project suite', async () => {
    const dir = await freshProject({ filesExpected: ['impl.js'] });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as { readonly error: { readonly code: string } };
    expect(parsed.error.code).toBe('RUN-111');
  }, 30_000);
});

describe('forge test binding — an undetectable ecosystem', () => {
  it('is a RUN-111 usage error naming the real cause, not the "no test paths" message', async () => {
    // No `package.json` and no Python marker file anywhere -- `detectEcosystem` (`ecosystem.ts`)
    // has nothing to classify this project as, a genuinely distinct cause from "no test paths" (a
    // round-1 gauntlet critic, M15 P4, found only the latter had a regression test).
    const dir = await freshProject({ skipPackageJson: true });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as {
      readonly error: { readonly code: string; readonly message: string };
    };
    expect(parsed.error.code).toBe('RUN-111');
    expect(parsed.error.message).toContain('could not detect a js/python test ecosystem');
  }, 30_000);
});

describe('forge test binding — no configured unit test command', () => {
  it('is a RUN-111 usage error naming the real cause, not the "no test paths" message', async () => {
    const dir = await freshProject({ skipTestCommand: true });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as {
      readonly error: { readonly code: string; readonly message: string };
    };
    expect(parsed.error.code).toBe('RUN-111');
    expect(parsed.error.message).toContain('no execution.testCommands.unit is configured');
  }, 30_000);
});

describe('forge test binding — a story already failing before any mutation', () => {
  it('reports baseline-not-green through the real CLI: exit 1, naming the failing test, writing no evidence', async () => {
    // A round-2 gauntlet critic (M15 P4) found `runTestBindingCommand`'s own non-'completed' outcome
    // mapping (bin.ts's `result.outcome === 'baseline-not-green' ? ... : result.message` ternary) had
    // zero CLI-level test coverage -- only `runBindingCheck` itself (`binding.test.ts`, M15 P3) was
    // ever exercised at that outcome, never the real spawned `forge` binary's own exit code/JSON shape
    // for it.
    const dir = await freshProject({
      testBody:
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(999); });\n",
    });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly ok: boolean; readonly problem: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toContain('already failing before any mutation');
    expect(parsed.problem).toContain('adds');
    // No `MutationEvidence` is written for a check that never completed (`binding-evidence.ts`'s own
    // doc comment): a baseline that never ran under mutation has nothing real to record.
    expect(result.stdout).not.toContain('MUT-');
  }, 30_000);
});

describe('forge test binding — a structured execution.testCommands.unit entry (specs/22 M17 P4)', () => {
  it('with a declared "scope" template: exits 0, bound, through the real CLI -- never routed through detectEcosystem at all', async () => {
    const dir = await freshProject({
      testCommandOverride: {
        run: `${TEST_COMMAND} --reporter=json`,
        output: { source: 'stdout' },
        format: 'vitest-json',
        scope: `${TEST_COMMAND} --reporter=json {files}`,
      },
      // No package.json at all: a structured layer never reaches `detectEcosystem` (Decision 4),
      // so this real CLI invocation must succeed despite the SAME condition that made the sibling
      // "an undetectable ecosystem" describe above a RUN-111 refusal for a legacy string.
      skipPackageJson: true,
    });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly bound: readonly string[];
    };
    expect(parsed.passed).toBe(true);
    expect(parsed.bound).toEqual(['adds']);
  }, 30_000);

  it('with NO "scope" template declared: a RUN-111-free, typed "problem" naming the missing capability -- never a crash', async () => {
    const dir = await freshProject({
      testCommandOverride: {
        run: `${TEST_COMMAND} --reporter=json`,
        output: { source: 'stdout' },
        format: 'vitest-json',
      },
    });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly ok: boolean; readonly problem: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toContain('"scope"');
  }, 30_000);
});

describe('forge test binding — a genuinely broken test command', () => {
  it('reports the real tool-error message through the CLI, the ternary\'s "else" branch', async () => {
    // The companion case to 'baseline-not-green' above: this covers the ternary's other real branch
    // (`result.message`, used by `baseline-tool-error`/`mutated-tool-error`/`restore-verification-
    // tool-error` alike) -- a round-2 critic found this branch untested too. Shell chaining
    // (`shell-safety.ts`'s own `containsShellChaining`) is a real, deterministic way to make
    // `runAndNormalize` itself refuse outright (`'tool-error'`) rather than ever invoking a test
    // runner at all, never flaky the way an actually-broken command's exit code could be.
    const dir = await freshProject({ testCommandOverride: `${TEST_COMMAND} && echo done` });
    const result = run(['test', 'binding', '--story', 'STORY-001', '--json'], dir);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly ok: boolean; readonly problem: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toContain('shell chaining');
    expect(result.stdout).not.toContain('MUT-');
  }, 30_000);
});

describe('forge test binding --timeout-ms (specs/22 M16 P10)', () => {
  it('a real --timeout-ms reaches the engine: a baseline that genuinely hangs is killed near the declared bound and reported as a distinct, typed problem, never a crash or a hang', async () => {
    // A synchronous busy loop, never an unresolved Promise: it blocks the whole worker's own event
    // loop, so only an external, process-group kill (this flag's own real effect) can ever end it.
    const dir = await freshProject({
      testBody: "import { test } from 'vitest'; test('hangs', () => { for (;;) { /* busy */ } });",
    });

    const started = Date.now();
    const result = run(
      ['test', 'binding', '--story', 'STORY-001', '--timeout-ms', '3000', '--json'],
      dir,
    );
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(20_000);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly ok: boolean; readonly problem: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toContain('timed out');
    expect(result.stdout).not.toContain('MUT-');
  }, 30_000);

  it('a malformed --timeout-ms is a real, typed RUN-117 usage refusal, before any git work at all', async () => {
    const dir = await freshProject();
    const result = run(
      ['test', 'binding', '--story', 'STORY-001', '--timeout-ms', 'soon', '--json'],
      dir,
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as {
      readonly error: { readonly code: string; readonly message: string };
    };
    expect(parsed.error.code).toBe('RUN-117');
    expect(parsed.error.message).toContain('--timeout-ms');
  });
});

describe('forge test binding — plain-text output (no --json)', () => {
  // A round-3 gauntlet critic (M15 P4) found every one of this file's other tests passes `--json`,
  // leaving the entire human-readable branch of `runTestBindingCommand` (the success summary line,
  // the per-test `non-binding: <name>` stderr lines, and the plain-text early-failure line) with zero
  // real-CLI coverage -- confirmed live against the sibling `forge story verify`'s own non-`--json`
  // test (`packages/cli/test/bin-story-verify.test.ts`), which already covers its own plain-text path.
  it('prints a human-readable summary line and exits 0 for a genuinely binding suite', async () => {
    const dir = await freshProject();
    const result = run(['test', 'binding', '--story', 'STORY-001'], dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('forge test binding --story STORY-001:');
    expect(result.stdout).toContain('bound=1');
    expect(result.stdout).toContain('nonBinding=0');
    expect(result.stdout).toContain('restoreVerified=true');
    expect(result.stdout).toMatch(/evidence=MUT-\d{3}\./);
  }, 30_000);

  it('prints the summary line plus one "non-binding: <name>" line per non-binding test, on stderr', async () => {
    const dir = await freshProject({
      filesExpected: ['impl.js', 'tautology.test.js'],
      skipImpl: true,
    });
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'tautology.test.js'),
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: a genuinely unrelated test file'], {
      cwd: dir,
    });

    const result = run(['test', 'binding', '--story', 'STORY-001'], dir);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('forge test binding --story STORY-001:');
    expect(result.stderr).toContain('non-binding: tautology');
  }, 30_000);
});
