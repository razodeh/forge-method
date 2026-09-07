/**
 * `@forge/kb/index` — `08` §8.5's derived index: three backends behind one interface, and
 * `rebuildIndex`, the only path that should ever be trusted as ground truth.
 *
 * @see PLAN-M3.md P8
 */
export { SqliteBackend } from './better-sqlite-backend.ts';
export { JsonBackend } from './json-backend.ts';
export { NodeSqliteBackend } from './node-sqlite-backend.ts';
export { openKbIndex } from './open.ts';
export { rebuildIndex } from './rebuild.ts';
export { scoreByTermOverlap, type SearchableDocument } from './term-score.ts';
export type { EntryRow, KbIndexBackend, LinkKind, LinkRow, SearchHit } from './types.ts';
