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
 * @see PLAN-M17.md P11
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

/** Mirrors `../cli/parse-event.ts`'s own identically-named helper exactly -- see that file's own doc
 * comment. `modelUsage` here is `SDKResultSuccess.modelUsage: Record<string, ModelUsage>`, still read
 * as `unknown` (via `isRecord`) rather than trusted at its declared type: this function receives
 * `message: Record<string, unknown>` (an already-narrowed `SDKMessage`, but never re-asserted back to
 * one here), the same defensive stance this file's own sibling functions already take throughout. */
function sumModelUsageField(modelUsage: unknown, field: string): number | undefined {
  if (!isRecord(modelUsage)) return undefined;
  let sum = 0;
  let sawAny = false;
  for (const entry of Object.values(modelUsage)) {
    if (!isRecord(entry)) continue;
    const value = numberOf(entry[field]);
    if (value === undefined) continue;
    sum += value;
    sawAny = true;
  }
  return sawAny ? sum : undefined;
}

/** `usage.input_tokens`/`.output_tokens` plus top-level `total_cost_usd` -- the same fields on both the
 * `'usage'` and `'error'` `AdapterEvent` variants, read the same way regardless of which `result`
 * subtype carries them (mirrors `../cli/parse-event.ts`'s own `extractUsageFields`). Returns
 * `undefined` when `usage` itself is missing or malformed, rather than `{}`: a `Record<string,
 * never>`-shaped empty return collides with an object-literal spread that also sets a sibling literal
 * key (`{ type: 'usage', ...fields }`), confirmed directly -- `tsc` rejected it (`type: never` inferred
 * from the index signature). `cacheReadTokens`/`cacheCreationTokens` (M17 P11) are
 * `sumModelUsageField`'s own real per-model sum over `message.modelUsage` when present and usable,
 * falling back to the pre-M17 `usage.cache_read_input_tokens`/`.cache_creation_input_tokens` fields
 * otherwise. */
