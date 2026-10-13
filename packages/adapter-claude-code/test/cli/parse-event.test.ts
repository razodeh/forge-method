/**
 * `parseCliEventLine` — one raw NDJSON line mapped to zero, one, or (a `result` line carrying both a
 * usage/error signal and a `structured_output` payload) several real `AdapterEvent`s. Every fixture
 * below is the real field structure/names this milestone captured live (three real calls: two
 * non-bare/subscription, one bare/API-key), trimmed to minimal, representative content rather than
 * reproducing this specific development environment's own idiosyncratic tools/skills/plugins lists
 * verbatim (see `SPEC-QUESTIONS.md` Q114).
 *
 * M17 P11 changed `parseCliEventLine`'s own return type from `AdapterEvent | undefined` to
 * `readonly AdapterEvent[]` — every existing test below was updated to match (`.toBeUndefined()` ->
 * `.toEqual([])`, a single-object `.toEqual({...})` -> `.toEqual([{...}])`), with no change to what
 * each one actually proves; the new `describe` block at the end of this file covers the new behaviour
 * itself (multi-event `result` mapping, real per-model cache-token summing).
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q114
 * @see PLAN-M7.md P2
 * @see PLAN-M17.md P11
 */
import { describe, expect, it } from 'vitest';

import { parseCliEventLine } from '../../src/cli/parse-event.ts';

