/**
 * `evaluateGate` against the real, shipped `G-Verify.gate.yaml` and this piece's own real `forge
 * test run [--rule lint|typecheck] --json` CLI wiring — `PLAN-M8.md` P4's own Checks section asks
 * for exactly this: "running `evaluateGate` against the real gate definition and this real command
 * ... produces the correct `passed`/`failed` gate outcome end-to-end," which no other test file
 * proves (`run.test.ts`/`bin.test.ts` each stop at `testRun`'s own JSON envelope, never feeding it
 * through the real `failOn` expression evaluator against the real, committed check ids).
 *
 * Also `test:binding` (`specs/22` M15 P5): the real `G-Verify.gate.yaml`'s own `run: 'forge test
 * binding --json'` line has no `--story` — `evaluateGate`'s own `CheckRunner` passes `check.run`
 * through as a literal shell command (`facades.ts`'s own `createGateEvaluator`, no templating, no
 * per-story substitution), and `G-Verify` is itself evaluated once per STAGE over a branch that can
 * hold many stories at once (`build-stage.workflow.yaml`'s own `verify` step has no `itemKey`, unlike
 * every per-story step above it) — so `test:binding`'s own real invocation shape is M15 P5's own
 * discover mode (every `done` story, no single story in scope), proven here end to end, the same way
 * `story:ac-coverage`'s own identical "no `--story`, scan every `done` story" shape already is.
 *
 * @see specs/13 §13.1 F-TEST-7
 * @see specs/22 M15 P5
 * @see PLAN-M8.md P4
 * @see PLAN-M15.md P5
 */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { parseExpression } from '@forge/engine/expr';
import { runShellCommand } from '@forge/engine/dispatch';
import { evaluateGate, type CheckRunner, type GateDefinition } from '@forge/engine/gates';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

const LAUNCHER = fileURLToPath(new URL('../../../../bin/forge.mjs', import.meta.url));
const REAL_GATE_YAML_PATH = fileURLToPath(
  new URL('../../../../../templates/templates/checks/G-Verify.gate.yaml', import.meta.url),
);

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

const REAL_VITEST_CMD = `${process.execPath} ${resolveRealBinEntry('vitest', 'vitest')} run --root .`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Fixture {
  readonly dir: string;
  readonly runner: CheckRunner;
}

/** `check.run` in the real, shipped gate YAML is a bare `forge ...` invocation — this environment
 * has no `forge` on `PATH` (it is not a dependency of the workspace root, so pnpm never links its
 * bin there). A tiny real wrapper script, prepended onto `PATH` for this fixture's own real
 * `CheckRunner` only, makes the real, verbatim gate YAML runnable without editing it. */
async function fixtureWithRealForgeOnPath(): Promise<Fixture> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-gate-e2e-'));
  dirs.push(dir);
  await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');

  const binDir = await mkdtemp(path.join(tmpdir(), 'forge-gate-e2e-bin-'));
  dirs.push(binDir);
  const wrapperPath = path.join(binDir, 'forge');
  await writeFile(
    wrapperPath,
    `#!/usr/bin/env sh\nexec "${process.execPath}" "${LAUNCHER}" "$@"\n`,
    'utf8',
  );
  await chmod(wrapperPath, 0o755);

  const env = { PATH: `${binDir}:${process.env['PATH'] ?? ''}` };
  const runner: CheckRunner = async (check, cwd) => {
    const result = await runShellCommand(`${check.run} -C ${cwd}`, cwd, env);
    return { stdout: result.stdout, exitCode: result.exitCode };
  };
  return { dir, runner };
}

