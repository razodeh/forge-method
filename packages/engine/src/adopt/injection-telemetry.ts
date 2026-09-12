/**
 * `reportInjectionAttempt` — `20` §20.5 point 2's own "removed and logged as `InjectionAttemptBlocked`,"
 * for the one real caller shape `cartography.ts`/`inference.ts` both need: a `wrapUntrustedContent` call
 * already stripped zero or more live `FORGE_*` tokens out of a CARTOGRAPHY/INFERENCE prompt's own
 * SURVEY/INVENTORY evidence block, and this reports that fact as a real telemetry event rather than
 * discarding it (`@forge/adapter-kit` itself "has no path to `@forge/telemetry`," per `strip.ts`'s own
 * module doc comment and `SPEC-QUESTIONS.md` Q57 -- a caller with `core`/`telemetry` access, which
 * `@forge/engine` is, is exactly what that doc comment says must construct the real event).
 *
 * Kept as its own tiny, directly-testable function rather than inlined at each of the two call sites,
 * since both `cartography.ts` and `inference.ts` need it identically.
 *
 * `strippedCount > 0` was, for a while, believed to be structurally unreachable through this piece's own
 * real evidence-building path: both callers built their evidence block with one `JSON.stringify({...})`
 * call and stripped the *result*, and a JSON-encoded blob's own escaped newlines can never satisfy
 * `stripControlTokens`'s own line-anchored `FORGE_*` pattern (`scan.ts`'s own `TOKEN_LINE_PATTERN`).
 * `PLAN-M11.md` P10's own `20` §20.10 S5 investigation found that belief was itself the bug, not a
 * proof of safety: it meant a real `FORGE_*`-shaped file path or fact extracted from a hostile brownfield
 * repository was never actually stripped either, not merely never logged. Both callers now sanitise
 * every evidence string leaf individually, *before* serialising (`./evidence-sanitize.ts`'s own
 * `sanitizeEvidenceForPrompt`), so this branch is genuinely reachable today, not merely defensive.
 *
 * @see specs/20 §20.5 point 2
 * @see specs/20 §20.10 S5
 * @see PLAN-M10.md P16
 * @see PLAN-M11.md P10
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
