/**
 * `mapSdkMessage` — one real `SDKMessage` union member mapped to zero or more real `AdapterEvent`s.
 * Deliberately mirrors `../cli/parse-event.ts`'s own per-message-kind mapping logic (P2) one-for-one:
 * the CLI's raw NDJSON and the SDK's own typed `SDKMessage` objects are two encodings of the exact
 * same underlying producer (confirmed directly: `SDKAssistantMessage`'s own doc comment describes CLI
 * streaming behaviour, not just the SDK's), so a bug fix to one mapping's own logic should be mirrored
 * to the other, not drift independently.
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q115
 * @see PLAN-M7.md P3
 */
import { normalizeAdapterEvent } from '@forge/adapter-kit/events';
import type { AdapterEvent } from '@forge/adapter-kit';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Mirrors `parse-event.ts`'s own `mapAssistantContentBlock` exactly -- see that function's own doc
 * comment for why only the first content block is ever read (confirmed live, P2: a streamed session's
 * own assistant message always carries exactly one block). */
function mapAssistantContentBlock(block: unknown): AdapterEvent | undefined {
  if (!isRecord(block)) return undefined;
  const blockType = block['type'];
  if (blockType === 'text') {
    const text = textOf(block['text']);
    if (text === undefined) return undefined;
    return { type: 'text', text, partial: false };
  }
  if (blockType === 'thinking') {
    const text = textOf(block['thinking']);
    if (text === undefined) return undefined;
    return { type: 'thinking', text };
  }
  if (blockType === 'tool_use') {
    const id = textOf(block['id']);
    const name = textOf(block['name']);
    if (id === undefined || name === undefined) return undefined;
    return { type: 'tool.call', id, name, input: block['input'] };
  }
  return undefined;
}

function mapAssistant(message: unknown): AdapterEvent | undefined {
  if (!isRecord(message)) return undefined;
  const inner = message['message'];
  if (!isRecord(inner)) return undefined;
  const content = inner['content'];
  if (!isArray(content) || content.length === 0) return undefined;
  return mapAssistantContentBlock(content[0]);
}

function mapUserToolResult(message: unknown): AdapterEvent | undefined {
  if (!isRecord(message)) return undefined;
  const inner = message['message'];
  if (!isRecord(inner)) return undefined;
  const content = inner['content'];
  if (!isArray(content) || content.length === 0) return undefined;
  const block = content[0];
  if (!isRecord(block) || block['type'] !== 'tool_result') return undefined;
  const id = textOf(block['tool_use_id']);
  if (id === undefined) return undefined;
  const rawSummary = block['content'];
  const summary = typeof rawSummary === 'string' ? rawSummary : JSON.stringify(rawSummary);
  const isError = block['is_error'];
  return { type: 'tool.result', id, ok: isError !== true, summary };
}

function mapSystemInit(
  message: SDKMessage & { readonly type: 'system' },
): AdapterEvent | undefined {
  if (message.subtype !== 'init') return undefined;
  return {
    type: 'session.started',
    sessionId: message.session_id,
    model: message.model,
    tools: message.tools,
    meta: message,
  };
}

/** Field names confirmed against the real, published SDK's own `SDKAPIRetryMessage` type declaration. */
function mapApiRetry(message: SDKMessage & { readonly type: 'system' }): AdapterEvent | undefined {
  if (message.subtype !== 'api_retry') return undefined;
  const errorStatus: unknown = message.error_status;
  const reason = typeof errorStatus === 'number' ? `api error ${String(errorStatus)}` : 'api retry';
  return {
    type: 'retry',
    attempt: message.attempt,
    maxRetries: message.max_retries,
    reason,
    delayMs: message.retry_delay_ms,
  };
}

/** Field names confirmed against the real, published SDK's own `SDKResultSuccess` type declaration
 * (`total_cost_usd`, `usage.input_tokens`/`.output_tokens`/`.cache_read_input_tokens`) -- the identical
 * fields the CLI transport's own live captures confirmed for the same underlying `result` message. */
