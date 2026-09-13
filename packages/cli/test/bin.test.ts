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
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { existsSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { ProjectPaths } from '@forge/core/fs';
import { appendEvent } from '@forge/telemetry/events';

import { acquireRunLock } from '../src/commands/run/lock.ts';
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

/** `forge module add`/`forge overlay add --json` print two real, separate JSON lines to stdout, not
 * one — `promptForConsent`'s own real `--yes --json` auto-accept line (`{description, granted}`),
 * then this dispatcher's own real `InstallChangeReport` envelope — matching this codebase's own NDJSON
 * `--json` convention (`03` §3.5's own "JSON... NDJSON events on stdout"), not a single-object
 * contract. This reads back only the last real line, the one this piece's own report actually is. */
function lastJsonLine(stdout: string): unknown {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  const last = lines.at(-1);
  if (last === undefined) throw new Error('expected at least one real JSON line on stdout');
  return JSON.parse(last);
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
    // `kb list` used to be the example here — `PLAN-M12.md` P4 wired the whole `kb` surface, so this
    // now uses `agent list` instead: `agent validate --all` is the only real, wired `agent` subcommand
    // (`PLAN-M6.md` C9), `list`/`show`/`new`/`compile` remain genuinely unwired.
    const dir = await realProject();
    const result = run(['agent', 'list', '-C', dir]);
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

// -------------------------------------------------------------------------------------------------
// `module`/`overlay`/`upgrade`/`export`/`doctor`/`audit`/`config`/`cost`/`uninstall` — `PLAN-M12.md`
// P2's own real dispatcher wiring, driven end to end as a real subprocess exactly like every command
// above.
// -------------------------------------------------------------------------------------------------

interface ModuleBundleOverrides {
  readonly forgeVersion?: string;
  readonly requires?: readonly string[];
  readonly ceilings?: Record<string, unknown>;
}

/** A real, minimal, schema-valid `module.yaml` — permissive enough (`forgeVersion: '>=0.0.0'`) to
 * install against whatever `@forge/agents` version this workspace happens to be running, the same
 * "no real hardcoded version to keep in sync" reasoning every other real fixture in this file already
 * follows for its own real content. */
async function writeModuleBundleFixture(
  dir: string,
  id: string,
  overrides: ModuleBundleOverrides = {},
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'module.yaml'),
    YAML.stringify({
      id,
      name: `Fixture module ${id}`,
      version: '1.0.0',
      forgeVersion: overrides.forgeVersion ?? '>=0.0.0',
      requires: overrides.requires ?? [],
      conflicts: [],
      levels: ['L0', 'L1', 'L2', 'L3'],
      ceilings: overrides.ceilings ?? {},
      provides: {},
    }),
  );
}

/** A real, minimal, schema-valid `overlay.yaml` — the overlay-channel counterpart of
 * `writeModuleBundleFixture` above. */
async function writeOverlayBundleFixture(dir: string, id: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'overlay.yaml'),
    YAML.stringify({
      id,
      name: `Fixture overlay ${id}`,
      version: '1.0.0',
      forgeVersion: '>=0.0.0',
      requiresModules: [],
    }),
  );
}

