/**
 * `replayFromNdjson` — replays a previously-recorded `AdapterEvent` stream as a session's own live
 * event stream, for deterministic re-testing of a captured real run. One JSON-serialised `AdapterEvent`
 * per line, each validated through `normalizeAdapterEvent` (P1) on read — no separate `SessionResult`
 * line; `SessionResult` is instead derived from the replayed events themselves, the same computation a
 * real consumer already has to be able to do from a live stream.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q61 points 7-8
 * @see PLAN-M4.md P5
 */
import { readFile } from 'node:fs/promises';

import { normalizeAdapterEvent } from '@forge/adapter-kit/events';
import type { AdapterEvent, SessionHandle, SessionResult } from '@forge/adapter-kit/types';

import { makeHandle } from './handle.ts';

/** Parses one NDJSON line into an `AdapterEvent`, throwing a clear, actionable error (naming the file,
 * the 1-based line number, and the offending text) if the line is not valid JSON or does not normalise
 * to a real `AdapterEvent` — a replay of a corrupt or hand-edited recording should fail loudly, not
 * silently skip or fabricate an event that was never actually recorded. */
function parseLine(filePath: string, lineNumber: number, line: string): AdapterEvent {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(line);
  } catch (cause) {
    throw new Error(
      `@forge/testkit: replayFromNdjson: ${filePath}:${String(lineNumber)} is not valid JSON: ${line}`,
      { cause },
    );
  }
  const result = normalizeAdapterEvent(parsedJson);
  if (!result.ok) {
    throw new Error(
      `@forge/testkit: replayFromNdjson: ${filePath}:${String(lineNumber)} does not normalise to a ` +
        `real AdapterEvent (${result.issue.path}: ${result.issue.message}): ${line}`,
    );
  }
  return result.event;
}

async function* readEventsFromFile(filePath: string): AsyncGenerator<AdapterEvent> {
  const raw = await readFile(filePath, 'utf8');
  const lines = raw.split('\n');
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '') continue;
    yield parseLine(filePath, index + 1, line);
  }
}

/** Best-effort, derived from the replayed events themselves — not a second, parallel schema this file
 * would otherwise have to invent: `finalText` from concatenated non-partial `text` events, `usage`
 * summed across every `usage` event (one `turns` increment per such event), `changedFiles` from
 * `file.changed` events (deduplicated), `ok`/`error` from whether an `error` event or a
 * non-`'complete'` `session.ended` appears. `controlTokens` is always empty: a raw `control` event's
 * own `{token, payload}` shape cannot be reconstructed into a real, fully-typed `ParsedControlToken`
 * without re-deriving the exact text `parseControlTokens` (P3) would have parsed it from, which a
 * recorded event stream does not carry. */
function deriveResult(sessionId: string, events: readonly AdapterEvent[]): SessionResult {
  let finalText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | undefined;
  let turns = 0;
  const changedFiles: string[] = [];
  let ok = true;
  let error: { readonly code: string; readonly message: string } | undefined;

  for (const event of events) {
    switch (event.type) {
      case 'text':
        if (!event.partial) finalText += event.text;
        break;
      case 'usage':
        inputTokens += event.inputTokens;
        outputTokens += event.outputTokens;
        if (event.costUsd !== undefined) costUsd = (costUsd ?? 0) + event.costUsd;
        turns += 1;
        break;
      case 'file.changed':
        if (!changedFiles.includes(event.path)) changedFiles.push(event.path);
        break;
      case 'error':
        ok = false;
        error = { code: event.code, message: event.message };
        break;
      case 'session.ended':
        if (event.reason !== 'complete') ok = false;
        break;
      case 'session.started':
      case 'thinking':
      case 'tool.call':
      case 'tool.result':
      case 'control':
      case 'retry':
        // Nothing in SessionResult is derived from these — carries no information deriveResult needs,
        // but listed explicitly (not a catch-all default) so a future new AdapterEvent variant fails
        // this switch's own exhaustiveness check instead of silently falling through unnoticed.
        break;
    }
  }

  return {
    sessionId,
    ok,
    finalText,
    usage: { inputTokens, outputTokens, turns, ...(costUsd !== undefined ? { costUsd } : {}) },
    durationMs: 0,
    changedFiles,
    controlTokens: [],
    ...(error !== undefined ? { error } : {}),
  };
}

/** Synchronous in its own return, unlike `startSession`'s `Promise<SessionHandle>` — the actual file
 * read is deferred into the handle's own lazily-consumed `events` generator, so constructing the handle
 * never itself touches the filesystem; only actually consuming it (via `events` or `result()`) does. */
export function replayFromNdjson(filePath: string): SessionHandle {
  const sessionId = `replay:${filePath}`;

  async function* wrapped(): AsyncGenerator<AdapterEvent, SessionResult> {
    const events: AdapterEvent[] = [];
    for await (const event of readEventsFromFile(filePath)) {
      events.push(event);
      yield event;
    }
    return deriveResult(sessionId, events);
  }

  return makeHandle(sessionId, wrapped);
}
