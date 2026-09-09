/**
 * `forge mcp validate` — a thin wrapper over `@forge/extensions/mcp`'s `validateMcpConfig`.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mcpList, mcpValidate } from '../../src/commands/mcp.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

describe('mcpValidate', () => {
  it('validates a real, empty, default mcp config as valid', async () => {
    const project = await createTestProject();
    const outcome = await mcpValidate({ paths: project.paths }, 'dev');
    expect(outcome.valid).toBe(true);
    expect(outcome.findings).toEqual([]);
  });

  it('throws CFG-020 when the project has never been initialized (no real config.yaml)', async () => {
    const project = await createTestProject();
    const { rm } = await import('node:fs/promises');
    await rm(path.join(project.dir, '.forge/config.yaml'));
    await expect(mcpValidate({ paths: project.paths }, 'dev')).rejects.toMatchObject({
      code: 'CFG-020',
    });
  });

  it('throws CFG-001 for a real, present but schema-invalid config.yaml', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, '.forge/config.yaml'), 'version: not-a-number\n');
    await expect(mcpValidate({ paths: project.paths }, 'dev')).rejects.toMatchObject({
      code: 'CFG-001',
    });
  });
});

describe('mcpList', () => {
  it('is a real, named refusal — no configured-server registry mechanism exists', () => {
    expect(() => mcpList()).toThrow(expect.objectContaining({ code: 'USR-003' }));
  });
});
