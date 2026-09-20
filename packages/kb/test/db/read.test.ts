/**
 * `readKbIndexEntries` — the read-only look at the derived index that `forge kb lint --rule kb-synced` needs
 * (`PLAN-M13.md` P25).
 *
 * @see specs/08 §8.5, §8.9
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { JsonBackend } from '../../src/db/json-backend.ts';
import { NodeSqliteBackend } from '../../src/db/node-sqlite-backend.ts';
import { openKbIndex } from '../../src/db/open.ts';
import { readKbIndexEntries } from '../../src/db/read.ts';
import { SqliteBackend } from '../../src/db/better-sqlite-backend.ts';
import type { EntryRow } from '../../src/db/types.ts';

const require = createRequire(import.meta.url);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fresh(): { readonly root: string; readonly paths: ProjectPaths } {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-kb-read-'));
  roots.push(root);
  return { root, paths: new ProjectPaths(root) };
}

const row = (id: string, hash: string): EntryRow => ({
  id,
  type: 'ADR',
  section: '',
  title: id,
  path: `decisions/${id}.md`,
  status: 'accepted',
  confidence: '',
  updated: '2026-01-01',
  hash,
  statement: '',
  rationale: '',
});

describe('readKbIndexEntries', () => {
  it('reports missing when no index was ever written, and creates nothing', () => {
    const { root, paths } = fresh();
    expect(readKbIndexEntries(paths)).toEqual({ status: 'missing' });
    expect(existsSync(path.join(root, '.forge'))).toBe(false);
  });

  it('reads the entries the real backend wrote, sorted, with hash and path', () => {
    const { paths } = fresh();
    const backend = openKbIndex(paths);
    backend.upsertEntry(row('ADR-0002', 'bbb'));
    backend.upsertEntry(row('ADR-0001', 'aaa'));
    backend.close();
    expect(readKbIndexEntries(paths)).toEqual({
      status: 'ok',
      entries: [
        { id: 'ADR-0001', hash: 'aaa', path: 'decisions/ADR-0001.md' },
        { id: 'ADR-0002', hash: 'bbb', path: 'decisions/ADR-0002.md' },
      ],
    });
  });

  it('reads an index written by each SQLite backend and by the JSON backend', () => {
    for (const kind of ['better-sqlite3', 'node:sqlite', 'json'] as const) {
      const { paths } = fresh();
      mkdirSync(path.dirname(paths.resolveState('index.db')), { recursive: true });
      let backend;
      if (kind === 'json') backend = new JsonBackend(paths.resolveState('index.json'));
      else if (kind === 'node:sqlite') {
        const { DatabaseSync } = require('node:sqlite') as {
          DatabaseSync: new (p: string) => ConstructorParameters<typeof NodeSqliteBackend>[0];
        };
        backend = new NodeSqliteBackend(new DatabaseSync(paths.resolveState('index.db')));
      } else {
        const Database = require('better-sqlite3') as new (
          p: string,
        ) => ConstructorParameters<typeof SqliteBackend>[0];
        backend = new SqliteBackend(new Database(paths.resolveState('index.db')));
      }
      backend.upsertEntry(row('ADR-0001', 'h1'));
      backend.close();
      const result = readKbIndexEntries(paths);
      expect(result.status, kind).toBe('ok');
      if (result.status === 'ok')
        expect(
          result.entries.map((e) => e.hash),
          kind,
        ).toEqual(['h1']);
    }
  });

  it('an empty index is ok with no entries (synced, nothing to sync)', () => {
    const { paths } = fresh();
    openKbIndex(paths).close();
    expect(readKbIndexEntries(paths)).toEqual({ status: 'ok', entries: [] });
  });

  it('a corrupt JSON index is unreadable, and is not repaired or rewritten', () => {
    const { paths } = fresh();
    const file = paths.resolveState('index.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{ not json');
    const result = readKbIndexEntries(paths);
    expect(result.status).toBe('unreadable');
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('a JSON index of the wrong shape is unreadable', () => {
    for (const body of ['[]', '{}', '{"entries":[]}', '{"entries":{"a":{"id":1}}}', 'null']) {
      const { paths } = fresh();
      const file = paths.resolveState('index.json');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, body);
      expect(readKbIndexEntries(paths).status, body).toBe('unreadable');
    }
  });

  it('a file that is not a database, at index.db, is unreadable and untouched', () => {
    const { paths } = fresh();
    const file = paths.resolveState('index.db');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'this is not a sqlite database');
    const before = statSync(file).mtimeMs;
    const result = readKbIndexEntries(paths);
    expect(result.status).toBe('unreadable');
    expect(readFileSync(file, 'utf8')).toBe('this is not a sqlite database');
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it('a corrupt index.db falls back to the JSON index, as openKbIndex does, so `kb sync` clears it', () => {
    const { paths } = fresh();
    mkdirSync(path.dirname(paths.resolveState('index.db')), { recursive: true });
    writeFileSync(paths.resolveState('index.db'), 'garbage');
    expect(readKbIndexEntries(paths).status).toBe('unreadable');
    const json = new JsonBackend(paths.resolveState('index.json'));
    json.upsertEntry(row('ADR-0001', 'fresh'));
    json.close();
    const result = readKbIndexEntries(paths);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.entries.map((e) => e.hash)).toEqual(['fresh']);
  });

  it('reading writes nothing: the files are byte-identical afterwards', () => {
    const { paths } = fresh();
    const json = new JsonBackend(paths.resolveState('index.json'));
    json.upsertEntry(row('ADR-0001', 'h'));
    json.close();
    const before = readFileSync(paths.resolveState('index.json'), 'utf8');
    readKbIndexEntries(paths);
    expect(readFileSync(paths.resolveState('index.json'), 'utf8')).toBe(before);
  });
});
