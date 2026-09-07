/**
 * `scoreByTermOverlap` — the deterministic, non-BM25 search ranking used by both the JSON backend and
 * the `node:sqlite` backend (which, verified empirically, has no FTS5 extension in the installed
 * Node — `SPEC-QUESTIONS.md` Q53 point 6). Only `better-sqlite3` gets real BM25.
 *
 * A plain term-overlap count, not a substring search: the query and each document's own searchable
 * text are both lower-cased and split on non-word characters into a set of terms, and the score is
 * how many of the query's own terms appear anywhere in the document's terms. Ties are broken by `id`,
 * compared with plain `<`/`>` (never `localeCompare` — R10), so the result order never depends on the
 * host's locale or on which backend happens to be active.
 *
 * @see specs/08 §8.5
 * @see SPEC-QUESTIONS.md Q53
 * @see PLAN-M3.md P8
 */
import type { SearchHit } from './types.ts';

export interface SearchableDocument {
  readonly id: string;
  readonly text: string;
}

/** Exported so `SqliteBackend` can build its own FTS5 query from the identical tokenisation this
 * scorer uses — the two backends should agree on what counts as "a term" even though only one of
 * them does real BM25. */
export function termsOf(text: string): ReadonlySet<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter((term) => term.length > 0));
}

export function scoreByTermOverlap(
  query: string,
  documents: readonly SearchableDocument[],
): readonly SearchHit[] {
  const queryTerms = termsOf(query);
  if (queryTerms.size === 0) return [];

  const hits: SearchHit[] = [];
  for (const document of documents) {
    const documentTerms = termsOf(document.text);
    let score = 0;
    for (const term of queryTerms) {
      if (documentTerms.has(term)) score += 1;
    }
    if (score > 0) hits.push({ id: document.id, score });
  }

  return hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.id < b.id ? -1 : 1;
  });
}