async function loadRealGVerify(): Promise<GateDefinition> {
  const raw = YAML.parse(await readFile(REAL_GATE_YAML_PATH, 'utf8')) as {
    readonly id: string;
    readonly checks: {
      readonly deterministic: GateDefinition['checks']['deterministic'];
      readonly advisory?: GateDefinition['checks']['advisory'];
    };
    readonly openQuestionsPolicy?: 'block' | 'warn';
  };
  return {
    id: raw.id,
    checks: { deterministic: raw.checks.deterministic, advisory: raw.checks.advisory ?? [] },
    openQuestionsPolicy: raw.openQuestionsPolicy ?? 'warn',
  };
}

/** `DEFAULT_CONFIG`, not a hand-rolled object — `@forge/schemas/config`'s own real default is
 * already proven, by that package's own test suite, to satisfy `configSchema` in full; hand-typing
 * every one of `configSchema`'s twenty-odd top-level sections here would just be a second, drifting
 * copy of the same schema this test has no need to re-derive. */
async function setTestCommand(dir: string, layer: string, command: string): Promise<void> {
  const configDir = path.join(dir, '.forge');
  await mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.yaml');
  const config = {
    ...DEFAULT_CONFIG,
    execution: {
      ...DEFAULT_CONFIG.execution,
      testCommands: { ...DEFAULT_CONFIG.execution.testCommands, [layer]: command },
    },
  };
  await writeFile(configPath, YAML.stringify(config), 'utf8');
}

/** A real, `storySchema`-valid `done` Story — `test:binding`'s own real invocation (no `--story`,
 * `G-Verify.gate.yaml`'s own `run:` line) only ever considers `done` stories (`loadDoneStories`,
 * `shared.ts`), the identical scope `story:ac-coverage` already established. */
