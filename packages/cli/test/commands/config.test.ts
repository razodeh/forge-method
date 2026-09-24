/**
 * `forge config <get|set|list|explain|edit>`.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { ProjectPaths } from '@forge/core';
import { DEFAULT_CONFIG } from '@forge/schemas/config';

import {
  configEdit,
  configExplain,
  configGet,
  configList,
  configSet,
} from '../../src/commands/config.ts';
import {
  cleanupAll,
  createTestProject,
  registerCleanup,
  type TestProject,
} from './upgrade/helpers.ts';

afterEach(cleanupAll);

/** A project with a real `.forge/config.yaml` but NO git repository at all (`CFG-055`'s "not a
 * git repository" case, `PLAN-M14.md` P37). */
async function nonGitProject(): Promise<{ readonly dir: string; readonly paths: ProjectPaths }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-config-commit-nogit-'));
  registerCleanup(dir);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');
  return { dir, paths: new ProjectPaths(dir) };
}

/** `createTestProject`'s own real `runInit` only ever runs `git init` (`run-init.ts`'s `ensureGit`) —
 * it makes no commit at all, so a fresh `createTestProject()` project is itself already the "untracked"
 * `CFG-055` case (`.forge/config.yaml`, like everything else `forge init` wrote, sits on an unborn
 * `HEAD`, wholly untracked). A real project commits that first tree itself, outside `forge init`
 * (`test/intake-workflow.test.ts`'s own `buildTemplateProject` does exactly this) — this helper mirrors
 * that, once, so the `--commit` happy-path tests below start from a real, clean, committed baseline. */
async function committedProject(): Promise<TestProject> {
  const project = await createTestProject();
  await execa('git', ['add', '-A'], { cwd: project.dir });
  await execa(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'init'],
    { cwd: project.dir },
  );
  return project;
}

