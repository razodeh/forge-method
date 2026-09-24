/**
 * `planRegenerableContent` — `03` §3.4 step 5's own real, read-only plan (`PLAN-M14.md` P43): every
 * already-materialised regenerable file classified `current`/`stale`/`edited`/`missing`, sharing the
 * identical content readers and traversal order `writeRegenerableContent` itself uses.
 *
 * @see specs/03 §3.3, §3.4
 * @see PLAN-M14.md P43
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { withGeneratedHeader } from '../../src/init/generated-header.ts';
import { sha256 } from '../../src/init/hash.ts';
import { readPackageVersion } from '../../src/init/package-root.ts';
import { planRegenerableContent, writeRegenerableContent } from '../../src/init/write-tree.ts';
import { cleanupAll, createTestProject } from '../commands/upgrade/helpers.ts';

afterEach(cleanupAll);

const WORKFLOW_REL_PATH = '.forge/workflows/intake.workflow.yaml';

describe('planRegenerableContent', () => {
  it('classifies every real, freshly materialised regenerable file as current', async () => {
    const project = await createTestProject();
    const plan = await planRegenerableContent(project.paths, project.modulesDir);
    expect(plan.length).toBeGreaterThan(0);
    for (const entry of plan) expect(entry.status).toBe('current');
  });

  it('classifies a regenerable file removed from disk as missing', async () => {
    const project = await createTestProject();
    const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
    await rm(filePath);

    const plan = await planRegenerableContent(project.paths, project.modulesDir);
    const entry = plan.find((candidate) => candidate.path === WORKFLOW_REL_PATH);
    expect(entry?.status).toBe('missing');
  });

  it('classifies a hand-edited file (body no longer matches its own recorded header) as edited', async () => {
    const project = await createTestProject();
    const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
    await writeFile(filePath, `${await readFile(filePath, 'utf8')}\n# hand-edited\n`, 'utf8');

    const plan = await planRegenerableContent(project.paths, project.modulesDir);
    const entry = plan.find((candidate) => candidate.path === WORKFLOW_REL_PATH);
    expect(entry?.status).toBe('edited');
  });

  it('classifies an undrifted file whose recorded hash no longer matches the shipped content as stale (body-vs-header, not body-vs-shipped)', async () => {
    const project = await createTestProject();
    const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
    // A real, undrifted copy of an *older* shipped body: the header's own recorded hash matches this
    // file's own on-disk body (a human never touched it), but that body is not what `content.ts` reads
    // today — the real "shipped content changed since this was generated" shape, at the *same* real,
    // currently-running package version the header itself is stamped with (a stale classification must
    // come from the real body/header hash comparison alone, never from a version-string mismatch).
    const olderBody =
      'id: intake\nsteps: []\n# an older shipped body — not what content.ts reads today\n';
    const version = readPackageVersion('@forge/agents');
    const staleContent = withGeneratedHeader(
      olderBody,
      WORKFLOW_REL_PATH,
      version,
      sha256(olderBody),
    );
    await writeFile(filePath, staleContent, 'utf8');

    const plan = await planRegenerableContent(project.paths, project.modulesDir);
    const entry = plan.find((candidate) => candidate.path === WORKFLOW_REL_PATH);
    expect(entry?.status).toBe('stale');
  });

  it('names exactly the real paths writeRegenerableContent would touch, and never writes anything itself', async () => {
    const project = await createTestProject();
    // Deleting a real file first means "the plan silently wrote it back" would be directly observable.
    const filePath = path.join(project.dir, WORKFLOW_REL_PATH);
    await rm(filePath);

    const plan = await planRegenerableContent(project.paths, project.modulesDir);
    await expect(readFile(filePath, 'utf8')).rejects.toThrow();

    const written = await writeRegenerableContent(project.paths, project.modulesDir);
    expect(new Set(plan.map((entry) => entry.path))).toEqual(
      new Set(written.map((file) => file.path)),
    );
  });
});
