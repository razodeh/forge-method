/**
 * `EntryRow`, `LinkRow`, `KbIndexBackend` — `08` §8.5's derived index, one shape shared by all three
 * backend implementations.
 *
 * @see specs/08 §8.5
 * @see SPEC-QUESTIONS.md Q53
 * @see PLAN-M3.md P8
 */

/** `08` §8.5's own `entries` columns. `section`/`confidence` are `''` for a document kind that has
 * neither field at all (an ADR, a Diagram, a Runbook — only the generic `knowledge`/`glossary` KB
 * entry shape, `kbEntrySchema`, has them) — an honest "not applicable" sentinel, not fabricated data
 * (`SPEC-QUESTIONS.md` Q53 point 3). `statement`/`rationale` are not one of `08` §8.5's own `entries`
 * columns — added so `upsertEntry` has something to feed the `terms` table's own required content
 * (Q53 point 5); `''` for the same "does not apply to this document kind" reason. */
export interface EntryRow {
  readonly id: string;
  readonly type: string;
  readonly section: string;
  readonly title: string;
  readonly path: string;
  readonly status: string;
  readonly confidence: string;
  readonly updated: string;
  readonly hash: string;
  readonly statement: string;
  readonly rationale: string;
}

/** `08` §8.5's own `links.kind` enum, verbatim — no sixth kind invented for a relationship (a
 * Diagram's own `depicts`, a KB entry's own `diagrams`) that has no listed kind of its own; both are
 * tagged `related` when `rebuildIndex` (P8) builds link rows from them. `rebuildIndex` only ever
 * produces `related`/`supersedes`/`applies_to` rows — `derived_from`/`cites` have no data source in
 * `KbTree` today (`SPEC-QUESTIONS.md` Q53 point 2) but are still part of the closed set every backend
 * must accept, for whichever future piece does have one. */
export type LinkKind = 'related' | 'supersedes' | 'applies_to' | 'derived_from' | 'cites';

export interface LinkRow {
  readonly toId: string;
  readonly kind: LinkKind;
}

export interface SearchHit {
  readonly id: string;
  readonly score: number;
}

/**
 * One shape, three implementations (`SqliteBackend`, `NodeSqliteBackend`, `JsonBackend`) — every
 * method synchronous, matching `better-sqlite3`'s and `node:sqlite`'s own synchronous APIs (the
 * design this interface was written against; the JSON backend's own synchronous file I/O follows the
 * same shape for consistency, not because it needs to be sync on its own).
 *
 * `clear()` was not in this piece's own first draft — added because `rebuildIndex`'s "clears and
 * repopulates every table" line named a capability nothing in the original four-method interface
 * could actually provide (`SPEC-QUESTIONS.md` Q53 point 7).
 */
export interface KbIndexBackend {
  upsertEntry(row: EntryRow): void;
  upsertLinks(id: string, links: readonly LinkRow[]): void;
  search(query: string): readonly SearchHit[];
  expand(ids: readonly string[], hops: number): readonly string[];
  clear(): void;
  close(): void;
}
