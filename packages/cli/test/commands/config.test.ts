/**
 * `forge config <get|set|list|explain|edit>`.
 */
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  configEdit,
  configExplain,
  configGet,
  configList,
  configSet,
} from '../../src/commands/config.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

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
