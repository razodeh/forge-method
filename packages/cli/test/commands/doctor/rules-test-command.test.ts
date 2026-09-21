/**
 * `forge doctor --rule test-command` (`G-Foundation`'s `test:command`, `PLAN-M13.md` P23, `SPEC-QUESTIONS.md` Q230;
 * `10` §10.3 "no test command", `13` §13.1 F-TEST-1 rule 4, `14` §14.9).
 *
 * The rule passes only when the project has a usable single-command `unit` command and every other layer that becomes an
 * exec grant (integration, lint, typecheck) that IS configured is one plain command whose program is found. Each clause has a
 * failing fixture; the real CLI prints the `v:1` envelope the gate reads (`errors`), and nothing here runs a test suite.
 */
import { execFile } from 'node:child_process';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
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

async function violations(
  dir: string,
  testCommands: Record<string, string> | undefined,
  env: Record<string, string> = ENV,
) {
  return (
    await doctorRule(
      {
        paths: new ProjectPaths(dir),
        projectRoot: dir,
        kbRoot: KB_ROOT,
        reportsRoot: 'docs/forge/reports',
        env,
        ...(testCommands === undefined ? {} : { testCommands }),
      },
      'test-command',
    )
  ).violations;
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

  it('an unset test command is a v1 envelope with errors, a typed violation and its remedy, and exit 1 (never a silent pass)', async () => {
    const { dir } = await createTestProject();
    const outcome = await forge(['-C', dir, 'doctor', '--rule', 'test-command', '--json'], dir);
    expect(outcome.status).toBe(1);
    const envelope = JSON.parse(outcome.stdout) as {
      v: number;
      rule: string;
      errors: number;
      violations: { subject: string; message: string; remedy: string }[];
    };
    expect(envelope).toMatchObject({ v: 1, rule: 'test-command', errors: 1 });
    expect(envelope.violations[0]).toMatchObject({ subject: 'execution.testCommands.unit' });
    expect(envelope.violations[0]?.remedy).toContain(
      'forge config set execution.testCommands.unit',
    );
  });

  it('after `forge config set`, the rule passes: the route the remedy names is the route that clears it', async () => {
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
    });
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

  it('an unreadable configuration is a failing verdict carrying `errors`, not an empty stdout', async () => {
    const { dir } = await createTestProject();
    await writeFile(path.join(dir, '.forge/config.yaml'), 'not: [valid');
    const outcome = await forge(['-C', dir, 'doctor', '--rule', 'test-command', '--json'], dir);
    expect(outcome.status).toBe(1);
    const envelope = JSON.parse(outcome.stdout) as { v: number; errors: number };
    expect(envelope.v).toBe(1);
    expect(envelope.errors).toBeGreaterThan(0);
  });
});
