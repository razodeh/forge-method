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

  // `specs/22` M16 P5 (`18` §18.7: "`forge doctor`'s separate `secret-references` check scans every
  // `.yaml`, `.yml`, `.md` and `.json` file under `.forge/` ... so a declaration, a capture or a
  // record that holds one draws that warning -- the only validation or health check that flags
  // anything under `.forge/parity/`"). This proves it against a REAL declaration-shaped file holding
  // the literal string, not merely by reading `secrets.ts`'s own code and assuming it would.
  describe('.forge/parity/ (specs/22 M16 P5) (18 §18.7)', () => {
    it('a declaration holding a literal ${secret:NAME} reference draws the warning', async () => {
      const project = await createTestProject();
      await mkdir(path.join(project.dir, '.forge/parity'), { recursive: true });
      await writeFile(
        path.join(project.dir, '.forge/parity/search-api.parity.yaml'),
        'reference:\n  ref: ${secret:PARITY_REF_TOKEN}\n',
      );
      const result = await checkSecretReferences(project.paths, {});
      expect(result.ok).toBe(false);
      expect(result.message).toContain('PARITY_REF_TOKEN');
    });

    it('a capture (.json, no front matter) holding a literal ${secret:NAME} reference also draws the warning', async () => {
      const project = await createTestProject();
      await mkdir(path.join(project.dir, '.forge/parity/captures'), { recursive: true });
      await writeFile(
        path.join(
          project.dir,
          '.forge/parity/captures/0000000000000000000000000000000000000000000000000000000000000000.json',
        ),
        '{"name":"${secret:CAPTURE_LEAK}"}',
      );
      const result = await checkSecretReferences(project.paths, {});
      expect(result.ok).toBe(false);
      expect(result.message).toContain('CAPTURE_LEAK');
    });

    it('a resolved reference under .forge/parity/ passes, exactly like anywhere else under .forge/', async () => {
      const project = await createTestProject();
      await mkdir(path.join(project.dir, '.forge/parity'), { recursive: true });
      await writeFile(
        path.join(project.dir, '.forge/parity/search-api.parity.yaml'),
        'reference:\n  ref: ${secret:PARITY_REF_TOKEN}\n',
      );
      const result = await checkSecretReferences(project.paths, { PARITY_REF_TOKEN: 'real-value' });
      expect(result.ok).toBe(true);
    });

    it('ordinary declaration/capture content with no secret reference draws no warning at all', async () => {
      const project = await createTestProject();
      await mkdir(path.join(project.dir, '.forge/parity/captures'), { recursive: true });
      await writeFile(
        path.join(project.dir, '.forge/parity/search-api.parity.yaml'),
        'reference:\n  ref: v1.2.0\nreview:\n  by: alice\n',
      );
      await writeFile(
        path.join(
          project.dir,
          '.forge/parity/captures/1111111111111111111111111111111111111111111111111111111111111111.json',
        ),
        '{"name":"search-api","platform":"linux-x64"}',
      );
      const result = await checkSecretReferences(project.paths, {});
      expect(result.ok).toBe(true);
    });
  });
});
