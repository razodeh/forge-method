/**
 * `SqliteConnectionLike`, `BaseSqliteBackend` — the schema and operations `SqliteBackend`
 * (`better-sqlite3`) and `NodeSqliteBackend` (`node:sqlite`) share. Verified empirically that both
 * packages' own connection objects expose the identical `exec`/`prepare().run()/.get()/.all()`/`close`
 * shape, so one implementation serves both — only `terms` (real FTS5 for `better-sqlite3`; a plain
 * table plus `scoreByTermOverlap` for `node:sqlite`, which has no FTS5 — `SPEC-QUESTIONS.md` Q53 point
 * 6) differs, left abstract here.
 *
 * @see specs/08 §8.5
 * @see PLAN-M3.md P8
 */
import type { EntryRow, KbIndexBackend, LinkRow, SearchHit } from './types.ts';

export interface SqliteStatementLike {
  run(...params: readonly unknown[]): unknown;
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown[];
}

export interface SqliteConnectionLike {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

interface LinkTableRow {
  readonly from_id: string;
  readonly to_id: string;
}

/** Every table `08` §8.5's derived index names, `entries`/`links` populated by this piece
 * (`SPEC-QUESTIONS.md` Q53), `symbols`/`usage` created empty for a future piece that does have data
 * for them (Q53 point 3) — `clear()` (Q53 point 7) must still clear them, since a stale row from a
 * *previous* rebuild must not survive one it wasn't part of. */
const SHARED_SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence TEXT NOT NULL,
  updated TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS symbols (
  symbol TEXT NOT NULL,
  entry_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  action TEXT NOT NULL
);
`;

export abstract class BaseSqliteBackend implements KbIndexBackend {
  protected readonly db: SqliteConnectionLike;

  constructor(db: SqliteConnectionLike) {
    this.db = db;
    this.db.exec(SHARED_SCHEMA);
    this.reconcileTermsTableShape();
    this.createTermsTable();
  }

  /**
   * Drops an existing `terms` table if it is the *wrong kind* for this backend — an FTS5 virtual
   * table left behind by `better-sqlite3` when `node:sqlite` (no FTS5 — `SPEC-QUESTIONS.md` Q53 point
   * 6) later opens the same `.forge/state/index.db`, or vice versa. A gauntlet critic found the first
   * version's own doc comment *claimed* this reconciliation already happened ("drops-and-recreates on
   * a shape mismatch") when no code anywhere actually did it: `CREATE TABLE IF NOT EXISTS` silently
   * no-ops against an existing table of the wrong kind, so `node:sqlite` opening a file `better-sqlite3`
   * had already indexed failed every later `upsertEntry`/`search` call with an opaque
   * `no such module: fts5`, with no indication the fix was "delete `index.db` and rebuild." Detected
   * via `sqlite_master`'s own `sql` column, which records literally `CREATE VIRTUAL TABLE ...` for an
   * FTS5 table and `CREATE TABLE ...` for a plain one — the one place SQLite itself distinguishes the
   * two, since `type` is `'table'` for both.
   *
   * This self-heals in only one direction: `better-sqlite3` (which has the FTS5 module loaded) can
   * drop a plain table `node:sqlite` left behind. The reverse cannot self-heal — verified empirically
   * that `node:sqlite`'s own `DROP TABLE` on an existing FTS5 virtual table itself throws
   * `no such module: fts5` (dropping a virtual table needs its module registered, not only reading or
   * writing it) — so `NodeSqliteBackend` simply throws in that case, same as any other construction
   * failure, and relies on `openKbIndex`'s own existing try/catch to fall through to `JsonBackend`
   * rather than trying to fabricate a recovery this environment genuinely cannot perform.
   */
  private reconcileTermsTableShape(): void {
    const existing = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'terms'")
      .get() as { readonly sql: string } | undefined;
    if (existing === undefined) return;

    const existingIsVirtual = /virtual\s+table/i.test(existing.sql);
    if (existingIsVirtual !== this.termsTableIsVirtual()) {
      // A verify pass found this silently discarded real derived data with no signal: dropping
      // `terms` alone (not `entries`/`links`, which stay valid) leaves every already-indexed entry
      // unsearchable until it is re-upserted or a full `rebuildIndex()` runs — the same "reduced
      // guarantees until rebuilt" situation `openKbIndex`'s own JSON-fallback branch already warns
      // about, so this does too.
      // eslint-disable-next-line no-console -- see the comment above.
      console.warn(
        'KbIndexBackend: reopened an index.db whose terms table was built by a different backend; ' +
          'search results for already-indexed entries are stale until they are re-upserted or the index is rebuilt.',
      );
      this.db.exec('DROP TABLE terms');
    }
  }

  /** Whether this backend's own `createTermsTable()` creates an FTS5 virtual table (`true`, only
   * `SqliteBackend`) or a plain one (`false`, `NodeSqliteBackend`) — an abstract *method*, not a
   * field, so it is available from this base constructor before any subclass field initialiser has
   * run (a plain `protected readonly` field set in the subclass would still be `undefined` at this
   * point in construction). */
  protected abstract termsTableIsVirtual(): boolean;
  protected abstract createTermsTable(): void;
  protected abstract upsertTerms(row: EntryRow): void;
  abstract search(query: string): readonly SearchHit[];

  upsertEntry(row: EntryRow): void {
    // Bound to a narrowed object, not `row` itself: verified empirically that `node:sqlite` (unlike
    // `better-sqlite3`) rejects a bound object carrying a named key the statement never references
    // ("Unknown named parameter") — `row` also carries `statement`/`rationale`, which this statement
    // has no place for (`upsertTerms` below is the one that needs them).
    this.db
      .prepare(
        `INSERT INTO entries (id, type, section, title, path, status, confidence, updated, hash)
         VALUES (@id, @type, @section, @title, @path, @status, @confidence, @updated, @hash)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type, section = excluded.section, title = excluded.title,
           path = excluded.path, status = excluded.status, confidence = excluded.confidence,
           updated = excluded.updated, hash = excluded.hash`,
      )
      .run({
        id: row.id,
        type: row.type,
        section: row.section,
        title: row.title,
        path: row.path,
        status: row.status,
        confidence: row.confidence,
        updated: row.updated,
        hash: row.hash,
      });
    this.upsertTerms(row);
  }

  upsertLinks(id: string, links: readonly LinkRow[]): void {
    this.db.prepare('DELETE FROM links WHERE from_id = ?').run(id);
    const insert = this.db.prepare('INSERT INTO links (from_id, to_id, kind) VALUES (?, ?, ?)');
    for (const link of links) insert.run(id, link.toId, link.kind);
  }

  /** Undirected: an entry pointing *at* something already in the frontier is reachable too — the
   * same interpretation the JSON backend uses (`SPEC-QUESTIONS.md` Q53 point 4). */
  expand(ids: readonly string[], hops: number): readonly string[] {
    const frontier = new Set(ids);
    const allLinks = this.db
      .prepare('SELECT from_id, to_id FROM links')
      .all() as readonly LinkTableRow[];

    for (let hop = 0; hop < hops; hop += 1) {
      const discovered = new Set<string>();
      for (const link of allLinks) {
        if (frontier.has(link.from_id)) discovered.add(link.to_id);
        if (frontier.has(link.to_id)) discovered.add(link.from_id);
      }
      for (const id of discovered) frontier.add(id);
    }

    return [...frontier].sort((a, b) => (a < b ? -1 : 1));
  }

  clear(): void {
    this.db.exec('DELETE FROM entries; DELETE FROM links; DELETE FROM symbols; DELETE FROM usage;');
    this.clearTerms();
  }

  protected abstract clearTerms(): void;

  close(): void {
    this.db.close();
  }
}
