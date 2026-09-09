/**
 * `createBackup`'s own `copyWithRetry` helper (`packages/cli/src/commands/upgrade/backup.ts`) — a
 * bounded retry around `fs.cp` for the real, transient `ENOTEMPTY`/`EBUSY` races a gauntlet critic
 * caught under full-suite parallelism. In a file of its own for the identical reason
 * `context-ancestor-walk.test.ts` already establishes: it needs a real, mocked `node:fs/promises` `cp`
 * to inject a transient failure no real fixture can reliably reproduce on demand, and `vi.mock`
 * (replacing the whole module every importer sees) is the one form of interception that reaches a
 * named import's own binding.
 *
 * @see packages/cli/test/commands/run/context-ancestor-walk.test.ts
 */
import type * as NodeFsPromises from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { Clock } from '@forge/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { cpMock } = vi.hoisted(() => ({ cpMock: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  cpMock.mockImplementation(actual.cp);
  return { ...actual, cp: cpMock };
});

const { createBackup } = await import('../../../src/commands/upgrade/backup.ts');
const { cleanupAll, createTestProject, SPECS_ROOT } = await import('./helpers.ts');

afterEach(cleanupAll);

function fakeClock(iso: string): Clock {
  return { now: () => iso };
}

function enotempty(): NodeJS.ErrnoException {
  const error = new Error('ENOTEMPTY: directory not empty') as NodeJS.ErrnoException;
  error.code = 'ENOTEMPTY';
  return error;
}

describe('createBackup — transient fs.cp retry', () => {
  it('retries past a real, transient ENOTEMPTY and still produces a complete backup', async () => {
    const project = await createTestProject();
    let failedOnce = false;
    cpMock.mockImplementation(async (...args: Parameters<typeof NodeFsPromises.cp>) => {
      if (!failedOnce) {
        failedOnce = true;
        throw enotempty();
      }
      const actual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises');
      return actual.cp(...args);
    });

    const relPath = await createBackup(
      project.paths,
      project.dir,
      fakeClock('2026-01-01T00:00:00.000Z'),
      SPECS_ROOT,
    );

    expect(failedOnce).toBe(true);
    const entries = await readdir(path.join(project.dir, relPath));
    expect(entries).toContain('manifest.yaml');
  });

  it('does not retry a real, non-transient error — it propagates immediately', async () => {
    const project = await createTestProject();
    const permissionError = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
    permissionError.code = 'EACCES';
    cpMock.mockRejectedValue(permissionError);

    await expect(
      createBackup(project.paths, project.dir, fakeClock('2026-01-01T00:00:00.000Z'), SPECS_ROOT),
    ).rejects.toThrow('EACCES');
  });
});
