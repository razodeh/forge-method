/**
 * `makeHandle` — turns an `AsyncGenerator<AdapterEvent, SessionResult>` into a spec-compliant
 * `SessionHandle`, shared by `FakePlatformAdapter`'s own `startSession`/`resumeSession` and
 * `replayFromNdjson`. `events` and `result()` may be drained in either order, but not *concurrently*:
 * exactly one pump may be in flight against the underlying generator at a time, and a second concurrent
 * attempt is rejected with a clear, immediate error rather than silently corrupting the captured
 * `SessionResult` — `AsyncIterable` was never a safe-for-concurrent-multi-consumption contract to begin
 * with. A `result()` call that itself loses that race resets its own memoized attempt afterward, so a
 * later, purely-sequential retry recovers cleanly instead of staying permanently wedged on the same
 * stale error (both properties were found missing, one after the other, during M4 P4's own gauntlet
 * round on a structurally identical helper there — built correctly here from the start).
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P5
 */
import type { AdapterEvent, SessionHandle, SessionResult } from '@forge/adapter-kit/types';

export function makeHandle(
  sessionId: string,
  createGenerator: () => AsyncGenerator<AdapterEvent, SessionResult>,
): SessionHandle {
  const generator = createGenerator();
  let finalResult: SessionResult | undefined;
  let generatorDone = false;
  let pumpInFlight = false;
  let draining: Promise<void> | undefined;

  async function pump(): Promise<IteratorResult<AdapterEvent, void>> {
    if (generatorDone) {
      return { done: true, value: undefined };
    }
    if (pumpInFlight) {
      throw new Error(
        `@forge/testkit: session ${sessionId} — events and result() were drained concurrently; ` +
          "fully drain one before starting the other (see makeHandle's own doc comment).",
      );
    }
    pumpInFlight = true;
    try {
      const step = await generator.next();
      if (step.done) {
        generatorDone = true;
        finalResult = step.value;
        return { done: true, value: undefined };
      }
      return { done: false, value: step.value };
    } finally {
      pumpInFlight = false;
    }
  }

  async function drainFully(): Promise<void> {
    let step = await pump();
    while (!step.done) {
      step = await pump();
    }
  }

  return {
    sessionId,
    events: {
      [Symbol.asyncIterator]() {
        return { next: () => pump() };
      },
    },
    async stop(): Promise<void> {
      // No real process to tear down for an in-memory fake.
    },
    async result(): Promise<SessionResult> {
      draining ??= drainFully();
      try {
        await draining;
      } catch (error) {
        draining = undefined;
        throw error;
      }
      if (finalResult === undefined) {
        throw new Error(`@forge/testkit: session ${sessionId} produced no SessionResult.`);
      }
      return finalResult;
    },
  };
}
