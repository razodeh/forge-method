/**
 * `makeSessionHandle` — turns an `AsyncGenerator<AdapterEvent, SessionResult>` into a spec-compliant
 * `SessionHandle`. A deliberate, small duplication of `@forge/testkit`'s own `makeHandle` (M4 P5) and
 * `@forge/adapter-claude-code`'s own identically-named/-shaped function (M7 P4) — this package has no
 * boundary-graph edge to either (`testkit` is test-time only; `adapter-claude-code` is a sibling
 * adapter, not a shared dependency), the same "duplicate a small, proven shape rather than force a
 * disallowed cross-package edge" precedent this whole build has already established repeatedly. Every
 * real property those two originals' own doc comments record — `events`/`result()` may be drained in
 * either order but never concurrently, and a `result()` call that loses that race resets its own
 * memoized attempt so a later, purely-sequential retry recovers — is preserved faithfully here too.
 *
 * @see specs/07 §7.2
 * @see PLAN-M11.md P7
 */
import type { AdapterEvent, SessionHandle, SessionResult } from '@forge/adapter-kit';

export function makeSessionHandle(
  sessionId: string,
  createGenerator: () => AsyncGenerator<AdapterEvent, SessionResult>,
  stopImpl: (reason: string) => Promise<void>,
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
        `@forge/adapter-generic: session ${sessionId} — events and result() were drained ` +
          "concurrently; fully drain one before starting the other (see makeSessionHandle's own doc " +
          'comment).',
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
    stop: stopImpl,
    async result(): Promise<SessionResult> {
      draining ??= drainFully();
      try {
        await draining;
      } catch (error) {
        draining = undefined;
        throw error;
      }
      if (finalResult === undefined) {
        throw new Error(`@forge/adapter-generic: session ${sessionId} produced no SessionResult.`);
      }
      return finalResult;
    },
  };
}
