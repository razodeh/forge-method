/**
 * `JsonBackend` — persistence, corruption handling, and directory creation specific to the pure-JS
 * fallback (the shared `KbIndexBackend` behaviour every backend provides is covered once, for all
 * three, in `backends.test.ts`).
 *
 * @see specs/02 §2.1
 * @see PLAN-M3.md P8
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JsonBackend } from '../../src/db/json-backend.ts';
import type { EntryRow } from '../../src/db/types.ts';

let scratchDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-kb-json-backend-'));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

function entry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: 'KB-ARCH-0001',
    type: 'knowledge',
    section: 'architecture',
    title: 'Asynchronous work execution strategy',
    path: 'architecture/topic.md',
    status: 'active',
    confidence: 'high',
    updated: '2026-01-05',
    hash: 'abc123',
    statement: 'Work is executed asynchronously via a durable queue.',
    rationale: 'See ADR-0011.',
    ...overrides,
  };
}

describe('JsonBackend — persistence', () => {
  it('creates the containing directory if it does not exist yet', () => {
    const dir = freshDir();
    const filePath = path.join(dir, 'nested', 'index.json');
    const backend = new JsonBackend(filePath);
    backend.upsertEntry(entry());
    backend.close();
    expect(readFileSync(filePath, 'utf8')).toContain('KB-ARCH-0001');
  });

  it('survives a close-then-reopen round trip', () => {
    const filePath = path.join(freshDir(), 'index.json');
    const first = new JsonBackend(filePath);
    first.upsertEntry(entry());
    first.close();

    const second = new JsonBackend(filePath);
    expect(second.search('asynchronous queue').map((hit) => hit.id)).toContain('KB-ARCH-0001');
    second.close();
  });

  it('writes the file atomically — no partial file left on a normal write', () => {
    const filePath = path.join(freshDir(), 'index.json');
    const backend = new JsonBackend(filePath);
    backend.upsertEntry(entry());
    backend.close();
    expect(readFileSync(filePath, 'utf8').endsWith('\n')).toBe(true);
  });
});

describe('JsonBackend — a missing or corrupt existing file is not fatal', () => {
  it('starts fresh when the file does not exist yet', () => {
    const filePath = path.join(freshDir(), 'index.json');
    const backend = new JsonBackend(filePath);
    expect(backend.search('anything')).toEqual([]);
    backend.close();
  });

  it.each([
    ['invalid JSON', 'not json{{{'],
    ['a bare JSON number', '42'],
    ['a bare JSON string', '"hello"'],
    ['a bare JSON null', 'null'],
    ['missing entries/links entirely', JSON.stringify({ foo: 'bar' })],
    ['entries present but links missing', JSON.stringify({ entries: {} })],
  ])('starts fresh for %s, rather than throwing', (_label, content) => {
    const dir = freshDir();
    const filePath = path.join(dir, 'index.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content);

    const backend = new JsonBackend(filePath);
    expect(backend.search('anything')).toEqual([]);
    backend.upsertEntry(entry());
    expect(backend.search('asynchronous')).toHaveLength(1);
    backend.close();
  });
});