function mapResultSuccess(message: unknown): AdapterEvent | undefined {
  if (!isRecord(message)) return undefined;
  const usage = message['usage'];
  if (!isRecord(usage)) return undefined;
  const inputTokens = numberOf(usage['input_tokens']);
  const outputTokens = numberOf(usage['output_tokens']);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const cacheReadTokens = numberOf(usage['cache_read_input_tokens']);
  const costUsd = numberOf(message['total_cost_usd']);
  return {
    type: 'usage',
    inputTokens,
    outputTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

/** Field names confirmed against the real, published SDK's own `SDKResultError` type declaration
 * (`subtype`, `is_error`, `errors: string[]`). `retryable` is `false` for every one of the SDK's own
 * four named error subtypes -- each names a terminal condition for *this* session, not a transient one
 * `AdapterEvent{type:'retry'}` already covers separately. */
function mapResultError(message: unknown): AdapterEvent | undefined {
  if (!isRecord(message)) return undefined;
  const subtype = textOf(message['subtype']);
  if (subtype === undefined) return undefined;
  const errors = message['errors'];
  const firstError = isArray(errors) ? textOf(errors[0]) : undefined;
  return { type: 'error', code: subtype, message: firstError ?? subtype, retryable: false };
}

/**
 * A fresh critic round found the original draft dispatched purely on `is_error === true`, missing a
 * second, real error shape: the SDK's own `SDKResultMessage` doc comment says `subtype: 'success'`
 * "carries the final assistant text in `result` -- or, with `is_error` true, the error text when the
 * turn ended on an API error." Confirmed directly against `SDKResultSuccess`'s own real fields: it
 * carries both `is_error: boolean` and `result: string`, with no `errors` array at all -- a
 * *different* shape from `SDKResultError`'s own dedicated `error_*` subtypes. Dispatching on
 * `is_error` alone routed this case into `mapResultError`, which reads `subtype`/`errors` (absent or
 * meaningless on this shape), producing a nonsensical `{code:'success', message:'success'}` instead
 * of the real error text. `subtype` is now checked first: only `subtype !== 'success'` is genuinely
 * `SDKResultError`-shaped; `subtype === 'success'` with `is_error: true` is this second, real case,
 * read from `result` instead of `errors`. `'api_error'` is this piece's own label for it (not a value
 * literally present in the SDK's own subtype enum, since none exists for this specific case).
 */
function mapResult(message: unknown): AdapterEvent | undefined {
  if (!isRecord(message)) return undefined;
  if (message['subtype'] !== 'success') return mapResultError(message);
  if (message['is_error'] === true) {
    const resultText = textOf(message['result']);
    return {
      type: 'error',
      code: 'api_error',
      message: resultText ?? 'API error',
      retryable: false,
    };
  }
  return mapResultSuccess(message);
}

/** Mirrors `parse-event.ts`'s own `mapStreamEvent` exactly -- `SDKPartialAssistantMessage`'s own real
 * shape (`{type:'stream_event', event: BetaRawMessageStreamEvent}`) is structurally identical to the
 * CLI transport's own raw `stream_event`-typed NDJSON line. */
function mapStreamEvent(message: unknown): AdapterEvent | undefined {
  if (!isRecord(message)) return undefined;
  const event = message['event'];
  if (!isRecord(event) || event['type'] !== 'content_block_delta') return undefined;
  const delta = event['delta'];
  if (!isRecord(delta) || delta['type'] !== 'text_delta') return undefined;
  const text = textOf(delta['text']);
  if (text === undefined) return undefined;
  return { type: 'text', text, partial: true };
}

export function mapSdkMessage(message: SDKMessage): readonly AdapterEvent[] {
  let candidate: AdapterEvent | undefined;
  if (message.type === 'system' && message.subtype === 'init') candidate = mapSystemInit(message);
  else if (message.type === 'system' && message.subtype === 'api_retry')
    candidate = mapApiRetry(message);
  else if (message.type === 'assistant') candidate = mapAssistant(message);
  else if (message.type === 'user') candidate = mapUserToolResult(message);
  else if (message.type === 'result') candidate = mapResult(message);
  else if (message.type === 'stream_event') candidate = mapStreamEvent(message);
  // Every other real `SDKMessage` variant (`rate_limit_event`, and the many task/hook/plugin/auth
  // notification kinds this milestone's own scope does not need) has no `AdapterEvent` variant to
  // become -- skipped, mirroring `parse-event.ts`'s own identical stance.

  if (candidate === undefined) return [];
  const normalized = normalizeAdapterEvent(candidate);
  return normalized.ok ? [normalized.event] : [];
}
