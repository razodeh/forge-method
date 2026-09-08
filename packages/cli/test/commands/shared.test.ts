/**
 * `@forge/cli/commands`'s own shared helpers.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { listSpecArtifacts, readArtifactTemplate } from '../../src/commands/shared.ts';
import { SPECS_ROOT, cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('readArtifactTemplate', () => {
  it('reads the real, shipped ADR template', async () => {
    const text = await readArtifactTemplate('ADR');
    expect(text).toContain('id: ADR-0001');
  });

  it('reads a different real template for a different type', async () => {
    const text = await readArtifactTemplate('Vision');
    expect(text).toContain('type: Vision');
  });
});

describe('listSpecArtifacts', () => {
  it('returns an empty list for a project with no specs/ directory at all', async () => {
    const project = await createTestProject();
    const docs = await listSpecArtifacts(project.paths, SPECS_ROOT);
    expect(docs).toEqual([]);
  });
});
