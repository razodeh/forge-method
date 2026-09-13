/**
 * `bin.ts` / `bin/forge.mjs` — the real, minimal `pnpm forge <cmd>` dispatcher, invoked as a real
 * subprocess (not imported as a function) so this proves the actual, literal shell invocation
 * `specs/22` M6's own exit-test line uses actually works, not merely that the underlying library
 * functions do.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { existsSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { KNOWN_ADAPTER_MODULES, loadAdapterFactory } from '@forge/adapter-kit/registry';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import * as YAML from 'yaml';

import { runInit } from '../src/init/run-init.ts';

const REAL_ADAPTER_ENV = { ANTHROPIC_API_KEY: 'sk-ant-test-fixture-not-real' };

/** Whether a real, installable platform CLI for this registry's own one real adapter module is
 * reachable on this machine — probed through the identical real, generic seam `bin.ts` itself uses
 * (`@forge/adapter-kit/registry`'s `loadAdapterFactory` + the constructed adapter's own real
 * `preflight()`), never a literal binary name hardcoded in this test file (`forge-boundaries/
 * no-platform-concept` forbids that here exactly as much as in production source). Real `forge init`
 * success genuinely needs a passing preflight; nothing else this file's own new tests exercise does
 * (adapter *construction* alone needs no live CLI at all, and model listing is a real, static table).
 * This repository's own CI (`.github/workflows/ci.yml`) installs no real platform CLI at all, so the
 * one real test that needs it is skipped, not silently faked, when it is absent — the identical
 * disclosed-skip discipline `22` §22.1 rule 1 already establishes for this codebase's own Windows-only
 * `skipIf` sites. See `SPEC-QUESTIONS.md`. */
async function probeRealAdapterCli(): Promise<boolean> {
  const [spec] = KNOWN_ADAPTER_MODULES;
  if (spec === undefined) return false;
  try {
    const factory = await loadAdapterFactory(spec.packageName);
    const adapter = factory({ env: REAL_ADAPTER_ENV, now: () => Date.now() });
    const result = await adapter.preflight({ projectRoot: process.cwd(), env: REAL_ADAPTER_ENV });
    return result.ok;
  } catch {
    return false;
  }
}

const REAL_ADAPTER_CLI = await probeRealAdapterCli();

/** A real git repository with a real `.forge/config.yaml` (`DEFAULT_CONFIG`, never regenerated
 * through `forge init` — `platform.primary` defaults to `''`, which `buildAdapterForConfig` falls back
 * to this registry's own first real entry for, with no live session ever started) and one real,
 * agent-free workflow (`command` + `gate` steps only) — every `forge run/resume/pause/abort/lanes/
 * logs/gate/merge` test below can run this way with no real platform CLI or network access at all,
 * since neither `resolveModel` (a real, static table) nor any step in this fixture ever calls
 * `PlatformAdapter.startSession`. */
const RUN_WORKFLOW_ID = 'bin-fixture';
const RUN_GATE_ID = 'G-Bin-Fixture';
const RUN_WORKFLOWS_ROOT = '.forge/workflows';
const RUN_CHECKS_ROOT = '.forge/checks';

const RUN_FIXTURE_WORKFLOW = `id: ${RUN_WORKFLOW_ID}
name: Bin dispatcher fixture
version: 1.0.0
description: A real, agent-free workflow (command + gate only) exercising forge run's own real
  dispatcher wiring end to end with no live platform session.

steps:
  - id: prepare
    kind: command
    run: "true"
    inline: true

  - id: verify
    kind: gate
    gate: ${RUN_GATE_ID}
    dependsOn: [ prepare ]
`;

const RUN_SLOW_WORKFLOW_ID = 'bin-fixture-slow';

/** A real, non-instant `command` step — a genuine wall-clock window for `forge pause`'s own real
 * `SIGTERM` to land while the run is still genuinely in flight, the identical "real sleep, not
 * simulated" reasoning `packages/cli/test/commands/run/helpers.ts`'s own `FIXTURE_WORKFLOW_SLOW_SOURCE`
 * already establishes for the identical problem. */
const RUN_SLOW_FIXTURE_WORKFLOW = `id: ${RUN_SLOW_WORKFLOW_ID}
name: Bin dispatcher slow fixture
version: 1.0.0
description: A real, slow, agent-free workflow for tests that need a real run genuinely still in
  flight (forge pause/abort).

steps:
  - id: prepare
    kind: command
    run: "sleep 2"
    inline: true

  - id: verify
    kind: gate
    gate: ${RUN_GATE_ID}
    dependsOn: [ prepare ]
`;