function doneStoryFixture(id: string, filesExpected: readonly string[]): string {
  return `---
id: ${id}
type: Story
schemaVersion: 1
title: Fixture story
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
status: done
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

/** `fixtureWithRealForgeOnPath`, plus a real git history `assertCleanWorkingTree` (`forge test
 * binding`'s own literal first statement) requires: a base commit (config, one `done` story, no
 * implementation yet) and — unless `skipImpl` — a second, later commit adding the implementation and
 * its own test, so `HEAD~1` genuinely lacks it (the exact shape `bin-binding.test.ts`'s own
 * `freshProject` already establishes for M15 P4's single-story tests, reused here for M15 P5's
 * discover-mode/gate-check tests). */
async function fixtureWithBindingStory(
  options: {
    readonly storyId?: string;
    readonly filesExpected?: readonly string[];
    readonly testBody?: string;
    readonly skipImpl?: boolean;
  } = {},
): Promise<Fixture> {
  const { dir, runner } = await fixtureWithRealForgeOnPath();
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await setTestCommand(dir, 'unit', REAL_VITEST_CMD);
  const storyId = options.storyId ?? 'STORY-001';
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories', `${storyId}-fixture.md`),
    doneStoryFixture(storyId, options.filesExpected ?? ['impl.js', 'impl.test.js']),
    'utf8',
  );
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
    await writeFile(
      path.join(dir, 'impl.test.js'),
      options.testBody ??
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: implement add()'], { cwd: dir });
  }
  return { dir, runner };
}

describe('evaluateGate against the real, shipped G-Verify.gate.yaml', () => {
  it('reports passed: false with the real failing check ids for a real vitest failure', async () => {
    const { dir, runner } = await fixtureWithRealForgeOnPath();
    await setTestCommand(dir, 'unit', REAL_VITEST_CMD);
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `import { test, expect } from 'vitest'; test('fails', () => { expect(1).toBe(2); });`,
      'utf8',
    );
    const gate = await loadRealGVerify();

    const result = await evaluateGate(gate, dir, runner);

    expect(result.passed).toBe(false);
    const testRunCheck = result.checks.find((c) => c.checkId === 'test:run');
    expect(testRunCheck?.passed).toBe(false);
  });

  it('reports test:run passing for a real, clean vitest fixture', async () => {
    const { dir, runner } = await fixtureWithRealForgeOnPath();
    await setTestCommand(dir, 'unit', REAL_VITEST_CMD);
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `import { test, expect } from 'vitest'; test('passes', () => { expect(1).toBe(1); });`,
      'utf8',
    );
    const gate = await loadRealGVerify();

    const result = await evaluateGate(gate, dir, runner);

    const testRunCheck = result.checks.find((c) => c.checkId === 'test:run');
    expect(testRunCheck?.passed).toBe(true);
  });
});

describe('G-Verify.gate.yaml — test:binding (specs/22 M15 P5)', () => {
  it("the real, shipped failOn ('incomplete > 0', round-1's own fix) parses as a real expression", async () => {
    // Reads the REAL shipped YAML, not a disconnected literal -- a round-2 gauntlet critic (M15 P5)
    // found an earlier version of this test still hardcoded the pre-round-1 'length(nonBinding) > 0'
    // string, which no longer appears anywhere in the real G-Verify.gate.yaml and had drifted into
    // testing nothing real.
    const gate = await loadRealGVerify();
    const bindingCheck = gate.checks.deterministic.find((check) => check.id === 'test:binding');
    expect(bindingCheck?.failOn).toBe('incomplete > 0');
    const result = parseExpression(bindingCheck?.failOn ?? '');
    expect(result.success).toBe(true);
  });

  it('is placed after test:run in the real, shipped check list (priority ordering, not enforced execution order — evaluateGate runs every deterministic check concurrently)', async () => {
    const gate = await loadRealGVerify();
    const ids = gate.checks.deterministic.map((check) => check.id);
    const runIndex = ids.indexOf('test:run');
    const bindingIndex = ids.indexOf('test:binding');
    expect(runIndex).toBeGreaterThanOrEqual(0);
    expect(bindingIndex).toBeGreaterThan(runIndex);
  });

  it('fails at test:binding, naming the non-binding test, for a done story whose test never depends on its implementation', async () => {
    const { dir, runner } = await fixtureWithBindingStory({
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
    const gate = await loadRealGVerify();

    const result = await evaluateGate(gate, dir, runner);

    const bindingCheck = result.checks.find((c) => c.checkId === 'test:binding');
    expect(bindingCheck?.passed).toBe(false);
    expect(bindingCheck?.stdout).toContain('STORY-001: tautology');
  }, 30_000);

  it('passes at test:binding for a done story whose test genuinely fails when the implementation is reverted', async () => {
    const { dir, runner } = await fixtureWithBindingStory();
    const gate = await loadRealGVerify();

    const result = await evaluateGate(gate, dir, runner);

    const bindingCheck = result.checks.find((c) => c.checkId === 'test:binding');
    expect(bindingCheck?.passed).toBe(true);
  }, 30_000);

  it('stays green at test:binding with zero done stories (the shipped-fixture shape: nothing to check is not a failure)', async () => {
    const { dir, runner } = await fixtureWithRealForgeOnPath();
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    await setTestCommand(dir, 'unit', REAL_VITEST_CMD);
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'no stories yet'], { cwd: dir });
    const gate = await loadRealGVerify();

    const result = await evaluateGate(gate, dir, runner);

    const bindingCheck = result.checks.find((c) => c.checkId === 'test:binding');
    expect(bindingCheck?.passed).toBe(true);
    expect(bindingCheck?.stdout).toContain('"bound":[]');
  }, 30_000);

  it('fails the real G-Verify check when restoreVerified is false, even though nonBinding stays empty', async () => {
    // A round-3 gauntlet critic (M15 P5, the final allowed round) found `incomplete`'s own
    // `restoreVerified` contribution (`runDiscoverModeBindingCommand`, the real shape this check
    // actually invokes) had no test anywhere proving it through the real `evaluateGate` + the real,
    // shipped `G-Verify.gate.yaml` -- the exact mechanism round 1 and round 2 were both BLOCKING on, in
    // the ONE path neither of those rounds' own fixes had tested. A real (non-mocked) `.gitignore`'d
    // counter, surviving `resetLaneWorktree`'s own `git clean -fd`, the identical technique
    // `bin-binding.test.ts`'s own sibling test already establishes (`./impl.js` must be a DYNAMIC
    // import inside the test body, never a static top-level one, or the mutated run's own module-load
    // failure skips the sentinel write for that invocation entirely).
    const { dir, runner } = await fixtureWithRealForgeOnPath();
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    await setTestCommand(dir, 'unit', REAL_VITEST_CMD);
    await writeFile(path.join(dir, '.gitignore'), '.sentinel-count\n', 'utf8');
    await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
      doneStoryFixture('STORY-001', ['impl.js', 'impl.test.js']),
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
    const gate = await loadRealGVerify();

    const result = await evaluateGate(gate, dir, runner);

    const bindingCheck = result.checks.find((c) => c.checkId === 'test:binding');
    expect(bindingCheck?.passed).toBe(false);
    expect(bindingCheck?.stdout).toContain('"restoreVerified":false');
    expect(bindingCheck?.stdout).toContain('"nonBinding":[]');
    expect(bindingCheck?.stdout).toContain('"bound":["STORY-001: adds"]');
  }, 30_000);
});

/**
 * A project-authored check on `uncoveredHunks`, proven through the REAL `evaluateGate` (`specs/22`
 * M16 P13) — `13` F-TEST-10's own words: "No default threshold ships... a project that wants one
 * authors a check over the `--json` envelope under `10` §10.3's check contract." This is that check,
 * hand-authored here exactly as a real project's own `*.gate.yaml` would declare it (never a shipped
 * FORGE gate — `G-Verify`/`G-Parity` name no such check), run through the identical `evaluateGate` the
 * two describe blocks above already use.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-10
 * @see specs/22 M16 P13
 * @see process/SPEC-QUESTIONS.md Q294 Decision 8
 */
function uncoveredHunksGate(storyId: string, base: string): GateDefinition {
  return {
    id: 'G-ProjectAuthored-UncoveredHunks',
    checks: {
      deterministic: [
        {
          id: 'hunk:uncovered',
          run: `forge test binding --story ${storyId} --hunks --base ${base} --json`,
          parser: 'forge-json',
          failOn: 'uncoveredHunks > 0',
        },
      ],
      advisory: [],
    },
    openQuestionsPolicy: 'warn',
  };
}

/** Two real hunks in one file, `add` tested (killed on reversal) and `sub` untested (uncovered) — the
 * identical `bin-binding-hunks-mutation.test.ts`'s own `projectWithOneUncoveredHunk` shape (M16 P12),
 * replicated here (this file owns its own fixture independently): the ONE named test (`adds`) binds
 * the whole change, so the change-level result PASSES (exit 0, `incomplete: 0`) while `sub`'s own
 * hunk still reads `uncovered` -- the fixture both proves "a project-authored check on
 * `uncoveredHunks` fails on a real uncovered hunk" and "it fails independent of the change-level exit
 * code", in one shot. */
async function fixtureWithOneUncoveredHunk(): Promise<Fixture & { readonly baseSha: string }> {
  const { dir, runner } = await fixtureWithRealForgeOnPath();
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await setTestCommand(dir, 'unit', REAL_VITEST_CMD);
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
    doneStoryFixture('STORY-001', ['impl.js', 'impl.test.js']),
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.js'),
    'export function add(a, b) {\n  return 0;\n}\n\nexport function sub(a, b) {\n  return 0;\n}\n',
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base: two buggy stubs'], { cwd: dir });
  const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  await writeFile(
    path.join(dir, 'impl.js'),
    'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.test.js'),
    "import { test, expect } from 'vitest';\n" +
      "import { add } from './impl.js';\n" +
      "test('adds', () => { expect(add(1, 2)).toBe(3); });\n",
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'the story: fix both, only add() is tested'], {
    cwd: dir,
  });
  return { dir, runner, baseSha: baseSha.trim() };
}

/** Both hunks genuinely tested (`add` AND `sub`): `uncoveredHunks` is 0 and the project-authored
 * check must pass. */
async function fixtureFullyCovered(): Promise<Fixture & { readonly baseSha: string }> {
  const { dir, runner } = await fixtureWithRealForgeOnPath();
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await setTestCommand(dir, 'unit', REAL_VITEST_CMD);
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
    doneStoryFixture('STORY-001', ['impl.js', 'impl.test.js']),
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.js'),
    'export function add(a, b) {\n  return 0;\n}\n\nexport function sub(a, b) {\n  return 0;\n}\n',
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base: two buggy stubs'], { cwd: dir });
  const { stdout: baseSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  await writeFile(
    path.join(dir, 'impl.js'),
    'export function add(a, b) {\n  return a + b;\n}\n\nexport function sub(a, b) {\n  return a - b;\n}\n',
    'utf8',
  );
  await writeFile(
    path.join(dir, 'impl.test.js'),
    "import { test, expect } from 'vitest';\n" +
      "import { add, sub } from './impl.js';\n" +
      "test('adds', () => { expect(add(1, 2)).toBe(3); });\n" +
      "test('subtracts', () => { expect(sub(3, 1)).toBe(2); });\n",
    'utf8',
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'the story: fix both, both tested'], { cwd: dir });
  return { dir, runner, baseSha: baseSha.trim() };
}

describe('a project-authored check on uncoveredHunks, through the real evaluateGate (specs/22 M16 P13) (13 F-TEST-10)', () => {
  it('fails (failOn: "uncoveredHunks > 0") on a real fixture with one genuinely uncovered hunk', async () => {
    const { dir, runner, baseSha } = await fixtureWithOneUncoveredHunk();
    const gate = uncoveredHunksGate('STORY-001', baseSha);

    const result = await evaluateGate(gate, dir, runner);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.checkId === 'hunk:uncovered');
    expect(check?.passed).toBe(false);
    expect(check?.stdout).toContain('"uncoveredHunks":1');
  }, 30_000);

  it('passes the identical check on a fully-covered fixture', async () => {
    const { dir, runner, baseSha } = await fixtureFullyCovered();
    const gate = uncoveredHunksGate('STORY-001', baseSha);

    const result = await evaluateGate(gate, dir, runner);

    expect(result.passed).toBe(true);
    const check = result.checks.find((c) => c.checkId === 'hunk:uncovered');
    expect(check?.passed).toBe(true);
    expect(check?.stdout).toContain('"uncoveredHunks":0');
  }, 30_000);

  it('still fails even though the change-level result itself passed (exit 0) -- failOn reads the parsed envelope, independent of the exit code', async () => {
    const { dir, runner, baseSha } = await fixtureWithOneUncoveredHunk();
    const gate = uncoveredHunksGate('STORY-001', baseSha);

    const result = await evaluateGate(gate, dir, runner);

    const check = result.checks.find((c) => c.checkId === 'hunk:uncovered');
    // "Nothing is failing by M15's own binding standard": the check's own real exit code, from THIS
    // evaluation, is 0 -- the ONE named test (`adds`) bound the whole change, so the change-level
    // result passed. `failOn` still read the parsed envelope's own `uncoveredHunks` field and found
    // it real, so the check -- and the gate -- fail regardless. Checked against the same `stdout`
    // `evaluateGate` itself parsed, never a second, separate invocation (which would dirty this
    // fixture's own tree with a second evidence file before the real evaluation ran).
    expect(check?.exitCode).toBe(0);
    const envelope = JSON.parse(check?.stdout ?? '{}') as { readonly passed: boolean };
    expect(envelope.passed).toBe(true);
    expect(result.passed).toBe(false);
    expect(check?.passed).toBe(false);
  }, 30_000);
});
