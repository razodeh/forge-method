/**
 * `makeSessionHandle` — turns an `AsyncGenerator<AdapterEvent, SessionResult>` into a spec-compliant
 * `SessionHandle`. A deliberate, small duplication of `@forge/testkit`'s own identically-purposed
 * `makeHandle` (M4 P5) rather than an import: this package has no boundary-graph edge to
 * `@forge/testkit` (confirmed: `adapter-claude-code: ['adapter-kit', 'schemas', 'telemetry']` --
 * `testkit` is a *test-time* dependency other packages consume, never a production one), the same
 * "duplicate a small, proven shape rather than force a disallowed cross-package edge" precedent this
 * whole build has already established repeatedly (`StepContext` in `@forge/agents`, `ProjectLevel` in
 * `@forge/extensions/agents`, ...). Every real property `makeHandle`'s own doc comment records --
 * `events`/`result()` may be drained in either order but never concurrently, and a `result()` call
 * that loses that race resets its own memoized attempt so a later, purely-sequential retry recovers --
 * is preserved faithfully here, not just the shape, since those properties were only found correct
 * after a real M4 gauntlet round on the original.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
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
        `@forge/adapter-claude-code: session ${sessionId} — events and result() were drained ` +
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
        throw new Error(
          `@forge/adapter-claude-code: session ${sessionId} produced no SessionResult.`,
        );
      }
      return finalResult;
    },
  };
}
