/**
 * `forge doctor --rule test-command` (`G-Foundation`'s `test:command`, `PLAN-M13.md` P23, `SPEC-QUESTIONS.md` Q230;
 * `10` §10.3 "no test command", `13` §13.1 F-TEST-1 rule 4, `14` §14.9).
 *
 * The rule passes only when the project has a usable single-command `unit` command and every other layer that becomes an
 * exec grant (integration, lint, typecheck) that IS configured is one plain command whose program is found. Each clause has a
 * failing fixture; the real CLI prints the `v:1` envelope the gate reads (`errors`), and nothing here runs a test suite.
 *
 * `granted` (`PLAN-M14.md` P1, `SPEC-QUESTIONS.md` Q233, `15` §15.3.2): the same envelope also carries every
 * configured `AGENT_RUN_LAYERS` layer whose command passes `checkTestCommand` (`@forge/engine/dispatch`
 * `deriveTestExec`) — the PROJECT-WIDE CEILING, visible without reading a run's `context.json`. This is NOT any one
 * step's own grant, which is narrower: a real step is derived over `testLayersForBrief(briefKey)`, not every
 * `AGENT_RUN_LAYERS` layer (`engine/dispatch/assemble.ts`, `cli/commands/loop/debug.ts`), so a narrow-brief step
 * (`rca`, `debug-isolate`, `write-failing-tests`: `unit`/`integration` only) is granted a strict subset of what this
 * rule lists when `lint`/`typecheck` are also configured. A layer can be `granted` and still carry a *violation*
 * (its program does not resolve, or it is a no-op): the grant is about the STRING being exact and safe, not about
 * the command working.
 */
import { execFile } from 'node:child_process';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { deriveTestExec, testLayersForBrief } from '@forge/engine/dispatch';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { doctorRule } from '../../../src/commands/doctor/rules.ts';
import { programResolves } from '../../../src/commands/doctor/rules-test-command.ts';
import { KB_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

const run = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL('../../../bin/forge.mjs', import.meta.url));

/** The environment snapshot a rule is handed: a PATH that finds `node` (this process's own) and nothing else of the host's. */
const NODE_DIR = path.dirname(process.execPath);
const ENV: Record<string, string> = { PATH: NODE_DIR };

async function ruleResult(
  dir: string,
  testCommands: Record<string, string> | undefined,
  env: Record<string, string> = ENV,
) {
  return doctorRule(
    {
      paths: new ProjectPaths(dir),
      projectRoot: dir,
      kbRoot: KB_ROOT,
      reportsRoot: 'docs/forge/reports',
      env,
      ...(testCommands === undefined ? {} : { testCommands }),
    },
    'test-command',
  );
}

async function violations(
  dir: string,
  testCommands: Record<string, string> | undefined,
  env: Record<string, string> = ENV,
) {
  return (await ruleResult(dir, testCommands, env)).violations;
}

describe('test-command: a required unit command', () => {
  it('fails when nothing is configured (no map at all, or an empty one), naming the key and the command that sets it', async () => {
    const { dir } = await createTestProject();
    for (const testCommands of [undefined, {}]) {
      const found = await violations(dir, testCommands);
      expect(found).toHaveLength(1);
      expect(found[0]?.subject).toBe('execution.testCommands.unit');
      expect(found[0]?.message).toMatch(/no test command is configured/);
      expect(found[0]?.remedy).toMatch(
        /^Run `forge config set execution\.testCommands\.unit "<command>"`/,
      );
    }
  });

  it('a project that configures only e2e/smoke/contract has no test command: those layers do not satisfy the rule', async () => {
    const { dir } = await createTestProject();
    const found = await violations(dir, {
      e2e: 'node -e "0"',
      smoke: 'node -e "0"',
      contract: 'node -e "0"',
    });
    expect(found.map((entry) => entry.subject)).toEqual(['execution.testCommands.unit']);
  });

  it('passes with a unit command whose program is on PATH', async () => {
    const { dir } = await createTestProject();
    expect(await violations(dir, { unit: 'node -e "process.exitCode=0"' })).toEqual([]);
  });
});

