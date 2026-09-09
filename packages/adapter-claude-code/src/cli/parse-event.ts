/**
 * `parseCliEventLine` — one raw `claude -p --output-format stream-json` NDJSON line mapped to zero or
 * one real `AdapterEvent`. Every shape below was confirmed against real, live output this milestone
 * captured directly across three real calls (non-bare/subscription auth, and bare/API-key auth once
 * the coordinator supplied one — both real auth modes exercised, per the coordinator's own explicit
 * request): `system/init`, `assistant` (text and `tool_use` content blocks — confirmed one block per
 * line when streaming, matching the SDK's own doc comment: "While a response streams the CLI emits one
 * assistant message per completed content block"), `user` (`tool_result`), `result` (success), and
 * `stream_event` (the real incremental-delta mechanism, confirmed on the third, bare-mode capture —
 * the first two calls' own responses were too short to ever trigger one, which is why an earlier draft
 * of this file shipped without handling them at all; see `mapStreamEvent`'s own doc comment). Only
 * `result` (error) and `system/api_retry` remain unconfirmed live (neither call ever failed or
 * retried) — grounded instead in the real, published `@anthropic-ai/claude-agent-sdk`'s own `.d.ts`
 * field names, not guessed. See `SPEC-QUESTIONS.md` Q114 for the full record, including a real,
 * confirmed surprise: `--bare` mode still loads the invoking user's own globally-installed agents/
 * skills/slash-commands (its own `--help` text only promises to skip hooks/LSP/plugin-sync/CLAUDE.md/
 * keychain-reads/auto-memory, not those) — real, machine-dependent bleed bare mode's own "reproducible
 * across machines" framing does not fully cover, confirmed by directly comparing a non-bare and a
 * bare capture's own `tools`/`skills`/`slash_commands` fields side by side.
 *
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q114
 * @see PLAN-M7.md P2
 */
