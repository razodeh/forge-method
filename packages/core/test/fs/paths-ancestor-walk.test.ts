/**
 * `realpathOfDeepestExistingAncestor`'s root-reached guard (`packages/core/src/fs/paths.ts`), in a
 * file of its own because it needs `existsSync` to report "nothing exists" all the way up to the
 * filesystem root — a state no real fixture can produce, since the root itself always exists.
 *
 * `vi.spyOn` on a default-imported `node:fs` object does not reach this: Node snapshots a built-in
 * module's named exports on first static import, so `paths.ts`'s own `import { existsSync }` keeps
 * resolving to the pre-spy function regardless of what a spy does to a separately obtained reference
 * to the same module object (verified directly before writing this file — the spy value never
 * reached the named import's binding). `vi.mock`, which replaces the module vitest hands to every
 * importer rather than patching a value after the fact, is the one form of interception that works
 * here — which is also why this lives apart from `paths.test.ts`: a module-level mock of `node:fs`
 * would otherwise apply to every other test in that file too.
 *
 * @see specs/02 §2.5
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock } = vi.hoisted(() => ({ existsSyncMock: vi.fn() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  existsSyncMock.mockImplementation(actual.existsSync);
  return { ...actual, existsSync: existsSyncMock };
});

const { ProjectPaths } = await import('../../src/fs/paths.ts');

let projectRoot: string | undefined;

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('resolveWithin — ancestor walk termination', () => {
  it('stops walking once it reaches the filesystem root, rather than looping forever', () => {
    // realpathOfDeepestExistingAncestor climbs parent directories until one exists. In real use that
    // always terminates quickly (the project root exists), so this forces the pathological case —
    // nothing on the whole ancestor chain appears to exist — to prove the loop's root-reached guard
    // (`path.dirname(probe) === probe`) is what stops it, not a coincidence of the fixture.
    // Resolved through realpathSync up front: os.tmpdir() is itself a symlink on macOS
    // (/var/folders/... -> /private/var/folders/...), and forcing existsSync false below means the
    // walk never reaches an intermediate directory where that symlink would normally get resolved —
    // starting from an already-real root keeps this test isolated to the root-reached guard, rather
    // than also exercising an unrelated host-specific symlink.
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'forge-paths-ancestor-'));
    projectRoot = root;
    const paths = new ProjectPaths(root);
    existsSyncMock.mockReturnValue(false);
    expect(() => paths.resolveWithin('some/nested/file.txt')).not.toThrow();
  });
});