describe('test-command: one plain command, or a violation with a remedy', () => {
  it.each([
    ['chained with &&', 'node --version && node --version', /chains, redirects or substitutes/],
    ['a second line', 'node --version\nnode --version', /more than one line/],
    ['a wildcard', 'node --test tests/*.test.js', /"\*"/],
    ['a variable prefix', 'CI=1 node --version', /variable assignment/],
    ['an expansion', 'node $HOME/x.js', /expands|"\$"/],
    ['blank', '   ', /empty/],
  ])('rejects %s', async (_name, value, message) => {
    const { dir } = await createTestProject();
    const found = await violations(dir, { unit: value });
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('execution.testCommands.unit');
    expect(found[0]?.message).toMatch(message);
    expect(found[0]?.remedy.length).toBeGreaterThan(20);
  });

  it('holds a configured integration, lint and typecheck command to the same rule, but not an unset one', async () => {
    const { dir } = await createTestProject();
    const found = await violations(dir, {
      unit: 'node -e "0"',
      integration: 'node -e "0" && node -e "1"',
      lint: 'node -e "0"',
      typecheck: 'node -e "0" | cat',
    });
    expect(found.map((entry) => entry.subject)).toEqual([
      'execution.testCommands.integration',
      'execution.testCommands.typecheck',
    ]);
    // integration, lint and typecheck unset: not a violation (only `unit` is required).
    expect(await violations(dir, { unit: 'node -e "0"' })).toEqual([]);
  });

  it('does not judge a layer the gates run themselves: a chained e2e or smoke command is not this rule’s business', async () => {
    const { dir } = await createTestProject();
    expect(
      await violations(dir, {
        unit: 'node -e "0"',
        e2e: 'docker compose up -d && playwright test',
        smoke: 'node -e "0" && node -e "0"',
        nfr: 'k6 run load.js',
        contract: 'not-a-program-anywhere',
      }),
    ).toEqual([]);
  });
});

describe('test-command: a no-op is not a test command', () => {
  it.each(['true', ':', 'echo ok', 'printf done', 'exit 0'])(
    '`unit: %s` fails: it runs no tests',
    async (value) => {
      const { dir } = await createTestProject();
      const found = await violations(dir, { unit: value }, { PATH: '/bin:/usr/bin' });
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toMatch(/runs no tests/);
    },
  );
});

describe('test-command: the program must exist (a dry lookup, the suite is never run)', () => {
  it('a bare program that is not on PATH fails, saying so', async () => {
    const { dir } = await createTestProject();
    const found = await violations(dir, { unit: 'no-such-runner-xyz test' });
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/"no-such-runner-xyz".*not found on PATH/);
    expect(found[0]?.remedy).toMatch(/^Install "no-such-runner-xyz"/);
  });

  it('reads the environment snapshot it was handed, never the process’s own: an empty PATH finds nothing, even node', async () => {
    const { dir } = await createTestProject();
    expect(await violations(dir, { unit: 'node -e "0"' }, {})).toHaveLength(1);
    expect(await violations(dir, { unit: 'node -e "0"' }, { PATH: '' })).toHaveLength(1);
  });

  it('a script path is resolved against the project and must be an executable file', async () => {
    const { dir } = await createTestProject();
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await writeFile(path.join(dir, 'scripts', 'test.sh'), '#!/bin/sh\nexit 0\n');
    // Present but not executable.
    await chmod(path.join(dir, 'scripts', 'test.sh'), 0o644);
    expect((await violations(dir, { unit: './scripts/test.sh' }))[0]?.message).toMatch(
      /not found at that path/,
    );
    await chmod(path.join(dir, 'scripts', 'test.sh'), 0o755);
    expect(await violations(dir, { unit: './scripts/test.sh' })).toEqual([]);
    // Missing, and a directory.
    expect(await violations(dir, { unit: './scripts/missing.sh' })).toHaveLength(1);
    expect(await violations(dir, { unit: './scripts' })).toHaveLength(1);
  });

  it('is dry: a passing rule does not run the test command', async () => {
    const { dir } = await createTestProject();
    const marker = path.join(dir, 'ran.marker');
    await writeFile(path.join(dir, 'test.sh'), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    await chmod(path.join(dir, 'test.sh'), 0o755);
    expect(await violations(dir, { unit: './test.sh' })).toEqual([]);
    await expect(stat(marker)).rejects.toThrow();
  });

  it('programResolves: the Windows spelling `Path` is read, and a relative PATH entry is relative to the project', async () => {
    const { dir } = await createTestProject();
    await mkdir(path.join(dir, 'bin'), { recursive: true });
    await writeFile(path.join(dir, 'bin', 'runner'), '#!/bin/sh\nexit 0\n');
    await chmod(path.join(dir, 'bin', 'runner'), 0o755);
    expect(await programResolves('runner', dir, { Path: NODE_DIR })).toBe(false);
    expect(await programResolves('node', dir, { Path: NODE_DIR })).toBe(true);
    expect(await programResolves('runner', dir, { PATH: 'bin' })).toBe(true);
    expect(await programResolves('runner', dir, { PATH: 'nope' })).toBe(false);
  });

  it('programResolves: PATH entries are searched in order, empty entries are skipped, a directory is not a program', async () => {
    const { dir } = await createTestProject();
    expect(await programResolves('node', dir, { PATH: `:${NODE_DIR}:` })).toBe(true);
    expect(
      await programResolves(path.basename(NODE_DIR), dir, { PATH: path.dirname(NODE_DIR) }),
    ).toBe(false);
    expect(await programResolves('node', dir, {})).toBe(false);
  });
});