describe('parseCliEventLine', () => {
  it('empty and whitespace-only lines produce no event', () => {
    expect(parseCliEventLine('')).toEqual([]);
    expect(parseCliEventLine('   ')).toEqual([]);
  });

  it('a line that is not valid JSON at all produces no event, never throws', () => {
    expect(parseCliEventLine('not json at all')).toEqual([]);
  });

  it('system/init -> [session.started] (real, live-captured field structure)', () => {
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
    const events = parseCliEventLine(line);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe('session.started');
    if (event?.type !== 'session.started') return;
    expect(event.sessionId).toBe('b6a36085-6a6e-46a4-af47-96e3fb59ff19');
    expect(event.model).toBe('claude-haiku-4-5-20251001');
    expect(event.tools).toEqual(['Bash', 'Edit', 'Read']);
    expect(event.meta['cwd']).toBe('/tmp/lane');
    expect(event.meta['mcp_servers']).toEqual([]);
  });

  it('assistant text content block -> [text] (partial: false)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello there, friend.' }] },
      session_id: 's-1',
    });
    expect(parseCliEventLine(line)).toEqual([
      { type: 'text', text: 'Hello there, friend.', partial: false },
    ]);
  });

  it('assistant thinking content block -> [thinking]', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'considering the request' }] },
      session_id: 's-1',
    });
    expect(parseCliEventLine(line)).toEqual([
      { type: 'thinking', text: 'considering the request' },
    ]);
  });

  it('assistant tool_use content block -> [tool.call] (real, live-captured Bash example)', () => {
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
    expect(parseCliEventLine(line)).toEqual([
      {
        type: 'tool.call',
        id: 'toolu_01XLx6rsptVFL3NpQCnHFULo',
        name: 'Bash',
        input: { command: 'printf OK > marker.txt' },
      },
    ]);
  });

  it('an unrecognized assistant content-block kind (e.g. redacted_thinking) produces no event, not a fabricated guess', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'redacted_thinking', data: 'opaque' }] },
      session_id: 's-1',
    });
    expect(parseCliEventLine(line)).toEqual([]);
  });

  it('user tool_result -> [tool.result] (real, live-captured shape)', () => {
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
    expect(parseCliEventLine(line)).toEqual([
      {
        type: 'tool.result',
        id: 'toolu_01XLx6rsptVFL3NpQCnHFULo',
        ok: true,
        summary: 'OK',
      },
    ]);
  });

  it('user tool_result with is_error:true -> [tool.result] ok:false', () => {
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
    expect(parseCliEventLine(line)).toEqual([
      {
        type: 'tool.result',
        id: 'toolu_1',
        ok: false,
        summary: 'command failed',
      },
    ]);
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
    const events = parseCliEventLine(line);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.type).toBe('tool.result');
    if (event?.type === 'tool.result')
      expect(event.summary).toBe(JSON.stringify([{ type: 'text', text: 'x' }]));
  });

  it('result success -> [usage] (real, live-captured field names: total_cost_usd, usage.input_tokens/output_tokens/cache_read_input_tokens)', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.0026899999999999997,
      usage: { input_tokens: 1785, output_tokens: 181, cache_read_input_tokens: 0 },
    });
    expect(parseCliEventLine(line)).toEqual([
      {
        type: 'usage',
        inputTokens: 1785,
        outputTokens: 181,
        cacheReadTokens: 0,
        costUsd: 0.0026899999999999997,
      },
    ]);
  });

  it('result success with no usage field at all produces no event (nothing safe to report)', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
    });
    expect(parseCliEventLine(line)).toEqual([]);
  });

  it('result error with no usage field at all (a crash/startup error, per the real SDKResultError doc comment\'s own "may carry zeroed values") -> [error], retryable:false, no usage fields', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['exceeded the maximum number of turns'],
    });
    expect(parseCliEventLine(line)).toEqual([
      {
        type: 'error',
        code: 'error_max_turns',
        message: 'exceeded the maximum number of turns',
        retryable: false,
      },
    ]);
  });

  it("result error WITH usage/cost present (M16 P17's own real live run: the real SDKResultError carries usage/total_cost_usd exactly like SDKResultSuccess, confirmed directly against the installed SDK's own .d.ts) -> [error], retryable:false, PLUS the real usage fields", () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['exceeded the maximum number of turns'],
      total_cost_usd: 0.3766544,
      usage: { input_tokens: 40, output_tokens: 9874, cache_read_input_tokens: 0 },
    });
    expect(parseCliEventLine(line)).toEqual([
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
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'the API returned a 529 overloaded error mid-turn',
    });
    expect(parseCliEventLine(line)).toEqual([
      {
        type: 'error',
        code: 'api_error',
        message: 'the API returned a 529 overloaded error mid-turn',
        retryable: false,
      },
    ]);
  });

  it('result success with is_error:true AND usage/cost present (M16 P17, round 2: SDKResultSuccess requires usage/total_cost_usd exactly like a clean success does, so a mid-turn API error after real spend must report it too, not only error_max_turns and its SDKResultError siblings) -> [error], retryable:false, PLUS the real usage fields', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'the API returned a 529 overloaded error mid-turn',
      total_cost_usd: 0.3766544,
      usage: { input_tokens: 40, output_tokens: 9874, cache_read_input_tokens: 0 },
    });
    expect(parseCliEventLine(line)).toEqual([
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

  it('system/api_retry (grounded in the real SDK SDKAPIRetryMessage field names, never observed live) -> [retry]', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      attempt: 2,
      max_retries: 5,
      retry_delay_ms: 1000,
      error_status: 529,
    });
    expect(parseCliEventLine(line)).toEqual([
      { type: 'retry', attempt: 2, maxRetries: 5, reason: 'api error 529', delayMs: 1000 },
    ]);
  });

  it('stream_event content_block_delta text_delta -> [text] (partial: true) -- the real incremental mechanism, confirmed live on the third capture', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'Hello world' },
      },
      session_id: 's-1',
    });
    expect(parseCliEventLine(line)).toEqual([{ type: 'text', text: 'Hello world', partial: true }]);
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
    expect(parseCliEventLine(thinkingDelta)).toEqual([]);
    expect(parseCliEventLine(signatureDelta)).toEqual([]);
  });

  it('stream_event message_start/message_stop/content_block_start/content_block_stop produce no event (not content deltas)', () => {
    for (const eventType of [
      'message_start',
      'message_stop',
      'content_block_start',
      'content_block_stop',
    ]) {
      const line = JSON.stringify({ type: 'stream_event', event: { type: eventType } });
      expect(parseCliEventLine(line)).toEqual([]);
    }
  });

  it('rate_limit_event (a real, live-captured message type with no AdapterEvent variant) produces no event', () => {
    const line = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' },
    });
    expect(parseCliEventLine(line)).toEqual([]);
  });

  it('system/status and system/thinking_tokens (real, live-captured message types with no AdapterEvent variant) produce no event', () => {
    expect(
      parseCliEventLine(
        JSON.stringify({ type: 'system', subtype: 'status', status: 'requesting' }),
      ),
    ).toEqual([]);
    expect(
      parseCliEventLine(
        JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50 }),
      ),
    ).toEqual([]);
  });

  it('an unknown top-level type produces no event', () => {
    expect(parseCliEventLine(JSON.stringify({ type: 'something_forge_has_never_seen' }))).toEqual(
      [],
    );
  });
});

