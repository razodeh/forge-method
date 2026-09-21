/**
 * `forge config set execution.testCommands.<layer> "<command>"` (`PLAN-M13.md` P23, `SPEC-QUESTIONS.md` Q230): the one route
 * by which a project's test commands get into `.forge/config.yaml`. Before it, `execution.testCommands` was one leaf (a
 * record), so a single layer could only be set by replacing the whole map with a YAML flow mapping, which drops every other
 * layer, and no step wrote it at all (`scaffold-project` only asks the human to).
 *
 * Through the real CLI where the behaviour is the CLI's (exit codes, the typed refusal on stderr, `--json`), and in process
 * for the value semantics.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { configExplain, configGet, configSet } from '../../src/commands/config.ts';
import { cleanupAll, createTestProject } from './doctor/helpers.ts';

afterEach(cleanupAll);

const run = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL('../../bin/forge.mjs', import.meta.url));

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

async function commandsOnDisk(dir: string): Promise<Record<string, string>> {
  const config = YAML.parse(await readFile(path.join(dir, '.forge/config.yaml'), 'utf8')) as {
    execution: { testCommands: Record<string, string> };
  };
  return config.execution.testCommands;
}

describe('setting one layer', () => {
  it('sets a nested layer key without disturbing the others, including the `smoke` layer (P25)', async () => {
    const project = await createTestProject();
    const ctx = { paths: project.paths };
    await configSet(ctx, 'execution.testCommands.unit', 'pnpm test');
    await configSet(ctx, 'execution.testCommands.lint', 'pnpm lint');
    await configSet(ctx, 'execution.testCommands.smoke', 'pnpm run smoke');
    expect(await commandsOnDisk(project.dir)).toEqual({
      unit: 'pnpm test',
      lint: 'pnpm lint',
      smoke: 'pnpm run smoke',
    });
    await configSet(ctx, 'execution.testCommands.unit', 'pnpm run test:unit');
    expect(await commandsOnDisk(project.dir)).toEqual({
      unit: 'pnpm run test:unit',
      lint: 'pnpm lint',
      smoke: 'pnpm run smoke',
    });
  });

  it('every layer of the schema is settable (the key set is the schema’s own)', async () => {
    const project = await createTestProject();
    for (const layer of [
      'unit',
      'integration',
      'contract',
      'e2e',
      'nfr',
      'smoke',
      'lint',
      'typecheck',
    ]) {
      await configSet(
        { paths: project.paths },
        `execution.testCommands.${layer}`,
        'node --version',
      );
    }
    expect(Object.keys(await commandsOnDisk(project.dir)).sort()).toEqual(
      ['contract', 'e2e', 'integration', 'lint', 'nfr', 'smoke', 'typecheck', 'unit'].sort(),
    );
  });

  it('stores the command as a STRING, never YAML-parsed into another type (`true`, `123` and `a: b` are commands here)', async () => {
    const project = await createTestProject();
    const ctx = { paths: project.paths };
    await configSet(ctx, 'execution.testCommands.unit', 'true');
    expect(await configGet(ctx, 'execution.testCommands.unit')).toBe('true');
    await configSet(ctx, 'execution.testCommands.integration', 'node -e "process.exitCode=0"');
    expect(await configGet(ctx, 'execution.testCommands.integration')).toBe(
      'node -e "process.exitCode=0"',
    );
    expect(await commandsOnDisk(project.dir)).toEqual({
      unit: 'true',
      integration: 'node -e "process.exitCode=0"',
    });
  });

  it('trims the value, so the stored command is the exact string a grant is built from', async () => {
    const project = await createTestProject();
    await configSet({ paths: project.paths }, 'execution.testCommands.unit', '  pnpm test \n');
    expect((await commandsOnDisk(project.dir))['unit']).toBe('pnpm test');
  });

  it('get and explain accept a layer key (explain documents it by its parent key)', async () => {
    const project = await createTestProject();
    const ctx = { paths: project.paths };
    expect(await configGet(ctx, 'execution.testCommands.unit')).toBeUndefined();
    await configSet(ctx, 'execution.testCommands.unit', 'pnpm test');
    expect(await configGet(ctx, 'execution.testCommands.unit')).toBe('pnpm test');
    const explained = await configExplain(ctx, 'execution.testCommands.unit');
    expect(explained.value).toBe('pnpm test');
    expect(explained.doc.length).toBeGreaterThan(10);
  });

  it('an unknown layer is a usage error, like any unknown key', async () => {
    const project = await createTestProject();
    for (const key of [
      'execution.testCommands.bogus',
      'execution.testCommands.',
      'execution.testCommands.unit.extra',
      'execution.testCommands.__proto__',
    ]) {
      await expect(
        configSet({ paths: project.paths }, key, 'pnpm test'),
        key,
      ).rejects.toMatchObject({
        code: 'USR-002',
      });
    }
  });
});

describe('a value that is not one plain command is refused for a layer an agent runs, with the typed refusal and its remedy', () => {
  it.each([
    ['chained', 'pnpm lint && pnpm test'],
    ['a second line', 'pnpm lint\npnpm test'],
    ['a wildcard', 'pnpm test *'],
    ['piped', 'pnpm test | tee out'],
    ['a variable prefix', 'CI=1 pnpm test'],
    ['empty', ''],
    ['blank', '   '],
  ])('%s', async (_name, value) => {
    const project = await createTestProject();
    const before = await readFile(path.join(project.dir, '.forge/config.yaml'), 'utf8');
    for (const layer of ['unit', 'integration', 'lint', 'typecheck']) {
      await expect(
        configSet({ paths: project.paths }, `execution.testCommands.${layer}`, value),
        `${layer}: ${value}`,
      ).rejects.toMatchObject({ code: 'ENV-006' });
    }
    // Nothing was written.
    expect(await readFile(path.join(project.dir, '.forge/config.yaml'), 'utf8')).toBe(before);
  });

  it('through the real CLI: exit 1, the field and the remedy on stderr, and the config is unchanged', async () => {
    const project = await createTestProject();
    const before = await readFile(path.join(project.dir, '.forge/config.yaml'), 'utf8');
    const outcome = await forge(
      ['-C', project.dir, 'config', 'set', 'execution.testCommands.unit', 'pnpm lint && pnpm test'],
      project.dir,
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain('execution.testCommands.unit');
    expect(outcome.stderr).toMatch(/Put the steps in a script/);
    expect(await readFile(path.join(project.dir, '.forge/config.yaml'), 'utf8')).toBe(before);
  });
});

describe('the layers only the gates run (contract, e2e, nfr, smoke) are held to "one line"', () => {
  it('a chained command on one line is accepted (`test run --rule smoke` allows `&&`, Q219), a second line is not', async () => {
    const project = await createTestProject();
    const ctx = { paths: project.paths };
    for (const layer of ['contract', 'e2e', 'nfr', 'smoke']) {
      await configSet(ctx, `execution.testCommands.${layer}`, 'docker compose up -d && pnpm e2e');
      await expect(
        configSet(ctx, `execution.testCommands.${layer}`, 'one\ntwo'),
      ).rejects.toMatchObject({ code: 'ENV-006' });
      await expect(configSet(ctx, `execution.testCommands.${layer}`, ' ')).rejects.toMatchObject({
        code: 'ENV-006',
      });
    }
  });
});

describe('the whole-map form still works (nothing about the existing route changed)', () => {
  it('`set execution.testCommands "{unit: pnpm test}"` replaces the map, as before', async () => {
    const project = await createTestProject();
    await configSet({ paths: project.paths }, 'execution.testCommands', '{unit: pnpm test}');
    expect(await commandsOnDisk(project.dir)).toEqual({ unit: 'pnpm test' });
  });
});