describe('test-command: granted — the derived test-command exec grant, visible in the envelope', () => {
  it("every configured AGENT_RUN_LAYERS command that passes checkTestCommand is granted, in AGENT_RUN_LAYERS' own order — NOT the config's insertion order (the object below is keyed typecheck-first) — the project-wide ceiling (see the next test for why this is not any one step's own grant)", async () => {
    const { dir } = await createTestProject();
    const result = await ruleResult(dir, {
      // Deliberately NOT unit/integration/lint/typecheck order: a wrong implementation that emitted `granted` in
      // the config object's own insertion order, rather than genuinely iterating `AGENT_RUN_LAYERS`, would produce
      // typecheck, lint, integration, unit here instead of the expected order below.
      typecheck: 'node -e "3"',
      lint: 'node -e "2"',
      integration: 'node -e "1"',
      unit: 'node -e "0"',
    });
    expect(result.granted).toEqual([
      { layer: 'unit', command: 'node -e "0"' },
      { layer: 'integration', command: 'node -e "1"' },
      { layer: 'lint', command: 'node -e "2"' },
      { layer: 'typecheck', command: 'node -e "3"' },
    ]);
  });

  it("is the project-wide ceiling, NOT any one step's own grant: a narrow-brief step (rca: unit+integration only) is granted a strict subset of what doctor lists here", async () => {
    const { dir } = await createTestProject();
    const testCommands = {
      unit: 'node -e "0"',
      integration: 'node -e "1"',
      lint: 'node -e "2"',
      typecheck: 'node -e "3"',
    };
    const result = await ruleResult(dir, testCommands);
    // `rca`'s brief only ever needs unit+integration (`TEST_LAYERS_BY_BRIEF`); its real step grant is derived
    // exactly as `assemble.ts`/`debug.ts` derive it — over `testLayersForBrief`, not `AGENT_RUN_LAYERS`.
    const rcaStepGrant = deriveTestExec(testCommands, testLayersForBrief('rca')).granted;
    expect(rcaStepGrant).toEqual([
      { layer: 'unit', command: 'node -e "0"' },
      { layer: 'integration', command: 'node -e "1"' },
    ]);
    // Doctor's `granted` lists strictly more (lint, typecheck too): every layer the step would get is also listed
    // by doctor, but doctor also lists layers this particular step never receives.
    for (const entry of rcaStepGrant) expect(result.granted).toContainEqual(entry);
    expect(result.granted).toHaveLength(4);
    expect(rcaStepGrant.length).toBeLessThan(result.granted?.length ?? 0);
  });

  it('nothing configured: granted is [], not absent, and violations still fire for the required layer', async () => {
    const { dir } = await createTestProject();
    const result = await ruleResult(dir, undefined);
    expect(result.granted).toEqual([]);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('a configured layer whose command fails checkTestCommand is a violation and is NOT granted (derivation, not presence)', async () => {
    const { dir } = await createTestProject();
    const result = await ruleResult(dir, {
      unit: 'node -e "0"',
      // A wildcard would widen an exact exec pattern (`checkTestCommand`'s own `wildcard` refusal):
      // configured, but never grantable.
      integration: 'pnpm test*',
    });
    expect(result.granted).toEqual([{ layer: 'unit', command: 'node -e "0"' }]);
    expect(result.violations.some((v) => v.subject === 'execution.testCommands.integration')).toBe(
      true,
    );
  });

  it('a no-op unit command (e.g. `true`) is still granted — checkTestCommand judges syntax, not whether the command runs tests — but is also a violation', async () => {
    const { dir } = await createTestProject();
    const result = await ruleResult(dir, { unit: 'true' }, { PATH: '/bin:/usr/bin' });
    expect(result.granted).toEqual([{ layer: 'unit', command: 'true' }]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.message).toMatch(/runs no tests/);
  });

  it('a program that does not resolve is still granted (the grant is the exact string, not "it works") but is also a violation', async () => {
    const { dir } = await createTestProject();
    const result = await ruleResult(dir, { unit: 'no-such-runner-xyz test' });
    expect(result.granted).toEqual([{ layer: 'unit', command: 'no-such-runner-xyz test' }]);
    expect(result.violations).toHaveLength(1);
  });

  it('a layer outside AGENT_RUN_LAYERS is never granted, even with a syntactically VALID single-word command (proves scope, not just syntax — each of contract/e2e/nfr/smoke here would individually pass checkTestCommand)', async () => {
    const { dir } = await createTestProject();
    const result = await ruleResult(dir, {
      unit: 'node -e "0"',
      contract: 'node -e "1"',
      e2e: 'node -e "2"',
      nfr: 'node -e "3"',
      smoke: 'node -e "4"',
    });
    expect((result.granted ?? []).map((g) => g.layer)).toEqual(['unit']);
  });
});

describe('forge doctor --rule test-command, through the real CLI', () => {
  async function forge(args: readonly string[], cwd: string) {
    try {
      const { stdout, stderr } = await run(process.execPath, [LAUNCHER, ...args], {
        cwd,
        timeout: 60_000,
      });
      return { status: 0, stdout, stderr };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      return { status: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }

  it('an unset test command is a v1 envelope with errors, a typed violation and its remedy, and exit 1 (never a silent pass); granted is [], not absent', async () => {
    const { dir } = await createTestProject();
    const outcome = await forge(['-C', dir, 'doctor', '--rule', 'test-command', '--json'], dir);
    expect(outcome.status).toBe(1);
    const envelope = JSON.parse(outcome.stdout) as {
      v: number;
      rule: string;
      errors: number;
      violations: { subject: string; message: string; remedy: string }[];
      granted: { layer: string; command: string }[];
    };
    expect(envelope).toMatchObject({ v: 1, rule: 'test-command', errors: 1 });
    expect(envelope.violations[0]).toMatchObject({ subject: 'execution.testCommands.unit' });
    expect(envelope.violations[0]?.remedy).toContain(
      'forge config set execution.testCommands.unit',
    );
    expect(envelope.granted).toEqual([]);
  });

  it('after `forge config set`, the rule passes and granted names the unit layer with its exact command — the field the doctor rule adds for 15 §15.3.2', async () => {
    const { dir } = await createTestProject();
    const set = await forge(
      ['-C', dir, 'config', 'set', 'execution.testCommands.unit', 'node -e "process.exitCode=0"'],
      dir,
    );
    expect(set.status, set.stderr).toBe(0);
    const outcome = await forge(['-C', dir, 'doctor', '--rule', 'test-command', '--json'], dir);
    expect(outcome.status, outcome.stderr).toBe(0);
    expect(JSON.parse(outcome.stdout)).toMatchObject({
      v: 1,
      rule: 'test-command',
      errors: 0,
      violations: [],
      granted: [{ layer: 'unit', command: 'node -e "process.exitCode=0"' }],
    });
  });

  it('a different doctor rule (clean-build) never carries a `granted` key: the field is test-command only', async () => {
    const { dir } = await createTestProject();
    const outcome = await forge(['-C', dir, 'doctor', '--rule', 'clean-build', '--json'], dir);
    const envelope = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(envelope['rule']).toBe('clean-build');
    expect(Object.hasOwn(envelope, 'granted')).toBe(false);
  });

  it('a configured command whose program is missing fails through the CLI too', async () => {
    const { dir } = await createTestProject();
    await writeFile(
      path.join(dir, '.forge/config.yaml'),
      YAML.stringify({
        ...DEFAULT_CONFIG,
        execution: {
          ...DEFAULT_CONFIG.execution,
          testCommands: { unit: 'no-such-runner-xyz test' },
        },
      }),
    );
    const outcome = await forge(['-C', dir, 'doctor', '--rule', 'test-command', '--json'], dir);
    expect(outcome.status).toBe(1);
    const envelope = JSON.parse(outcome.stdout) as {
      errors: number;
      violations: { message: string }[];
    };
    expect(envelope.errors).toBe(1);
    expect(envelope.violations[0]?.message).toContain('not found on PATH');
  });

  it('an unreadable configuration is a failing verdict carrying `errors`, not an empty stdout; granted is [], not absent, even on this path', async () => {
    const { dir } = await createTestProject();
    await writeFile(path.join(dir, '.forge/config.yaml'), 'not: [valid');
    const outcome = await forge(['-C', dir, 'doctor', '--rule', 'test-command', '--json'], dir);
    expect(outcome.status).toBe(1);
    const envelope = JSON.parse(outcome.stdout) as {
      v: number;
      errors: number;
      granted: unknown;
    };
    expect(envelope.v).toBe(1);
    expect(envelope.errors).toBeGreaterThan(0);
    expect(envelope.granted).toEqual([]);
  });
});
