/**
 * `checkDiskSpace`'s own real, honest failure branch — `node:fs/promises`' `statfs` genuinely
 * throwing (an unreadable/unmounted path) — in a file of its own for the identical reason
 * `context-ancestor-walk.test.ts` already establishes: `vi.mock` is the one form of interception that
 * reaches a named import's own binding, and mocking `node:fs/promises` module-wide would otherwise
 * bleed into every other test in this suite that touches the real filesystem.
 *
 * @see packages/cli/test/commands/run/context-ancestor-walk.test.ts
 */
import type * as NodeFsPromises from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { statfsMock } = vi.hoisted(() => ({ statfsMock: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  statfsMock.mockImplementation(actual.statfs);
  return { ...actual, statfs: statfsMock };
});

const { checkDiskSpace } = await import('../../../src/commands/doctor/environment.ts');

afterEach(() => {
  statfsMock.mockReset();
});

describe('checkDiskSpace — real statfs failure', () => {
  it('reports a real, honest failure when statfs itself throws', async () => {
    statfsMock.mockRejectedValue(new Error('ENOENT: no such file or directory'));
    const result = await checkDiskSpace('/nonexistent/forge-doctor-fixture');
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('Could not read real disk space');
  });

  it('reports a real, honest failure when free space is below the 500MB floor', async () => {
    statfsMock.mockResolvedValue({ bavail: 100, bsize: 1024 });
    const result = await checkDiskSpace('/fixture-below-floor');
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('real lane worktrees need real space');
    expect(result.fix).toBeDefined();
  });
});
