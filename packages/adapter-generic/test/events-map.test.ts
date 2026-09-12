/**
 * `events-map.ts` proven directly: `parseNdjsonLine`'s robustness against malformed output (`07` §7.6's
 * own malformed-output failure-injection need), and `mapLineToCandidate`'s first-match-wins rule against
 * `07` §7.5's own worked-example `events.map` entries.
 *
 * @see specs/07 §7.5
 * @see specs/07 §7.6
 * @see PLAN-M11.md P7
 */
import { describe, expect, it } from 'vitest';

import { mapLineToCandidate, parseNdjsonLine } from '../src/events-map.ts';

describe('parseNdjsonLine', () => {
  it('parses a well-formed NDJSON object line', () => {
    expect(parseNdjsonLine('{"type":"done"}')).toEqual({ type: 'done' });
  });

  it('never throws on malformed input -- returns undefined instead', () => {
    expect(parseNdjsonLine('this line is not valid ndjson on purpose')).toBeUndefined();
    expect(parseNdjsonLine('{"unterminated')).toBeUndefined();
    expect(parseNdjsonLine('')).toBeUndefined();
    expect(parseNdjsonLine('   ')).toBeUndefined();
  });

  it('treats a non-object JSON value (array, string, number, null) as unmapped', () => {
    expect(parseNdjsonLine('[1,2,3]')).toBeUndefined();
    expect(parseNdjsonLine('"just a string"')).toBeUndefined();
    expect(parseNdjsonLine('42')).toBeUndefined();
    expect(parseNdjsonLine('null')).toBeUndefined();
  });
});

const WORKED_EXAMPLE_MAP = {
  map: [
    { match: { type: 'message', role: 'assistant' }, emit: { type: 'text', text: '{{.content}}' } },
    {
      match: { type: 'tool_call' },
      emit: { type: 'tool.call', name: '{{.tool}}', input: '{{.args}}' },
    },
    { match: { type: 'done' }, emit: { type: 'session.ended', reason: 'complete' } },
  ],
};

describe("mapLineToCandidate: 07 §7.5's own worked-example map, first-match-wins", () => {
  it('maps a message/assistant line to a text candidate', () => {
    const candidate = mapLineToCandidate(WORKED_EXAMPLE_MAP, {
      type: 'message',
      role: 'assistant',
      content: 'hi there',
    });
    expect(candidate).toEqual({ type: 'text', text: 'hi there' });
  });

  it('does not match a message from a non-assistant role', () => {
    expect(
      mapLineToCandidate(WORKED_EXAMPLE_MAP, { type: 'message', role: 'user', content: 'ignored' }),
    ).toBeUndefined();
  });

  it('maps a tool_call line to a tool.call candidate', () => {
    const candidate = mapLineToCandidate(WORKED_EXAMPLE_MAP, {
      type: 'tool_call',
      tool: 'write_file',
      args: { path: 'a.txt' },
    });
    expect(candidate).toEqual({ type: 'tool.call', name: 'write_file', input: { path: 'a.txt' } });
  });

  it('maps a done line to a session.ended candidate', () => {
    expect(mapLineToCandidate(WORKED_EXAMPLE_MAP, { type: 'done' })).toEqual({
      type: 'session.ended',
      reason: 'complete',
    });
  });

  it('returns undefined for a line no entry matches -- an honest, silent skip', () => {
    expect(
      mapLineToCandidate(WORKED_EXAMPLE_MAP, { type: 'usage', inputTokens: 1 }),
    ).toBeUndefined();
  });

  it('first match wins when two entries could both apply', () => {
    const config = {
      map: [
        { match: { type: 'x' }, emit: { type: 'text', text: 'first' } },
        { match: { type: 'x' }, emit: { type: 'text', text: 'second' } },
      ],
    };
    expect(mapLineToCandidate(config, { type: 'x' })).toEqual({ type: 'text', text: 'first' });
  });
});
