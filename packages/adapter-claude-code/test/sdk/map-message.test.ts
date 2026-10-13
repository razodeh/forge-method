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

  it('result error with no usage field at all (a crash/startup error) -> [error], retryable:false, no usage fields', () => {
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

  it("result error WITH usage/cost present (M16 P17's own real live run: the real SDKResultError carries usage/total_cost_usd exactly like SDKResultSuccess) -> [error], retryable:false, PLUS the real usage fields", () => {
    const message = {
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['exceeded the maximum number of turns'],
      total_cost_usd: 0.3766544,
      usage: { input_tokens: 40, output_tokens: 9874, cache_read_input_tokens: 0 },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      {
        type: 'error',
        code: 'error_max_turns',
        message: 'exceeded the maximum number of turns',
        retryable: false,
        inputTokens: 40,
        outputTokens: 9874,
        cacheReadTokens: 0,
        costUsd: 0.3766544,
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

  it('result success with is_error:true AND usage/cost present (M16 P17, round 2: SDKResultSuccess requires usage/total_cost_usd exactly like a clean success does) -> [error], retryable:false, PLUS the real usage fields', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'the API returned a 529 overloaded error mid-turn',
      total_cost_usd: 0.3766544,
      usage: { input_tokens: 40, output_tokens: 9874, cache_read_input_tokens: 0 },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      {
        type: 'error',
        code: 'api_error',
        message: 'the API returned a 529 overloaded error mid-turn',
        retryable: false,
        inputTokens: 40,
        outputTokens: 9874,
        cacheReadTokens: 0,
        costUsd: 0.3766544,
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

/**
 * M17 P11's own two new behaviours, mirroring `../cli/parse-event.test.ts`'s own identically-named
 * describe block exactly: a `result` message that yields several events, and real per-model
 * `modelUsage` cache-token summing (`07` §7.3's own "Honest cache-token accounting").
 *
 * @see specs/07 §7.3
 * @see PLAN-M17.md P11
 */
describe('mapSdkMessage — multi-event result mapping and real per-model cache-token summing (specs/22 M17 P11)', () => {
  it('a result message carrying both a usage signal and structured_output yields [usage, structured], in that order', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 },
      structured_output: { answer: 'ok' },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      { type: 'usage', inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, costUsd: 0.01 },
      { type: 'structured', data: { answer: 'ok' } },
    ]);
  });

  it('a result message carrying ONLY structured_output (no usage field at all) yields [structured] alone', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      structured_output: { answer: 'ok' },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([{ type: 'structured', data: { answer: 'ok' } }]);
  });

  it('real per-model modelUsage is summed into cacheReadTokens/cacheCreationTokens, overriding what the main-loop-only usage field alone would report', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.05,
      usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0 },
      modelUsage: {
        'claude-sonnet-5': {
          inputTokens: 500,
          outputTokens: 50,
          cacheReadInputTokens: 300,
          cacheCreationInputTokens: 40,
          costUSD: 0.05,
        },
      },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      {
        type: 'usage',
        inputTokens: 500,
        outputTokens: 50,
        cacheReadTokens: 300,
        cacheCreationTokens: 40,
        costUsd: 0.05,
      },
    ]);
  });

  it('modelUsage with several real model entries (main loop + a Task subagent) sums cache tokens across all of them', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.09,
      usage: { input_tokens: 900, output_tokens: 90, cache_read_input_tokens: 0 },
      modelUsage: {
        'claude-sonnet-5': {
          inputTokens: 700,
          outputTokens: 70,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 10,
          costUSD: 0.07,
        },
        'claude-haiku-4-5': {
          inputTokens: 200,
          outputTokens: 20,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 5,
          costUSD: 0.02,
        },
      },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      {
        type: 'usage',
        inputTokens: 900,
        outputTokens: 90,
        cacheReadTokens: 250,
        cacheCreationTokens: 15,
        costUsd: 0.09,
      },
    ]);
  });

  it('modelUsage absent entirely degrades to the pre-M17 main-loop-only cache_read_input_tokens/cache_creation_input_tokens fields', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 3,
      },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 7,
        cacheCreationTokens: 3,
        costUsd: 0.01,
      },
    ]);
  });

  it('an error result with real modelUsage also sums cache tokens onto the error event, mirroring the success path exactly', () => {
    const message = {
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['exceeded the maximum number of turns'],
      total_cost_usd: 0.3766544,
      usage: { input_tokens: 40, output_tokens: 9874, cache_read_input_tokens: 0 },
      modelUsage: {
        'claude-sonnet-5': {
          inputTokens: 40,
          outputTokens: 9874,
          cacheReadInputTokens: 12,
          cacheCreationInputTokens: 6,
          costUSD: 0.3766544,
        },
      },
    } as unknown as SDKMessage;
    expect(mapSdkMessage(message)).toEqual([
      {
        type: 'error',
        code: 'error_max_turns',
        message: 'exceeded the maximum number of turns',
        retryable: false,
        inputTokens: 40,
        outputTokens: 9874,
        cacheReadTokens: 12,
        cacheCreationTokens: 6,
        costUsd: 0.3766544,
      },
    ]);
  });
});
