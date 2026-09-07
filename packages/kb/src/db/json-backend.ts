/**
 * `JsonBackend` — the pure-JS fallback `02` §2.1 mandates when neither `better-sqlite3` nor
 * `node:sqlite` is available: a plain object, held in memory for the backend's lifetime and written
 * atomically, once, on `close()` — not on every `upsertEntry` call, which would cost `rebuildIndex` an
 * O(n) file write per row (O(n²) total) for no benefit, since nothing reads the file back until the
 * next `openKbIndex` call opens a fresh backend anyway.
 *
 * Search uses `scoreByTermOverlap` — the same non-BM25 ranking the `node:sqlite` backend uses, since
 * neither has FTS5 (`SPEC-QUESTIONS.md` Q53 point 6).
 *
 * @see specs/02 §2.1
 * @see specs/08 §8.5
 * @see PLAN-M3.md P8
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { scoreByTermOverlap } from './term-score.ts';
import type { EntryRow, KbIndexBackend, LinkRow, SearchHit } from './types.ts';

interface JsonIndexData {
  entries: Record<string, EntryRow>;
  links: Record<string, readonly LinkRow[]>;
}

function emptyData(): JsonIndexData {
  return { entries: {}, links: {} };
}

function isJsonIndexData(value: unknown): value is JsonIndexData {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['entries'] === 'object' && typeof record['links'] === 'object';
}

/** Reads `filePath` if it exists and parses to a `JsonIndexData` shape; otherwise (missing, corrupt)
 * starts fresh — the same "a damaged or absent cache is not fatal" stance every other cache in this
 * codebase already takes. */
function readExisting(filePath: string): JsonIndexData {
  if (!existsSync(filePath)) return emptyData();
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return isJsonIndexData(parsed) ? parsed : emptyData();
  } catch {
    return emptyData();
  }
}

/** Writes `contents` to `target`, atomically (temp file in the same directory, then rename) — the
 * synchronous counterpart to `@forge/core/fs`'s own `writeFileAtomic`, needed here because
 * `KbIndexBackend`'s every method is synchronous, matching the two real SQLite backends' own APIs. */
function writeFileAtomicSync(target: string, contents: string): void {
  const dir = path.dirname(target);
  mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(target)}.tmp-${String(process.pid)}`);
  writeFileSync(tempPath, contents);
  renameSync(tempPath, target);
}

export class JsonBackend implements KbIndexBackend {
  private readonly filePath: string;
  private data: JsonIndexData;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = readExisting(filePath);
  }

  upsertEntry(row: EntryRow): void {
    this.data.entries[row.id] = row;
  }

  upsertLinks(id: string, links: readonly LinkRow[]): void {
    this.data.links[id] = [...links];
  }

  search(query: string): readonly SearchHit[] {
    const documents = Object.values(this.data.entries).map((entry) => ({
      id: entry.id,
      text: `${entry.title} ${entry.statement} ${entry.rationale}`,
    }));
    return scoreByTermOverlap(query, documents);
  }

  expand(ids: readonly string[], hops: number): readonly string[] {
    const frontier = new Set(ids);
    for (let hop = 0; hop < hops; hop += 1) {
      const discovered = new Set<string>();
      for (const [fromId, links] of Object.entries(this.data.links)) {
        if (!frontier.has(fromId)) continue;
        for (const link of links) discovered.add(link.toId);
      }
      // Undirected: an entry pointing *at* something already in the frontier is reachable too.
      for (const [fromId, links] of Object.entries(this.data.links)) {
        if (links.some((link) => frontier.has(link.toId))) discovered.add(fromId);
      }
      for (const id of discovered) frontier.add(id);
    }
    return [...frontier].sort((a, b) => (a < b ? -1 : 1));
  }

  clear(): void {
    this.data = emptyData();
  }

  close(): void {
    writeFileAtomicSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}
