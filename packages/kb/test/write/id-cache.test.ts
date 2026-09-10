/**
 * `computeKbValidityHash`, `readKbIdCache`, `writeKbIdCache` — `.forge/state/kb-ids.json`.
 *
 * @see specs/08 §8.6
 * @see PLAN-M3.md P7
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { computeKbValidityHash, readKbIdCache, writeKbIdCache } from '../../src/write/id-cache.ts';

let projectRoot: string | undefined;

function freshProject(): ProjectPaths {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-kb-id-cache-'));
  projectRoot = root;
  return new ProjectPaths(root);
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('computeKbValidityHash', () => {
  it('is order-independent — the same file set hashes the same regardless of input order', () => {
    expect(computeKbValidityHash(['a.md', 'b.md'])).toBe(computeKbValidityHash(['b.md', 'a.md']));
  });

  it('differs when the file set differs', () => {
    expect(computeKbValidityHash(['a.md'])).not.toBe(computeKbValidityHash(['a.md', 'b.md']));
  });

  it('is deterministic across repeated calls', () => {
    expect(computeKbValidityHash(['a.md', 'b.md'])).toBe(computeKbValidityHash(['a.md', 'b.md']));
  });
});

describe('readKbIdCache', () => {
  it('reports "missing" when there is no cache file yet', async () => {
    const paths = freshProject();
    expect(await readKbIdCache(paths)).toEqual({ kind: 'missing' });
  });

  it.each([
    ['invalid JSON', 'not json{{{'],
    ['a bare JSON number', '42'],
    ['a bare JSON string', '"hello"'],
    ['a bare JSON null', 'null'],
    ['not shaped like a KbIdIndex at all', JSON.stringify({ foo: 'bar' })],
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
    [
      'counters values are not all numbers',
      JSON.stringify({ validityHash: 'x', writtenAt: 't', counters: { architecture: 'nope' } }),
    ],
  ])('reports "corrupt" for %s', async (_label, content) => {
    const paths = freshProject();
    const cachePath = paths.resolveState('kb-ids.json');
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, content);
    expect((await readKbIdCache(paths)).kind).toBe('corrupt');
  });

  it('reads back a well-formed cache', async () => {
    const paths = freshProject();
    await writeKbIdCache(paths, {
      validityHash: 'abc',
      writtenAt: 't0',
      counters: { architecture: 3 },
    });
    const result = await readKbIdCache(paths);
    expect(result).toEqual({
      kind: 'ok',
      index: { validityHash: 'abc', writtenAt: 't0', counters: { architecture: 3 } },
    });
  });
});

describe('writeKbIdCache', () => {
  it('writes to .forge/state/kb-ids.json', async () => {
    const paths = freshProject();
    await writeKbIdCache(paths, {
      validityHash: 'abc',
      writtenAt: 't0',
      counters: { architecture: 1 },
    });
    const raw = readFileSync(paths.resolveState('kb-ids.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({
      validityHash: 'abc',
      writtenAt: 't0',
      counters: { architecture: 1 },
    });
  });

  it('writes counters with sorted keys, deterministically, when insertion order is descending', async () => {
    const paths = freshProject();
    await writeKbIdCache(paths, {
      validityHash: 'abc',
      writtenAt: 't0',
      counters: { product: 1, architecture: 2 },
    });
    const raw = readFileSync(paths.resolveState('kb-ids.json'), 'utf8');
    expect(raw.indexOf('"architecture"')).toBeLessThan(raw.indexOf('"product"'));
  });

  it('writes counters with sorted keys, deterministically, when insertion order is already ascending', async () => {
    // Exercises the comparator's other branch: `{ product, architecture }` above never needs the
    // "already in order" outcome, since every pair it produces during a real sort needs a swap.
    const paths = freshProject();
    await writeKbIdCache(paths, {
      validityHash: 'abc',
      writtenAt: 't0',
      counters: { architecture: 2, product: 1 },
    });
    const raw = readFileSync(paths.resolveState('kb-ids.json'), 'utf8');
    expect(raw.indexOf('"architecture"')).toBeLessThan(raw.indexOf('"product"'));
  });

  it('is atomic — no partial file is ever left on a normal write', async () => {
    const paths = freshProject();
    await writeKbIdCache(paths, { validityHash: 'abc', writtenAt: 't0', counters: {} });
    const entries = readFileSync(paths.resolveState('kb-ids.json'), 'utf8');
    expect(entries.endsWith('\n')).toBe(true);
  });
});