describe('configGet / configSet', () => {
  it('reads a real, currently-effective value at a real dot-path', async () => {
    const project = await createTestProject();
    const value = await configGet({ paths: project.paths }, 'project.name');
    expect(value).toBe('Fixture Project');
  });

  it('throws CFG-020 when the project has never been initialized (no real config.yaml)', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, '.forge/config.yaml'));
    await expect(configGet({ paths: project.paths }, 'project.name')).rejects.toMatchObject({
      code: 'CFG-020',
    });
  });

  it('throws CFG-001 for a real, present but schema-invalid config.yaml', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, '.forge/config.yaml'), 'version: not-a-number\n');
    await expect(configGet({ paths: project.paths }, 'project.name')).rejects.toMatchObject({
      code: 'CFG-001',
    });
  });

  it('rejects a key that is not a real, declared leaf', async () => {
    const project = await createTestProject();
    await expect(configGet({ paths: project.paths }, 'not.a.real.key')).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('writes a real, schema-revalidated value and re-reads it back', async () => {
    const project = await createTestProject();
    await configSet({ paths: project.paths }, 'execution.concurrency', '4');
    const value = await configGet({ paths: project.paths }, 'execution.concurrency');
    expect(value).toBe(4);
  });

  it('writes a real, top-level (no-dot) key too', async () => {
    const project = await createTestProject();
    await configSet({ paths: project.paths }, 'version', '1');
    const value = await configGet({ paths: project.paths }, 'version');
    expect(value).toBe(1);
  });

  it('throws USR-002 (not a raw YAMLParseError) for a genuinely malformed raw value', async () => {
    const project = await createTestProject();
    await expect(
      configSet({ paths: project.paths }, 'execution.concurrency', '[1,2'),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses a real value that fails schema revalidation, without writing it', async () => {
    const project = await createTestProject();
    const before = await configGet({ paths: project.paths }, 'project.name');
    await expect(configSet({ paths: project.paths }, 'project.name', '5')).rejects.toMatchObject({
      code: 'CFG-001',
    });
    const after = await configGet({ paths: project.paths }, 'project.name');
    expect(after).toBe(before);
  });
});

describe('execution.testRoots (PLAN-M14.md P5)', () => {
  it('is unset by default', async () => {
    const project = await createTestProject();
    const value = await configGet({ paths: project.paths }, 'execution.testRoots');
    expect(value).toBeUndefined();
  });

  it('round-trips a list of directories through set/get/explain', async () => {
    const project = await createTestProject();
    await configSet({ paths: project.paths }, 'execution.testRoots', '[tests, test/integration]');
    const value = await configGet({ paths: project.paths }, 'execution.testRoots');
    expect(value).toEqual(['tests', 'test/integration']);
    const explanation = await configExplain({ paths: project.paths }, 'execution.testRoots');
    expect(explanation.value).toEqual(['tests', 'test/integration']);
    expect(explanation.doc.length).toBeGreaterThan(0);
  });

  it('refuses an empty-string entry, without writing it', async () => {
    const project = await createTestProject();
    await expect(
      configSet({ paths: project.paths }, 'execution.testRoots', '[tests, ""]'),
    ).rejects.toMatchObject({ code: 'CFG-001' });
    const value = await configGet({ paths: project.paths }, 'execution.testRoots');
    expect(value).toBeUndefined();
  });
});

describe('paths.release (PLAN-M14.md P12)', () => {
  it('is an empty list by default', async () => {
    const project = await createTestProject();
    const value = await configGet({ paths: project.paths }, 'paths.release');
    expect(value).toEqual([]);
  });

  it(
    'is optional (backward compatible): a config.yaml written before this piece, with no paths.release ' +
      'key at all, still validates and every other command still works',
    async () => {
      const project = await createTestProject();
      const configPath = path.join(project.dir, '.forge/config.yaml');
      const raw = YAML.parse(await readFile(configPath, 'utf8')) as {
        paths: Record<string, unknown>;
      };
      expect('release' in raw.paths).toBe(true); // sanity: a fresh init really does have the key
      delete raw.paths['release'];
      await writeFile(configPath, YAML.stringify(raw));
      const value = await configGet({ paths: project.paths }, 'paths.release');
      expect(value).toBeUndefined();
      await expect(configGet({ paths: project.paths }, 'project.name')).resolves.toBeDefined();
      await expect(configGet({ paths: project.paths }, 'paths.kb')).resolves.toBeDefined();
    },
  );

  it('round-trips a list of app paths through set/get/explain', async () => {
    const project = await createTestProject();
    await configSet({ paths: project.paths }, 'paths.release', '[apps/mobile/**, app.json]');
    const value = await configGet({ paths: project.paths }, 'paths.release');
    expect(value).toEqual(['apps/mobile/**', 'app.json']);
    const explanation = await configExplain({ paths: project.paths }, 'paths.release');
    expect(explanation.value).toEqual(['apps/mobile/**', 'app.json']);
    expect(explanation.doc.length).toBeGreaterThan(0);
  });

  it('refuses a scalar (not a list), without writing it', async () => {
    const project = await createTestProject();
    await expect(
      configSet({ paths: project.paths }, 'paths.release', 'apps/mobile'),
    ).rejects.toMatchObject({ code: 'CFG-001' });
    const value = await configGet({ paths: project.paths }, 'paths.release');
    expect(value).toEqual([]);
  });

  it('refuses an absolute entry, a ".." segment, and a "!"-leading entry, without writing them', async () => {
    const project = await createTestProject();
    for (const bad of ['[/etc/passwd]', '[../outside]', '[apps/../etc]', '["!apps/mobile/**"]']) {
      await expect(configSet({ paths: project.paths }, 'paths.release', bad)).rejects.toMatchObject(
        { code: 'CFG-001' },
      );
    }
    const value = await configGet({ paths: project.paths }, 'paths.release');
    expect(value).toEqual([]);
  });
});

describe('gates.waiverMaxDays (PLAN-M14.md P16, SPEC-QUESTIONS.md Q232 decision 10)', () => {
  it('is 90 by default', async () => {
    const project = await createTestProject();
    const value = await configGet({ paths: project.paths }, 'gates.waiverMaxDays');
    expect(value).toBe(90);
  });

  it(
    'is optional (backward compatible): a config.yaml written before this piece, with no gates key at ' +
      'all, still validates and every other command still works',
    async () => {
      const project = await createTestProject();
      const configPath = path.join(project.dir, '.forge/config.yaml');
      const raw = YAML.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
      expect('gates' in raw).toBe(true); // sanity: a fresh init really does have the key
      delete raw['gates'];
      await writeFile(configPath, YAML.stringify(raw));
      const value = await configGet({ paths: project.paths }, 'gates.waiverMaxDays');
      expect(value).toBeUndefined();
      await expect(configGet({ paths: project.paths }, 'project.name')).resolves.toBeDefined();
      await expect(configGet({ paths: project.paths }, 'paths.kb')).resolves.toBeDefined();
    },
  );

  it('round-trips a positive integer through set/get/explain', async () => {
    const project = await createTestProject();
    await configSet({ paths: project.paths }, 'gates.waiverMaxDays', '30');
    const value = await configGet({ paths: project.paths }, 'gates.waiverMaxDays');
    expect(value).toBe(30);
    const explanation = await configExplain({ paths: project.paths }, 'gates.waiverMaxDays');
    expect(explanation.value).toBe(30);
    expect(explanation.doc.length).toBeGreaterThan(0);
  });

  it('refuses zero and a non-numeric value, without writing them', async () => {
    const project = await createTestProject();
    await expect(
      configSet({ paths: project.paths }, 'gates.waiverMaxDays', '0'),
    ).rejects.toMatchObject({ code: 'CFG-001' });
    await expect(
      configSet({ paths: project.paths }, 'gates.waiverMaxDays', 'x'),
    ).rejects.toMatchObject({ code: 'CFG-001' });
    const value = await configGet({ paths: project.paths }, 'gates.waiverMaxDays');
    expect(value).toBe(90);
  });
});

describe('configSet --commit (PLAN-M14.md P37)', () => {
  it(
    'commits exactly .forge/config.yaml, leaving git status --porcelain empty, subject ' +
      '"forge(config): set project.level"',
    async () => {
      const project = await committedProject();
      const ctx = { paths: project.paths, projectRoot: project.dir };
      const result = await configSet(ctx, 'project.level', 'L2', { commit: true });
      expect(result.config.project.level).toBe('L2');
      expect(result.committed).not.toBeNull();
      expect(result.committed?.sha).toMatch(/^[0-9a-f]{40}$/);
      const status = (await execa('git', ['status', '--porcelain'], { cwd: project.dir })).stdout;
      expect(status).toBe('');
      const subject = (
        await execa('git', ['log', '-1', '--format=%s'], { cwd: project.dir })
      ).stdout.trim();
      expect(subject).toBe('forge(config): set project.level');
    },
  );

  it('carries Forge-Step/Forge-Run trailers, and no Co-Authored-By, from ctx.marker', async () => {
    const project = await committedProject();
    const ctx = {
      paths: project.paths,
      projectRoot: project.dir,
      marker: { runId: 'run-intake-full', stepId: 'intake:record-level' },
    };
    // A genuinely different value: `createTestProject`'s own real, resolved default (`fixture-mod`'s
    // own level) is not pinned here, so this reads it rather than risking a same-value no-op.
    const current = await configGet(ctx, 'project.level');
    const target = current === 'L4' ? 'L3' : 'L4';
    await configSet(ctx, 'project.level', target, { commit: true });
    const body = (
      await execa('git', ['log', '-1', '--format=%B'], { cwd: project.dir })
    ).stdout.trim();
    expect(body).toBe(
      'forge(config): set project.level\n\n' +
        'Forge-Step: intake:record-level\n' +
        'Forge-Run: run-intake-full',
    );
  });

  it('makes no commit at all — the plain, unchanged behaviour — when --commit is not given', async () => {
    const project = await committedProject();
    const before = (await execa('git', ['rev-parse', 'HEAD'], { cwd: project.dir })).stdout;
    const result = await configSet(
      { paths: project.paths, projectRoot: project.dir },
      'project.level',
      'L2',
    );
    expect(result.committed).toBeNull();
    const after = (await execa('git', ['rev-parse', 'HEAD'], { cwd: project.dir })).stdout;
    expect(after).toBe(before);
    const status = (await execa('git', ['status', '--porcelain'], { cwd: project.dir })).stdout;
    expect(status.trim()).toBe('M .forge/config.yaml');
  });

  it('reports committed: null and makes no new commit when re-set to the value already stored', async () => {
    const project = await committedProject();
    const ctx = { paths: project.paths, projectRoot: project.dir };
    const current = await configGet(ctx, 'project.level');
    const before = (await execa('git', ['rev-parse', 'HEAD'], { cwd: project.dir })).stdout;
    const result = await configSet(ctx, 'project.level', String(current), { commit: true });
    expect(result.committed).toBeNull();
    const after = (await execa('git', ['rev-parse', 'HEAD'], { cwd: project.dir })).stdout;
    expect(after).toBe(before);
  });

  it('CFG-055, nothing written, when the project is not a git repository', async () => {
    const project = await nonGitProject();
    const ctx = { paths: project.paths, projectRoot: project.dir };
    const before = await readFile(path.join(project.dir, '.forge/config.yaml'), 'utf8');
    await expect(configSet(ctx, 'project.level', 'L2', { commit: true })).rejects.toMatchObject({
      code: 'CFG-055',
    });
    const after = await readFile(path.join(project.dir, '.forge/config.yaml'), 'utf8');
    expect(after).toBe(before);
  });

  it('CFG-055, nothing written, when .forge/config.yaml is untracked (a fresh forge init: runInit itself never commits)', async () => {
    const project = await createTestProject();
    const ctx = { paths: project.paths, projectRoot: project.dir };
    const before = await readFile(path.join(project.dir, '.forge/config.yaml'), 'utf8');
    await expect(configSet(ctx, 'project.level', 'L2', { commit: true })).rejects.toMatchObject({
      code: 'CFG-055',
    });
    const after = await readFile(path.join(project.dir, '.forge/config.yaml'), 'utf8');
    expect(after).toBe(before);
    // `-uall` (`--untracked-files=all`, matching `getDirtyFiles`'s own real behaviour) so the new
    // `.forge/` directory is listed file by file, not collapsed to one entry — proof this really is
    // `.forge/config.yaml` specifically, not merely "something in .forge/ is untracked".
    const status = (await execa('git', ['status', '--porcelain', '-uall'], { cwd: project.dir }))
      .stdout;
    expect(status).toContain('.forge/config.yaml');
  });

  it('CFG-055, nothing written, when .forge/config.yaml already differs from HEAD', async () => {
    const project = await committedProject();
    const configPath = path.join(project.dir, '.forge/config.yaml');
    const dirty = `${await readFile(configPath, 'utf8')}\n# a pending human edit\n`;
    await writeFile(configPath, dirty);
    const ctx = { paths: project.paths, projectRoot: project.dir };
    await expect(configSet(ctx, 'project.level', 'L2', { commit: true })).rejects.toMatchObject({
      code: 'CFG-055',
    });
    const after = await readFile(configPath, 'utf8');
    expect(after).toBe(dirty);
  });

  it('validates before checking git: an invalid value is still CFG-001, even in a non-git directory (order)', async () => {
    const project = await nonGitProject();
    const ctx = { paths: project.paths, projectRoot: project.dir };
    await expect(
      configSet(ctx, 'project.level', 'not-a-level', { commit: true }),
    ).rejects.toMatchObject({ code: 'CFG-001' });
  });
});

describe('configList', () => {
  it('lists every real leaf key with its own real, current value', async () => {
    const project = await createTestProject();
    const entries = await configList({ paths: project.paths });
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.some((entry) => entry.key === 'project.name')).toBe(true);
  });
});

describe('configExplain', () => {
  it('returns the real, current value plus its real documentation line', async () => {
    const project = await createTestProject();
    const explanation = await configExplain({ paths: project.paths }, 'project.level');
    expect(explanation.value).toBeDefined();
    expect(typeof explanation.doc).toBe('string');
    expect(explanation.doc.length).toBeGreaterThan(0);
  });
});

describe('configEdit', () => {
  it('is a real, named refusal — no interactive $EDITOR mechanism exists', () => {
    expect(() => configEdit()).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });
});
