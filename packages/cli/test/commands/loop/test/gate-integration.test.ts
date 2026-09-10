/**
 * `evaluateGate` against the real, shipped `G-Verify.gate.yaml` and this piece's own real `forge
 * test run [--rule lint|typecheck] --json` CLI wiring — `PLAN-M8.md` P4's own Checks section asks
 * for exactly this: "running `evaluateGate` against the real gate definition and this real command
 * ... produces the correct `passed`/`failed` gate outcome end-to-end," which no other test file
 * proves (`run.test.ts`/`bin.test.ts` each stop at `testRun`'s own JSON envelope, never feeding it
 * through the real `failOn` expression evaluator against the real, committed check ids).
 *
 * @see specs/13 §13.1 F-TEST-7
 * @see PLAN-M8.md P4
 */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
