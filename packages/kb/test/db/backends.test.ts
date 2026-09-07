/**
 * `SqliteBackend`/`NodeSqliteBackend`/`JsonBackend` — the shared `KbIndexBackend` behaviour every
 * backend must provide identically, checked against all three, not just whichever is installed in CI.
 *
 * @see specs/08 §8.5
 * @see SPEC-QUESTIONS.md Q53
 * @see PLAN-M3.md P8
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SqliteBackend } from '../../src/db/better-sqlite-backend.ts';
import { JsonBackend } from '../../src/db/json-backend.ts';
import { NodeSqliteBackend } from '../../src/db/node-sqlite-backend.ts';
import type { SqliteConnectionLike } from '../../src/db/sqlite-common.ts';
import type { EntryRow, KbIndexBackend } from '../../src/db/types.ts';

const require = createRequire(import.meta.url);

let scratchDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'forge-kb-index-'));
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
    rationale: 'See ADR-0011 for the throughput analysis.',
    ...overrides,
  };
}

type BackendFactory = () => KbIndexBackend;

const BACKENDS: readonly [string, BackendFactory][] = [
  [
    'SqliteBackend (better-sqlite3)',
    () => {
      const Database = require('better-sqlite3') as new (path: string) => SqliteConnectionLike;
      return new SqliteBackend(new Database(':memory:'));
    },
  ],
  [
    'NodeSqliteBackend (node:sqlite)',
    () => {
      const { DatabaseSync } = require('node:sqlite') as {
        DatabaseSync: new (path: string) => SqliteConnectionLike;
      };
      return new NodeSqliteBackend(new DatabaseSync(':memory:'));
    },
  ],
  ['JsonBackend', () => new JsonBackend(path.join(freshDir(), 'index.json'))],
];

describe.each(BACKENDS)('%s — shared KbIndexBackend behaviour', (_name, createBackend) => {
  it('upsertEntry then search finds the entry for a matching query', () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    const hits = backend.search('asynchronous queue');
    expect(hits.map((hit) => hit.id)).toContain('KB-ARCH-0001');
    backend.close();
  });

  it('upsertEntry twice for the same id updates it, not duplicates it', () => {
    const backend = createBackend();
    backend.upsertEntry(entry({ title: 'First title' }));
    backend.upsertEntry(entry({ title: 'Second title' }));
    // No direct "get" on the interface — search for a term unique to the second title and confirm
    // exactly one hit, proving the first row was replaced, not accumulated alongside it.
    const hits = backend.search('Second');
    expect(hits).toHaveLength(1);
    backend.close();
  });

  it('expand(ids, 0) returns ids unchanged', () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    expect(backend.expand(['KB-ARCH-0001'], 0)).toEqual(['KB-ARCH-0001']);
    backend.close();
  });

  it('expand(ids, 1) returns exactly the entries linked to ids, plus ids themselves', () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    backend.upsertEntry(entry({ id: 'KB-DATA-0001', title: 'A linked entry' }));
    backend.upsertEntry(entry({ id: 'KB-DATA-0002', title: 'Two hops away' }));
    backend.upsertLinks('KB-ARCH-0001', [{ toId: 'KB-DATA-0001', kind: 'related' }]);
    backend.upsertLinks('KB-DATA-0001', [{ toId: 'KB-DATA-0002', kind: 'related' }]);

    const result = backend.expand(['KB-ARCH-0001'], 1);
    expect([...result].sort()).toEqual(['KB-ARCH-0001', 'KB-DATA-0001']);
    expect(result).not.toContain('KB-DATA-0002');
    backend.close();
  });

  it('expand treats links as undirected: a linked-from entry is also reachable', () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    backend.upsertEntry(entry({ id: 'KB-DATA-0001', title: 'Points at the first entry' }));
    backend.upsertLinks('KB-DATA-0001', [{ toId: 'KB-ARCH-0001', kind: 'related' }]);

    const result = backend.expand(['KB-ARCH-0001'], 1);
    expect(result).toContain('KB-DATA-0001');
    backend.close();
  });

  it('clear() removes every entry and link', () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    backend.upsertLinks('KB-ARCH-0001', [{ toId: 'KB-DATA-0001', kind: 'related' }]);
    backend.clear();
    expect(backend.search('asynchronous')).toEqual([]);
    expect(backend.expand(['KB-ARCH-0001'], 1)).toEqual(['KB-ARCH-0001']);
    backend.close();
  });

  it('search returns [] for a query matching nothing', () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    expect(backend.search('completely unrelated nonsense')).toEqual([]);
    backend.close();
  });

  it.each([
    "what's next?",
    'C++ programming',
    '50% done',
    'a-b-c',
    'foo:bar',
    '',
    'foo AND',
    'NOT',
    '((()',
    'quotes "inside" a query',
    "unmatched ' quote",
  ])('search never throws for adversarial query text: %s', (query) => {
    // A gauntlet critic found a first version of SqliteBackend passed the query straight to SQLite's
    // FTS5 MATCH operator unescaped — FTS5's own query language treats most of these characters as
    // syntax, not literal text, so ordinary search input (an apostrophe, a colon) threw a real
    // "fts5: syntax error" uncaught, breaking backend interchangeability outright.
    const backend = createBackend();
    backend.upsertEntry(entry());
    expect(() => backend.search(query)).not.toThrow();
    backend.close();
  });
});

describe('SqliteBackend / NodeSqliteBackend — reopening the same on-disk file with the other backend', () => {
  it('node:sqlite cannot self-heal an FTS5 table left by better-sqlite3, and says so plainly', () => {
    // Models a real scenario: .forge/state/index.db is derived, rebuildable state that can travel
    // between machines/CI runners with different native-binding availability. Verified this
    // direction genuinely cannot self-heal: node:sqlite has no FTS5 module loaded at all, and
    // *dropping* a virtual table needs its module registered, not only reading or writing it — so
    // node:sqlite's own DROP TABLE on an existing FTS5 table throws the identical
    // "no such module: fts5" it would throw trying to use the table at all. NodeSqliteBackend
    // construction throwing here (rather than silently limping along) is what lets openKbIndex's own
    // existing try/catch fall through to JsonBackend instead — see open.test.ts for that path.
    const dbPath = path.join(freshDir(), 'index.db');

    const Database = require('better-sqlite3') as new (path: string) => SqliteConnectionLike;
    const sqlite = new SqliteBackend(new Database(dbPath));
    sqlite.upsertEntry(entry());
    sqlite.close();

    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => SqliteConnectionLike;
    };
    expect(() => new NodeSqliteBackend(new DatabaseSync(dbPath))).toThrow(/fts5/i);
  });

  it('reconciles a plain terms table left by node:sqlite when better-sqlite3 later opens the same file', () => {
    const dbPath = path.join(freshDir(), 'index.db');

    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => SqliteConnectionLike;
    };
    const nodeSqlite = new NodeSqliteBackend(new DatabaseSync(dbPath));
    nodeSqlite.upsertEntry(entry());
    nodeSqlite.close();

    const Database = require('better-sqlite3') as new (path: string) => SqliteConnectionLike;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sqlite = new SqliteBackend(new Database(dbPath));
    // A verify pass found the original version dropped the stale terms table with no signal that
    // real derived data (the entry upserted via node:sqlite above) just became unsearchable.
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    expect(() => {
      sqlite.upsertEntry(entry({ id: 'KB-ARCH-0002' }));
    }).not.toThrow();
    expect(sqlite.search('asynchronous').map((hit) => hit.id)).toContain('KB-ARCH-0002');
    sqlite.close();
  });
});
