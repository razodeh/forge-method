/**
 * `scoreByTermOverlap` — the deterministic, non-BM25 ranking `NodeSqliteBackend` and `JsonBackend`
 * both use.
 *
 * @see SPEC-QUESTIONS.md Q53
 * @see PLAN-M3.md P8
 */
import { describe, expect, it } from 'vitest';

import { scoreByTermOverlap } from '../../src/db/term-score.ts';

describe('scoreByTermOverlap', () => {
  it('ranks a document matching more query terms above one matching fewer', () => {
    const hits = scoreByTermOverlap('async queue reliability', [
      { id: 'a', text: 'Work is executed asynchronously via a durable queue.' },
      { id: 'b', text: 'Reliability is not discussed here at all.' },
    ]);
    expect(hits[0]?.id).toBe('a');
  });

  it('omits a document with zero overlap entirely', () => {
    const hits = scoreByTermOverlap('async queue', [
      { id: 'a', text: 'completely unrelated text' },
    ]);
    expect(hits).toEqual([]);
  });

  it('is case-insensitive', () => {
    const hits = scoreByTermOverlap('ASYNC', [{ id: 'a', text: 'async work' }]);
    expect(hits).toHaveLength(1);
  });

  it('breaks a score tie by id, byte order, never localeCompare', () => {
    const hits = scoreByTermOverlap('async', [
      { id: 'zebra', text: 'async' },
      { id: 'apple', text: 'async' },
    ]);
    expect(hits.map((hit) => hit.id)).toEqual(['apple', 'zebra']);
  });

  it('returns [] for an empty query', () => {
    expect(scoreByTermOverlap('', [{ id: 'a', text: 'anything' }])).toEqual([]);
  });

  it('is deterministic across repeated calls', () => {
    const documents = [
      { id: 'a', text: 'async queue reliability' },
      { id: 'b', text: 'sync direct call' },
    ];
    expect(scoreByTermOverlap('async', documents)).toEqual(scoreByTermOverlap('async', documents));
  });
});
