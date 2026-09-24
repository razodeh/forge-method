/**
 * `configSet --commit`'s rollback catch block: what happens when the ROLLBACK write itself ALSO fails,
 * after `commitPaths` has already failed — a round-2 critic finding (`PLAN-M14.md` P37). No real
 * fixture can force `writeFileAtomic`'s SECOND call (the restore) to fail while its FIRST call (the
 * real write) succeeds, so `vi.mock` — the one form of interception that reaches a named import's own
 * binding — mocks `@forge/core`'s `writeFileAtomic` and `@forge/vcs`'s `commitPaths` selectively, in a
 * file of its own (the identical reason `context-ancestor-walk.test.ts`/
 * `environment-diskspace-failure.test.ts` already establish), leaving every other real `@forge/core`/
 * `@forge/vcs` export untouched.
 *
 * @see packages/cli/src/commands/config.ts
 */
import type * as ForgeCore from '@forge/core';
import type * as ForgeVcs from '@forge/vcs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { writeFileAtomicMock, commitPathsMock } = vi.hoisted(() => ({
  writeFileAtomicMock: vi.fn(),
  commitPathsMock: vi.fn(),
}));

vi.mock('@forge/core', async (importOriginal) => {
  const actual = await importOriginal<typeof ForgeCore>();
  // Default: every call behaves exactly like the real thing, unless a test overrides it below.
  writeFileAtomicMock.mockImplementation(actual.writeFileAtomic);
  return { ...actual, writeFileAtomic: writeFileAtomicMock };
});

vi.mock('@forge/vcs', async (importOriginal) => {
  const actual = await importOriginal<typeof ForgeVcs>();
  return { ...actual, commitPaths: commitPathsMock };
});

const { configSet } = await import('../../src/commands/config.ts');
const { cleanupAll, createTestProject } = await import('./upgrade/helpers.ts');
const { execa } = await import('execa');

afterEach(async () => {
  writeFileAtomicMock.mockReset();
  commitPathsMock.mockReset();
  await cleanupAll();
});

describe('configSet --commit: the rollback write ALSO fails (round-2 critic finding)', () => {
  it('preserves the original commit failure as `cause` rather than silently replacing it with the restore failure', async () => {
    const actualCore = await vi.importActual<typeof ForgeCore>('@forge/core');
    // The mock's default (installed by the `vi.mock` factory above) passes every call through to the
    // real `writeFileAtomic` -- exercised for real by `createTestProject`'s own many internal writes
    // (`runInit`'s write-tree pipeline) before this test ever calls `configSet`. Only AFTER that setup
    // is done does this test start counting: call 1 is `configSet`'s own real write of the new value
    // (let through for real, so the scenario is genuine — a real write really happened), call 2 is the
    // ROLLBACK's own restore write inside `configSet`'s catch block — the one this test forces to fail.
    const project = await createTestProject();
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'init'],
      { cwd: project.dir },
    );

    let writeCount = 0;
    writeFileAtomicMock.mockImplementation(
      async (...args: Parameters<typeof actualCore.writeFileAtomic>) => {
        writeCount += 1;
        if (writeCount === 2) {
          throw new Error('SIMULATED restore-write failure (disk full, say)');
        }
        return actualCore.writeFileAtomic(...args);
      },
    );
    commitPathsMock.mockRejectedValue(
      new Error('SIMULATED commit failure (a signing failure, say)'),
    );

    const ctx = { paths: project.paths, projectRoot: project.dir };
    const error: unknown = await configSet(ctx, 'project.level', 'L2', { commit: true }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    // Both real failures are named -- neither silently wins over or erases the other.
    expect(message).toContain('SIMULATED commit failure');
    expect(message).toContain('SIMULATED restore-write failure');
    // The ORIGINAL commit failure -- the one a real caller most needs to see -- is preserved as the
    // real `cause`, not merely mentioned in a string.
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(((error as Error).cause as Error).message).toBe(
      'SIMULATED commit failure (a signing failure, say)',
    );
    expect(writeCount).toBe(2);
  });
});
