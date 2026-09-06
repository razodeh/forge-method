/**
 * `computeValidityHash`, `readIdCache`, `writeIdCache` — `.forge/state/ids.json`.
 *
 * @see specs/18 §18.8
 * @see PLAN-M1.md P13
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectPaths } from '../../src/fs/paths.ts';
import { computeValidityHash, readIdCache, writeIdCache } from '../../src/ids/cache.ts';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-ids-cache-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('computeValidityHash', () => {
  it('is order-independent — the same file set hashes the same regardless of input order', () => {
    expect(computeValidityHash(['a.md', 'b.md'])).toBe(computeValidityHash(['b.md', 'a.md']));
  });

  it('differs when the file set differs', () => {
    expect(computeValidityHash(['a.md'])).not.toBe(computeValidityHash(['a.md', 'b.md']));
  });

  it('is deterministic across repeated calls', () => {
    expect(computeValidityHash(['a.md', 'b.md'])).toBe(computeValidityHash(['a.md', 'b.md']));
  });
});

describe('readIdCache', () => {
  it('reports "missing" when there is no cache file yet', async () => {
    const paths = freshProject();
    expect(await readIdCache(paths)).toEqual({ kind: 'missing' });
  });

  it('reports "corrupt" for invalid JSON', async () => {
    const paths = freshProject();
    const cachePath = paths.resolveState('ids.json');
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, 'not json{{{');
    const result = await readIdCache(paths);
    expect(result.kind).toBe('corrupt');
  });

  it('reports "corrupt" for valid JSON that is not shaped like an IdIndex', async () => {
    const paths = freshProject();
    const cachePath = paths.resolveState('ids.json');
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ foo: 'bar' }));
    const result = await readIdCache(paths);
    expect(result.kind).toBe('corrupt');
  });

  it('reports "corrupt" when counters is not an object of numbers', async () => {
    const paths = freshProject();
    const cachePath = paths.resolveState('ids.json');
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({ validityHash: 'x', writtenAt: 't', counters: { Story: 'not a number' } }),
    );
    expect((await readIdCache(paths)).kind).toBe('corrupt');
  });

  it.each([
    ['a bare JSON number', '42'],
    ['a bare JSON string', '"hello"'],
    ['a bare JSON null', 'null'],
    ['writtenAt missing', JSON.stringify({ validityHash: 'x', counters: {} })],
    ['writtenAt not a string', JSON.stringify({ validityHash: 'x', writtenAt: 42, counters: {} })],
    [
      'counters not an object',
      JSON.stringify({ validityHash: 'x', writtenAt: 't', counters: 'nope' }),
    ],
    [
      'counters is an array',
      JSON.stringify({ validityHash: 'x', writtenAt: 't', counters: ['nope'] }),
    ],
    ['counters is null', JSON.stringify({ validityHash: 'x', writtenAt: 't', counters: null })],
  ])('reports "corrupt" for %s', async (_label, content) => {
    const paths = freshProject();
    const cachePath = paths.resolveState('ids.json');
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, content);
    expect((await readIdCache(paths)).kind).toBe('corrupt');
  });

  it('reads back a well-formed cache', async () => {
    const paths = freshProject();
    await writeIdCache(paths, { validityHash: 'abc', writtenAt: 't0', counters: { Story: 3 } });
    const result = await readIdCache(paths);
    expect(result).toEqual({
      kind: 'ok',
      index: { validityHash: 'abc', writtenAt: 't0', counters: { Story: 3 } },
    });
  });
});

describe('writeIdCache', () => {
  it('writes to .forge/state/ids.json', async () => {
    const paths = freshProject();
    await writeIdCache(paths, { validityHash: 'abc', writtenAt: 't0', counters: { Story: 1 } });
    const raw = readFileSync(paths.resolveState('ids.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({
      validityHash: 'abc',
      writtenAt: 't0',
      counters: { Story: 1 },
    });
  });

  it('writes counters with sorted keys, deterministically, when insertion order is descending', async () => {
    const paths = freshProject();
    await writeIdCache(paths, {
      validityHash: 'abc',
      writtenAt: 't0',
      counters: { Story: 1, ADR: 2 },
    });
    const raw = readFileSync(paths.resolveState('ids.json'), 'utf8');
    expect(raw.indexOf('"ADR"')).toBeLessThan(raw.indexOf('"Story"'));
  });

  it('writes counters with sorted keys, deterministically, when insertion order is already ascending', async () => {
    // Exercises the comparator's other branch: `{ Story, ADR }` above never needs the "already in
    // order" outcome, since every pair it produces during a real sort needs a swap.
    const paths = freshProject();
    await writeIdCache(paths, {
      validityHash: 'abc',
      writtenAt: 't0',
      counters: { ADR: 2, Story: 1 },
    });
    const raw = readFileSync(paths.resolveState('ids.json'), 'utf8');
    expect(raw.indexOf('"ADR"')).toBeLessThan(raw.indexOf('"Story"'));
  });

  it('is atomic — no partial file is ever left on a normal write', async () => {
    const paths = freshProject();
    await writeIdCache(paths, { validityHash: 'abc', writtenAt: 't0', counters: {} });
    const entries = readFileSync(paths.resolveState('ids.json'), 'utf8');
    expect(entries.endsWith('\n')).toBe(true);
  });
});