/**
 * M17 P11's own two new behaviours: a `result` line that yields several events, and real per-model
 * `modelUsage` cache-token summing (`07` §7.3's own "Honest cache-token accounting"). Field names for
 * both are grounded in the real, published SDK's own `.d.ts` (`SDKResultSuccess.modelUsage: Record
 * <string, ModelUsage>`, `.structured_output?: unknown`), not live-observed -- see this file's own
 * top-of-file doc comment for why.
 *
 * @see specs/07 §7.3
 * @see PLAN-M17.md P11
 */
describe('parseCliEventLine — multi-event result mapping and real per-model cache-token summing (specs/22 M17 P11)', () => {
  it('a result line carrying both a usage signal and structured_output yields [usage, structured], in that order, never only the first one a mapper happens to construct', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 },
      structured_output: { answer: 'ok' },
    });
    expect(parseCliEventLine(line)).toEqual([
      { type: 'usage', inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, costUsd: 0.01 },
      { type: 'structured', data: { answer: 'ok' } },
    ]);
  });

  it('a result line carrying ONLY structured_output (no usage field at all) yields [structured] alone, not a fabricated usage event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      structured_output: { answer: 'ok' },
    });
    expect(parseCliEventLine(line)).toEqual([{ type: 'structured', data: { answer: 'ok' } }]);
  });

  it('a result line whose structured_output is explicitly null still yields a structured event -- "the key was present" is the trigger, not truthiness', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      structured_output: null,
    });
    expect(parseCliEventLine(line)).toEqual([{ type: 'structured', data: null }]);
  });

  it('an error_max_turns result that ALSO carries structured_output (a partial structured answer before the turn limit hit) yields [error, structured], not structured alone', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['exceeded the maximum number of turns'],
      structured_output: { partial: true },
    });
    expect(parseCliEventLine(line)).toEqual([
      {
        type: 'error',
        code: 'error_max_turns',
        message: 'exceeded the maximum number of turns',
        retryable: false,
      },
      { type: 'structured', data: { partial: true } },
    ]);
  });

  it('real per-model modelUsage is summed into cacheReadTokens/cacheCreationTokens, overriding what the main-loop-only usage field alone would report', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.05,
      // The main-loop-only field under-reports on purpose here (cache_read_input_tokens: 0) --
      // proving the real per-model sum is what actually reaches the event, not a coincidental
      // pass-through of a field that happens to already hold the right number.
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
    });
    expect(parseCliEventLine(line)).toEqual([
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
    const line = JSON.stringify({
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
    });
    const events = parseCliEventLine(line);
    expect(events).toEqual([
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

  it('modelUsage absent entirely degrades to the pre-M17 main-loop-only cache_read_input_tokens/cache_creation_input_tokens fields, never silently omitting what the adapter did report', () => {
    const line = JSON.stringify({
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
    });
    expect(parseCliEventLine(line)).toEqual([
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

  it('modelUsage present but empty, or with no entry carrying a real number for a field, also degrades to the main-loop-only fallback rather than reporting 0', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 },
      modelUsage: {},
    });
    expect(parseCliEventLine(line)).toEqual([
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        costUsd: 0.01,
      },
    ]);
  });

  it('an error result with real modelUsage also sums cache tokens onto the error event, mirroring the success path exactly', () => {
    const line = JSON.stringify({
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
    });
    expect(parseCliEventLine(line)).toEqual([
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

  it("a realistic forge adopt inference structured_output (a claims array, INFERENCE_CLAIM_SCHEMA's own shape) round-trips byte-for-byte into the structured event's data field -- the exact payload @forge/engine/adopt's claimsFromSession reads", () => {
    const claimsPayload = {
      claims: [
        {
          kind: 'convention',
          statement: 'Every exported error is a ForgeError.',
          confidence: 'medium',
          evidence: [{ kind: 'path', path: 'packages/core/src/errors/base.ts', line: 12 }],
        },
      ],
    };
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.02,
      structured_output: claimsPayload,
    });
    expect(parseCliEventLine(line)).toEqual([{ type: 'structured', data: claimsPayload }]);
  });
});
