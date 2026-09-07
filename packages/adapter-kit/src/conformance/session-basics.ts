/**
 * C1 (hello session), C6 (limits), C7 (usage reporting), C11 (error surface) — `07` §7.6's own table,
 * verbatim. Each check is a plain, directly-callable async function (not only reachable through the
 * `it()` block that wraps it) so this piece's own test file can invoke one against a deliberately
 * non-compliant stub adapter and assert it rejects, proving the suite fails closed rather than only
 * proving a correct adapter happens to pass it.
 *
 * @see specs/07 §7.6
 * @see PLAN-M4.md P4
 */
import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '../types/events.ts';
import type { SessionHandle } from '../types/session.ts';
import type { ConformanceContext } from './context.ts';
import { collectEvents, withTimeout } from './helpers.ts';

function isEndedEvent(event: AdapterEvent): event is Extract<AdapterEvent, { readonly type: 'session.ended' }> {
  return event.type === 'session.ended';
}

function isUsageEvent(event: AdapterEvent): event is Extract<AdapterEvent, { readonly type: 'usage' }> {
  return event.type === 'usage';
}

function isErrorEvent(event: AdapterEvent): event is Extract<AdapterEvent, { readonly type: 'error' }> {
  return event.type === 'error';
}

export async function checkC1HelloSession(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();
  const handle = await context
    .getAdapter()
    .startSession(context.buildRequest({ cwd, prompt: context.options.helloPrompt }));
  const events = await withTimeout(collectEvents(handle), 15000, 'C1: session did not end within 15s');

  const textEvents = events.filter((event) => event.type === 'text');
  expect(textEvents.length).toBeGreaterThanOrEqual(1);

  const endedEvent = events.find(isEndedEvent);
  expect(endedEvent).toBeDefined();
  expect(endedEvent?.reason).toBe('complete');

  const result = await handle.result();
  expect(result.ok).toBe(true);
}

export async function checkC6Limits(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();
  const handle = await context.getAdapter().startSession(
    context.buildRequest({
      cwd,
      prompt: context.options.manyTurnsPrompt,
      limits: { maxTurns: 1 },
    }),
  );
  const events = await withTimeout(collectEvents(handle), 15000, 'C6: session did not end within 15s');
  const result = await withTimeout(handle.result(), 5000, 'C6: result() did not settle within 5s');

  const endedEvent = events.find(isEndedEvent);
  expect(endedEvent).toBeDefined();
  expect(endedEvent?.reason).toBe('limit');
  // "maxTurns respected," not only "labelled limit": result.usage.turns is the one independently
  // observable count this interface exposes, so it must not exceed what was actually granted — a
  // gauntlet critic found the original version trusted the reason label alone, which an adapter could
  // run every turn it wanted and still just report accurately.
  expect(result.usage.turns).toBeLessThanOrEqual(1);
}

export async function checkC7UsageReporting(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();
  const handle = await context
    .getAdapter()
    .startSession(context.buildRequest({ cwd, prompt: context.options.helloPrompt }));
  const events = await withTimeout(collectEvents(handle), 15000, 'C7: session did not end within 15s');

  const usageEvents = events.filter(isUsageEvent);
  expect(usageEvents.length).toBeGreaterThanOrEqual(1);
  for (const usage of usageEvents) {
    expect(usage.inputTokens).toBeGreaterThanOrEqual(0);
    expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
  }
}

export async function checkC11ErrorSurface(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();
  const request = context.buildRequest({
    cwd,
    prompt: context.options.helloPrompt,
    model: context.options.invalidModel,
  });

  let handle: SessionHandle | undefined;
  let startError: unknown;
  try {
    handle = await withTimeout(
      context.getAdapter().startSession(request),
      15000,
      'C11: startSession did not settle within 15s',
    );
  } catch (error) {
    startError = error;
  }

  if (handle === undefined) {
    // startSession itself rejecting is a legitimate way to surface "this model id is invalid," as long
    // as it happened promptly rather than hanging (already enforced by the withTimeout above).
    expect(startError).toBeDefined();
    return;
  }

  const events = await withTimeout(collectEvents(handle), 15000, 'C11: session did not end within 15s');
  const errorEvent = events.find(isErrorEvent);
  const result = await withTimeout(handle.result(), 15000, 'C11: result() did not settle within 15s');

  const surfaced = errorEvent !== undefined || result.error !== undefined;
  expect(surfaced).toBe(true);
  // "Non-retryable" is only checkable on the errorEvent path: SessionResult.error (07 §7.2's own
  // literal shape) has no retryable field at all, so an adapter that surfaces the failure only through
  // result.error cannot have that half of the row verified — a gauntlet critic named this; it is a real
  // interface gap (not something this check can work around) rather than a gap in the check itself.
  if (errorEvent !== undefined) {
    expect(errorEvent.retryable).toBe(false);
    expect(typeof errorEvent.code).toBe('string');
  }
}

export function registerSessionBasicsTests(context: ConformanceContext): void {
  describe('C1, C6, C7, C11 — session basics', () => {
    it('C1 — hello session: starts, streams ≥1 text event, ends complete, result().ok', () =>
      checkC1HelloSession(context));
    it('C6 — limits: maxTurns is respected, session ends with reason limit', () => checkC6Limits(context));
    it('C7 — usage reporting: usage event(s) present with non-negative token counts', () =>
      checkC7UsageReporting(context));
    it('C11 — error surface: an invalid model produces a typed, non-retryable error, not a hang', () =>
      checkC11ErrorSurface(context));
  });
}
