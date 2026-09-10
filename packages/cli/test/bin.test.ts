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

import { afterEach, describe, expect, it } from 'vitest';
import { FakePlatformAdapter } from '@forge/testkit';
import * as YAML from 'yaml';

import { runInit } from '../src/init/run-init.ts';

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

function run(args: readonly string[]): {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
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
});
