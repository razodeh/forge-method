/**
 * `VcsClock` — the one source of "now" `analyzeGitProfile`'s age calculation may consult.
 *
 * `QUALITY-BAR.md` R10 forbids an uninjected `Date.now()` in production code: a timestamp read at
 * call time makes a fact report's own `ageDays` depend on when the process happened to run rather
 * than on an explicit, replayable input, which is exactly wrong for a report meant to be diffed
 * against a later run (`17` §17.5's own "continuous adoption"). `vcs`'s own `specs/02` §2.2 row
 * (`['schemas']`) has no `core` edge, so `@forge/core`'s own `SYSTEM_CLOCK` (`PLAN-M1.md` P13) is
 * structurally unreachable here — this file mirrors that one's shape instead of depending on it,
 * matched by the same per-package `src/clock.ts` ESLint exemption (`eslint.config.js`) so it, like
 * `@forge/core`'s own, is the one place in this package allowed to read the real wall clock.
 *
 * @see QUALITY-BAR.md R10
 * @see SPEC-QUESTIONS.md Q152
 */
export interface VcsClock {
  /** The current instant, as epoch milliseconds — `Date.now()`'s own return shape, since that is
   * what an age-in-days calculation needs, unlike `@forge/core`'s `Clock` (an ISO string, for event
   * logs). */
  now(): number;
}

/** The real clock. Production wiring's only legitimate source of `VcsClock` — tests inject their
 * own, fixed instant instead. */
export const SYSTEM_CLOCK: VcsClock = {
  now: () => Date.now(),
};
