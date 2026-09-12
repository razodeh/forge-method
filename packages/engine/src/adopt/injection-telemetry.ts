/**
 * `reportInjectionAttempt` — `20` §20.5 point 2's own "removed and logged as `InjectionAttemptBlocked`,"
 * for the one real caller shape `cartography.ts`/`inference.ts` both need: a `wrapUntrustedContent` call
 * already stripped zero or more live `FORGE_*` tokens out of a CARTOGRAPHY/INFERENCE prompt's own
 * SURVEY/INVENTORY evidence block, and this reports that fact as a real telemetry event rather than
 * discarding it (`@forge/adapter-kit` itself "has no path to `@forge/telemetry`," per `strip.ts`'s own
 * module doc comment and `SPEC-QUESTIONS.md` Q57 -- a caller with `core`/`telemetry` access, which
 * `@forge/engine` is, is exactly what that doc comment says must construct the real event).
 *
 * Kept as its own tiny, directly-testable function rather than inlined at each of the two call sites:
 * a JSON-encoded evidence block (`JSON.stringify({...})`, always starting with `{`) can never itself
 * produce a line matching `stripControlTokens`'s own line-anchored `FORGE_*` pattern (`scan.ts`'s own
 * `TOKEN_LINE_PATTERN` requires a match at the line's own start), so `strippedCount > 0` is not
 * realistically reachable through this piece's own real evidence-building path today -- but the branch
 * exists because that JSON-shape assumption is not a checked invariant, and a defense that only turns on
 * once new evidence formatting makes it reachable is exactly the kind of dead code review would otherwise
 * flag as untested. Testing this function directly, independent of whether a real evidence string can
 * currently trigger it, gives it real coverage without fabricating an artificial end-to-end scenario.
 *
 * @see specs/20 §20.5 point 2
 * @see PLAN-M10.md P16
 */
import type { ExecuteStepContext } from '../dispatch/types.ts';
import type { AgentId } from '../plan/index.ts';

export async function reportInjectionAttempt(
  ctx: ExecuteStepContext,
  stepId: string,
  agentId: AgentId | undefined,
  phase: 'cartography' | 'inference',
  kind: string,
  strippedCount: number,
): Promise<void> {
  if (strippedCount <= 0) return;
  await ctx.telemetry.emit({
    type: 'InjectionAttemptBlocked',
    stepId,
    agentId,
    payload: { phase, kind, strippedCount },
  });
}