import { normalizeAdapterEvent } from '@forge/adapter-kit/events';
import type { AdapterEvent } from '@forge/adapter-kit';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value is readonly unknown[]`, not `value is any[]`: `Array.isArray` itself narrows to `any[]`,
 * which would let every `content[0]`-style access below silently become an unsafe `any`. */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** `system`/`init` -> `session.started`. Real fields confirmed live: `session_id`, `model`, `tools`
 * (a string array), `cwd`. `capabilities` (the real `system/init` array `07` §7.3 names for feature
 * detection, P4's own job) and `mcp_servers` (P7's own load-verification) are passed through in `meta`
 * unexamined here — this function's own job is the mapping, not the interpretation. */
function mapSystemInit(message: Record<string, unknown>): AdapterEvent | undefined {
  const sessionId = textOf(message['session_id']);
  const model = textOf(message['model']);
  const tools = message['tools'];
  if (sessionId === undefined || model === undefined || !Array.isArray(tools)) return undefined;
  return {
    type: 'session.started',
    sessionId,
    model,
    tools: tools.filter((tool): tool is string => typeof tool === 'string'),
    meta: message,
  };
}

/** `system`/`api_retry` -> `retry`. Field names confirmed against the real, published SDK's own
 * `SDKAPIRetryMessage` type (`attempt`, `max_retries`, `retry_delay_ms`) -- never observed live (see
 * this file's own top-of-file doc comment), so this mapping is grounded in Anthropic's own published
 * type declaration, not invented, but is not proven against a real captured line. */
function mapApiRetry(message: Record<string, unknown>): AdapterEvent | undefined {
  const attempt = numberOf(message['attempt']);
  const maxRetries = numberOf(message['max_retries']);
  const delayMs = numberOf(message['retry_delay_ms']);
  if (attempt === undefined || maxRetries === undefined || delayMs === undefined) return undefined;
  const errorStatus = message['error_status'];
  const reason = typeof errorStatus === 'number' ? `api error ${String(errorStatus)}` : 'api retry';
  return { type: 'retry', attempt, maxRetries, reason, delayMs };
}

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
  // Other real content-block kinds (e.g. `redacted_thinking`) carry nothing this milestone's own
  // `AdapterEvent` union has a variant for -- skipped, not fabricated into the nearest-looking case.
  return undefined;
}

/** `assistant` -> `text` / `thinking` / `tool.call`, from whichever single content block this line
 * actually carries. Confirmed live: a streamed session's own assistant line always carries exactly one
 * block (never observed more than one), matching the SDK's own doc comment quoted above -- this
 * function still only reads the first block if more than one somehow appears, rather than silently
 * dropping the line entirely, since one real event is better than none for an input this function did
 * not expect but can still partially handle. */
function mapAssistant(message: Record<string, unknown>): AdapterEvent | undefined {
  const inner = message['message'];
  if (!isRecord(inner)) return undefined;
  const content = inner['content'];
  if (!isArray(content) || content.length === 0) return undefined;
  return mapAssistantContentBlock(content[0]);
}

/** `user` (a real tool result being echoed back, `07` §7.3's own `tool.result` row) -> `tool.result`.
 * Confirmed live: `message.content[0]` carries `{type:'tool_result', tool_use_id, content, is_error}`.
 * `summary` is the result's own `content` field, stringified when it is not already a string (a real
 * tool result can be structured, e.g. an image block list) -- this milestone has no richer `summary`
 * concept than a short, human-readable line, matching `AdapterEvent`'s own `tool.result.summary: string`
 * field exactly. */
function mapUserToolResult(message: Record<string, unknown>): AdapterEvent | undefined {
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

/** `result` (`subtype: 'success'`) -> `usage`. Confirmed live: `total_cost_usd`, `usage.input_tokens`/
 * `.output_tokens`/`.cache_read_input_tokens` all present exactly as `07` §7.3's own mapping table
 * names them ("result message `total_cost_usd`, per-model breakdown, token counts"). Per-model
 * (`modelUsage`) breakdown is real but has no field of its own in `AdapterEvent`'s closed `usage`
 * variant -- carried nowhere by this function; a future piece needing it reads `session.started`'s own
 * `meta`-adjacent init data or a richer event this milestone's scope does not add. */
function mapResultSuccess(message: Record<string, unknown>): AdapterEvent | undefined {
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

/** `result` (any `error_*` subtype) -> `error`. Field names confirmed against the real, published
 * SDK's own `SDKResultError` type (`subtype`, `is_error`, `errors: string[]`) -- never observed live
 * (both real captures succeeded). `retryable` is `false` for every one of the SDK's own four named
 * error subtypes (`error_during_execution`, `error_max_turns`, `error_max_budget_usd`,
 * `error_max_structured_output_retries`): each names a terminal condition for *this* session, not a
 * transient one `AdapterEvent{type:'retry'}` already covers separately. */
function mapResultError(message: Record<string, unknown>): AdapterEvent | undefined {
  const subtype = textOf(message['subtype']);
  if (subtype === undefined) return undefined;
  const errors = message['errors'];
  const firstError = Array.isArray(errors) ? textOf(errors[0]) : undefined;
  return { type: 'error', code: subtype, message: firstError ?? subtype, retryable: false };
}

/**
 * A fresh critic round (found while reviewing this logic's own sibling in the SDK transport, P3,
 * which mirrors this file) found the original draft dispatched purely on `is_error === true`, missing
 * a second, real error shape: the SDK's own `SDKResultMessage` doc comment (the identical underlying
 * producer this CLI transport's own NDJSON output comes from) says `subtype: 'success'` "carries the
 * final assistant text in `result` -- or, with `is_error` true, the error text when the turn ended on
 * an API error." Confirmed directly against the real, published SDK's own `SDKResultSuccess` type: it
 * carries both `is_error: boolean` and `result: string`, with no `errors` array at all -- a
 * *different* shape from `SDKResultError`'s own dedicated `error_*` subtypes. Dispatching on
 * `is_error` alone routed this case into `mapResultError`, which reads `subtype`/`errors` (absent or
 * meaningless on this shape), producing a nonsensical `{code:'success', message:'success'}` instead
 * of the real error text. `subtype` is now checked first: only `subtype !== 'success'` is genuinely
 * `SDKResultError`-shaped; `subtype === 'success'` with `is_error: true` is this second, real case,
 * read from `result` instead of `errors`. `'api_error'` is this piece's own label for it (not a value
 * literally present in the SDK's own subtype enum, since none exists for this specific case).
 */
function mapResult(message: Record<string, unknown>): AdapterEvent | undefined {
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

/** `stream_event` -> `text` (`partial: true`), the real incremental-delta mechanism
 * `--include-partial-messages` actually provides. A second live capture (bare mode, `--model haiku`,
 * this milestone's own real, confirmed example) found this piece's own first draft silently dropped
 * every one of these -- only the final, consolidated `assistant` line (already handled by
 * `mapAssistant` above) was ever mapped, so `partial: true` was never once produced despite
 * `AdapterEvent.text` having a field for exactly this. Confirmed live shape: `event.type ===
 * 'content_block_delta'` wraps `delta.type === 'text_delta'` with the real incremental `delta.text`
 * chunk. `thinking_delta`/`signature_delta` (also real, also observed live) have no `AdapterEvent`
 * variant with a `partial` flag of its own (`'thinking'` is always a complete block) -- skipped here,
 * consolidated into one complete `thinking` event only once `mapAssistant` sees the final block. */
function mapStreamEvent(message: Record<string, unknown>): AdapterEvent | undefined {
  const event = message['event'];
  if (!isRecord(event) || event['type'] !== 'content_block_delta') return undefined;
  const delta = event['delta'];
  if (!isRecord(delta) || delta['type'] !== 'text_delta') return undefined;
  const text = textOf(delta['text']);
  if (text === undefined) return undefined;
  return { type: 'text', text, partial: true };
}

export function parseCliEventLine(line: string): AdapterEvent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;

  const type = raw['type'];
  const subtype = raw['subtype'];
  let candidate: AdapterEvent | undefined;
  if (type === 'system' && subtype === 'init') candidate = mapSystemInit(raw);
  else if (type === 'system' && subtype === 'api_retry') candidate = mapApiRetry(raw);
  else if (type === 'assistant') candidate = mapAssistant(raw);
  else if (type === 'user') candidate = mapUserToolResult(raw);
  else if (type === 'result') candidate = mapResult(raw);
  else if (type === 'stream_event') candidate = mapStreamEvent(raw);
  // Every other real, observed line type (`rate_limit_event`, `system/status`, `system/thinking_tokens`,
  // and any future one Claude Code adds) has
  // no `AdapterEvent` variant to become -- skipped, per `05` §5.5 point 9's own "unknown tokens are
  // logged and ignored" spirit, extended here to unknown *message* shapes generally, not only control
  // tokens specifically.

  if (candidate === undefined) return undefined;
  const normalized = normalizeAdapterEvent(candidate);
  return normalized.ok ? normalized.event : undefined;
}
