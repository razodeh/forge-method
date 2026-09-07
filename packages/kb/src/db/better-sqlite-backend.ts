/**
 * `SqliteBackend` — `02` §2.1's primary "Local DB" tier, via `better-sqlite3`. The only backend that
 * gets real FTS5/BM25 search (`SPEC-QUESTIONS.md` Q53 point 6).
 *
 * @see specs/08 §8.5
 * @see PLAN-M3.md P8
 */
import { BaseSqliteBackend } from './sqlite-common.ts';
import { termsOf } from './term-score.ts';
import type { EntryRow, SearchHit } from './types.ts';

interface TermsHit {
  readonly id: string;
  readonly score: number;
}

/**
 * Builds a syntactically-safe FTS5 `MATCH` expression from `query`'s own tokens (the identical
 * tokenisation `scoreByTermOverlap` uses), or `undefined` for a query with no terms at all.
 *
 * A gauntlet critic found the original version passed `query` straight through to `MATCH` unquoted —
 * FTS5's own query language treats many characters ordinary search text routinely contains as syntax
 * (`"`, `+`, `-`, `:`, `%`, `*`, parentheses, and the bare words `AND`/`OR`/`NOT`), so `"what's next?"`,
 * `"C++ programming"`, or even a single unmatched quote all threw a real `fts5: syntax error`
 * uncaught — breaking `search()`'s own implicit "never throws on a string" contract that the two
 * other backends already meet, and making backend interchangeability depend on which one happened to
 * be installed. Quoting each token as its own FTS5 string literal makes every special character inert
 * text rather than an operator; joining with `OR` keeps `SqliteBackend` matching-any-term the way
 * `scoreByTermOverlap` already does for the other two backends.
 *
 * The internal-quote-doubling below is defence-in-depth, not a live path today: `termsOf`'s own
 * `\W+`-based split already strips every `"` out of a token before this function ever sees one, so
 * no term this function receives can contain one — a verify pass confirmed this by construction, not
 * by assumption. Kept anyway so a future change to `termsOf`'s own tokenisation can't silently
 * reopen an FTS5 syntax-injection path here without this function's own escaping already covering it.
 */
function toSafeFts5Query(query: string): string | undefined {
  const terms = [...termsOf(query)];
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
}

export class SqliteBackend extends BaseSqliteBackend {
  protected termsTableIsVirtual(): boolean {
    return true;
  }

  protected createTermsTable(): void {
    this.db.exec(
      'CREATE VIRTUAL TABLE IF NOT EXISTS terms USING fts5(id UNINDEXED, title, statement, rationale)',
    );
  }

  protected upsertTerms(row: EntryRow): void {
    this.db.prepare('DELETE FROM terms WHERE id = ?').run(row.id);
    this.db
      .prepare('INSERT INTO terms (id, title, statement, rationale) VALUES (@id, @title, @statement, @rationale)')
      .run({ id: row.id, title: row.title, statement: row.statement, rationale: row.rationale });
  }

  protected clearTerms(): void {
    this.db.exec('DELETE FROM terms');
  }

  /** Negated: SQLite's own `bm25()` scores *more relevant* as *more negative* — every backend in
   * this piece reports higher-is-more-relevant, matching the JSON/`node:sqlite` term-overlap count. */
  search(query: string): readonly SearchHit[] {
    const ftsQuery = toSafeFts5Query(query);
    if (ftsQuery === undefined) return [];

    const rows = this.db
      .prepare('SELECT id, bm25(terms) AS raw_score FROM terms WHERE terms MATCH ? ORDER BY raw_score')
      .all(ftsQuery) as readonly { readonly id: string; readonly raw_score: number }[];
    return rows.map((row): TermsHit => ({ id: row.id, score: -row.raw_score }));
  }
}