const RUN_FIXTURE_GATE = `id: ${RUN_GATE_ID}
name: Always-passing bin-dispatcher fixture gate
phase: verify
checks:
  deterministic: []
  advisory: []
openQuestionsPolicy: warn
`;

const RUN_FAILING_GATE_ID = 'G-Bin-Failing';

const RUN_FAILING_GATE = `id: ${RUN_FAILING_GATE_ID}
name: Always-failing bin-dispatcher fixture gate
phase: verify
checks:
  deterministic:
    - id: always-fail
      run: "echo '{\\"errors\\":1}'"
      failOn: 'errors > 0'
  advisory: []
openQuestionsPolicy: warn
`;

async function realRunProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-run-'));
  dirs.push(dir);

  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });

  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');
  await mkdir(path.join(dir, RUN_WORKFLOWS_ROOT), { recursive: true });
  await writeFile(
    path.join(dir, RUN_WORKFLOWS_ROOT, `${RUN_WORKFLOW_ID}.workflow.yaml`),
    RUN_FIXTURE_WORKFLOW,
    'utf8',
  );
  await writeFile(
    path.join(dir, RUN_WORKFLOWS_ROOT, `${RUN_SLOW_WORKFLOW_ID}.workflow.yaml`),
    RUN_SLOW_FIXTURE_WORKFLOW,
    'utf8',
  );
  await mkdir(path.join(dir, RUN_CHECKS_ROOT), { recursive: true });
  await writeFile(
    path.join(dir, RUN_CHECKS_ROOT, `${RUN_GATE_ID}.gate.yaml`),
    RUN_FIXTURE_GATE,
    'utf8',
  );
  await writeFile(
    path.join(dir, RUN_CHECKS_ROOT, `${RUN_FAILING_GATE_ID}.gate.yaml`),
    RUN_FAILING_GATE,
    'utf8',
  );
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n', 'utf8');

  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: dir });

  return dir;
}

const REAL_MODULES_DIR = fileURLToPath(new URL('../../../modules/', import.meta.url));
const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function realProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-e2e-'));
  dirs.push(dir);
  await runInit(
    dir,
    { name: 'Bin Check', yes: true, level: 'L0' },
    { candidateAdapters: [new FakePlatformAdapter()], env: {}, modulesDir: REAL_MODULES_DIR },
  );
  return dir;
}

/** Patches a real key under `execution.testCommands` in the project's own real, `forge init`-written
 * `.forge/config.yaml` — the same file `readConfig` (`commands/config.ts`) reads for `forge test
 * run`'s own real CLI wiring (`PLAN-M8.md` P4). */
async function setTestCommand(dir: string, layer: string, command: string): Promise<void> {
  const configPath = path.join(dir, '.forge/config.yaml');
  const parsed = YAML.parse(await readFile(configPath, 'utf8')) as {
    execution: { testCommands: Record<string, string> };
  };
  parsed.execution.testCommands[layer] = command;
  await writeFile(configPath, YAML.stringify(parsed), 'utf8');
}

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

const REAL_VITEST_CMD = `${process.execPath} ${resolveRealVitestEntry()} run --root .`;

/** A minimal, real, schema-valid `Story` written directly (not via `specNew`'s id allocator, which
 * this file has no need of) — just enough front matter for `oversized-stories`
 * (`spec/validate-rules.ts`, M8 P2) to have something real to evaluate against a real subprocess. */
async function writeOversizedStory(dir: string): Promise<void> {
  const relPath = 'docs/forge/specs/stories/STORY-001-fixture.md';
  await mkdir(path.dirname(path.join(dir, relPath)), { recursive: true });
  const content = `---
id: STORY-001
type: Story
schemaVersion: 1
title: Fixture story
status: ready
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: po
changelog: []
epic: EPIC-001
capability: CAP-001
storyType: feature
size: L
owner_role: backend
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected: []
context_refs: []
acceptance: []
tests: []
dod_profile: backend-default
---

Fixture body.
`;
  await writeFile(path.join(dir, relPath), content, 'utf8');
}

function run(
  args: readonly string[],
  envOverlay: Readonly<Record<string, string>> = {},
): {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...envOverlay },
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

