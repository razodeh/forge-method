/**
 * C5 (abort) and C10 (control tokens) — `07` §7.6's own table, verbatim. Each check is a plain,
 * directly-callable async function so this piece's own test file can invoke one against a deliberately
 * non-compliant stub adapter and assert it rejects.
 *
 * @see specs/07 §7.6
 * @see SPEC-QUESTIONS.md Q60 point 5
 * @see PLAN-M4.md P4
 */
import { describe, expect, it } from 'vitest';

import type { ParsedControlToken } from '../types/control-tokens.ts';
import type { AdapterEvent } from '../types/events.ts';
import type { ConformanceContext } from './context.ts';
import { collectEvents, withTimeout } from './helpers.ts';

function isControlEvent(
  event: AdapterEvent,
): event is Extract<AdapterEvent, { readonly type: 'control' }> {
  return event.type === 'control';
}

function isEndedEvent(
  event: AdapterEvent,
): event is Extract<AdapterEvent, { readonly type: 'session.ended' }> {
  return event.type === 'session.ended';
}

export async function checkC5Abort(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();
  const controller = new AbortController();
  const handle = await context.getAdapter().startSession(
    context.buildRequest({
      cwd,
      prompt: context.options.manyTurnsPrompt,
      abortSignal: controller.signal,
    }),
  );

  controller.abort('conformance suite C5 abort');

  // "No orphan child processes remain" has no observable mechanism through PlatformAdapter's own
  // interface (SPEC-QUESTIONS.md Q60 point 5) — approximated by the strongest available proxy: the
  // event stream actually completes and result() actually resolves, both within the 5s budget the spec
  // states, rather than hanging (a real adapter that leaked a process would, in the overwhelming
  // majority of real implementations, also be the one whose stream/promise never cleanly settles).
  const events = await withTimeout(
    collectEvents(handle),
    5000,
    'C5: event stream did not settle within 5s of abort',
  );
  await withTimeout(handle.result(), 5000, 'C5: result() did not settle within 5s of abort');

  const endedEvent = events.find(isEndedEvent);
  if (endedEvent !== undefined) {
    expect(endedEvent.reason).toBe('aborted');
  }
}

export async function checkC10ControlTokens(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();
  const handle = await context
    .getAdapter()
    .startSession(context.buildRequest({ cwd, prompt: context.options.controlTokenPrompt }));
  const events = await withTimeout(
    collectEvents(handle),
    30000,
    'C10: session did not end within 30s',
  );
  const result = await withTimeout(handle.result(), 5000, 'C10: result() did not settle within 5s');

  const controlEvent = events.find((event) => isControlEvent(event) && event.token === 'FORGE_ASK');
  expect(controlEvent).toBeDefined();

  // SessionResult.controlTokens carries the fully-parsed, typed shape (PLAN-M4.md P4's own note: "P3's
  // ParsedControlToken, for C10's own expected-shape assertion").
  const parsedAsk = result.controlTokens.find(
    (token): token is Extract<ParsedControlToken, { readonly token: 'FORGE_ASK' }> =>
      token.token === 'FORGE_ASK',
  );
  expect(parsedAsk).toBeDefined();
  expect(typeof parsedAsk?.question).toBe('string');
  expect(Array.isArray(parsedAsk?.options)).toBe(true);
}

export function registerControlAndAbortTests(context: ConformanceContext): void {
  describe('C5 — abort', () => {
    it('abortSignal aborts within 5s; the event stream and result() both settle cleanly (no hang)', () =>
      checkC5Abort(context));
  });

  describe('C10 — control tokens', () => {
    it('a FORGE_ASK-eliciting prompt produces a parsed control event', () =>
      checkC10ControlTokens(context));
  });
}
