/**
 * `forge doctor`'s own unresolved-secret-reference check.
 *
 * @see specs/03 §3.7
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkSecretReferences } from '../../../src/commands/doctor/secrets.ts';
import { cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('checkSecretReferences', () => {
  it('passes for a real project with no secret references at all', async () => {
    const project = await createTestProject();
    const result = await checkSecretReferences(project.paths, {});
    expect(result.ok).toBe(true);
  });

  it('passes when every real ${secret:NAME} reference resolves against the given env', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/checks/example.gate.yaml'),
      'id: G-Example\ntoken: ${secret:API_TOKEN}\n',
    );
    const result = await checkSecretReferences(project.paths, {
      API_TOKEN: 'real-value-never-shown',
    });
    expect(result.ok).toBe(true);
    // The real env value never appears in the check's own output.
    expect(result.message).not.toContain('real-value-never-shown');
  });

  it('is a real warning naming the missing secret — never its value — when unresolved', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/checks/example.gate.yaml'),
      'id: G-Example\ntoken: ${secret:MISSING_TOKEN}\n',
    );
    const result = await checkSecretReferences(project.paths, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain('MISSING_TOKEN');
  });

  it('never descends into .forge/state (event logs/locks, never real config content)', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, '.forge/state'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/state/stray.yaml'),
      'note: ${secret:SHOULD_NOT_BE_SCANNED}\n',
    );
    const result = await checkSecretReferences(project.paths, {});
    expect(result.ok).toBe(true);
  });
});