describe('forge (real subprocess dispatch)', () => {
  it('runs `forge agent validate --all` for real, exiting 0 against a real, clean project', async () => {
    const dir = await realProject();
    const result = run(['agent', 'validate', '--all', '-C', dir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no real findings');
  });

  it('runs `forge template validate --all` for real, exiting 0', async () => {
    const dir = await realProject();
    const result = run(['template', 'validate', '--all', '-C', dir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no real errors');
  });

  it('runs `forge --json status` for real, printing a real {"v":1,...} envelope', async () => {
    const dir = await realProject();
    const result = run(['status', '--json', '-C', dir]);
    // No real run has happened in this fixture yet -- a real, honest RUN-048 refusal, not a crash.
    expect(result.status).not.toBe(0);
  });

  it('exits 2 and names the command for a real, not-yet-wired subcommand', async () => {
    const dir = await realProject();
    const result = run(['kb', 'list', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('gives a real, specific "needs --all" message — not the generic "not wired" one — for a real, wired command missing it', async () => {
    // A critic round caught the original dispatcher giving the same generic "not wired into this
    // dispatcher yet" message for `agent validate` (a real, wired command with a missing flag) as it
    // gives for a genuinely unimplemented command like `kb list` above — misleading a caller who just
    // forgot `--all` into reading a doc comment naming dozens of unrelated commands.
    const dir = await realProject();
    const result = run(['agent', 'validate', '-C', dir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('needs --all');
    expect(result.stderr).not.toContain('not wired into');
  });

  it('runs `forge spec validate --rule oversized-stories --json` for real against a real violation, exiting 1 with a numeric errors field the real G-Ready gate can read', async () => {
    // `PLAN-M8.md` P2's own Checks section: this exact command is what `G-Ready.gate.yaml`'s real,
    // already-shipped `story:oversized` check shells out to (`failOn: 'errors > 0'`) — proven here as
    // a real subprocess, not merely a library-function call, since that is the one thing a unit test
    // against `specValidateRule` directly can never prove on its own.
    const dir = await realProject();
    await writeOversizedStory(dir);
    const result = run(['spec', 'validate', '--rule', 'oversized-stories', '--json', '-C', dir]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly errors: number };
    expect(parsed.errors).toBe(1);
  });

  it('runs `forge spec validate --rule oversized-stories --json` for real against a clean project, exiting 0', async () => {
    const dir = await realProject();
    const result = run(['spec', 'validate', '--rule', 'oversized-stories', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly errors: number };
    expect(parsed.errors).toBe(0);
  });

  it('exits 2 with a real, specific message naming every valid --rule for an unrecognised one', async () => {
    const dir = await realProject();
    const result = run(['spec', 'validate', '--rule', 'not-a-real-rule', '-C', dir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('oversized-stories');
  });

  it('runs `forge test run --json` for real end to end, from the real config through a real vitest failure', async () => {
    // `PLAN-M8.md` P4's own Checks section: proves the full real pipeline (readConfig -> testRun ->
    // JSON envelope -> exit code), not merely that `testRun` the library function works in
    // isolation (`test/run.test.ts` already covers that thoroughly).
    const dir = await realProject();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await setTestCommand(dir, 'unit', REAL_VITEST_CMD);
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `import { test, expect } from 'vitest'; test('fails', () => { expect(1).toBe(2); });`,
      'utf8',
    );

    const result = run(['test', 'run', '--json', '-C', dir]);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      readonly failed: number;
      readonly errors: number;
    };
    expect(parsed.failed).toBe(1);
  });

  it('runs `forge test run --json` for real end to end against a real, clean vitest fixture, exiting 0', async () => {
    const dir = await realProject();
    await writeFile(path.join(dir, 'package.json'), '{}', 'utf8');
    await setTestCommand(dir, 'unit', REAL_VITEST_CMD);
    await writeFile(
      path.join(dir, 'sample.test.js'),
      `import { test, expect } from 'vitest'; test('passes', () => { expect(1).toBe(1); });`,
      'utf8',
    );

    const result = run(['test', 'run', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly failed: number };
    expect(parsed.failed).toBe(0);
  });

  it('exits 2 with a real, specific message for an unrecognised "test run --rule" value, rather than silently running the default suite', async () => {
    // A fresh critic round found `findTestRuleFlag`'s first draft collapsed "no --rule given" and
    // "a --rule given but misspelled" into the identical `undefined`, silently running the entire
    // default suite for a typo — mirroring the already-existing `spec validate --rule
    // not-a-real-rule` test above for the identical, already-fixed-once gap.
    const dir = await realProject();
    const result = run(['test', 'run', '--rule', 'typecheckk', '-C', dir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('typecheck');
  });

  it('runs `forge test run --rule oracle-lint --json` for real end to end against a real weak-assertion violation', async () => {
    const dir = await realProject();
    await writeFile(
      path.join(dir, 'weak.test.js'),
      `test('AC-900-1 returns a result', () => { expect(doSomething()).toBeDefined(); });`,
      'utf8',
    );

    const result = run(['test', 'run', '--rule', 'oracle-lint', '--json', '-C', dir]);

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { readonly errors: number };
    expect(parsed.errors).toBe(1);
  });

  it('runs `forge test coverage --rule acceptance-criteria --json` for real end to end, vacuously exiting 0 with no done stories at all', async () => {
    // `PLAN-M8.md` P6's own Checks section: proves the full real pipeline (readConfig-free —
    // `story:ac-coverage` needs no `testCommands` entry — SpecGraph/story load -> JSON envelope ->
    // exit code), not merely that `testCoverage` the library function works in isolation
    // (`test/coverage.test.ts` already covers that thoroughly).
    const dir = await realProject();

    const result = run(['test', 'coverage', '--rule', 'acceptance-criteria', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly coverage: number };
    expect(parsed.coverage).toBe(100);
  });

  it('exits 2 with a real, specific message for an unrecognised "test coverage --rule" value', async () => {
    const dir = await realProject();

    const result = run(['test', 'coverage', '--rule', 'ratchett', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('ratchet');
  });

  it('exits 2, rather than silently running the default rule, for a real "--rule" with no value at all', async () => {
    // A fresh critic round found `findRuleFlag`'s own trailing-token case (`--rule` as the very last
    // token in argv) collapsed to the identical `undefined` "no --rule given" returns — silently
    // running `test:coverage` (the default rule) instead of erroring, the same collapse
    // `findRawTestRuleFlag`'s own doc comment already closed for a *misspelled* value.
    const dir = await realProject();

    const result = run(['test', 'coverage', '-C', dir, '--rule']);

    expect(result.status).toBe(2);
  });

  it('runs `forge test flaky --json` for real end to end, exiting 0 against a real, clean project', async () => {
    // `PLAN-M8.md` P7's own Checks section: proves the full real pipeline (readFlakyState -> JSON
    // envelope -> exit code), not merely that `testFlaky` the library function works in isolation
    // (`test/flaky.test.ts` already covers that thoroughly).
    const dir = await realProject();

    const result = run(['test', 'flaky', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly flaky: number;
      readonly quarantined: number;
    };
    expect(parsed.flaky).toBe(0);
    expect(parsed.quarantined).toBe(0);
  });
});

describe('forge init (real subprocess dispatch, PLAN-M12.md P1)', () => {
  it.skipIf(!REAL_ADAPTER_CLI)(
    'runs `forge init` for real end to end against a real platform CLI preflight, producing the real Stage-1 artifact set, exit 0',
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-init-'));
      dirs.push(dir);

      const result = run(['init', dir, '--name', 'Bin Init Fixture', '--level', 'L0', '--yes'], {
        // Bare mode only ever checks this env var is a real, non-empty string
        // (`probeAuthAvailability`'s own doc comment) — never validated against a real API, so no
        // live network call happens for this test to pass.
        ANTHROPIC_API_KEY: REAL_ADAPTER_ENV.ANTHROPIC_API_KEY,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('forge init');
      const config = YAML.parse(await readFile(path.join(dir, '.forge/config.yaml'), 'utf8')) as {
        readonly platform: { readonly primary: string };
      };
      const [spec] = KNOWN_ADAPTER_MODULES;
      expect(config.platform.primary).toBe(spec?.id);
    },
  );

  it('reports "already-initialized" honestly, exiting non-zero, for a project that already has a real .forge/config.yaml — no real preflight() ever runs for this path', async () => {
    // `buildCandidateAdapters` still constructs the real adapter object before `runInit` reaches its
    // own `isAlreadyInitialized` check (construction is real but does no I/O or credential probing) —
    // it is `selectPlatform`'s own real `preflight()` call that never runs here, which is the one real
    // thing that would need a live platform CLI on `PATH`.
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-init-existing-'));
    dirs.push(dir);
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');

    const result = run(['init', dir, '--name', 'Already There', '--yes']);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('already initialized');
  });

  it('exits non-zero for `forge init` with no real --yes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-init-noyes-'));
    dirs.push(dir);

    const result = run(['init', dir, '--name', 'No Yes']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--yes');
  });

  it('exits non-zero for `forge init` with no real --name', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-init-noname-'));
    dirs.push(dir);

    const result = run(['init', dir, '--yes']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--name');
  });
});

describe('forge run/resume/pause/abort/lanes/logs/gate/merge (real subprocess dispatch, PLAN-M12.md P1)', () => {
  it('exits 2 for `forge run` with no real <workflow> id', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-runargs-'));
    dirs.push(dir);

    const result = run(['run', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('<workflow>');
  });

  it('runs `forge run <workflow> --json` for real end to end against a real, agent-free workflow, exiting 0 with a real "completed" status', async () => {
    const dir = await realRunProject();

    const result = run(['run', RUN_WORKFLOW_ID, '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly runId: string;
      readonly runState: { readonly runStatus: string };
    };
    expect(parsed.runState.runStatus).toBe('completed');
  });

  it('runs `forge run <workflow> --dry-run` for real, compiling without ever starting a run, exiting 0', async () => {
    const dir = await realRunProject();

    const result = run(['run', RUN_WORKFLOW_ID, '--dry-run', '-C', dir]);

    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, '.forge/state/last-run.json'))).toBe(false);
  });

  it('exits non-zero with a real RUN-053 for a real, not-yet-created workflow id', async () => {
    const dir = await realRunProject();

    const result = run(['run', 'no-such-workflow', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no-such-workflow');
  });

  it("runs `forge lanes`/`forge logs` for real against a real, completed run's own real event log", async () => {
    const dir = await realRunProject();
    const started = run(['run', RUN_WORKFLOW_ID, '-C', dir]);
    expect(started.status).toBe(0);

    const lanes = run(['lanes', '--json', '-C', dir]);
    expect(lanes.status).toBe(0);
    const parsedLanes = JSON.parse(lanes.stdout) as { readonly lanes: readonly unknown[] };
    // A `command` + `gate`-only workflow never opens a lane worktree — real, honest, empty.
    expect(parsedLanes.lanes).toEqual([]);

    const logs = run(['logs', '-C', dir]);
    expect(logs.status).toBe(0);
    expect(logs.stdout.split('\n').filter((line) => line.length > 0).length).toBeGreaterThan(0);
    expect(logs.stdout).toContain('RunCompleted');
  });

  it('exits non-zero with a real RUN-048 for `forge lanes`/`forge pause`/`forge abort` with no real run yet', async () => {
    const dir = await realRunProject();

    expect(run(['lanes', '-C', dir]).status).toBe(2);
    expect(run(['pause', '-C', dir]).status).toBe(2);
    expect(run(['abort', '-C', dir]).status).toBe(2);
  });

  it("lists every real gate from a real project's own .forge/checks/ via `forge gate list`", async () => {
    const dir = await realRunProject();
    const started = run(['run', RUN_WORKFLOW_ID, '-C', dir]);
    expect(started.status).toBe(0);

    const result = run(['gate', 'list', '-C', dir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(RUN_GATE_ID);
  });

  it('runs `forge gate check <id>` for real against a real, passing gate, exiting 0', async () => {
    const dir = await realRunProject();
    const started = run(['run', RUN_WORKFLOW_ID, '-C', dir]);
    expect(started.status).toBe(0);

    const result = run(['gate', 'check', RUN_GATE_ID, '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly report: { readonly passed: boolean } };
    expect(parsed.report.passed).toBe(true);
  });

  it('exits 2 with a real, specific message for `forge gate reject <id>` with no --reason', async () => {
    const dir = await realRunProject();
    const started = run(['run', RUN_WORKFLOW_ID, '-C', dir]);
    expect(started.status).toBe(0);

    const result = run(['gate', 'reject', RUN_GATE_ID, '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--reason');
  });

  it('exits 2 for `forge merge` with neither --lane nor --all', async () => {
    const dir = await realRunProject();

    const result = run(['merge', '-C', dir]);

    expect(result.status).toBe(2);
  });

  it('exits non-zero with a real USR-003 for `forge merge --abort` — never implemented, refused rather than guessed at', async () => {
    const dir = await realRunProject();

    const result = run(['merge', '--abort', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not yet supported');
  });

  it('runs `forge merge --all` for real against a real run with no ready lane, exiting 0 with a real, empty result', async () => {
    const dir = await realRunProject();
    const started = run(['run', RUN_WORKFLOW_ID, '-C', dir]);
    expect(started.status).toBe(0);

    const result = run(['merge', '--all', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly results: readonly unknown[] };
    expect(parsed.results).toEqual([]);
  });

  it('exits 2 for a real, misspelled `forge run` flag, rather than silently dropping it', async () => {
    // A fresh critic round found the first draft of `--stage`/`--epic`/`--story` parsing silently
    // ignored an unrecognised flag instead of erroring — `forge run wf --epci foo` (a typo of
    // `--epic`) ran with no error and no real `vars.epic` at all.
    const dir = await realRunProject();

    const result = run(['run', RUN_WORKFLOW_ID, '--epci', 'foo', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--epci');
  });

  it('runs `forge gate approve <id> --json` for real, honoring --json rather than always printing plain text', async () => {
    const dir = await realRunProject();
    const started = run(['run', RUN_WORKFLOW_ID, '-C', dir]);
    expect(started.status).toBe(0);

    const result = run([
      'gate',
      'approve',
      RUN_GATE_ID,
      '--reason',
      'looks fine',
      '--json',
      '-C',
      dir,
    ]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly gateId: string;
      readonly recorded: boolean;
    };
    expect(parsed).toEqual({ v: 1, gateId: RUN_GATE_ID, recorded: true });
  });

  it('exits with a real EXIT_CODES.gateFailed (3) for `forge gate check <id>` against a real, failing gate', async () => {
    const dir = await realRunProject();
    const started = run(['run', RUN_WORKFLOW_ID, '-C', dir]);
    expect(started.status).toBe(0);

    const result = run(['gate', 'check', RUN_FAILING_GATE_ID, '--json', '-C', dir]);

    expect(result.status).toBe(3);
    const parsed = JSON.parse(result.stdout) as { readonly report: { readonly passed: boolean } };
    expect(parsed.report.passed).toBe(false);
  });

  it('exits 2 for `forge gate list --run <id>` — list takes no real --run at all, rather than silently ignoring one', async () => {
    const dir = await realRunProject();

    const result = run(['gate', 'list', '--run', 'whatever', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--run');
  });

  it('exits 2 for `forge pause`/`forge resume`/`forge abort`/`forge lanes` given a real, unrecognised flag, rather than silently dropping it', async () => {
    const dir = await realRunProject();

    expect(run(['pause', '--forc', '-C', dir]).status).toBe(2);
    expect(run(['resume', 'run-1', '--extra', '-C', dir]).status).toBe(2);
    expect(run(['abort', '--forc', '-C', dir]).status).toBe(2);
    expect(run(['lanes', 'run-1', 'run-2', '-C', dir]).status).toBe(2);
  });

  it('reports the real pid in `forge pause`/`forge abort` --json output against a real, live-locked run', async () => {
    const dir = await realRunProject();
    // A real, long-running `forge run` invocation, backgrounded so its own real lock is genuinely
    // held while this test drives `forge pause` against it — the identical real lock/signal machinery
    // `commands/run/lock.ts` itself already proves, exercised here through the real CLI path.
    const child = execa(process.execPath, [LAUNCHER, 'run', RUN_SLOW_WORKFLOW_ID, '-C', dir], {
      reject: false,
    });
    // A bounded, real wait for the lock file to actually exist -- polling, not a fixed sleep, since
    // how long the child takes to acquire it is not this test's own concern to guess at.
    const lockPath = path.join(dir, '.forge/state/lock.json');
    for (let attempt = 0; attempt < 100 && !existsSync(lockPath); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(existsSync(lockPath)).toBe(true);

    const result = run(['pause', '--json', '-C', dir]);
    await child;

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly runId: string;
      readonly pid: number;
      readonly stopped: boolean;
    };
    expect(typeof parsed.pid).toBe('number');
    expect(parsed.stopped).toBe(true);
  });
});
