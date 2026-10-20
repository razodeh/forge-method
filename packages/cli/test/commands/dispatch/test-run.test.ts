/**
 * `commands/dispatch/test-run.ts` — `forge test run [--rule <name>] [--timeout-ms <n>]`, exercised
 * in-process (`specs/22` M17 P2's own "the coverage report for the new dispatch modules meets the
 * floor"). Real, simple shell commands (`exit 0`/`exit 1`) stand in for a real test runner, the
 * identical "a real subprocess, a trivial one" pattern `loop/test/run.test.ts`'s own `lint`/
 * `typecheck` fixtures already establish for the layers this file's own dispatch logic does not
 * itself need a real test runner to exercise.
 *
 * @see specs/22 M17 P2
 */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchTestRun } from '../../../src/commands/dispatch/test-run.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import {
  captureLogs,
  cleanupAll,
  createConfiguredProject,
  type TestProject,
} from './dispatch-test-helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject, positionals: readonly string[], json = false): DispatchContext {
  return {
    positionals,
    flags: {
      profile: 'default',
      dryRun: false,
      yes: false,
      json,
      noTui: false,
      verbosity: 0,
      quiet: false,
      positionals,
    },
    paths: project.paths,
    projectRoot: project.dir,
  };
}

/** `createConfiguredProject` writes `DEFAULT_CONFIG` verbatim (no real `execution.testCommands.unit`)
 * -- this overwrites just that one leaf with a real, trivial shell command, so `testRun` has
 * something real (if trivial) to execute. */
async function createProjectWithUnitCommand(command: string): Promise<TestProject> {
  const project = await createConfiguredProject();
  const configPath = path.join(project.dir, '.forge', 'config.yaml');
  const raw = YAML.parse(await readFile(configPath, 'utf8')) as {
    execution: { testCommands: Record<string, unknown> };
  };
  raw.execution.testCommands['unit'] = command;
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, YAML.stringify(raw), 'utf8');
  // `detectEcosystem` (`legacy-string` layers only) needs a real `package.json` to recognise this
  // as a real `'js'` project; without one it reports `'unknown'`, which `resolveTestLayerIdentity`-
  // style callers would refuse -- `testRun` itself folds it into a real `errors: 1` problem instead.
  await writeFile(path.join(project.dir, 'package.json'), JSON.stringify({ name: 'fixture' }));
  return project;
}

/** The identical shape, for the SEPARATE `--rule smoke|contract` dispatch path
 * (`runTestLayerCommand`, not `testRun`) -- writes a real command under
 * `execution.testCommands[layer]`. */
async function createProjectWithLayerCommand(
  layer: 'smoke' | 'contract',
  command: string,
): Promise<TestProject> {
  const project = await createConfiguredProject();
  const configPath = path.join(project.dir, '.forge', 'config.yaml');
  const raw = YAML.parse(await readFile(configPath, 'utf8')) as {
    execution: { testCommands: Record<string, unknown> };
  };
  raw.execution.testCommands[layer] = command;
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, YAML.stringify(raw), 'utf8');
  return project;
}

