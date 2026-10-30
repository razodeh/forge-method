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

/** `node:sqlite` is a Node>=22-only built-in (`specs/02` §2.1) — confirmed live, every
 * `require('node:sqlite')` below throws `Error: No such built-in module: node:sqlite` on a real
 * Node 20.19.6 binary, not a graceful fallback (that graceful handling lives in `openKbIndex`'s own
 * 3-tier probe, `open.ts`, deliberately bypassed here to test `NodeSqliteBackend` itself in
 * isolation — `open.test.ts` covers the fallback). `SPEC-QUESTIONS.md` Q369/Q370. */
const NODE_SQLITE_AVAILABLE = Number(process.versions.node.split('.')[0]) >= 22;
const NODE_SQLITE_SKIP_REASON = `node:sqlite requires Node >=22, running on Node ${process.versions.node}`;

/** Whether this Node's own bundled SQLite has the FTS5 extension compiled in for `node:sqlite`.
 * Node gained this starting at v22.16.0 (`nodejs/node#57621`, backported into the 22.x line) — but
 * detected empirically, by actually trying it, rather than assumed from the version number alone:
 * confirmed live that a real Node 22.14.0 binary (predating the backport) lacks it while a real
 * 22.23.4 one (postdating it) has it, so "Node >=22" alone is not a reliable signal, and neither is
 * any single threshold guaranteed to hold for every future platform/build combination. Before this
 * was compiled in, `node:sqlite`'s own `DROP TABLE` on an existing FTS5 virtual table — and even just
 * opening a connection to a file that has one — threw `no such module: fts5`; once it is compiled in,
 * both succeed, which changes which of the two cases below actually applies on a given machine. */
const NODE_SQLITE_HAS_FTS5 = (() => {
  if (!NODE_SQLITE_AVAILABLE) return false;
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => SqliteConnectionLike;
    };
    const probe = new DatabaseSync(':memory:');
    try {
      probe.exec('CREATE VIRTUAL TABLE forge_fts5_probe USING fts5(x)');
      return true;
    } catch {
      return false;
    } finally {
      probe.close();
    }
  } catch {
    return false;
  }
})();

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

