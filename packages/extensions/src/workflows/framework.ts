/**
 * `frameworkOverlaySchema`, `checkFrameworkRemovalStillReferenced` — `15` §15.7's "Framework
 * overlays" subsection.
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 */
import { overlayArrayField } from '../merge/index.ts';
import { z } from 'zod';

import type { FrameworkReferenceFinding } from './types.ts';

const criteriaItemSchema = z.object({ id: z.string().min(1) }).catchall(z.unknown());
const ruleItemSchema = z.record(z.string(), z.unknown());

/** `15` §15.7's worked example: criteria weights, added/removed options, extra hard rules. No
 * `$insertAfter`-style workflow-specific extension is needed here, so this reuses P1's six generic
 * array operators as-is rather than restating them. */
export const frameworkOverlaySchema = z
  .object({
    criteria: overlayArrayField(criteriaItemSchema).optional(),
    options: overlayArrayField(z.string().min(1)).optional(),
    rules: overlayArrayField(ruleItemSchema).optional(),
  })
  .strict();

export type FrameworkOverlay = z.infer<typeof frameworkOverlaySchema>;

/**
 * `15` §15.7's own list of guardrails implies a framework cannot be removed while a gate config still
 * names it — the schema-level half of that rule, given the specific removal and the specific
 * still-referencing gate ids directly (the caller's to supply; the whole-resolved-set version, which
 * would need to search every gate config in a project rather than the two documents in hand, is
 * `PLAN-M2.md` P8's to assert if it turns out to need that).
 */
export function checkFrameworkRemovalStillReferenced(
  removedFrameworkIds: readonly string[],
  stillReferencedBy: ReadonlyMap<string, readonly string[]>,
): readonly FrameworkReferenceFinding[] {
  const findings: FrameworkReferenceFinding[] = [];
  for (const id of removedFrameworkIds) {
    const gates = stillReferencedBy.get(id) ?? [];
    if (gates.length === 0) continue;
    findings.push({
      severity: 'error',
      code: 'framework-still-referenced',
      message: `Framework "${id}" is still named by gate(s) ${gates.join(', ')} and cannot be removed.`,
    });
  }
  return findings;
}