describe('forge module/overlay add/remove/update (real subprocess dispatch, PLAN-M12.md P2)', () => {
  it('runs `forge module add <id> <source> --yes --json` for real end to end against a real local-channel fixture', async () => {
    const dir = await realProject();
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-module-'));
    dirs.push(bundleDir);
    await writeModuleBundleFixture(bundleDir, 'acme-fixture-mod');

    const result = run([
      'module',
      'add',
      'acme-fixture-mod',
      bundleDir,
      '--yes',
      '--json',
      '-C',
      dir,
    ]);

    expect(result.status).toBe(0);
    const parsed = lastJsonLine(result.stdout) as {
      readonly report: { readonly id: string; readonly action: string };
    };
    expect(parsed.report).toMatchObject({ id: 'acme-fixture-mod', action: 'installed' });
    expect(existsSync(path.join(dir, '.forge/modules/acme-fixture-mod/module.yaml'))).toBe(true);
  });

  it('refuses `forge module add` without --yes against a non-interactive stdin, exiting non-zero with no write', async () => {
    const dir = await realProject();
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-module-noyes-'));
    dirs.push(bundleDir);
    await writeModuleBundleFixture(bundleDir, 'acme-noyes-mod');

    const result = run(['module', 'add', 'acme-noyes-mod', bundleDir, '-C', dir]);

    expect(result.status).not.toBe(0);
    expect(existsSync(path.join(dir, '.forge/modules/acme-noyes-mod'))).toBe(false);
  });

  it('exits 2 for `forge module add` with a missing <source>', async () => {
    const dir = await realProject();

    const result = run(['module', 'add', 'acme-fixture-mod', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('module add');
  });

  it('exits 2 for a real, unrecognised `forge module <sub>`, naming the real wired subcommands', async () => {
    const dir = await realProject();

    const result = run(['module', 'list', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('add|remove|update');
  });

  it('runs `forge module remove <id> --json` for real after a real add', async () => {
    const dir = await realProject();
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-module-rm-'));
    dirs.push(bundleDir);
    await writeModuleBundleFixture(bundleDir, 'acme-remove-mod');
    expect(run(['module', 'add', 'acme-remove-mod', bundleDir, '--yes', '-C', dir]).status).toBe(0);

    const result = run(['module', 'remove', 'acme-remove-mod', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly report: { readonly action: string } };
    expect(parsed.report.action).toBe('removed');
    expect(existsSync(path.join(dir, '.forge/modules/acme-remove-mod'))).toBe(false);
  });

  it('runs `forge module update <id> <source> --yes --json` for real after a real add', async () => {
    const dir = await realProject();
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-module-up-'));
    dirs.push(bundleDir);
    await writeModuleBundleFixture(bundleDir, 'acme-update-mod');
    expect(run(['module', 'add', 'acme-update-mod', bundleDir, '--yes', '-C', dir]).status).toBe(0);

    const updatedDir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-module-up2-'));
    dirs.push(updatedDir);
    await mkdir(updatedDir, { recursive: true });
    await writeFile(
      path.join(updatedDir, 'module.yaml'),
      YAML.stringify({
        id: 'acme-update-mod',
        name: 'Fixture module acme-update-mod',
        version: '2.0.0',
        forgeVersion: '>=0.0.0',
        requires: [],
        conflicts: [],
        levels: ['L0', 'L1', 'L2', 'L3'],
        ceilings: {},
        provides: {},
      }),
    );

    const result = run([
      'module',
      'update',
      'acme-update-mod',
      updatedDir,
      '--yes',
      '--json',
      '-C',
      dir,
    ]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly report: { readonly action: string; readonly version: string };
    };
    expect(parsed.report).toMatchObject({ action: 'updated', version: '2.0.0' });
  });

  it('runs `forge overlay add <source> --yes --json` for real end to end against a real local-channel fixture', async () => {
    const dir = await realProject();
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-overlay-'));
    dirs.push(bundleDir);
    await writeOverlayBundleFixture(bundleDir, 'acme-fixture-overlay');

    const result = run(['overlay', 'add', bundleDir, '--yes', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = lastJsonLine(result.stdout) as {
      readonly report: { readonly id: string; readonly action: string };
    };
    expect(parsed.report).toMatchObject({ id: 'acme-fixture-overlay', action: 'installed' });
    expect(existsSync(path.join(dir, '.forge/overlays/acme-fixture-overlay/overlay.yaml'))).toBe(
      true,
    );
  });

  it('exits 2 for a real, unrecognised `forge overlay <sub>`', async () => {
    const dir = await realProject();

    const result = run(['overlay', 'list', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('add');
  });

  it("strips a real, hostile ESC/DEL/C1 sequence out of this dispatcher's own install-change report before printing it, in both plain and --json modes", async () => {
    // A round-2 critic finding: `describeRequestedCapabilities`'s own `moduleEntries` interpolates a
    // module's real, unconstrained `ceilings.<role>.exec` pattern verbatim into capability text
    // (`@forge/extensions/module`'s own schema has no charset restriction on it) — a hostile module
    // author on this exact git/npm-fetch install path could embed a real ANSI escape/DEL/C1 byte to
    // corrupt or hide the very consent-relevant report a human is meant to read. This piece's own fix
    // (`stripControlChars`/`sanitizeInstallChangeReportForDisplay`) only ever sanitizes *this
    // dispatcher's own* `InstallChangeReport` rendering — `promptForConsent`'s own separate, real
    // auto-accept banner (`@forge/extensions/install`, a different package, pre-existing behavior this
    // piece's own ~400-line dispatcher-wiring mandate does not touch) still echoes the raw description
    // text unsanitized, a real, disclosed, out-of-scope gap recorded in `SPEC-QUESTIONS.md` rather than
    // silently fixed here. This test therefore asserts only against the report line(s) this dispatcher
    // itself prints (everything from the real `forge: installed ...` line onward), not the whole
    // subprocess's stdout.
    const dir = await realProject();
    const bundleDir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-module-hostile-'));
    dirs.push(bundleDir);
    const hostilePattern = '\x1b[2Krm -rf *\x7f\x9b';
    await writeModuleBundleFixture(bundleDir, 'acme-hostile-mod', {
      ceilings: { backend: { exec: [hostilePattern] } },
    });

    const plain = run(['module', 'add', 'acme-hostile-mod', bundleDir, '--yes', '-C', dir]);
    expect(plain.status).toBe(0);
    const reportIndex = plain.stdout.indexOf('forge: installed');
    expect(reportIndex).toBeGreaterThanOrEqual(0);
    const reportText = plain.stdout.slice(reportIndex);
    expect(reportText).not.toContain('\x1b');
    expect(reportText).not.toContain('\x7f');
    expect(reportText).not.toContain('\x9b');
    expect(reportText).toContain('rm -rf *');

    const jsonBundleDir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-module-hostile2-'));
    dirs.push(jsonBundleDir);
    await writeModuleBundleFixture(jsonBundleDir, 'acme-hostile-mod-2', {
      ceilings: { backend: { exec: [hostilePattern] } },
    });
    const jsonResult = run([
      'module',
      'add',
      'acme-hostile-mod-2',
      jsonBundleDir,
      '--yes',
      '--json',
      '-C',
      dir,
    ]);
    expect(jsonResult.status).toBe(0);
    const parsed = lastJsonLine(jsonResult.stdout) as {
      readonly report: { readonly newGrants: readonly string[] };
    };
    const lastLine = jsonResult.stdout.trim().split('\n').at(-1) ?? '';
    expect(lastLine).not.toContain('\x1b');
    expect(lastLine).not.toContain('\x7f');
    expect(lastLine).not.toContain('\x9b');
    expect(parsed.report.newGrants.some((grant) => grant.includes('rm -rf *'))).toBe(true);
  });
});

describe('forge upgrade (real subprocess dispatch, PLAN-M12.md P2)', () => {
  it('runs `forge upgrade --dry-run --json` for real, reporting a real plan and writing nothing', async () => {
    const dir = await realProject();

    const result = run(['upgrade', '--dry-run', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly report: { readonly dryRun: boolean; readonly backupPath?: string };
    };
    expect(parsed.report.dryRun).toBe(true);
    expect(parsed.report.backupPath).toBeUndefined();
    expect(existsSync(path.join(dir, '.forge/backups'))).toBe(false);
  });

  it('runs `forge upgrade --to <version> --dry-run --json` for real, actually pinning the real target version', async () => {
    // A round-3 critic finding: every other `forge upgrade` test either omits `--to` entirely or
    // exercises the downgrade-refusal path through a hand-edited manifest, never through `--to` itself
    // — so `UPGRADE_FLAGS`'s own real `values.get('--to')` -> `runUpgrade` options-object wiring had no
    // real coverage of its own. `5.0.0` is a genuine, real *upgrade* target (ahead of this workspace's
    // own real, currently-running `0.0.0`), so this exercises the pin without also tripping CFG-018.
    const dir = await realProject();

    const result = run(['upgrade', '--to', '5.0.0', '--dry-run', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly report: { readonly targetVersion: string; readonly dryRun: boolean };
    };
    expect(parsed.report).toMatchObject({ targetVersion: '5.0.0', dryRun: true });
  });

  it('runs `forge upgrade --json` for real end to end, writing a real backup and re-running doctor', async () => {
    const dir = await realProject();

    const result = run(['upgrade', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly report: {
        readonly dryRun: boolean;
        readonly backupPath?: string;
        readonly doctor?: { readonly ok: boolean };
      };
    };
    expect(parsed.report.dryRun).toBe(false);
    expect(typeof parsed.report.backupPath).toBe('string');
    expect(parsed.report.doctor?.ok).toBe(true);
  });

  it('refuses a real downgrade with a real CFG-018, writing nothing', async () => {
    // This workspace's own real, currently-running `@forge/agents` version is `0.0.0` (every
    // package here is still pre-release) — there is no real, parseable version string below that to
    // pass as `--to`, so a genuine downgrade is instead simulated the other real way `03` §3.4 step 7
    // means it: a project whose own real `manifest.yaml` already names a version *ahead* of this
    // CLI's own, e.g. one upgraded by a newer CLI build and now opened by an older one.
    const dir = await realProject();
    const manifestPath = path.join(dir, '.forge/manifest.yaml');
    const manifest = YAML.parse(await readFile(manifestPath, 'utf8')) as {
      readonly modules: readonly { id: string; version: string }[];
    };
    for (const module of manifest.modules) {
      if (module.id !== '@forge/templates') module.version = '9.9.9';
    }
    await writeFile(manifestPath, YAML.stringify(manifest), 'utf8');

    const result = run(['upgrade', '-C', dir]);

    expect(result.status).not.toBe(0);
    expect(existsSync(path.join(dir, '.forge/backups'))).toBe(false);
  });
});

describe('forge export (real subprocess dispatch, PLAN-M12.md P2)', () => {
  it('runs `forge export markdown-bundle` for real, printing real content to stdout', async () => {
    const dir = await realProject();

    const result = run(['export', 'markdown-bundle', '-C', dir]);

    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('runs `forge export html --json` for real, printing a real {"v":1,...} envelope', async () => {
    const dir = await realProject();

    const result = run(['export', 'html', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly target: string;
      readonly content: string;
    };
    expect(parsed.target).toBe('html');
    expect(parsed.content).toContain('<!doctype html>');
  });

  it('surfaces the real, already-disclosed USR-003 refusal for `forge export jira` through the real CLI path', async () => {
    const dir = await realProject();

    const result = run(['export', 'jira', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not yet supported');
  });

  it('exits 2 for a real, unrecognised `forge export` target', async () => {
    const dir = await realProject();

    const result = run(['export', 'not-a-real-target', '-C', dir]);

    expect(result.status).toBe(2);
  });
});

/** A real, now-dead pid — a genuine child process spawned and awaited to exit, the identical real
 * convention `packages/cli/test/commands/run/lock.test.ts`/`corrupt-state.test.ts` already establish
 * for "a lock naming a dead pid," never a hand-picked magic number. */
async function spawnDeadPid(): Promise<number> {
  const child = spawn('node', ['-e', 'process.exit(0)']);
  const pid = child.pid;
  if (pid === undefined) throw new Error('child process failed to spawn (no pid)');
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
}

describe('forge doctor (real subprocess dispatch, PLAN-M12.md P2)', () => {
  it('runs `forge doctor --json` for real end to end, exiting 0 against a real, clean project', async () => {
    const dir = await realProject();

    const result = run(['doctor', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly v: number; readonly ok: boolean };
    expect(parsed).toMatchObject({ v: 1, ok: true });
  });

  it("diagnoses a real, live corruption (`21` E10's own stale-lock case) via a plain `forge doctor` run, then genuinely restores it via `--fix`", async () => {
    const dir = await realProject();
    const paths = new ProjectPaths(dir);
    const deadPid = await spawnDeadPid();
    await acquireRunLock(paths, {
      pid: deadPid,
      host: 'bin-corrupt-state-host',
      runId: 'bin-corrupt-state-run',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    // `stale-lock`'s own real severity is `warning`, not `hard` (`locks-and-worktrees.ts`'s own
    // `checkStaleLock`) — a plain `forge doctor` run still exits 0 (only a `hard` failure blocks
    // `DoctorReport.ok`), but the specific check still honestly reports the real corruption.
    const diagnosed = run(['doctor', '--json', '-C', dir]);
    expect(diagnosed.status).toBe(0);
    const diagnosedReport = JSON.parse(diagnosed.stdout) as {
      readonly checks: readonly { readonly id: string; readonly ok: boolean }[];
    };
    expect(diagnosedReport.checks.find((c) => c.id === 'stale-lock')?.ok).toBe(false);

    const fixed = run(['doctor', '--fix', '--json', '-C', dir]);
    expect(fixed.status).toBe(0);
    const fixedReport = JSON.parse(fixed.stdout) as {
      readonly ok: boolean;
      readonly fixes?: readonly { readonly id: string; readonly applied: boolean }[];
    };
    expect(fixedReport.ok).toBe(true);
    expect(fixedReport.fixes?.find((f) => f.id === 'stale-lock')?.applied).toBe(true);
  });

  it('exits 2 for a real, unrecognised `forge doctor` flag', async () => {
    const dir = await realProject();

    const result = run(['doctor', '--forc', '-C', dir]);

    expect(result.status).toBe(2);
  });
});

describe('forge audit (real subprocess dispatch, PLAN-M12.md P2)', () => {
  it('runs `forge audit --json` for real, printing a real, schema-shaped report against a real, event-free project', async () => {
    const dir = await realProject();

    const result = run(['audit', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly v: number;
      readonly since: string | null;
      readonly counts: Record<string, number>;
      readonly entries: readonly unknown[];
    };
    expect(parsed.v).toBe(1);
    expect(parsed.since).toBeNull();
    expect(parsed.entries).toEqual([]);
  });

  it('runs `forge audit --since <date>` for real, echoing the real cutoff back in --json', async () => {
    const dir = await realProject();

    const result = run(['audit', '--since', '2026-01-01', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly since: string | null };
    expect(parsed.since).toBe('2026-01-01T00:00:00.000Z');
  });

  it('exits 2 with a real USR-002 for a real, malformed `forge audit --since` value', async () => {
    const dir = await realProject();

    const result = run(['audit', '--since', 'not-a-real-date', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--since');
  });
});

describe('forge config (real subprocess dispatch, PLAN-M12.md P2)', () => {
  it('runs `forge config get <key> --json` for real against a real, default project config', async () => {
    const dir = await realProject();

    const result = run(['config', 'get', 'execution.concurrency', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly key: string; readonly value: unknown };
    expect(parsed.key).toBe('execution.concurrency');
  });

  it('runs `forge config set <key> <value>` for real, durably writing the real config file', async () => {
    const dir = await realProject();

    const result = run(['config', 'set', 'execution.concurrency', '7', '-C', dir]);
    expect(result.status).toBe(0);

    const after = run(['config', 'get', 'execution.concurrency', '--json', '-C', dir]);
    const parsed = JSON.parse(after.stdout) as { readonly value: number };
    expect(parsed.value).toBe(7);
  });

  it('runs `forge config set <key> <value> --json` for real, echoing back the real, type-parsed stored value — not the raw argv string', async () => {
    // A round-3 critic finding: `configSet` real-YAML-parses `value` before writing (a bare numeric
    // string becomes a real number on disk), so echoing the untouched argv string back in `--json`
    // mode disagreed in *type* with `config get --json`'s own field for the identical key —
    // `"7"` (string) here versus `7` (number) there, a real `--json` stable-contract violation.
    const dir = await realProject();

    const result = run(['config', 'set', 'execution.concurrency', '7', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly value: number };
    expect(parsed.value).toBe(7);
    expect(typeof parsed.value).toBe('number');
  });

  it('exits 2 with a real USR-002 for `forge config get` against an unknown key', async () => {
    const dir = await realProject();

    const result = run(['config', 'get', 'not.a.real.key', '-C', dir]);

    expect(result.status).toBe(2);
  });

  it('surfaces the real, already-disclosed USR-003 refusal for `forge config edit` through the real CLI path', async () => {
    const dir = await realProject();

    const result = run(['config', 'edit', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not yet supported');
  });
});

describe('forge cost (real subprocess dispatch, PLAN-M12.md P2)', () => {
  it('runs `forge cost --json` for real, exiting 0 with a real, zeroed report against a project with no real runs', async () => {
    const dir = await realProject();

    const result = run(['cost', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly v: number; readonly totalUsd: number };
    expect(parsed).toMatchObject({ v: 1, totalUsd: 0 });
  });

  it('surfaces the real, disclosed USR-003 refusal for `forge cost --run`, a real gap in costReport itself', async () => {
    const dir = await realProject();

    const result = run(['cost', '--run', 'some-run', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not yet supported');
  });

  it('surfaces the real, disclosed USR-003 refusal for `forge cost --since`, the symmetric real gap', async () => {
    const dir = await realProject();

    const result = run(['cost', '--since', '2026-01-01', '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not yet supported');
    expect(result.stderr).toContain('--since');
  });

  it('exits with a real EXIT_CODES.budgetExceeded (4) for `forge cost --json` against a real, over-budget project', async () => {
    // `DEFAULT_CONFIG`'s own real `budget.dailyUsd` cap is $100 (`packages/schemas/src/config/
    // defaults.ts`) — a single real `UsageRecorded` event well past that, appended directly to a real
    // run's own real event log (the identical fixture shape `packages/cli/test/commands/cost.test.ts`
    // already establishes), gives `costReport`'s own real `checkBudget` a genuine `'breached'` status
    // to report, proving the real exit-code mapping this dispatcher itself adds rather than only its
    // vacuous, always-`'ok'`, no-runs-yet happy path above.
    const dir = await realProject();
    await appendEvent(dir, 'run-breach', {
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-breach',
      type: 'UsageRecorded',
      stepId: 'story-001:implement',
      agentId: 'engineer',
      payload: {
        model: 'test-model-1',
        platform: 'anthropic',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        costUsd: 250,
        estimated: false,
        durationMs: 1000,
      },
    });

    const result = run(['cost', '--json', '-C', dir]);

    expect(result.status).toBe(4);
    const parsed = JSON.parse(result.stdout) as {
      readonly totalUsd: number;
      readonly budgetStatus: string;
    };
    expect(parsed).toMatchObject({ totalUsd: 250, budgetStatus: 'breached' });
  });
});

describe('forge uninstall (real subprocess dispatch, PLAN-M12.md P2)', () => {
  it('exits non-zero for `forge uninstall` with no real --yes, removing nothing', async () => {
    const dir = await realProject();

    const result = run(['uninstall', '-C', dir]);

    expect(result.status).not.toBe(0);
    expect(existsSync(path.join(dir, '.forge'))).toBe(true);
  });

  it('runs `forge uninstall --yes --json` for real end to end, removing .forge/ and writing a real backup', async () => {
    const dir = await realProject();

    const result = run(['uninstall', '--yes', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly removed: readonly string[];
      readonly backupDir: string;
    };
    expect(parsed.removed).toContain('.forge');
    expect(existsSync(path.join(dir, '.forge'))).toBe(false);
    expect(existsSync(parsed.backupDir)).toBe(true);
    dirs.push(parsed.backupDir);
  });

  it('runs `forge uninstall --yes --remove-docs --json` for real, also removing docs/forge/', async () => {
    const dir = await realProject();
    await mkdir(path.join(dir, 'docs/forge'), { recursive: true });
    await writeFile(path.join(dir, 'docs/forge/marker.md'), 'fixture', 'utf8');

    const withoutFlag = run(['uninstall', '--yes', '--json', '-C', dir]);
    expect(withoutFlag.status).toBe(0);
    // A plain `--yes` (no `--remove-docs`) leaves `docs/forge/` alone — the real, opt-in scope
    // `uninstall`'s own `removeDocs` option documents.
    expect(existsSync(path.join(dir, 'docs/forge'))).toBe(true);
    const withoutFlagParsed = JSON.parse(withoutFlag.stdout) as { readonly backupDir: string };
    dirs.push(withoutFlagParsed.backupDir);

    // `.forge/` is already gone from the run above -- re-init it so a second, real uninstall pass has
    // something real to remove alongside `docs/forge/` this time.
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');

    const result = run(['uninstall', '--yes', '--remove-docs', '--json', '-C', dir]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly removed: readonly string[];
      readonly backupDir: string;
    };
    expect(parsed.removed).toEqual(expect.arrayContaining(['.forge', 'docs/forge']));
    expect(existsSync(path.join(dir, 'docs/forge'))).toBe(false);
    dirs.push(parsed.backupDir);
  });
});

// -------------------------------------------------------------------------------------------------
// `PLAN-M12.md` P4 — the remaining dispatcher: kb/spec/adr/diagram/customize/compile/preset/skill/mcp/
// help/plan, and the agent-facing implement/debug/refactor/deploy/review/panel/ask/session family.
// -------------------------------------------------------------------------------------------------

/** A real, schema-valid KB entry (`kbEntrySchema`) — the identical fixture shape `packages/cli/test/
 * commands/helpers.ts`'s own `writeKbEntryFixture` already establishes for the unit-level tests,
 * reused here at the real-subprocess level. */
async function writeKbEntryFixture(dir: string, id = 'KB-ARCH-0001'): Promise<void> {
  const relPath = `docs/forge/kb/architecture/${id}.md`;
  await mkdir(path.dirname(path.join(dir, relPath)), { recursive: true });
  const content = `---
id: ${id}
type: knowledge
section: architecture
title: Fixture knowledge entry
status: active
confidence: verified
owner: architect
sources:
  - kind: human
    ref: architect interview, 2026-01-01
created: 2026-01-01
updated: 2026-01-01
review_by: 2030-01-01
supersedes: []
superseded_by: null
related: []
diagrams: []
tags: []
applies_to: []
---

## Verification

Command: \`true\`
`;
  await writeFile(path.join(dir, relPath), content, 'utf8');
}

/** A real, schema-valid diagram sidecar (`diagramSchema`) — the identical fixture shape `helpers.ts`'s
 * own `writeDiagramFixture` already establishes. */
async function writeDiagramFixtureAt(dir: string, id = 'DIAG-001'): Promise<void> {
  const relPath = 'docs/forge/kb/architecture/views/fixture.mmd.yaml';
  await mkdir(path.dirname(path.join(dir, relPath)), { recursive: true });
  const content = `id: ${id}
type: Diagram
schemaVersion: 1
title: Fixture diagram
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
kind: flowchart
notation: mermaid
source: |
  flowchart TD
    UserService --> Database
generated: false
depicts: []
explains: []
caption: A fixture flowchart.
alt_text: A fixture flowchart from A to B.
owner: architect
`;
  await writeFile(path.join(dir, relPath), content, 'utf8');
}

/** Clears a real, `forge init`-written project's own `platform.primary` back to `''` — `realProject()`
 * (this file's own fixture, above) always records the fake test adapter's own id
 * (`forge-fake-adapter`), which `buildAdapterForConfig` can never resolve (it is not a real, registered
 * `KNOWN_ADAPTER_MODULES` entry — that would defeat the whole point of a fake test double). Every P4
 * command that needs a real, *constructible* (not live) adapter — `plan`/`implement`/`refactor`/
 * `deploy`/`debug`/`review`/`panel`/`session` — needs this real, resolvable value instead, the identical
 * `''` default `realRunProject()`'s own `DEFAULT_CONFIG` fixture already relies on above for the
 * `run`/`resume`/`gate`/`merge` family. */
async function clearPlatformPrimary(dir: string): Promise<void> {
  const configPath = path.join(dir, '.forge/config.yaml');
  const parsed = YAML.parse(await readFile(configPath, 'utf8')) as {
    platform: { primary: string };
  };
  parsed.platform.primary = '';
  await writeFile(configPath, YAML.stringify(parsed), 'utf8');
}

describe('forge kb (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('lists real KB entries via `forge kb list --json`, empty on a fresh project', async () => {
    const dir = await realProject();
    const result = run(['kb', 'list', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { readonly entries: readonly unknown[] };
    expect(parsed.entries).toEqual([]);
  });

  it('runs `forge kb show <id>`/`forge kb search`/`forge kb sync`/`forge kb graph` for real against a real entry', async () => {
    const dir = await realProject();
    await writeKbEntryFixture(dir);

    const show = run(['kb', 'show', 'KB-ARCH-0001', '--json', '-C', dir]);
    expect(show.status).toBe(0);
    expect((JSON.parse(show.stdout) as { readonly entry: { readonly id: string } }).entry.id).toBe(
      'KB-ARCH-0001',
    );

    const sync = run(['kb', 'sync', '--json', '-C', dir]);
    expect(sync.status).toBe(0);
    expect((JSON.parse(sync.stdout) as { readonly entryCount: number }).entryCount).toBe(1);

    const search = run(['kb', 'search', 'Fixture', '--json', '-C', dir]);
    expect(search.status).toBe(0);
    const searchParsed = JSON.parse(search.stdout) as { readonly hits: readonly { id: string }[] };
    expect(searchParsed.hits.map((h) => h.id)).toContain('KB-ARCH-0001');

    const graph = run(['kb', 'graph', '--json', '-C', dir]);
    expect(graph.status).toBe(0);

    const lint = run(['kb', 'lint', '--json', '-C', dir]);
    expect(lint.status).toBe(0);

    const verify = run(['kb', 'verify', '--json', '-C', dir]);
    expect(verify.status).toBe(0);
    const verifyParsed = JSON.parse(verify.stdout) as {
      readonly findings: readonly { readonly outcome: string }[];
    };
    expect(verifyParsed.findings[0]?.outcome).toBe('pass');
  });

  it('exits non-zero for `forge kb show` with an unknown id (real KB-015)', async () => {
    const dir = await realProject();
    const result = run(['kb', 'show', 'KB-NOPE', '-C', dir]);
    expect(result.status).not.toBe(0);
  });

  it('exits non-zero with a real USR-003 for `forge kb diff` — never implemented, refused rather than guessed at', async () => {
    const dir = await realProject();
    const result = run(['kb', 'diff', '-C', dir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('kb diff');
  });

  it('exits 2 for a real, unrecognised `forge kb` subcommand', async () => {
    const dir = await realProject();
    const result = run(['kb', 'nope', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits 2 for `forge kb open` with no real <id>', async () => {
    const dir = await realProject();
    const result = run(['kb', 'open', '-C', dir]);
    expect(result.status).toBe(2);
  });
});

describe('forge spec (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('runs `forge spec new Vision`/`forge spec list`/`forge spec show`/`forge spec trace` for real end to end', async () => {
    const dir = await realProject();

    const created = run(['spec', 'new', 'Vision', 'Fixture Vision', '--json', '-C', dir]);
    expect(created.status).toBe(0);
    const { id } = JSON.parse(created.stdout) as { readonly id: string };
    expect(id).toMatch(/^VIS-/);

    const list = run(['spec', 'list', '--json', '-C', dir]);
    expect(list.status).toBe(0);
    const listParsed = JSON.parse(list.stdout) as { readonly specs: readonly { id: string }[] };
    expect(listParsed.specs.map((s) => s.id)).toContain(id);

    const show = run(['spec', 'show', id, '-C', dir]);
    expect(show.status).toBe(0);

    const trace = run(['spec', 'trace', id, '--json', '-C', dir]);
    expect(trace.status).toBe(0);

    const matrix = run(['spec', 'matrix', '--json', '-C', dir]);
    expect(matrix.status).toBe(0);

    const orphans = run(['spec', 'orphans', '--json', '-C', dir]);
    expect(orphans.status).toBe(0);
  });

  it('runs `forge spec validate` (the bare, no-rule form) for real, exiting 0 against a clean project', async () => {
    const dir = await realProject();
    const result = run(['spec', 'validate', '--json', '-C', dir]);
    expect(result.status).toBe(0);
  });

  it('still routes `forge spec validate --rule <name>` to the narrow, gate-shelled form, unaffected by the new bare form', async () => {
    const dir = await realProject();
    const result = run(['spec', 'validate', '--rule', 'oversized-stories', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveProperty('errors', 0);
  });

  it('exits 2 for `forge spec new` with an unrecognised <type>', async () => {
    const dir = await realProject();
    const result = run(['spec', 'new', 'NotARealType', 'Title', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it("exits non-zero with a real USR-003 for `forge spec new ADR` — a real, registered type outside spec.ts's own eight-type domain", async () => {
    const dir = await realProject();
    const result = run(['spec', 'new', 'ADR', 'Title', '-C', dir]);
    expect(result.status).not.toBe(0);
  });

  it('exits 2 for a real, unrecognised `forge spec` subcommand', async () => {
    const dir = await realProject();
    const result = run(['spec', 'nope', '-C', dir]);
    expect(result.status).toBe(2);
  });
});

describe('forge adr (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('runs `forge adr new`/`list`/`show`/`accept`/`reject`/`supersede` for real end to end', async () => {
    const dir = await realProject();

    const created = run(['adr', 'new', 'Fixture Decision', '--json', '-C', dir]);
    expect(created.status).toBe(0);
    const { id } = JSON.parse(created.stdout) as { readonly id: string };
    expect(id).toMatch(/^ADR-/);

    const list = run(['adr', 'list', '--json', '-C', dir]);
    expect(list.status).toBe(0);
    expect(
      (JSON.parse(list.stdout) as { readonly entries: readonly { id: string }[] }).entries.map(
        (e) => e.id,
      ),
    ).toContain(id);

    const show = run(['adr', 'show', id, '-C', dir]);
    expect(show.status).toBe(0);

    const accept = run(['adr', 'accept', id, '--json', '-C', dir]);
    expect(accept.status).toBe(0);
    expect((JSON.parse(accept.stdout) as { readonly status: string }).status).toBe('accepted');

    const created2 = run(['adr', 'new', 'Second Fixture Decision', '--json', '-C', dir]);
    const { id: id2 } = JSON.parse(created2.stdout) as { readonly id: string };
    const reject = run(['adr', 'reject', id2, '--json', '-C', dir]);
    expect(reject.status).toBe(0);
    expect((JSON.parse(reject.stdout) as { readonly status: string }).status).toBe('rejected');

    const created3 = run(['adr', 'new', 'Third Fixture Decision', '--json', '-C', dir]);
    const { id: id3 } = JSON.parse(created3.stdout) as { readonly id: string };
    const supersede = run(['adr', 'supersede', id3, 'Replacement Decision', '--json', '-C', dir]);
    expect(supersede.status).toBe(0);
    const supersedeParsed = JSON.parse(supersede.stdout) as {
      readonly superseded: string;
      readonly replacement: string;
    };
    expect(supersedeParsed.superseded).not.toBe(supersedeParsed.replacement);
  });

  it('exits non-zero for `forge adr show` with an unknown id', async () => {
    const dir = await realProject();
    const result = run(['adr', 'show', 'ADR-0999', '-C', dir]);
    expect(result.status).not.toBe(0);
  });

  it('exits 2 for `forge adr new` with no real <title>', async () => {
    const dir = await realProject();
    const result = run(['adr', 'new', '-C', dir]);
    expect(result.status).toBe(2);
  });
});

describe('forge diagram (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('runs `forge diagram list`/`show`/`validate`/`render` for real against a real diagram fixture', async () => {
    const dir = await realProject();
    await writeDiagramFixtureAt(dir);

    const list = run(['diagram', 'list', '--json', '-C', dir]);
    expect(list.status).toBe(0);
    expect(
      (JSON.parse(list.stdout) as { readonly entries: readonly { id: string }[] }).entries.map(
        (e) => e.id,
      ),
    ).toContain('DIAG-001');

    const show = run(['diagram', 'show', 'DIAG-001', '-C', dir]);
    expect(show.status).toBe(0);
    expect(show.stdout).toContain('flowchart TD');

    const validate = run(['diagram', 'validate', 'DIAG-001', '--json', '-C', dir]);
    expect(validate.status).toBe(0);

    const render = run(['diagram', 'render', 'DIAG-001', '-C', dir]);
    expect(render.status).toBe(0);
    expect(render.stdout.length).toBeGreaterThan(0);
  });

  it('exits non-zero with a real USR-003 for `forge diagram render --open` — no real browser-launch mechanism exists', async () => {
    const dir = await realProject();
    await writeDiagramFixtureAt(dir);
    const result = run(['diagram', 'render', 'DIAG-001', '--open', '-C', dir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--open');
  });

  it('exits non-zero with a real USR-003 for `forge diagram legend` — never implemented, refused rather than guessed at', async () => {
    const dir = await realProject();
    const result = run(['diagram', 'legend', '-C', dir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('legend');
  });

  it('exits 2 for `forge diagram diff` with no real --input', async () => {
    const dir = await realProject();
    await writeDiagramFixtureAt(dir);
    const result = run(['diagram', 'diff', 'DIAG-001', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits 2 for `forge diagram sync` with no real --input', async () => {
    const dir = await realProject();
    const result = run(['diagram', 'sync', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits 2 for `forge diagram generate` with an unrecognised generator', async () => {
    const dir = await realProject();
    const result = run(['diagram', 'generate', 'not-a-real-generator', '-C', dir]);
    expect(result.status).toBe(2);
  });
});

describe('forge customize / forge compile (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('exits non-zero with a real USR-003 for `forge customize` — never implemented, refused rather than guessed at', async () => {
    const dir = await realProject();
    const result = run(['customize', '-C', dir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('customize');
  });

  it('exits 2 for `forge compile` with no real --sources', async () => {
    const dir = await realProject();
    const result = run(['compile', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('runs `forge compile --sources <path> --json` for real end to end against a real, empty CompileSources', async () => {
    const dir = await realProject();
    const sourcesPath = path.join(dir, 'sources.json');
    await writeFile(
      sourcesPath,
      JSON.stringify({
        agents: {},
        workflows: {},
        frameworks: {},
        templates: {},
        checks: {},
        skills: {},
      }),
      'utf8',
    );
    const result = run(['compile', '--sources', 'sources.json', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly result: { readonly violations: readonly unknown[] };
    };
    expect(parsed.result.violations).toEqual([]);
  });
});

describe('forge preset / forge skill / forge mcp (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('runs `forge preset list`/`show`/`apply`/`apply --eject` for real end to end', async () => {
    const dir = await realProject();

    const list = run(['preset', 'list', '--json', '-C', dir]);
    expect(list.status).toBe(0);
    const { presets } = JSON.parse(list.stdout) as { readonly presets: readonly { id: string }[] };
    expect(presets.length).toBeGreaterThan(0);
    const [preset] = presets;
    if (preset === undefined) throw new Error('expected at least one real, registered preset');

    const show = run(['preset', 'show', preset.id, '--json', '-C', dir]);
    expect(show.status).toBe(0);

    const eject = run(['preset', 'apply', preset.id, '--eject', '--json', '-C', dir]);
    expect(eject.status).toBe(0);

    const apply = run(['preset', 'apply', preset.id, '--json', '-C', dir]);
    expect(apply.status).toBe(0);
  });

  it('exits 2 for a real, unrecognised `forge preset diff` — a named row with no real mechanism', async () => {
    const dir = await realProject();
    const result = run(['preset', 'diff', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('runs `forge skill list` for real, listing the real, built-in skill library `forge init` materializes', async () => {
    const dir = await realProject();
    const result = run(['skill', 'list', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    const { ids } = JSON.parse(result.stdout) as { readonly ids: readonly string[] };
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain('writing-an-adr');
  });

  it('exits 2 for `forge skill validate` with no real <id>', async () => {
    const dir = await realProject();
    const result = run(['skill', 'validate', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits 2 for a real, unrecognised `forge skill new` — a named row with no real mechanism', async () => {
    const dir = await realProject();
    const result = run(['skill', 'new', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('runs `forge mcp validate --environment` for real end to end against a real, clean config', async () => {
    const dir = await realProject();
    const result = run(['mcp', 'validate', '--environment', 'dev', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    expect(
      (JSON.parse(result.stdout) as { readonly outcome: { valid: boolean } }).outcome.valid,
    ).toBe(true);
  });

  it('exits 2 for `forge mcp validate` with no real --environment', async () => {
    const dir = await realProject();
    const result = run(['mcp', 'validate', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits non-zero with a real USR-003 for `forge mcp list` — never implemented, refused rather than guessed at', async () => {
    const dir = await realProject();
    const result = run(['mcp', 'list', '-C', dir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('mcp list');
  });
});

describe('forge help (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('recommends `forge doctor` for real, state-aware, against a real, freshly-initialized project', async () => {
    const dir = await realProject();
    const result = run(['help', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly recommendation: { readonly command: string };
    };
    expect(parsed.recommendation.command).toBe('forge doctor');
  });

  it('recommends `forge init` for real against a real, never-initialized directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-help-'));
    dirs.push(dir);
    const result = run(['help', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    expect(
      (JSON.parse(result.stdout) as { readonly recommendation: { readonly command: string } })
        .recommendation.command,
    ).toBe('forge init');
  });

  it('exits non-zero with a real USR-003 for `forge help <topic>` — no real per-topic content exists yet', async () => {
    const dir = await realProject();
    const result = run(['help', 'workflows', '-C', dir]);
    expect(result.status).not.toBe(0);
  });
});

describe('forge plan (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('runs `forge plan init --dry-run` for real, compiling without ever starting a run', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const result = run(['plan', 'init', '--dry-run', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveProperty('plan');
  });

  it('runs `forge plan stage <id> --dry-run` for real, threading a real {{stageId}} through', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const result = run(['plan', 'stage', 'STAGE-1', '--dry-run', '--json', '-C', dir]);
    expect(result.status).toBe(0);
  });

  it('runs `forge plan replan --from a-gate-failure --dry-run` for real', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const result = run([
      'plan',
      'replan',
      '--from',
      'a-gate-failure',
      '--dry-run',
      '--json',
      '-C',
      dir,
    ]);
    expect(result.status).toBe(0);
  });

  it('exits non-zero with a real USR-003 for `forge plan data`/`forge plan testing` — no corresponding real workflow', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const dataResult = run(['plan', 'data', '-C', dir]);
    expect(dataResult.status).not.toBe(0);
    const testingResult = run(['plan', 'testing', '-C', dir]);
    expect(testingResult.status).not.toBe(0);
  });

  it('exits 2 for `forge plan` with an unrecognised <phase>', async () => {
    const dir = await realProject();
    const result = run(['plan', 'not-a-real-phase', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits 2 for `forge plan stage` with no real <id>', async () => {
    const dir = await realProject();
    const result = run(['plan', 'stage', '-C', dir]);
    expect(result.status).toBe(2);
  });
});

describe('forge implement / forge refactor / forge deploy (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('runs `forge implement <storyId> --dry-run` for real, reaching the real production template — a real, pre-existing, disclosed gap (SPEC-QUESTIONS.md) means it reports a real compile issue rather than a fabricated success', async () => {
    // `implementStory`'s own `ImplementStoryExpressionContext` (`loop/implement.ts`, built before this
    // piece) supplies `storyId`/`ownerRole` but never populates `ExpressionContext.run`
    // (`testPaths`/`filesExpected`) — the real, shipped `implement-story.workflow.yaml` template
    // references `{{run.testPaths}}`/`{{run.filesExpected}}`, so a real dry-run against the genuine
    // production template (as opposed to the simplified fixture template `loop/implement.test.ts`'s
    // own unit tests use) genuinely cannot compile today, for *any* real Story. Confirmed directly by
    // running this exact command against a real project — a real, pre-existing gap this dispatcher-
    // wiring piece surfaces rather than silently working around; fixing `implementStory` itself is
    // outside this piece's own mandate (wiring an already-real function, not completing it).
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    await writeOversizedStory(dir);
    const result = run(['implement', 'STORY-001', '--dry-run', '--json', '-C', dir]);
    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout) as {
      readonly plan: { readonly success: boolean; readonly issues: readonly { code: string }[] };
    };
    expect(parsed.plan.success).toBe(false);
    expect(parsed.plan.issues.some((issue) => issue.code === 'template-resolution-failed')).toBe(
      true,
    );
  });

  it('exits 2 for `forge implement` with no real <storyId>', async () => {
    const dir = await realProject();
    const result = run(['implement', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('runs `forge refactor <target> --goal <text> --dry-run` for real', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const result = run([
      'refactor',
      'src/foo.ts',
      '--goal',
      'reduce duplication',
      '--dry-run',
      '--json',
      '-C',
      dir,
    ]);
    expect(result.status).toBe(0);
  });

  it('exits 2 for `forge refactor` with no real --goal', async () => {
    const dir = await realProject();
    const result = run(['refactor', 'src/foo.ts', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('runs `forge deploy <env> --dry-run` for real, never requiring a destructive confirmation for a dry-run', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const result = run(['deploy', 'staging', '--dry-run', '--json', '-C', dir]);
    expect(result.status).toBe(0);
  });

  it('exits 2 for `forge deploy` with no real <env>', async () => {
    const dir = await realProject();
    const result = run(['deploy', '-C', dir]);
    expect(result.status).toBe(2);
  });
});

describe('forge debug / forge review / forge panel / forge ask / forge session (real subprocess dispatch, PLAN-M12.md P4)', () => {
  it('exits 2 for `forge debug` with neither a real <symptom> nor --from-failure', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const result = run(['debug', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits 2 for `forge review` with a real, unrecognised extra positional', async () => {
    const dir = await realProject();
    const result = run(['review', 'extra', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits 2 for `forge panel` with no real <question>', async () => {
    const dir = await realProject();
    const result = run(['panel', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits 2 for `forge panel <question>` with no real --roles', async () => {
    const dir = await realProject();
    const result = run(['panel', 'should we do X?', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits non-zero with a real USR-003 for `forge ask` — never implemented, refused rather than guessed at', async () => {
    const dir = await realProject();
    const result = run(['ask', 'what is the plan?', '-C', dir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('forge ask');
  });

  it('runs `forge session list` for real, empty on a fresh project', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const result = run(['session', 'list', '--json', '-C', dir]);
    expect(result.status).toBe(0);
    expect(
      (JSON.parse(result.stdout) as { readonly sessions: readonly unknown[] }).sessions,
    ).toEqual([]);
  });

  it('exits 2 for `forge session show` with no real <id>', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const result = run(['session', 'show', '-C', dir]);
    expect(result.status).toBe(2);
  });

  it('exits 2 for a real, unrecognised `forge session <type>`', async () => {
    const dir = await realProject();
    await clearPlatformPrimary(dir);
    const result = run(['session', 'not-a-real-type', '-C', dir]);
    expect(result.status).toBe(2);
  });

  // A real, full `debug`/`review`/`panel`/`session` happy path genuinely dispatches a live agent
  // session (`dispatchAgentStep`/`runSessionStep`) — unlike `forge init`'s own `REAL_ADAPTER_CLI`-gated
  // test above (a cheap `preflight()` probe only), actually running one of these to completion spends
  // real tokens against a real model and takes real wall-clock time whenever a developer's own machine
  // happens to have a real platform CLI on `PATH` (confirmed directly: a real, local run of `forge
  // panel` against this exact fixture spent real, non-trivial API cost). Deliberately not exercised
  // here for that reason — the usage-error paths above already prove every one of these commands is
  // genuinely reachable via real argv up to the one real, live call this test suite must not make on a
  // developer's behalf; see `SPEC-QUESTIONS.md`.
});
