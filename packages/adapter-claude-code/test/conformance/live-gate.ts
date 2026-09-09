/**
 * `shouldRunLive`/`planLiveRuns` — `PLAN-M7.md` P9's own shared live-run gate: which real auth modes
 * (if any) this environment can actually exercise right now, so `sdk.conformance.test.ts`/
 * `cli.conformance.test.ts` never attempt a network call unless `FORGE_LIVE=1` *and* a real credential
 * genuinely exists.
 *
 * Both functions are pure and synchronous, taking `liveEnv`/`auth` as explicit parameters rather than
 * reading `process.env` or calling `probeAuthAvailability` themselves — the real async work (probing
 * `claude auth status`) belongs to each conformance file's own top-level setup, once, before either
 * function is ever called; keeping the *decision* itself synchronous and dependency-free is what makes
 * it directly, exhaustively unit-testable in `live-gate.test.ts` without a single subprocess call.
 *
 * Deliberately gates by *auth mode*, never by individual conformance test id: neither function has any
 * way to express "skip just C13" -- the only decision either one can produce is "these modes run" (in
 * which case `runAdapterConformanceSuite` runs its own full, unmodified 16-test suite once per mode) or
 * "nothing runs at all." `07` §7.6's own five safety-critical ids (`SAFETY_CRITICAL_CONFORMANCE_IDS`)
 * are therefore structurally incapable of being silently skipped by anything *other* than this one,
 * uniform gate -- `live-gate.test.ts` proves this by asserting this file's own source never references
 * that constant or any of its five members at all, not merely by observing today's behaviour.
 *
 * @see specs/07 §7.6
 * @see PLAN-M7.md P9
 */
import type { AuthAvailability } from '../../src/auth.ts';

export interface LiveRunPlan {
  readonly bare: boolean;
  readonly reason: string;
}

/** The single yes/no gate: real, live, billed conformance runs happen only when the coordinator
 * explicitly opted in (`FORGE_LIVE=1`) *and* at least one real credential exists. Absent either half,
 * every conformance test reports skipped -- never a hang, never a wall of auth-failure errors. */
export function shouldRunLive(
  liveEnv: Readonly<Record<string, string | undefined>>,
  auth: AuthAvailability,
): boolean {
  return liveEnv['FORGE_LIVE'] === '1' && (auth.apiKey || auth.subscription);
}

/**
 * One entry per real, available auth mode -- both, when both a real API key and a real subscription
 * login are present in the same environment at once (the coordinator's own stated intent: "provide api
 * key also so we can test both scenarios"), so the suite genuinely exercises each, not merely whichever
 * one happens to be configured first.
 */
export function planLiveRuns(
  liveEnv: Readonly<Record<string, string | undefined>>,
  auth: AuthAvailability,
): readonly LiveRunPlan[] {
  if (!shouldRunLive(liveEnv, auth)) return [];
  const runs: LiveRunPlan[] = [];
  if (auth.apiKey) {
    runs.push({
      bare: true,
      reason: 'FORGE_LIVE=1 and a real ANTHROPIC_API_KEY credential is available (bare mode).',
    });
  }
  if (auth.subscription) {
    runs.push({
      bare: false,
      reason: 'FORGE_LIVE=1 and a real claude subscription login is available (non-bare mode).',
    });
  }
  return runs;
}