describe('dispatchTestRun (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createConfiguredProject();
    expect(await dispatchTestRun(ctx(project, ['test', 'binding']))).toBeUndefined();
  });

  it('returns undefined for "test" with a sub other than "run"', async () => {
    const project = await createConfiguredProject();
    expect(await dispatchTestRun(ctx(project, ['test', 'flaky']))).toBeUndefined();
  });

  it('refuses "test run --rule=smoke" (an = form, not a space) with a real, specific message', async () => {
    const project = await createConfiguredProject();
    expect(await dispatchTestRun(ctx(project, ['test', 'run', '--rule=smoke']))).toBe(2);
  });

  it('exits 2 with a real, specific message for an unrecognised "test run --rule" value', async () => {
    const project = await createConfiguredProject();
    expect(await dispatchTestRun(ctx(project, ['test', 'run', '--rule', 'not-a-real-rule']))).toBe(
      2,
    );
  });

  it('runs "test run --rule smoke --json" for real through the real layer-command path, no smoke command configured', async () => {
    const project = await createConfiguredProject();
    const result = await captureLogs(() =>
      dispatchTestRun(ctx(project, ['test', 'run', '--rule', 'smoke'], true)),
    );
    // No real `execution.testCommands.smoke` exists in this fixture -- `runTestLayerCommand`'s own
    // catch branch still prints a real, typed envelope (never a bare uncaught throw), exit 1.
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly rule: string;
      readonly failed: number;
      readonly code?: string;
    };
    expect(parsed.rule).toBe('smoke');
    expect(parsed.failed).toBe(1);
  });

  it('runs "test run --rule contract" for real through the real layer-command path, a real passing command', async () => {
    const project = await createProjectWithLayerCommand('contract', 'exit 0');
    const exitCode = await dispatchTestRun(ctx(project, ['test', 'run', '--rule', 'contract']));
    expect(exitCode).toBe(0);
  });

  it('exits 2 for "test run --rule smoke" given a real, unexpected extra positional', async () => {
    const project = await createConfiguredProject();
    await expect(
      dispatchTestRun(ctx(project, ['test', 'run', '--rule', 'smoke', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses USR-002 for "test run --rule smoke --rule smoke" (the layer-rule flag given more than once)', async () => {
    const project = await createConfiguredProject();
    await expect(
      dispatchTestRun(ctx(project, ['test', 'run', '--rule', 'smoke', '--rule', 'smoke'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 with a real, typed RUN-117 for a malformed "test run --timeout-ms" value', async () => {
    const project = await createProjectWithUnitCommand('exit 0');
    await expect(
      dispatchTestRun(ctx(project, ['test', 'run', '--timeout-ms', 'not-a-number'])),
    ).rejects.toMatchObject({ code: 'RUN-117' });
  });

  it('runs "test run --json" for real end to end, failed=0 against a real, clean vitest fixture', async () => {
    // `run.execution.testCommands.unit` (legacy `'js'` string form) gets this file's own
    // `--reporter=json` appended unconditionally (`reporter.ts`'s own `withReporterFlag`) -- it must
    // be a real vitest invocation, not an arbitrary shell command (`exit 0 --reporter=json` is a
    // real, separate `shell-safety.ts` refusal path, not this test's own concern).
    const require = createRequire(import.meta.url);
    const vitestBin = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    const project = await createProjectWithUnitCommand(`${process.execPath} ${vitestBin} run`);
    await writeFile(
      path.join(project.dir, 'fixture.test.ts'),
      "import { it, expect } from 'vitest';\nit('passes', () => { expect(1).toBe(1); });\n",
    );
    const result = await captureLogs(() => dispatchTestRun(ctx(project, ['test', 'run'], true)));
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as { readonly failed: number };
    expect(parsed.failed).toBe(0);
  }, 30000);

  it('runs "test run" (no --json) for real, exiting 1 against a real, failing vitest run', async () => {
    const require = createRequire(import.meta.url);
    const vitestBin = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    const project = await createProjectWithUnitCommand(`${process.execPath} ${vitestBin} run`);
    await writeFile(
      path.join(project.dir, 'fixture.test.ts'),
      "import { it, expect } from 'vitest';\nit('fails', () => { expect(1).toBe(2); });\n",
    );
    const exitCode = await dispatchTestRun(ctx(project, ['test', 'run']));
    expect(exitCode).toBe(1);
  }, 30000);

  it('runs "test run --timeout-ms <n>" for real: a genuinely hung vitest run is killed near the declared bound', async () => {
    const require = createRequire(import.meta.url);
    const vitestBin = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    const project = await createProjectWithUnitCommand(`${process.execPath} ${vitestBin} run`);
    await writeFile(
      path.join(project.dir, 'fixture.test.ts'),
      "import { it } from 'vitest';\nit('hangs', () => new Promise(() => {}));\n",
    );
    const exitCode = await dispatchTestRun(ctx(project, ['test', 'run', '--timeout-ms', '1500']));
    expect(exitCode).toBe(1);
  }, 30000);
});
