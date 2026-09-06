/**
 * `gateCheckSchema`, `checkBuiltInThreshold` — `15` §15.7's "Custom gate checks" subsection.
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 */
import { z } from 'zod';

import type { ThresholdCheckInput, ThresholdFinding } from './types.ts';

/** `15` §15.7's worked example, field for field. Only `parser` is optional — not named among the
 * "missing any of `id`/`run`/`failOn`/`remedy` is refused" fields, and a check with no declared
 * parser is presumably read by exit code alone. */
export const gateCheckSchema = z
  .object({
    id: z.string().min(1),
    run: z.string().min(1),
    parser: z.enum(['json']).optional(),
    failOn: z.string().min(1),
    remedy: z.string().min(1),
    appliesTo: z
      .object({
        gates: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    severity: z.enum(['error', 'warn']),
  })
  .strict();

export type GateCheck = z.infer<typeof gateCheckSchema>;

/**
 * `15` §15.7: "Thresholds on built-in checks are tunable... but cannot be removed, only raised or
 * lowered, and lowering below the module floor prints the delta in every gate report so a weakened
 * bar is never invisible." This piece records the delta; printing it in every `GateReport` is M5's.
 *
 * `input.floor` is the ceiling-bearing module's own declared value — a real number with no spec
 * source to invent, supplied by the caller, the same resolution `SPEC-QUESTIONS.md` Q32/Q33 used.
 */
export function checkBuiltInThreshold(input: ThresholdCheckInput): ThresholdFinding | undefined {
  if (input.overlayValue >= input.floor) return undefined;
  const delta = input.floor - input.overlayValue;
  return {
    severity: 'warning',
    code: 'threshold-below-floor',
    message: `Check "${input.checkId}"'s "${input.field}" is set to ${String(input.overlayValue)}, below the module floor of ${String(input.floor)} (delta ${String(delta)}).`,
    delta,
  };
}
