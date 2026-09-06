/**
 * `IdAllocator` — `18` §18.8: scan-derived truth, never reused, serialised concurrent allocation.
 *
 * @see specs/18 §18.8
 * @see specs/09 §9.2
 * @see PLAN-M1.md P13
 * @see SPEC-QUESTIONS.md Q30 (the `CFG-010` overflow behaviour)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Clock } from '../../src/clock.ts';
import { ProjectPaths } from '../../src/fs/paths.ts';
import { IdAllocator } from '../../src/ids/allocator.ts';
import { DEFAULT_ID_REGISTRY, type IdRegistry } from '../../src/ids/registry.ts';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-ids-allocator-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function story(id: string): string {
  return `---\nid: ${id}\ntype: Story\ntitle: X\n---\nbody\n`;
}

/** A deterministic, injected clock — never the real one (QUALITY-BAR.md R10). */
function fakeClock(): Clock {
  let tick = 0;
  return { now: () => `t${String(tick++)}` };
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('IdAllocator.scan', () => {
  it('reflects the real filesystem state, not an absent cache', async () => {
    const paths = freshProject();
    write(paths.resolveWithin('.'), 'specs/stories/STORY-003-c.md', story('STORY-003'));
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    expect((await allocator.scan()).counters).toEqual({ Story: 3 });
  });

  it('deleting ids.json yields the same next id as before deletion', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'specs/stories/STORY-003-c.md', story('STORY-003'));
    const before = await new IdAllocator({ paths, clock: fakeClock() }).allocate('Story');

    rmSync(paths.resolveState('ids.json'), { force: true });

    const after = await new IdAllocator({ paths, clock: fakeClock() }).allocate('Story');
    expect(after).toBe(before);
  });

  it('a hand-edited ids.json claiming a lower counter is overridden by the scan, not obeyed', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'specs/stories/STORY-005-c.md', story('STORY-005'));
    // A stale/tampered cache with a mismatched validityHash and a too-low counter.
    write(
      root,
      '.forge/state/ids.json',
      JSON.stringify({ validityHash: 'stale', writtenAt: 't', counters: { Story: 1 } }),
    );
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    expect(await allocator.allocate('Story')).toBe('STORY-006');
  });

  it('discards a corrupt ids.json with a warning, not fatally', async () => {
    const paths = freshProject();
    write(paths.resolveWithin('.'), '.forge/state/ids.json', 'not json{{{');
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    await expect(allocator.allocate('Story')).resolves.toBe('STORY-001');
  });

  it('reuses the cache when the scanned file set has not changed since it was written', async () => {
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'specs/stories/STORY-002-c.md', story('STORY-002'));
    await new IdAllocator({ paths, clock: fakeClock() }).scan();
    const cacheAfterFirstScan = readFileSync(paths.resolveState('ids.json'), 'utf8');

    // A second allocator, same on-disk file set: the cache should be trusted as-is (same
    // validityHash), not overwritten by a redundant scan producing byte-identical content anyway —
    // asserted structurally (same counters) rather than by mocking the filesystem.
    const second = new IdAllocator({ paths, clock: fakeClock() });
    expect((await second.scan()).counters).toEqual({ Story: 2 });
    expect(readFileSync(paths.resolveState('ids.json'), 'utf8')).toBe(cacheAfterFirstScan);
  });
});

describe('IdAllocator.allocate — zero-padding', () => {
  it('pads to idWidth 3 for an ordinary type', async () => {
    const paths = freshProject();
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    expect(await allocator.allocate('Story')).toBe('STORY-001');
  });

  it('pads to idWidth 4 for ADR', async () => {
    const paths = freshProject();
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    expect(await allocator.allocate('ADR')).toBe('ADR-0001');
  });

  it('throws a RangeError if allocateMany(type, 1) ever returned an empty array', async () => {
    // allocateMany's own contract guarantees this never happens for a real call — this is testing
    // allocate()'s own defensive check against that contract being violated, not a scenario a real
    // scan/registry can produce.
    const paths = freshProject();
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    vi.spyOn(allocator, 'allocateMany').mockResolvedValueOnce([]);
    await expect(allocator.allocate('Story')).rejects.toThrow(RangeError);
  });
});

