/**
 * `parseCliEventLine` — one raw NDJSON line mapped to zero or one real `AdapterEvent`. Every fixture
 * below is the real field structure/names this milestone captured live (three real calls: two
 * non-bare/subscription, one bare/API-key), trimmed to minimal, representative content rather than
 * reproducing this specific development environment's own idiosyncratic tools/skills/plugins lists
 * verbatim (see `SPEC-QUESTIONS.md` Q114).
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q114
 * @see PLAN-M7.md P2
 */
import { describe, expect, it } from 'vitest';

import { parseCliEventLine } from '../../src/cli/parse-event.ts';

describe('parseCliEventLine', () => {
  it('empty and whitespace-only lines produce no event', () => {
    expect(parseCliEventLine('')).toBeUndefined();
    expect(parseCliEventLine('   ')).toBeUndefined();
  });

  it('a line that is not valid JSON at all produces no event, never throws', () => {
    expect(parseCliEventLine('not json at all')).toBeUndefined();
  });

  it('system/init -> session.started (real, live-captured field structure)', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      cwd: '/tmp/lane',
      session_id: 'b6a36085-6a6e-46a4-af47-96e3fb59ff19',
      tools: ['Bash', 'Edit', 'Read'],
      mcp_servers: [],
      model: 'claude-haiku-4-5-20251001',
      capabilities: ['interrupt_receipt_v1'],
    });
    const event = parseCliEventLine(line);
    expect(event?.type).toBe('session.started');
    if (event?.type !== 'session.started') return;
    expect(event.sessionId).toBe('b6a36085-6a6e-46a4-af47-96e3fb59ff19');
    expect(event.model).toBe('claude-haiku-4-5-20251001');
    expect(event.tools).toEqual(['Bash', 'Edit', 'Read']);
    expect(event.meta['cwd']).toBe('/tmp/lane');
    expect(event.meta['mcp_servers']).toEqual([]);
  });

  it('assistant text content block -> text (partial: false)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello there, friend.' }] },
      session_id: 's-1',
    });
    expect(parseCliEventLine(line)).toEqual({
      type: 'text',
      text: 'Hello there, friend.',
      partial: false,
    });
  });

  it('assistant thinking content block -> thinking', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'considering the request' }] },
      session_id: 's-1',
    });
    expect(parseCliEventLine(line)).toEqual({ type: 'thinking', text: 'considering the request' });
  });

  it('assistant tool_use content block -> tool.call (real, live-captured Bash example)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01XLx6rsptVFL3NpQCnHFULo',
            name: 'Bash',
            input: { command: 'printf OK > marker.txt' },
          },
        ],
      },
      session_id: 's-1',
    });
    expect(parseCliEventLine(line)).toEqual({
      type: 'tool.call',
      id: 'toolu_01XLx6rsptVFL3NpQCnHFULo',
      name: 'Bash',
      input: { command: 'printf OK > marker.txt' },
    });
  });

  it('an unrecognized assistant content-block kind (e.g. redacted_thinking) produces no event, not a fabricated guess', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'redacted_thinking', data: 'opaque' }] },
      session_id: 's-1',
    });
    expect(parseCliEventLine(line)).toBeUndefined();
  });

  it('user tool_result -> tool.result (real, live-captured shape)', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01XLx6rsptVFL3NpQCnHFULo',
            content: 'OK',
            is_error: false,
          },
        ],
      },
    });
    expect(parseCliEventLine(line)).toEqual({
      type: 'tool.result',
      id: 'toolu_01XLx6rsptVFL3NpQCnHFULo',
      ok: true,
      summary: 'OK',
    });
  });

  it('user tool_result with is_error:true -> tool.result ok:false', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'command failed',
            is_error: true,
          },
        ],
      },
    });
    expect(parseCliEventLine(line)).toEqual({
      type: 'tool.result',
      id: 'toolu_1',
      ok: false,
      summary: 'command failed',
    });
  });

  it('a structured (non-string) tool_result content is stringified into summary', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: [{ type: 'text', text: 'x' }],
            is_error: false,
          },
        ],
      },
    });
    const event = parseCliEventLine(line);
    expect(event?.type).toBe('tool.result');
    if (event?.type === 'tool.result')
      expect(event.summary).toBe(JSON.stringify([{ type: 'text', text: 'x' }]));
  });

  it('result success -> usage (real, live-captured field names: total_cost_usd, usage.input_tokens/output_tokens/cache_read_input_tokens)', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.0026899999999999997,
      usage: { input_tokens: 1785, output_tokens: 181, cache_read_input_tokens: 0 },
    });
    expect(parseCliEventLine(line)).toEqual({
      type: 'usage',
      inputTokens: 1785,
      outputTokens: 181,
      cacheReadTokens: 0,
      costUsd: 0.0026899999999999997,
    });
  });

  it('result success with no usage field at all produces no event (nothing safe to report)', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
    });
    expect(parseCliEventLine(line)).toBeUndefined();
  });

  it('result error (grounded in the real SDK SDKResultError field names, never observed live) -> error, retryable:false', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['exceeded the maximum number of turns'],
    });
    expect(parseCliEventLine(line)).toEqual({
      type: 'error',
      code: 'error_max_turns',
      message: 'exceeded the maximum number of turns',
      retryable: false,
    });
  });

  it('result success with is_error:true (a real, distinct SDKResultSuccess error shape, not SDKResultError) -> error, read from result, not errors', () => {
    // A fresh critic round found the original draft dispatched purely on `is_error === true`,
    // routing this real case into the `errors`-array-shaped `mapResultError` instead -- confirmed
    // directly against the real SDK's own `SDKResultSuccess` type, which carries `is_error` AND
    // `result: string` together with no `errors` field at all.
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'the API returned a 529 overloaded error mid-turn',
    });
    expect(parseCliEventLine(line)).toEqual({
      type: 'error',
      code: 'api_error',
      message: 'the API returned a 529 overloaded error mid-turn',
      retryable: false,
    });
  });

  it('system/api_retry (grounded in the real SDK SDKAPIRetryMessage field names, never observed live) -> retry', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      attempt: 2,
      max_retries: 5,
      retry_delay_ms: 1000,
      error_status: 529,
    });
    expect(parseCliEventLine(line)).toEqual({
      type: 'retry',
      attempt: 2,
      maxRetries: 5,
      reason: 'api error 529',
      delayMs: 1000,
    });
  });

  it('stream_event content_block_delta text_delta -> text (partial: true) -- the real incremental mechanism, confirmed live on the third capture', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'Hello world' },
      },
      session_id: 's-1',
    });
    expect(parseCliEventLine(line)).toEqual({ type: 'text', text: 'Hello world', partial: true });
  });

  it('stream_event thinking_delta/signature_delta produce no event (no partial-thinking AdapterEvent variant exists)', () => {
    const thinkingDelta = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'x' },
      },
    });
    const signatureDelta = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'x' },
      },
    });
    expect(parseCliEventLine(thinkingDelta)).toBeUndefined();
    expect(parseCliEventLine(signatureDelta)).toBeUndefined();
  });

  it('stream_event message_start/message_stop/content_block_start/content_block_stop produce no event (not content deltas)', () => {
    for (const eventType of [
      'message_start',
      'message_stop',
      'content_block_start',
      'content_block_stop',
    ]) {
      const line = JSON.stringify({ type: 'stream_event', event: { type: eventType } });
      expect(parseCliEventLine(line)).toBeUndefined();
    }
  });

  it('rate_limit_event (a real, live-captured message type with no AdapterEvent variant) produces no event', () => {
    const line = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' },
    });
    expect(parseCliEventLine(line)).toBeUndefined();
  });

  it('system/status and system/thinking_tokens (real, live-captured message types with no AdapterEvent variant) produce no event', () => {
    expect(
      parseCliEventLine(
        JSON.stringify({ type: 'system', subtype: 'status', status: 'requesting' }),
      ),
    ).toBeUndefined();
    expect(
      parseCliEventLine(
        JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50 }),
      ),
    ).toBeUndefined();
  });

  it('an unknown top-level type produces no event', () => {
    expect(
      parseCliEventLine(JSON.stringify({ type: 'something_forge_has_never_seen' })),
    ).toBeUndefined();
  });
});
