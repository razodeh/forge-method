/**
 * `parseControlTokens` — every worked example `05` names, line-anchoring, and the "unknown tokens are
 * logged and ignored" contract for both unregistered names and malformed-but-registered payloads.
 *
 * @see specs/05 §5.5
 * @see SPEC-QUESTIONS.md Q59
 * @see PLAN-M4.md P3
 */
import { describe, expect, it } from 'vitest';

import { FORGE_CONTROL_TOKENS } from '../../src/types/control-tokens.ts';
import { parseControlTokens } from '../../src/control-tokens/parse.ts';

describe('parseControlTokens', () => {
  it('is tested against every one of the seven registered token names (closed set, Q58 point 12)', () => {
    expect(FORGE_CONTROL_TOKENS.length).toBe(7);
  });

  it('parses FORGE_REQUEST_CONTEXT: <kb-id|query> (05 §5.4 point 4 worked example)', () => {
    const result = parseControlTokens('FORGE_REQUEST_CONTEXT: ADR-011');
    expect(result.tokens).toEqual([{ token: 'FORGE_REQUEST_CONTEXT', query: 'ADR-011' }]);
    expect(result.unknownLines).toEqual([]);
  });

  it('parses a free-text FORGE_REQUEST_CONTEXT query, not just a kb-id', () => {
    const result = parseControlTokens('FORGE_REQUEST_CONTEXT: what did we decide about auth?');
    expect(result.tokens).toEqual([
      { token: 'FORGE_REQUEST_CONTEXT', query: 'what did we decide about auth?' },
    ]);
  });

  it('parses FORGE_ASK: <question> | <option>, <option>, ... (05 §5.5 point 2)', () => {
    const result = parseControlTokens('FORGE_ASK: Postgres or SQLite? | Postgres, SQLite');
    expect(result.tokens).toEqual([
      { token: 'FORGE_ASK', question: 'Postgres or SQLite?', options: ['Postgres', 'SQLite'] },
    ]);
  });

  it('parses FORGE_ASK with no options segment as an empty options list, not a failure', () => {
    const result = parseControlTokens('FORGE_ASK: should we proceed?');
    expect(result.tokens).toEqual([
      { token: 'FORGE_ASK', question: 'should we proceed?', options: [] },
    ]);
    expect(result.unknownLines).toEqual([]);
  });

  it('parses FORGE_ASSUME: <text> | <confidence> | <impact> | <validateBy> (05 §5.5 point 2)', () => {
    const result = parseControlTokens(
      'FORGE_ASSUME: single deployable at MVP | high | second service delayed | stage plan review at M2',
    );
    expect(result.tokens).toEqual([
      {
        token: 'FORGE_ASSUME',
        text: 'single deployable at MVP',
        confidence: 'high',
        impact: 'second service delayed',
        validateBy: 'stage plan review at M2',
      },
    ]);
  });

  it('normalizes FORGE_ASSUME confidence case (the model may write Low/HIGH/etc.)', () => {
    const result = parseControlTokens('FORGE_ASSUME: text | HIGH | impact | validation');
    expect(result.tokens).toEqual([
      {
        token: 'FORGE_ASSUME',
        text: 'text',
        confidence: 'high',
        impact: 'impact',
        validateBy: 'validation',
      },
    ]);
  });

  it('parses FORGE_HANDOFF: <role> <reason> (05 §5.5 point 3 worked example)', () => {
    const result = parseControlTokens('FORGE_HANDOFF: platform this needs infra decisions first');
    expect(result.tokens).toEqual([
      { token: 'FORGE_HANDOFF', role: 'platform', reason: 'this needs infra decisions first' },
    ]);
  });

  it('parses FORGE_REQUEST_CHANGE: <target> <reason>', () => {
    const result = parseControlTokens(
      'FORGE_REQUEST_CHANGE: packages/core/src/index.ts add a new export',
    );
    expect(result.tokens).toEqual([
      {
        token: 'FORGE_REQUEST_CHANGE',
        target: 'packages/core/src/index.ts',
        reason: 'add a new export',
      },
    ]);
  });

  it('parses FORGE_CONFLICT: <reason> (05 §5.5 point 9)', () => {
    const result = parseControlTokens(
      'FORGE_CONFLICT: ADR-004 and ADR-009 disagree on the storage engine',
    );
    expect(result.tokens).toEqual([
      { token: 'FORGE_CONFLICT', reason: 'ADR-004 and ADR-009 disagree on the storage engine' },
    ]);
  });

  it('parses FORGE_LOAD_SKILL: <skillId> (15 §15.4.3)', () => {
    const result = parseControlTokens('FORGE_LOAD_SKILL: error-handling-conventions');
    expect(result.tokens).toEqual([
      { token: 'FORGE_LOAD_SKILL', skillId: 'error-handling-conventions' },
    ]);
  });

  it('captures a FORGE_-shaped but unregistered token in unknownLines, not thrown, not dropped', () => {
    const result = parseControlTokens('FORGE_DOES_NOT_EXIST: some payload');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_DOES_NOT_EXIST: some payload']);
  });

  it('does not parse a token name appearing mid-sentence as a real token', () => {
    const result = parseControlTokens("...so I'll FORGE_ASK: is this right?");
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual([]);
  });

  it('treats a registered name with a payload that does not fit its own grammar as unknown, not partially parsed', () => {
    // FORGE_ASSUME needs exactly four pipe-delimited fields; this line has only one.
    const result = parseControlTokens('FORGE_ASSUME: not enough fields');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_ASSUME: not enough fields']);
  });

  it('treats an invalid FORGE_ASSUME confidence value as unknown, not coerced to a nearest guess', () => {
    const result = parseControlTokens('FORGE_ASSUME: text | maybe | impact | validation');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_ASSUME: text | maybe | impact | validation']);
  });

  it('treats a FORGE_HANDOFF with no reason (role only) as unknown, not a token with an empty reason', () => {
    const result = parseControlTokens('FORGE_HANDOFF: platform');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_HANDOFF: platform']);
  });

  it('treats a FORGE_REQUEST_CHANGE with no reason (target only) as unknown', () => {
    const result = parseControlTokens('FORGE_REQUEST_CHANGE: packages/core/src/index.ts');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_REQUEST_CHANGE: packages/core/src/index.ts']);
  });

  it('treats an empty FORGE_REQUEST_CONTEXT query as unknown', () => {
    const result = parseControlTokens('FORGE_REQUEST_CONTEXT:');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_REQUEST_CONTEXT:']);
  });

  it('treats an empty FORGE_ASK question as unknown, even when options are present', () => {
    const result = parseControlTokens('FORGE_ASK: | Postgres, SQLite');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_ASK: | Postgres, SQLite']);
  });

  it('treats a FORGE_ASSUME with an empty text field (four fields present, first blank) as unknown', () => {
    const result = parseControlTokens('FORGE_ASSUME:  | high | impact | validation');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_ASSUME:  | high | impact | validation']);
  });

  it('treats a FORGE_ASSUME with an empty impact field as unknown', () => {
    const result = parseControlTokens('FORGE_ASSUME: text | high |  | validation');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_ASSUME: text | high |  | validation']);
  });

  it('treats a FORGE_ASSUME with an empty validateBy field as unknown', () => {
    const result = parseControlTokens('FORGE_ASSUME: text | high | impact |  ');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_ASSUME: text | high | impact |  ']);
  });

  it('treats an empty FORGE_CONFLICT reason as unknown', () => {
    const result = parseControlTokens('FORGE_CONFLICT:');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_CONFLICT:']);
  });

  it('treats an empty FORGE_LOAD_SKILL skillId as unknown', () => {
    const result = parseControlTokens('FORGE_LOAD_SKILL:');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual(['FORGE_LOAD_SKILL:']);
  });

  it('recognizes an indented token line (leading whitespace does not disqualify it)', () => {
    const result = parseControlTokens('  FORGE_CONFLICT: indented reason');
    expect(result.tokens).toEqual([{ token: 'FORGE_CONFLICT', reason: 'indented reason' }]);
  });

  it('handles multiple lines, mixing plain text, a real token, and an unknown token', () => {
    const text = [
      'Here is my analysis of the situation.',
      'FORGE_ASK: which database? | Postgres, SQLite',
      'FORGE_MYSTERY: whatever this is',
      'That concludes my reasoning.',
    ].join('\n');
    const result = parseControlTokens(text);
    expect(result.tokens).toEqual([
      { token: 'FORGE_ASK', question: 'which database?', options: ['Postgres', 'SQLite'] },
    ]);
    expect(result.unknownLines).toEqual(['FORGE_MYSTERY: whatever this is']);
  });

  it('handles Windows CRLF line endings without leaking a stray \\r into a parsed field', () => {
    const text = 'FORGE_CONFLICT: reason text\r\nnext line';
    const result = parseControlTokens(text);
    expect(result.tokens).toEqual([{ token: 'FORGE_CONFLICT', reason: 'reason text' }]);
  });

  it('handles old-Mac-style lone \\r line endings the same way', () => {
    const text = 'FORGE_CONFLICT: reason text\rnext line';
    const result = parseControlTokens(text);
    expect(result.tokens).toEqual([{ token: 'FORGE_CONFLICT', reason: 'reason text' }]);
  });

  it('returns empty tokens and unknownLines for text with no control tokens at all', () => {
    const result = parseControlTokens('Just an ordinary paragraph with no tokens in it.');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual([]);
  });

  it('returns empty results for an empty string', () => {
    const result = parseControlTokens('');
    expect(result.tokens).toEqual([]);
    expect(result.unknownLines).toEqual([]);
  });
});
