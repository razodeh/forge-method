/**
 * `@forge/cli/commands`'s own shared helpers.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { specNew } from '../../src/commands/spec.ts';
import { listSpecArtifacts, readArtifactTemplate } from '../../src/commands/shared.ts';
import { KB_ROOT, SPECS_ROOT, cleanupAll, createTestProject } from './helpers.ts';

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

  it('skips a real hand-authored README.md with no front matter, rather than throwing', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, SPECS_ROOT), { recursive: true });
    await writeFile(
      path.join(project.dir, SPECS_ROOT, 'README.md'),
      '# Specs\n\nSee the real docs.\n',
    );
    await specNew({ paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT }, 'Vision', 'V');

    const docs = await listSpecArtifacts(project.paths, SPECS_ROOT);
    expect(docs).toHaveLength(1);
  });

  it('includes a real, valid, BOM-prefixed artifact document rather than silently skipping it', async () => {
    const project = await createTestProject();
    const doc = await specNew(
      { paths: project.paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT },
      'Vision',
      'V',
    );
    const withBom = '﻿' + doc.toString();
    await writeFile(path.join(project.dir, doc.path), withBom);

    const docs = await listSpecArtifacts(project.paths, SPECS_ROOT);
    expect(docs.some((found) => found.path === doc.path)).toBe(true);
  });

  it('still throws loudly for a real, genuinely corrupted document (unterminated front matter)', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, SPECS_ROOT), { recursive: true });
    await writeFile(path.join(project.dir, SPECS_ROOT, 'broken.md'), '---\nid: X\n');

    await expect(listSpecArtifacts(project.paths, SPECS_ROOT)).rejects.toMatchObject({
      code: 'CFG-006',
    });
  });
});