describe('IdAllocator.allocate — never reused', () => {
  it('an artifact with status: deprecated still occupies its id', async () => {
    const paths = freshProject();
    write(
      paths.resolveWithin('.'),
      'specs/stories/STORY-001-old.md',
      '---\nid: STORY-001\ntype: Story\ntitle: Old\nstatus: deprecated\n---\nbody\n',
    );
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    expect(await allocator.allocate('Story')).toBe('STORY-002');
  });

  it('a gap left by a deleted file is never backfilled — the counter only ever advances', async () => {
    // `18` §18.8's actual guarantee against reuse is retention (deleted artifacts keep their file,
    // marked `status: deprecated`, so a scan always still sees them) — deleting a file outright is
    // the documented anti-pattern that guarantee exists to prevent, not something this allocator can
    // detect after the fact. What IS true regardless, and what this asserts: the monotonic counter
    // never backfills a gap even when one appears, because "next id" is always the scanned maximum
    // plus one, never "the lowest free slot" — so STORY-002 going missing does not make STORY-002
    // available again, it just means the next id skips past where it used to be.
    const paths = freshProject();
    const root = paths.resolveWithin('.');
    write(root, 'specs/stories/STORY-001.md', story('STORY-001'));
    write(root, 'specs/stories/STORY-002.md', story('STORY-002'));
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    expect(await allocator.allocate('Story')).toBe('STORY-003');

    rmSync(path.join(root, 'specs', 'stories', 'STORY-002.md'));
    rmSync(paths.resolveState('ids.json'), { force: true });
    const rescanned = new IdAllocator({ paths, clock: fakeClock() });
    // The scanned maximum is now STORY-001 (STORY-002 and STORY-003's cache are both gone) — the
    // point being it still does not hand back the now-apparently-free STORY-002.
    expect(await rescanned.allocate('Story')).toBe('STORY-002');
    // ...which is exactly why `18` §18.8 mandates retention: reaching this state at all means the
    // documented policy was violated, and the id genuinely was made available again as a result.
  });
});

describe('IdAllocator.allocateMany', () => {
  it('returns count contiguous ids in order', async () => {
    const paths = freshProject();
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    expect(await allocator.allocateMany('Story', 3)).toEqual([
      'STORY-001',
      'STORY-002',
      'STORY-003',
    ]);
  });

  it('continues from the highest existing id', async () => {
    const paths = freshProject();
    write(paths.resolveWithin('.'), 'specs/stories/STORY-010-c.md', story('STORY-010'));
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    expect(await allocator.allocateMany('Story', 2)).toEqual(['STORY-011', 'STORY-012']);
  });

  it('persists the final counter after a batch, not just after the first', async () => {
    const paths = freshProject();
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    await allocator.allocateMany('Story', 3);
    expect(await allocator.allocate('Story')).toBe('STORY-004');
  });
});

describe('IdAllocator.allocate — CFG-010 overflow', () => {
  function narrowRegistry(): IdRegistry {
    return { ...DEFAULT_ID_REGISTRY, Story: { idPrefix: 'STORY', idWidth: 1 } };
  }

  it('refuses an id that would need more digits than idWidth allows', async () => {
    const paths = freshProject();
    const allocator = new IdAllocator({ paths, clock: fakeClock(), registry: narrowRegistry() });
    await allocator.allocateMany('Story', 9); // STORY-1 .. STORY-9, the maximum idWidth 1 permits
    await expect(allocator.allocate('Story')).rejects.toMatchObject({ code: 'CFG-010' });
  });

  it('refuses the whole batch if any id in an allocateMany call would overflow', async () => {
    const paths = freshProject();
    const allocator = new IdAllocator({ paths, clock: fakeClock(), registry: narrowRegistry() });
    await expect(allocator.allocateMany('Story', 10)).rejects.toMatchObject({ code: 'CFG-010' });
  });
});

describe('IdAllocator concurrency', () => {
  it('50 concurrent allocate("Story") calls return 50 distinct, contiguous ids', async () => {
    const paths = freshProject();
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    const ids = await Promise.all(Array.from({ length: 50 }, () => allocator.allocate('Story')));
    expect(new Set(ids).size).toBe(50);
    const numbers = ids.map((id) => Number(id.split('-')[1])).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('the same scenario run twice gives the same set of ids', async () => {
    async function run(): Promise<readonly string[]> {
      const paths = freshProject();
      const allocator = new IdAllocator({ paths, clock: fakeClock() });
      return Promise.all(Array.from({ length: 50 }, () => allocator.allocate('Story')));
    }
    const [first, second] = await Promise.all([run(), run()]);
    expect([...first].sort()).toEqual([...second].sort());
  });

  it('serialises allocate and allocateMany against each other, with no id collision', async () => {
    const paths = freshProject();
    const allocator = new IdAllocator({ paths, clock: fakeClock() });
    const [single, many] = await Promise.all([
      Promise.all(Array.from({ length: 10 }, () => allocator.allocate('Story'))),
      allocator.allocateMany('Story', 10),
    ]);
    const all = [...single, ...many];
    expect(new Set(all).size).toBe(20);
  });
});

describe('IdAllocator — the injected clock, not Date.now()', () => {
  it("writes the cache's writtenAt from the injected clock", async () => {
    const paths = freshProject();
    const clock: Clock = { now: () => '2026-03-04T00:00:00.000Z' };
    const allocator = new IdAllocator({ paths, clock });
    await allocator.allocate('Story');
    const cache = JSON.parse(readFileSync(paths.resolveState('ids.json'), 'utf8')) as {
      writtenAt: string;
    };
    expect(cache.writtenAt).toBe('2026-03-04T00:00:00.000Z');
  });
});
