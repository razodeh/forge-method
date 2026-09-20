/**
 * `readKbIndexEntries` — a read-only look at what the derived index currently holds, for `forge kb lint --rule
 * kb-synced` (`G-Operate`, `10` §10.3 "KB not synced").
 *
 * `openKbIndex` is not usable for that: it creates the state directory and an empty index when none exists, and
 * the JSON backend rewrites its file on `close()`, so "is the index current?" would have changed the index it was
 * asked about, and a check run on a project that never synced would leave a synced-looking empty index behind. This
 * reader never creates, writes or repairs anything.
 *
 * It probes in `openKbIndex`'s own order (`better-sqlite3`, then `node:sqlite`, both on `index.db`, then the JSON
 * file), so it reads the backend a `forge kb sync` in the same environment wrote.
 *
 * @see specs/08 §8.5, §8.9
 * @see PLAN-M13.md P25
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { ProjectPaths } from '@forge/core/fs';

const require = createRequire(import.meta.url);

/** What the index records about one entry: enough to tell whether the entry on disk has changed since. */
export interface KbIndexedEntry {
  readonly id: string;
  readonly hash: string;
  readonly path: string;
}

export type KbIndexReadResult =
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable'; readonly detail: string }
  | { readonly status: 'ok'; readonly entries: readonly KbIndexedEntry[] };

interface ReadOnlyConnection {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isIndexedEntry(value: unknown): value is KbIndexedEntry {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['id'] === 'string' &&
    typeof row['hash'] === 'string' &&
    typeof row['path'] === 'string'
  );
}

/** `null` when the `entries` table does not have the shape this reader expects. */
function entriesFromSqlite(open: () => ReadOnlyConnection): readonly KbIndexedEntry[] | null {
  const connection = open();
  try {
    const rows = connection.prepare('SELECT id, hash, path FROM entries ORDER BY id').all();
    if (!rows.every(isIndexedEntry)) return null;
    return rows.map((row) => ({ id: row.id, hash: row.hash, path: row.path }));
  } finally {
    connection.close();
  }
}

function readSqlite(dbPath: string): KbIndexReadResult | { readonly failed: string } {
  const attempts: readonly (readonly [string, () => ReadOnlyConnection])[] = [
    [
      'better-sqlite3',
      () => {
        const Database = require('better-sqlite3') as new (
          path: string,
          options: { readonly: boolean; fileMustExist: boolean },
        ) => ReadOnlyConnection;
        return new Database(dbPath, { readonly: true, fileMustExist: true });
      },
    ],
    [
      'node:sqlite',
      () => {
        const nodeSqlite = require('node:sqlite') as {
          DatabaseSync: new (path: string, options: { readOnly: boolean }) => ReadOnlyConnection;
        };
        return new nodeSqlite.DatabaseSync(dbPath, { readOnly: true });
      },
    ],
  ];
  const failures: string[] = [];
  for (const [name, open] of attempts) {
    try {
      const entries = entriesFromSqlite(open);
      if (entries !== null) return { status: 'ok', entries };
      failures.push(`${name}: the entries table has an unexpected shape`);
    } catch (cause) {
      failures.push(`${name}: ${describe(cause)}`);
    }
  }
  return { failed: failures.join('; ') };
}

function readJson(jsonPath: string): KbIndexReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (cause) {
    return { status: 'unreadable', detail: `${jsonPath}: ${describe(cause)}` };
  }
  const entries =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['entries']
      : undefined;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    return { status: 'unreadable', detail: `${jsonPath} has no entries object` };
  }
  const rows = Object.values(entries);
  if (!rows.every(isIndexedEntry)) {
    return { status: 'unreadable', detail: `${jsonPath} has an entry of an unexpected shape` };
  }
  return {
    status: 'ok',
    entries: rows
      .map((row) => ({ id: row.id, hash: row.hash, path: row.path }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/** Reads the derived index without creating, writing or repairing anything. Never throws: a missing index, and one
 * that cannot be read, are each a typed result. `hash` is the index's own content hash (of the parsed front matter,
 * `rebuild.ts`), so an edit to a body the index does not hash is not visible here. */
export function readKbIndexEntries(paths: ProjectPaths): KbIndexReadResult {
  const dbPath = paths.resolveState('index.db');
  const jsonPath = paths.resolveState('index.json');
  let sqliteFailure: string | undefined;
  if (existsSync(dbPath)) {
    const sqlite = readSqlite(dbPath);
    if (!('failed' in sqlite)) return sqlite;
    sqliteFailure = `${dbPath}: ${sqlite.failed}`;
  }
  // `openKbIndex` falls back to the JSON file when no SQLite backend can open `index.db`, and `forge kb sync` (and
  // every search) then use it. So a JSON index is the effective one when `index.db` is unreadable: reading it here
  // keeps "run `forge kb sync`" a remedy that works. If it is stale, its content says so.
  if (existsSync(jsonPath)) return readJson(jsonPath);
  return sqliteFailure === undefined
    ? { status: 'missing' }
    : { status: 'unreadable', detail: sqliteFailure };
}
