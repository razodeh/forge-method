/**
 * `writeFileAtomic` — temp file in the same directory → `fsync` → `rename` → `fsync` the directory.
 *
 * Written from `specs/18` §18.10 ("Atomic writes: temp file in the same directory → fsync → rename.
 * Never partial artifacts") and `PLAN-M1.md` P4's Checks: an interrupted write leaves the previous
 * content in place, no temp file survives a success, and `fsync` is proven to resolve before
 * `rename` is called rather than merely being present in the source.
 *
 * @see specs/18 §18.10
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectPaths } from '../../src/fs/paths.ts';
import { writeFileAtomic } from '../../src/fs/atomic.ts';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-atomic-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

afterEach(() => {
  vi.restoreAllMocks();
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('writeFileAtomic — the happy path', () => {
  it('writes string contents that can be read back', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('docs/forge/kb/a.md');
    await writeFileAtomic(target, '# Hello\n');
    expect(readFileSync(target, 'utf8')).toBe('# Hello\n');
  });

  it('writes binary contents that can be read back', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('data.bin');
    const bytes = new Uint8Array([0, 1, 2, 255, 254]);
    await writeFileAtomic(target, bytes);
    expect(new Uint8Array(readFileSync(target))).toEqual(bytes);
  });

  it('overwrites an existing file completely, not appending', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    await writeFileAtomic(target, 'a very long first version of the file');
    await writeFileAtomic(target, 'short');
    expect(readFileSync(target, 'utf8')).toBe('short');
  });

  it('creates intermediate directories that do not exist yet', async () => {
    // The plan's Surface lists `ensureDir` separately, but a write should not require the caller to
    // call it first for the common case of writing one new file into a fresh subtree.
    const paths = freshProject();
    const target = paths.resolveWithin('docs/forge/kb/new/a.md');
    await writeFileAtomic(target, 'content');
    expect(readFileSync(target, 'utf8')).toBe('content');
  });

  it('leaves no temp file behind after a successful write', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    await writeFileAtomic(target, 'content');
    const entries = readdirSync(path.dirname(target));
    expect(entries).toEqual(['a.md']);
  });
});

describe('writeFileAtomic — atomicity', () => {
  it('leaves the previous content in place when the write is interrupted before rename', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    await writeFileAtomic(target, 'original content');

    const renameSpy = vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('simulated crash'));
    await expect(writeFileAtomic(target, 'new content that should never land')).rejects.toThrow();
    renameSpy.mockRestore();

    expect(readFileSync(target, 'utf8')).toBe('original content');
  });

  it('never leaves the destination absent-then-present in an observably partial state', async () => {
    // There is no window in which readers can see a file that exists but holds partial content:
    // the destination path is only ever touched by the atomic rename, never opened for writing
    // directly.
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    const writeSpy = vi.spyOn(fsp, 'open');
    await writeFileAtomic(target, 'x'.repeat(10_000));
    const openedPaths = writeSpy.mock.calls.map((call) => String(call[0]));
    expect(openedPaths.every((opened) => opened !== target)).toBe(true);
  });

  it('does not leave a stray temp file behind after an interrupted write', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('simulated crash'));

    await expect(writeFileAtomic(target, 'content')).rejects.toThrow();

    const entries = readdirSync(path.dirname(target));
    expect(entries).toEqual([]);
  });

  it('reports the original failure, as a ForgeError, even when the post-failure cleanup itself fails', async () => {
    // Two independent failures compounding: the rename fails (entering the catch block), and then
    // the best-effort `fsp.rm` cleanup of the temp file *also* fails (e.g. a permissions change
    // racing the cleanup). The caller must still see the original rename failure wrapped as a
    // ForgeError, not a raw exception from the cleanup attempt replacing it.
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('simulated rename failure'));
    vi.spyOn(fsp, 'rm').mockRejectedValueOnce(
      Object.assign(new Error('simulated EACCES on cleanup'), { code: 'EACCES' }),
    );

    try {
      await writeFileAtomic(target, 'content');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('RUN-034');
      expect((error as { cause?: { message?: string } }).cause?.message).toBe(
        'simulated rename failure',
      );
    }
  });
});

describe('writeFileAtomic — fsync ordering', () => {
  it('resolves fsync on the temp file before calling rename', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');

    const order: string[] = [];
    const originalOpen = fsp.open.bind(fsp);
    const originalRename = fsp.rename.bind(fsp);

    vi.spyOn(fsp, 'open').mockImplementation(async (openPath, ...rest) => {
      const handle = await originalOpen(openPath, ...rest);
      // Only the temp file's handle matters for this ordering — the directory handle opened for
      // its own best-effort fsync afterwards is irrelevant to "before rename".
      if (openPath !== path.dirname(target)) {
        const originalSync = handle.sync.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await originalSync();
          order.push('fsync');
        });
      }
      return handle;
    });
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      order.push('rename');
      return originalRename(from, to);
    });

    await writeFileAtomic(target, 'content');

    expect(order.indexOf('fsync')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('rename')).toBeGreaterThan(order.indexOf('fsync'));
  });
});

describe('writeFileAtomic — directory fsync is best-effort', () => {
  it('still succeeds when fsync-ing the containing directory is not supported', async () => {
    // Windows does not support opening a directory the way POSIX durability wants to fsync it. The
    // file's own data is already durable from the file-level fsync above; the directory fsync is
    // extra durability for the rename's metadata, and its absence must not fail the write.
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');

    const originalOpen = fsp.open.bind(fsp);
    vi.spyOn(fsp, 'open').mockImplementation(async (target_, ...rest) => {
      if (target_ === path.dirname(target)) {
        throw Object.assign(new Error('EISDIR: illegal operation on a directory'), {
          code: 'EISDIR',
        });
      }
      return originalOpen(target_, ...rest);
    });

    await expect(writeFileAtomic(target, 'content')).resolves.toBeUndefined();
    expect(readFileSync(target, 'utf8')).toBe('content');
  });

  it('still succeeds, as a resolved promise carrying no ForgeError, when closing the directory handle fails', async () => {
    // The write and rename have already both landed by the time this runs — a failure closing the
    // handle opened purely for the best-effort directory fsync must not turn an already-successful
    // write into a rejected promise, let alone a raw (non-ForgeError) one.
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    const dir = path.dirname(target);

    const originalOpen = fsp.open.bind(fsp);
    vi.spyOn(fsp, 'open').mockImplementation(async (target_, ...rest) => {
      const handle = await originalOpen(target_, ...rest);
      if (target_ === dir) {
        vi.spyOn(handle, 'close').mockRejectedValueOnce(
          Object.assign(new Error('simulated EIO on close'), { code: 'EIO' }),
        );
      }
      return handle;
    });

    await expect(writeFileAtomic(target, 'content')).resolves.toBeUndefined();
    expect(readFileSync(target, 'utf8')).toBe('content');
  });
});

describe('writeFileAtomic — real crash simulation', () => {
  it('a write killed mid-flight, then retried, converges on the retried content', async () => {
    // Not a mock: an actual temp file is left on disk (simulating a process killed between the temp
    // write and the rename), and a fresh writeFileAtomic call for the same target must still
    // succeed and land the right content, proving a leftover temp file from a previous crash cannot
    // corrupt a later write.
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    const dir = path.dirname(target);
    writeFileSync(path.join(dir, `.a.md.tmp-99999-0`), 'leftover from a crashed run');

    await writeFileAtomic(target, 'the real content');

    expect(readFileSync(target, 'utf8')).toBe('the real content');
  });
});
