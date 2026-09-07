/**
 * Small utilities shared across every C1–C16 test group: draining a session's own event stream, and
 * bounding a promise so a genuinely hung adapter fails the specific test it broke instead of hanging the
 * whole suite.
 *
 * @see PLAN-M4.md P4
 */
import type { AdapterEvent } from '../types/events.ts';
import type { SessionHandle } from '../types/session.ts';

export async function collectEvents(handle: SessionHandle): Promise<readonly AdapterEvent[]> {
  const events: AdapterEvent[] = [];
  for await (const event of handle.events) {
    events.push(event);
  }
  return events;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    // clearTimeout accepts `undefined` directly (Node's own type signature: `NodeJS.Timeout | string |
    // number | undefined`) — no `if (timeoutId !== undefined)` guard needed, and so no dead branch
    // either: the Promise executor above runs synchronously, so `timeoutId` is always assigned by the
    // time this `finally` can possibly run, but nothing here depends on that being provable to the
    // type checker.
    clearTimeout(timeoutId);
  }
}