function extractUsageFields(
  message: Record<string, unknown>,
): Omit<Extract<AdapterEvent, { type: 'usage' }>, 'type'> | undefined {
  const usage = message['usage'];
  if (!isRecord(usage)) return undefined;
  const inputTokens = numberOf(usage['input_tokens']);
  const outputTokens = numberOf(usage['output_tokens']);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const modelUsage = message['modelUsage'];
  const cacheReadTokens =
    sumModelUsageField(modelUsage, 'cacheReadInputTokens') ??
    numberOf(usage['cache_read_input_tokens']);
  const cacheCreationTokens =
    sumModelUsageField(modelUsage, 'cacheCreationInputTokens') ??
    numberOf(usage['cache_creation_input_tokens']);
  const costUsd = numberOf(message['total_cost_usd']);
  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheCreationTokens === undefined ? {} : { cacheCreationTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

/** Field names confirmed against the real, published SDK's own `SDKResultSuccess` type declaration
 * (`total_cost_usd`, `usage.input_tokens`/`.output_tokens`/`.cache_read_input_tokens`) -- the identical
 * fields the CLI transport's own live captures confirmed for the same underlying `result` message. */
function mapResultSuccess(message: unknown): AdapterEvent | undefined {
  if (!isRecord(message)) return undefined;
  const fields = extractUsageFields(message);
  if (fields === undefined) return undefined;
  return { type: 'usage', ...fields };
}

/** Field names confirmed against the real, published SDK's own `SDKResultError` type declaration
 * (`subtype`, `is_error`, `errors: string[]`, PLUS `usage`/`total_cost_usd` -- M16 P17's own real live
 * run found the latter two genuinely present on a real `error_max_turns` result and confirmed directly
 * against the installed SDK's own `.d.ts`: an earlier doc comment here claiming this shape was limited
 * to `subtype`/`is_error`/`errors` was itself stale against a since-updated SDK). `retryable` is
 * `false` for every one of the SDK's own four named error subtypes -- each names a terminal condition
 * for *this* session, not a transient one `AdapterEvent{type:'retry'}` already covers separately. */
function mapResultError(message: unknown): AdapterEvent | undefined {
  if (!isRecord(message)) return undefined;
  const subtype = textOf(message['subtype']);
  if (subtype === undefined) return undefined;
  const errors = message['errors'];
  const firstError = isArray(errors) ? textOf(errors[0]) : undefined;
  return {
    type: 'error',
    code: subtype,
    message: firstError ?? subtype,
    retryable: false,
    ...extractUsageFields(message),
  };
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
 * M16 P17's own real live run (via a round-2 critic, reviewing the `extractUsageFields` fix above):
 * this shape is genuinely `SDKResultSuccess`-shaped, which requires `usage`/`total_cost_usd` exactly
 * like a clean success does -- a mid-turn API error after real spend must report it the same way
 * `mapResultError` now does, not fall back to the pre-fix zeroed default via a second, missed path.
 *
 * Returns an array (M17 P11): mirrors `../cli/parse-event.ts`'s own identically-restructured
 * `mapResult` exactly -- a single real `result` message can carry both a usage/error signal and a
 * real `structured_output` payload, and both become their own event here, in that order.
 */
function mapResult(message: unknown): readonly AdapterEvent[] {
  if (!isRecord(message)) return [];
  const events: AdapterEvent[] = [];
  if (message['subtype'] !== 'success') {
    const errorEvent = mapResultError(message);
    if (errorEvent !== undefined) events.push(errorEvent);
  } else if (message['is_error'] === true) {
    const resultText = textOf(message['result']);
    events.push({
      type: 'error',
      code: 'api_error',
      message: resultText ?? 'API error',
      retryable: false,
      ...extractUsageFields(message),
    });
  } else {
    const successEvent = mapResultSuccess(message);
    if (successEvent !== undefined) events.push(successEvent);
  }
  if (message['structured_output'] !== undefined) {
    events.push({ type: 'structured', data: message['structured_output'] });
  }
  return events;
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

/** `AdapterEvent | undefined` -> a zero-or-one-element array -- mirrors `../cli/parse-event.ts`'s own
 * identically-named helper; see that file's own doc comment. */
function toList(candidate: AdapterEvent | undefined): readonly AdapterEvent[] {
  return candidate === undefined ? [] : [candidate];
}

/** One real `SDKMessage` mapped to zero, one, or (a `result` message carrying both a usage/error
 * signal and a real `structured_output` payload, M17 P11) several real `AdapterEvent`s -- this
 * function's own return type was already `readonly AdapterEvent[]` before this piece (P3), but every
 * branch still only ever produced at most one candidate until `mapResult` above was restructured to
 * return its own array; that array is now threaded all the way through here too, rather than
 * collapsed back down to one. Each candidate is normalised and filtered independently, mirroring
 * `parseCliEventLine`'s own identical per-item tolerance. */
export function mapSdkMessage(message: SDKMessage): readonly AdapterEvent[] {
  let candidates: readonly AdapterEvent[];
  if (message.type === 'system' && message.subtype === 'init')
    candidates = toList(mapSystemInit(message));
  else if (message.type === 'system' && message.subtype === 'api_retry')
    candidates = toList(mapApiRetry(message));
  else if (message.type === 'assistant') candidates = toList(mapAssistant(message));
  else if (message.type === 'user') candidates = toList(mapUserToolResult(message));
  else if (message.type === 'result') candidates = mapResult(message);
  else if (message.type === 'stream_event') candidates = toList(mapStreamEvent(message));
  else candidates = [];
  // Every other real `SDKMessage` variant (`rate_limit_event`, and the many task/hook/plugin/auth
  // notification kinds this milestone's own scope does not need) has no `AdapterEvent` variant to
  // become -- skipped, mirroring `parse-event.ts`'s own identical stance.

  const normalized: AdapterEvent[] = [];
  for (const candidate of candidates) {
    const result = normalizeAdapterEvent(candidate);
    if (result.ok) normalized.push(result.event);
  }
  return normalized;
}
