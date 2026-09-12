/**
 * `matchScriptedEntry` proven directly, with no process spawned — `scripted-binary.test.ts` proves the
 * real subprocess wiring around it; this file proves the matching logic itself is correct in
 * isolation, the same split `@forge/testkit`'s own `matcher.ts`/`fake-adapter.ts` pair establishes.
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P8
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESPONSE,
  matchScriptedEntry,
  type ScriptedBinaryTable,
  type ScriptedInvocationContext,
} from './scripted-binary-protocol.ts';

function ctx(overrides: Partial<ScriptedInvocationContext> = {}): ScriptedInvocationContext {
  return { argv: [], prompt: '', model: undefined, cwd: undefined, ...overrides };
}

describe('matchScriptedEntry', () => {
  it('matches an entry whose promptContains is a substring of the real prompt', () => {
    const table: ScriptedBinaryTable = {
      entries: [{ match: { promptContains: 'hello' }, response: { text: ['hi'] } }],
    };
    expect(matchScriptedEntry(table, ctx({ prompt: 'please say hello now' }))).toEqual({
      text: ['hi'],
    });
  });

  it('does not match when the prompt lacks the required substring', () => {
    const table: ScriptedBinaryTable = {
      entries: [{ match: { promptContains: 'hello' }, response: { text: ['hi'] } }],
    };
    expect(matchScriptedEntry(table, ctx({ prompt: 'goodbye' }))).toBe(DEFAULT_RESPONSE);
  });

  it('requires every specified matcher field to agree (AND semantics), not just one', () => {
    const table: ScriptedBinaryTable = {
      entries: [
        {
          match: { promptContains: 'hello', modelEquals: 'model-a' },
          response: { text: ['matched'] },
        },
      ],
    };
    // Prompt matches, model does not -- the whole entry must be refused, not partially honoured.
    expect(matchScriptedEntry(table, ctx({ prompt: 'hello', model: 'model-b' }))).toBe(
      DEFAULT_RESPONSE,
    );
    expect(matchScriptedEntry(table, ctx({ prompt: 'hello', model: 'model-a' }))).toEqual({
      text: ['matched'],
    });
  });

  it('matches cwdEquals against the real invocation cwd (07 §7.6 C12: distinct cwds)', () => {
    const table: ScriptedBinaryTable = {
      entries: [
        { match: { cwdEquals: '/lane-a' }, response: { text: ['lane a'] } },
        { match: { cwdEquals: '/lane-b' }, response: { text: ['lane b'] } },
      ],
    };
    expect(matchScriptedEntry(table, ctx({ cwd: '/lane-a' }))).toEqual({ text: ['lane a'] });
    expect(matchScriptedEntry(table, ctx({ cwd: '/lane-b' }))).toEqual({ text: ['lane b'] });
    expect(matchScriptedEntry(table, ctx({ cwd: '/lane-c' }))).toBe(DEFAULT_RESPONSE);
  });

  it('matches argvContains against a real invocation flag', () => {
    const table: ScriptedBinaryTable = {
      entries: [{ match: { argvContains: '--read-only' }, response: { text: ['read only'] } }],
    };
    expect(matchScriptedEntry(table, ctx({ argv: ['--cwd', '/tmp', '--read-only'] }))).toEqual({
      text: ['read only'],
    });
    expect(matchScriptedEntry(table, ctx({ argv: ['--cwd', '/tmp'] }))).toBe(DEFAULT_RESPONSE);
  });

  it('picks the first matching entry, not the last, when more than one would match', () => {
    const table: ScriptedBinaryTable = {
      entries: [
        { match: { promptContains: 'hi' }, response: { text: ['first'] } },
        { match: { promptContains: 'hi' }, response: { text: ['second'] } },
      ],
    };
    expect(matchScriptedEntry(table, ctx({ prompt: 'hi there' }))).toEqual({ text: ['first'] });
  });

  it('falls back to table.defaultResponse, not the built-in DEFAULT_RESPONSE, when one is supplied', () => {
    const table: ScriptedBinaryTable = {
      entries: [{ match: { promptContains: 'never-matches-anything' }, response: { text: ['x'] } }],
      defaultResponse: { text: ['table default'] },
    };
    expect(matchScriptedEntry(table, ctx({ prompt: 'anything' }))).toEqual({
      text: ['table default'],
    });
  });

  it('falls back to the built-in DEFAULT_RESPONSE when the table has no entries and no defaultResponse', () => {
    const table: ScriptedBinaryTable = { entries: [] };
    expect(matchScriptedEntry(table, ctx())).toBe(DEFAULT_RESPONSE);
  });

  it('treats an empty match object as a catch-all, matching every invocation', () => {
    const table: ScriptedBinaryTable = {
      entries: [
        { match: { promptContains: 'specific' }, response: { text: ['specific'] } },
        { match: {}, response: { text: ['catch-all'] } },
      ],
    };
    expect(matchScriptedEntry(table, ctx({ prompt: 'specific case' }))).toEqual({
      text: ['specific'],
    });
    expect(matchScriptedEntry(table, ctx({ prompt: 'anything else' }))).toEqual({
      text: ['catch-all'],
    });
  });
});
