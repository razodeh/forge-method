/**
 * `openKbIndex` — `02` §2.1's three-tier fallback: `better-sqlite3` → `node:sqlite` if present → a
 * JSON-file index, probed in that exact order, never throwing for an unavailable native module.
 *
 * Probing uses `createRequire`, not a dynamic `import()`: both `better-sqlite3` and `node:sqlite` are
 * requirable synchronously, which is what lets `openKbIndex` itself stay synchronous — matching
 * `KbIndexBackend`'s own all-synchronous methods (mirroring `better-sqlite3`'s and `node:sqlite`'s own
 * synchronous APIs), which a `Promise`-returning dynamic-`import()` probe could not.
 *
 * @see specs/02 §2.1
 * @see PLAN-M3.md P8
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { ForgeError } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';

import { JsonBackend } from './json-backend.ts';
import { NodeSqliteBackend } from './node-sqlite-backend.ts';
import { SqliteBackend } from './better-sqlite-backend.ts';
import type { KbIndexBackend } from './types.ts';
import type { SqliteConnectionLike } from './sqlite-common.ts';

const require = createRequire(import.meta.url);

function tryBetterSqlite3(dbPath: string): KbIndexBackend | undefined {
  try {
    const Database = require('better-sqlite3') as new (path: string) => SqliteConnectionLike;
    return new SqliteBackend(new Database(dbPath));
  } catch {
    return undefined;
  }
}

function tryNodeSqlite(dbPath: string): KbIndexBackend | undefined {
  try {
    const nodeSqlite = require('node:sqlite') as {
      DatabaseSync: new (path: string) => SqliteConnectionLike;
    };
    return new NodeSqliteBackend(new nodeSqlite.DatabaseSync(dbPath));
  } catch {
    return undefined;
  }
}

export function openKbIndex(paths: ProjectPaths): KbIndexBackend {
  const dbPath = paths.resolveState('index.db');
  const stateDir = path.dirname(dbPath);

  // Verified empirically: neither better-sqlite3's nor node:sqlite's own Database constructor
  // creates a missing parent directory — both throw "Cannot open database because the directory
  // does not exist" for a brand-new project's own not-yet-created `.forge/state/`. A gauntlet critic
  // found this call unguarded: a real filesystem obstruction here (a plain file sitting where
  // `.forge/state/` should be a directory, or no write permission) surfaced as a raw, unhelpful
  // ENOENT/EEXIST/EACCES rather than an actionable error — not a "module unavailable, fall back"
  // case at all (no backend, SQLite or JSON, can work around a genuinely broken storage location).
  try {
    mkdirSync(stateDir, { recursive: true });
  } catch (cause) {
    const issue = cause instanceof Error ? cause.message : String(cause);
    throw new ForgeError('KB-012', { path: stateDir, issue }, { cause });
  }

  const sqlite = tryBetterSqlite3(dbPath);
  if (sqlite !== undefined) return sqlite;

  const nodeSqlite = tryNodeSqlite(dbPath);
  if (nodeSqlite !== undefined) return nodeSqlite;

  // eslint-disable-next-line no-console -- 02 §2.1's own "else a JSON-file index with a warning."
  console.warn(
    'openKbIndex: neither better-sqlite3 nor node:sqlite is available; using the JSON index.',
  );
  return new JsonBackend(paths.resolveState('index.json'));
}
