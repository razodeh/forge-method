/**
 * `KbIdAllocator` — `08` §8.6: scan-derived truth, never reused, serialised concurrent allocation.
 * Same discipline as `@forge/core/ids/allocator.test.ts`, for the `KbSection` key space.
 *
 * @see specs/08 §8.6
 * @see PLAN-M3.md P7
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import type { Clock } from '@forge/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KbIdAllocator } from '../../src/write/id-allocator.ts';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-kb-id-allocator-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

/** A deterministic, injected clock returning real ISO-8601 timestamps a second apart — never the
 * real one (`QUALITY-BAR.md` R10). Real timestamps (not `IdAllocator`'s own test's opaque `t0`/`t1`
 * tokens) matter here: `KbWriter` derives `created`/`updated` from `now().slice(0, 10)`. */
function fakeClock(startIso = '2026-01-05T00:00:00.000Z'): Clock {
  let current = new Date(startIso).getTime();
  return {
    now: () => {
      const iso = new Date(current).toISOString();
      current += 1000;
      return iso;
    },
  };
}

function kbEntry(id: string, section = 'architecture'): string {
  return `---\nid: ${id}\ntype: knowledge\nsection: ${section}\ntitle: X\n---\nbody\n`;
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('KbIdAllocator.scan', () => {
  it('reflects the real filesystem state, not an absent cache', async () => {
    const paths = freshProject();
    write(paths.resolveWithin('.'), 'docs/forge/kb/architecture/a.md', kbEntry('KB-ARCH-0003'));
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    expect((await allocator.scan()).counters).toEqual({ architecture: 3 });
  });

  it('a schema-invalid document (bad fields elsewhere) still counts its own well-formed id as claimed', async () => {
    // Mirrors @forge/core/ids/scan.ts's own countIdsFromFiles rule: treating a malformed document's
    // id as still free would let two files claim the same numeric id.
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/architecture/broken.md',
      '---\nid: KB-ARCH-0005\ntype: knowledge\nsection: not-a-real-section\n---\nbody\n',
    );
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    expect((await allocator.scan()).counters).toEqual({ architecture: 5 });
  });

  it('ignores a non-KB id (an ADR, say) entirely', async () => {
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/decisions/ADR-0001-x.md',
      '---\nid: ADR-0001\ntype: ADR\n---\nbody\n',
    );
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    expect((await allocator.scan()).counters).toEqual({});
  });

  it('ignores a KB-shaped id whose token names no registered section', async () => {
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/architecture/odd.md',
      '---\nid: KB-ZZZZ-0001\ntype: knowledge\n---\nbody\n',
    );
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    expect((await allocator.scan()).counters).toEqual({});
  });

  it('skips a file with no front matter at all, rather than failing the whole scan', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(
      root,
      'docs/forge/kb/architecture/not-front-matter.md',
      'just prose, no --- delimiters\n',
    );
    write(root, 'docs/forge/kb/architecture/real.md', kbEntry('KB-ARCH-0002'));
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    expect((await allocator.scan()).counters).toEqual({ architecture: 2 });
  });

  it('skips a file whose front matter parses but has no string id field', async () => {
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      'docs/forge/kb/architecture/no-id.md',
      '---\ntitle: no id here\n---\nbody\n',
    );
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    expect((await allocator.scan()).counters).toEqual({});
  });

  it('counts the highest id per section independently', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'docs/forge/kb/architecture/a.md', kbEntry('KB-ARCH-0002'));
    write(root, 'docs/forge/kb/data/b.md', kbEntry('KB-DATA-0007', 'data'));
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    expect((await allocator.scan()).counters).toEqual({ architecture: 2, data: 7 });
  });
});

describe('KbIdAllocator.allocate', () => {
  it('throws a RangeError if allocateMany(section, 1) ever returned an empty array', async () => {
    // allocateMany's own contract guarantees this never happens for a real call — this is testing
    // allocate()'s own defensive check against that contract being violated, not a scenario a real
    // scan/registry can produce. Mirrors @forge/core/ids/allocator.test.ts's own identical test for
    // the sibling `IdAllocator` this class is modelled on.
    const paths = freshProject();
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    vi.spyOn(allocator, 'allocateMany').mockResolvedValueOnce([]);
    await expect(allocator.allocate('architecture')).rejects.toThrow(RangeError);
  });

  it('allocates KB-{TOKEN}-0001 for the first entry in an empty section', async () => {
    const paths = freshProject();
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    expect(await allocator.allocate('architecture')).toBe('KB-ARCH-0001');
  });

  it('allocates the next id after existing entries on disk', async () => {
    const paths = freshProject();
    write(paths.resolveWithin('.'), 'docs/forge/kb/architecture/a.md', kbEntry('KB-ARCH-0003'));
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    expect(await allocator.allocate('architecture')).toBe('KB-ARCH-0004');
  });

  it('two concurrent allocate() calls to the same section give two distinct, contiguous ids', async () => {
    const paths = freshProject();
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    const [a, b] = await Promise.all([
      allocator.allocate('architecture'),
      allocator.allocate('architecture'),
    ]);
    expect([a, b].sort()).toEqual(['KB-ARCH-0001', 'KB-ARCH-0002']);
  });

  it('deleting the on-disk cache yields the same next id as before deletion', async () => {
    const paths = freshProject();
    write(paths.resolveWithin('.'), 'docs/forge/kb/architecture/a.md', kbEntry('KB-ARCH-0003'));
    const before = await new KbIdAllocator({ paths, clock: fakeClock() }).allocate('architecture');

    rmSync(paths.resolveState('kb-ids.json'), { force: true });

    const after = await new KbIdAllocator({ paths, clock: fakeClock() }).allocate('architecture');
    expect(after).toBe(before);
  });

  it('is deterministic: writtenAt derives only from the injected clock', async () => {
    const paths = freshProject();
    const allocator = new KbIdAllocator({ paths, clock: fakeClock('2026-02-01T00:00:00.000Z') });
    await allocator.allocate('architecture');
    const index = await allocator.scan();
    expect(index.writtenAt.startsWith('2026-02-01')).toBe(true);
  });

  it('discards a corrupt kb-ids.json with a warning, not fatally', async () => {
    const paths = freshProject();
    write(paths.resolveWithin('.'), '.forge/state/kb-ids.json', 'not json{{{');
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    await expect(allocator.allocate('architecture')).resolves.toBe('KB-ARCH-0001');
  });

  it('discards a kb-ids.json that does not parse to a KbIdIndex shape', async () => {
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      '.forge/state/kb-ids.json',
      JSON.stringify({ validityHash: 'stale', writtenAt: 't', counters: { architecture: 'nope' } }),
    );
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    await expect(allocator.allocate('architecture')).resolves.toBe('KB-ARCH-0001');
  });

  it('refuses an id that would need more than 4 digits (CFG-010)', async () => {
    const paths = freshProject();
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    await allocator.allocateMany('architecture', 9999); // KB-ARCH-0001 .. KB-ARCH-9999, the maximum
    await expect(allocator.allocate('architecture')).rejects.toMatchObject({ code: 'CFG-010' });
  });

  it('refuses the whole batch if any id in an allocateMany call would overflow', async () => {
    const paths = freshProject();
    const allocator = new KbIdAllocator({ paths, clock: fakeClock() });
    await expect(allocator.allocateMany('architecture', 10000)).rejects.toMatchObject({
      code: 'CFG-010',
    });
  });
});
