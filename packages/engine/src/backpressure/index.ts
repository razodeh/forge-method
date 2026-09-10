/**
 * `@forge/engine/backpressure` — `06` §6.3's own backpressure rule as one small, self-contained state
 * machine: halve effective concurrency on an adapter rate-limit signal, restore it additively once a quiet
 * period elapses.
 *
 * @see specs/06 §6.3
 * @see PLAN-M5.md P13
 */
export {
  createBackpressureState,
  onRateLimitSignal,
  tick,
  type BackpressureState,
} from './state.ts';
