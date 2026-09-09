/**
 * `realpathOfDeepestExistingAncestor`'s root-reached guard (`packages/cli/src/commands/run/
 * context.ts`), in a file of its own for the identical reason `@forge/core/fs`'s own
 * `packages/core/test/fs/paths-ancestor-walk.test.ts` already establishes: it needs a real, mocked
 * `node:fs/promises` `access` to report "nothing exists" all the way up to the filesystem root — a
 * state no real fixture can produce, since the root itself always exists — and `vi.mock` (which
 * replaces the whole module every importer sees) is the one form of interception that reaches a named
 * import's own binding, unlike `vi.spyOn` on a separately-obtained module reference.
 *
 * @see packages/core/test/fs/paths-ancestor-walk.test.ts
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import type * as NodeFsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execaSync } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { accessMock } = vi.hoisted(() => ({ accessMock: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  accessMock.mockImplementation(actual.access);
  return { ...actual, access: accessMock };
});

const { isTargetRegisteredWorktree } = await import('../../../src/commands/run/context.ts');

let projectRoot: string | undefined;

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('realpathOfDeepestExistingAncestor — ancestor walk termination', () => {
  it('stops walking once it reaches the filesystem root, rather than looping forever', async () => {
    // Forces the pathological case — nothing on the whole ancestor chain appears to exist — to prove
    // the loop's root-reached guard (`path.dirname(probe) === probe`) is what stops it, not a
    // coincidence of the fixture. Resolved through `realpathSync` up front for the identical reason
    // `paths-ancestor-walk.test.ts` already documents: keeps this test isolated to the root-reached
    // guard, rather than also exercising an unrelated host-specific symlink.
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'forge-cli-context-ancestor-'));
    projectRoot = root;
    execaSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
    execaSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: root });
    accessMock.mockRejectedValue(new Error('ENOENT'));
    await expect(isTargetRegisteredWorktree(root, path.join(root, 'nested/target'))).resolves.toBe(
      false,
    );
  });
});