describe.each(BACKENDS)('%s — shared KbIndexBackend behaviour', (name, createBackend) => {
  // `node:sqlite` only: every other entry in `BACKENDS` runs unaffected (`skip` is always `false`
  // for them, so `t`/`t.each` below are the real, unconditional `it`/`it.each`).
  const skip = name.startsWith('NodeSqliteBackend') && !NODE_SQLITE_AVAILABLE;
  const t = skip ? it.skip : it;
  const suffix = skip ? ` (skipped: ${NODE_SQLITE_SKIP_REASON})` : '';

  t(`upsertEntry then search finds the entry for a matching query${suffix}`, () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    const hits = backend.search('asynchronous queue');
    expect(hits.map((hit) => hit.id)).toContain('KB-ARCH-0001');
    backend.close();
  });

  t(`upsertEntry twice for the same id updates it, not duplicates it${suffix}`, () => {
    const backend = createBackend();
    backend.upsertEntry(entry({ title: 'First title' }));
    backend.upsertEntry(entry({ title: 'Second title' }));
    // No direct "get" on the interface — search for a term unique to the second title and confirm
    // exactly one hit, proving the first row was replaced, not accumulated alongside it.
    const hits = backend.search('Second');
    expect(hits).toHaveLength(1);
    backend.close();
  });

  t(`expand(ids, 0) returns ids unchanged${suffix}`, () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    expect(backend.expand(['KB-ARCH-0001'], 0)).toEqual(['KB-ARCH-0001']);
    backend.close();
  });

  t(
    `expand(ids, 1) returns exactly the entries linked to ids, plus ids themselves${suffix}`,
    () => {
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
    },
  );

  t(`expand treats links as undirected: a linked-from entry is also reachable${suffix}`, () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    backend.upsertEntry(entry({ id: 'KB-DATA-0001', title: 'Points at the first entry' }));
    backend.upsertLinks('KB-DATA-0001', [{ toId: 'KB-ARCH-0001', kind: 'related' }]);

    const result = backend.expand(['KB-ARCH-0001'], 1);
    expect(result).toContain('KB-DATA-0001');
    backend.close();
  });

  t(`clear() removes every entry and link${suffix}`, () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    backend.upsertLinks('KB-ARCH-0001', [{ toId: 'KB-DATA-0001', kind: 'related' }]);
    backend.clear();
    expect(backend.search('asynchronous')).toEqual([]);
    expect(backend.expand(['KB-ARCH-0001'], 1)).toEqual(['KB-ARCH-0001']);
    backend.close();
  });

  t(`search returns [] for a query matching nothing${suffix}`, () => {
    const backend = createBackend();
    backend.upsertEntry(entry());
    expect(backend.search('completely unrelated nonsense')).toEqual([]);
    backend.close();
  });

  t.each([
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
  ])(`search never throws for adversarial query text: %s${suffix}`, (query) => {
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

describe.skipIf(!NODE_SQLITE_AVAILABLE)(
  `SqliteBackend / NodeSqliteBackend — reopening the same on-disk file with the other backend${
    NODE_SQLITE_AVAILABLE ? '' : ` (skipped: ${NODE_SQLITE_SKIP_REASON})`
  }`,
  () => {
    it.skipIf(NODE_SQLITE_HAS_FTS5)(
      `node:sqlite cannot self-heal an FTS5 table left by better-sqlite3, and says so plainly${
        NODE_SQLITE_HAS_FTS5
          ? ` (skipped: this Node's own node:sqlite build has fts5 compiled in -- see the sibling case below)`
          : ''
      }`,
      () => {
        // Models a real scenario: .forge/state/index.db is derived, rebuildable state that can
        // travel between machines/CI runners with different native-binding availability. Verified
        // this direction genuinely cannot self-heal ON A NODE WHOSE node:sqlite BUILD LACKS FTS5
        // (NODE_SQLITE_HAS_FTS5 above): node:sqlite has no FTS5 module loaded at all, and *dropping*
        // a virtual table needs its module registered, not only reading or writing it — so
        // node:sqlite's own DROP TABLE on an existing FTS5 table throws the identical
        // "no such module: fts5" it would throw trying to use the table at all. NodeSqliteBackend
        // construction throwing here (rather than silently limping along) is what lets openKbIndex's
        // own existing try/catch fall through to JsonBackend instead — see open.test.ts for that
        // path. Once node:sqlite's own build DOES have fts5 (the sibling case below), this direction
        // self-heals instead of throwing — see that case for why.
        const dbPath = path.join(freshDir(), 'index.db');

        const Database = require('better-sqlite3') as new (path: string) => SqliteConnectionLike;
        const sqlite = new SqliteBackend(new Database(dbPath));
        sqlite.upsertEntry(entry());
        sqlite.close();

        const { DatabaseSync } = require('node:sqlite') as {
          DatabaseSync: new (path: string) => SqliteConnectionLike;
        };
        expect(() => new NodeSqliteBackend(new DatabaseSync(dbPath))).toThrow(/fts5/i);
      },
    );

    it.skipIf(!NODE_SQLITE_HAS_FTS5)(
      `node:sqlite CAN self-heal an FTS5 table left by better-sqlite3 once its own build has fts5 compiled in, warning rather than throwing${
        NODE_SQLITE_HAS_FTS5
          ? ''
          : ` (skipped: this Node's own node:sqlite build has no fts5 module -- see the sibling case above)`
      }`,
      () => {
        // Node's own bundled SQLite gained the FTS5 extension starting at v22.16.0
        // (`nodejs/node#57621`, backported into the 22.x line) -- on such a build, node:sqlite's own
        // DROP TABLE on an existing FTS5 virtual table now succeeds instead of throwing "no such
        // module: fts5", so BaseSqliteBackend's own reconcileTermsTableShape() (sqlite-common.ts)
        // self-heals in THIS direction too, exactly like the already-proven reverse direction below:
        // it warns, drops the stale FTS5 table, and recreates a plain one. NodeSqliteBackend
        // construction succeeds rather than throwing, and the backend is immediately usable --
        // openKbIndex (open.test.ts) keeps this tier instead of falling through to JsonBackend.
        const dbPath = path.join(freshDir(), 'index.db');

        const Database = require('better-sqlite3') as new (path: string) => SqliteConnectionLike;
        const sqlite = new SqliteBackend(new Database(dbPath));
        sqlite.upsertEntry(entry());
        sqlite.close();

        const { DatabaseSync } = require('node:sqlite') as {
          DatabaseSync: new (path: string) => SqliteConnectionLike;
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        let nodeSqlite: NodeSqliteBackend | undefined;
        expect(() => {
          nodeSqlite = new NodeSqliteBackend(new DatabaseSync(dbPath));
        }).not.toThrow();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();

        expect(() => {
          nodeSqlite?.upsertEntry(entry({ id: 'KB-ARCH-0002' }));
        }).not.toThrow();
        expect(nodeSqlite?.search('asynchronous').map((hit) => hit.id)).toContain('KB-ARCH-0002');
        nodeSqlite?.close();
      },
    );

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
  },
);
