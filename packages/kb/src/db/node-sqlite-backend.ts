/**
 * `NodeSqliteBackend` — `02` §2.1's middle "Local DB" tier, via `node:sqlite`. Verified empirically
 * that the installed Node's own bundled SQLite has no FTS5 extension (`SPEC-QUESTIONS.md` Q53 point
 * 6), so `terms` is a plain table here and search uses the same deterministic term-overlap ranking as
 * the JSON fallback, not real BM25.
 *
 * @see specs/08 §8.5
 * @see PLAN-M3.md P8
 */
import { BaseSqliteBackend } from './sqlite-common.ts';
import { scoreByTermOverlap } from './term-score.ts';
import type { EntryRow, SearchHit } from './types.ts';

interface TermsRow {
  readonly id: string;
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
}

export class NodeSqliteBackend extends BaseSqliteBackend {
  protected termsTableIsVirtual(): boolean {
    return false;
  }

  protected createTermsTable(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS terms (id TEXT PRIMARY KEY, title TEXT, statement TEXT, rationale TEXT)',
    );
  }

  protected upsertTerms(row: EntryRow): void {
    this.db
      .prepare(
        `INSERT INTO terms (id, title, statement, rationale) VALUES (@id, @title, @statement, @rationale)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, statement = excluded.statement, rationale = excluded.rationale`,
      )
      .run({ id: row.id, title: row.title, statement: row.statement, rationale: row.rationale });
  }

  protected clearTerms(): void {
    this.db.exec('DELETE FROM terms');
  }

  search(query: string): readonly SearchHit[] {
    const rows = this.db.prepare('SELECT id, title, statement, rationale FROM terms').all() as readonly TermsRow[];
    const documents = rows.map((row) => ({
      id: row.id,
      text: `${row.title} ${row.statement} ${row.rationale}`,
    }));
    return scoreByTermOverlap(query, documents);
  }
}
