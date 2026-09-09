/**
 * `mapSdkMessage` — one real `SDKMessage` union member mapped to zero or more real `AdapterEvent`s.
 * Deliberately mirrors `../cli/parse-event.test.ts`'s own fixture-per-shape discipline (P2): the same
 * real field structure/names, this time as real, typed `SDKMessage` objects rather than raw JSON
 * text (no `JSON.stringify`/`JSON.parse` round-trip needed -- the SDK hands the caller already-parsed
 * objects).
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q115
 * @see PLAN-M7.md P3
 */
import { describe, expect, it } from 'vitest';

import { mapSdkMessage } from '../../src/sdk/map-message.ts';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

describe('mapSdkMessage', () => {
  it('system/init -> [session.started]', () => {
    const message = {
      type: 'system',
      subtype: 'init',
      session_id: 'b6a36085-6a6e-46a4-af47-96e3fb59ff19',
      model: 'claude-haiku-4-5-20251001',
      tools: ['Bash', 'Edit', 'Read'],
      cwd: '/tmp/lane',
      mcp_servers: [],
    } as unknown as SDKMessage;
    const events = mapSdkMessage(message);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe('session.started');
    if (event?.type !== 'session.started') return;
    expect(event.sessionId).toBe('b6a36085-6a6e-46a4-af47-96e3fb59ff19');
    expect(event.model).toBe('claude-haiku-4-5-20251001');
    expect(event.tools).toEqual(['Bash', 'Edit', 'Read']);
  });

  it('a system message with a different subtype (e.g. task_notification) produces no event', () => {
    const message = { type: 'system', subtype: 'task_notification' } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([]);
  });

  it('assistant text content block -> [text] (partial: false)', () => {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello there, friend.' }] },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      { type: 'text', text: 'Hello there, friend.', partial: false },
    ]);
  });

  it('assistant tool_use content block -> [tool.call]', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } }],
      },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      { type: 'tool.call', id: 'toolu_1', name: 'Bash', input: { command: 'echo hi' } },
    ]);
  });

  it('user tool_result -> [tool.result]', () => {
    const message = {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'OK', is_error: false }],
      },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      { type: 'tool.result', id: 'toolu_1', ok: true, summary: 'OK' },
    ]);
  });

  it('result success -> [usage] (real field names confirmed against the real SDK SDKResultSuccess type)', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.0027,
      usage: { input_tokens: 1785, output_tokens: 181, cache_read_input_tokens: 0 },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      { type: 'usage', inputTokens: 1785, outputTokens: 181, cacheReadTokens: 0, costUsd: 0.0027 },
    ]);
  });

  it('result error (real field names confirmed against the real SDK SDKResultError type) -> [error], retryable:false', () => {
    const message = {
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['exceeded the maximum number of turns'],
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      {
        type: 'error',
        code: 'error_max_turns',
        message: 'exceeded the maximum number of turns',
        retryable: false,
      },
    ]);
  });

  it('result success with is_error:true (a real, distinct SDKResultSuccess error shape, not SDKResultError) -> [error], read from result, not errors', () => {
    // A fresh critic round found the original draft dispatched purely on `is_error === true`,
    // routing this real case into the `errors`-array-shaped `mapResultError` instead -- confirmed
    // directly against the real SDK's own `SDKResultSuccess` type, which carries `is_error` AND
    // `result: string` together with no `errors` field at all.
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'the API returned a 529 overloaded error mid-turn',
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      {
        type: 'error',
        code: 'api_error',
        message: 'the API returned a 529 overloaded error mid-turn',
        retryable: false,
      },
    ]);
  });

  it('system/api_retry (real field names confirmed against the real SDK SDKAPIRetryMessage type) -> [retry]', () => {
    const message = {
      type: 'system',
      subtype: 'api_retry',
      attempt: 2,
      max_retries: 5,
      retry_delay_ms: 1000,
      error_status: 529,
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      { type: 'retry', attempt: 2, maxRetries: 5, reason: 'api error 529', delayMs: 1000 },
    ]);
  });

  it("stream_event content_block_delta text_delta -> [text] (partial: true) -- SDKPartialAssistantMessage, structurally identical to the CLI transport's own raw stream_event line", () => {
    const message = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([{ type: 'text', text: 'Hello', partial: true }]);
  });

  it('rate_limit_event (a real SDKMessage variant with no AdapterEvent variant) produces no event', () => {
    const message = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed' },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([]);
  });
});
