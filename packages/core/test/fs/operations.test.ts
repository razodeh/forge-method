/**
 * `readTextFile`, `pathExists`, `ensureDir`, `listDirSorted` — the read-side and directory
 * operations of `@forge/core/fs`.
 *
 * @see specs/02 §2.5
 * @see QUALITY-BAR.md R10 (`listDirSorted`'s determinism)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureDir, listDirSorted, pathExists, readTextFile } from '../../src/fs/operations.ts';
import { ProjectPaths } from '../../src/fs/paths.ts';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-ops-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

afterEach(() => {
  vi.restoreAllMocks();
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('readTextFile', () => {
  it('reads back what was written', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    writeFileSync(target, '# Title\n\nBody.\n');
    expect(await readTextFile(target)).toBe('# Title\n\nBody.\n');
  });

  it('throws a RUN-034 ForgeError, with the cause preserved, when the file does not exist', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('missing.md');
    try {
      await readTextFile(target);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('RUN-034');
      expect((error as { cause?: { code?: string } }).cause?.code).toBe('ENOENT');
    }
  });

  it('decodes as UTF-8', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('unicode.md');
    writeFileSync(target, 'café ☕ 日本語');
    expect(await readTextFile(target)).toBe('café ☕ 日本語');
  });
});

describe('pathExists', () => {
  it('is true for a file that exists', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    writeFileSync(target, 'x');
    expect(await pathExists(target)).toBe(true);
  });

  it('is true for a directory that exists', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a-dir');
    mkdirSync(target);
    expect(await pathExists(target)).toBe(true);
  });

  it('is false, not thrown, for a path that does not exist', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('missing.md');
    expect(await pathExists(target)).toBe(false);
  });

  it('rethrows as a ForgeError for a failure other than "does not exist"', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    writeFileSync(target, 'x');
    vi.spyOn(fsp, 'access').mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    );
    await expect(pathExists(target)).rejects.toMatchObject({ code: 'RUN-034' });
  });

  it('rethrows as a ForgeError for a rejection that carries no error code at all', async () => {
    // Exercises errorCode()'s "not a code-bearing object" path, distinct from the above test where
    // the rejection has a `.code` that just isn't 'ENOENT'.
    const paths = freshProject();
    const target = paths.resolveWithin('a.md');
    writeFileSync(target, 'x');
    vi.spyOn(fsp, 'access').mockRejectedValueOnce(new Error('unexplained failure'));
    await expect(pathExists(target)).rejects.toMatchObject({ code: 'RUN-034' });
  });
});

describe('ensureDir', () => {
  it('creates a directory that does not exist', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a/b/c');
    await ensureDir(target);
    expect(await pathExists(target)).toBe(true);
  });

  it('is a no-op, not a failure, when the directory already exists', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a');
    await ensureDir(target);
    await expect(ensureDir(target)).resolves.toBeUndefined();
  });

  it('throws a RUN-034 ForgeError, with the cause preserved, on any other failure', async () => {
    const paths = freshProject();
    const target = paths.resolveWithin('a/b/c');
    vi.spyOn(fsp, 'mkdir').mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    );
    try {
      await ensureDir(target);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('RUN-034');
      expect((error as { cause?: { code?: string } }).cause?.code).toBe('EACCES');
    }
  });
});

describe('listDirSorted', () => {
  it('returns entries sorted, regardless of the order the filesystem reports', async () => {
    const paths = freshProject();
    const dir = paths.resolveWithin('.');
    // Written in an order deliberately not matching sorted order, so the assertion cannot pass by
    // coincidentally matching whatever order the filesystem happens to hand back.
    for (const name of ['zebra.md', 'apple.md', 'mango.md']) {
      writeFileSync(path.join(dir, name), 'x');
    }
    expect(await listDirSorted(dir)).toEqual(['apple.md', 'mango.md', 'zebra.md']);
  });

  it('sorts by code-unit order, not by locale collation', async () => {
    // QUALITY-BAR.md R10: a locale-aware collator treats an accented letter as adjacent to its
    // unaccented form — "école" sorts next to "apple", before "zebra" — because that is how a human
    // reader alphabetises. Code-unit order does not know that: "é" (U+00E9) is numerically far above
    // "z" (U+007A), so "école" sorts *after* "zebra". That divergence is exactly what proves the sort
    // is code-unit order rather than collation; case (a vs A) does not reliably prove it here, since a
    // case-insensitive filesystem — APFS and Windows by default — treats "a.md" and "A.md" as the
    // same directory entry, and never creates the four distinct files that comparison would need.
    const paths = freshProject();
    const dir = paths.resolveWithin('.');
    for (const name of ['zebra.md', 'école.md', 'apple.md']) {
      writeFileSync(path.join(dir, name), 'x');
    }
    expect(await listDirSorted(dir)).toEqual(['apple.md', 'zebra.md', 'école.md']);
  });

  it('sorts a pair the filesystem reports in reverse order', async () => {
    // Controls fs.readdir's raw order directly (rather than relying on what the host filesystem
    // happens to hand back) so the comparator is guaranteed to see an out-of-order pair — the real
    // directories used elsewhere in this file tend to come back from readdir already near-sorted,
    // which never exercises this side of byteCompare's two-branch body.
    const paths = freshProject();
    const dir = paths.resolveWithin('.');
    // fsp.readdir is overloaded (a plain string[] overload and a withFileTypes:true Dirent[]
    // overload); vi.spyOn's Mock type resolves to the last-declared (Dirent[]) overload regardless
    // of the call this test actually exercises, so the mocked return value needs an explicit cast.
    vi.spyOn(fsp, 'readdir').mockResolvedValueOnce(['zebra.md', 'apple.md'] as unknown as Awaited<
      ReturnType<typeof fsp.readdir>
    >);
    expect(await listDirSorted(dir)).toEqual(['apple.md', 'zebra.md']);
  });

  it('leaves equal entries as equal, the one byteCompare comparison a real, uniquely-named directory can never produce', async () => {
    // Directory entries are unique by construction, so byteCompare's "neither less nor greater"
    // return-0 case can only be reached with a mocked readdir, not through any real fixture.
    const paths = freshProject();
    const dir = paths.resolveWithin('.');
    vi.spyOn(fsp, 'readdir').mockResolvedValueOnce(['same.md', 'same.md'] as unknown as Awaited<
      ReturnType<typeof fsp.readdir>
    >);
    expect(await listDirSorted(dir)).toEqual(['same.md', 'same.md']);
  });

  it('does not call localeCompare at all', async () => {
    // Proves the sort is byte-order by construction rather than by coincidence: if the
    // implementation ever reached for localeCompare, this fails even on inputs where the two
    // orderings happen to agree.
    const paths = freshProject();
    const dir = paths.resolveWithin('.');
    writeFileSync(path.join(dir, 'a.md'), 'x');
    writeFileSync(path.join(dir, 'b.md'), 'x');
    const spy = vi.spyOn(String.prototype, 'localeCompare');
    await listDirSorted(dir);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns an empty array for an empty directory', async () => {
    const paths = freshProject();
    const dir = paths.resolveWithin('empty');
    mkdirSync(dir);
    expect(await listDirSorted(dir)).toEqual([]);
  });

  it('throws a RUN-034 ForgeError for a directory that does not exist', async () => {
    const paths = freshProject();
    const dir = paths.resolveWithin('missing');
    await expect(listDirSorted(dir)).rejects.toMatchObject({ code: 'RUN-034' });
  });
});
