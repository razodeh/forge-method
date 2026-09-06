/**
 * `Clock` — the one source of "now" any deterministic piece of `@forge/core` may consult.
 *
 * `QUALITY-BAR.md` R10 forbids an uninjected `Date.now()`/`new Date()` in production code: a
 * timestamp read at call time makes behaviour — and, for `IdAllocator`'s cache, a committed file's
 * own content — depend on when the process happened to run rather than on an explicit, replayable
 * input. Every consumer takes a `Clock` through its constructor; only this file is exempted from the
 * ban (`eslint.config.js`, matched narrowly by this file's own name) so there is exactly one place
 * that ever reads the real wall clock.
 *
 * @see QUALITY-BAR.md R10
 */
export interface Clock {
  /** The current instant, as an ISO-8601 UTC timestamp (e.g. `2026-03-04T12:00:00.000Z`). */
  now(): string;
}

/** The real clock. Production wiring's only legitimate source of `Clock` — tests inject their own. */
export const SYSTEM_CLOCK: Clock = {
  now: () => new Date().toISOString(),
};
