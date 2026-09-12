/**
 * `workflowOverlaySchema`, `checkWorkflowStepRemoval`, `checkInsertAfterAnchors`, `applyInsertAfter`
 * — `15` §15.7's workflow overlay rules.
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 * @see SPEC-QUESTIONS.md Q35
 * @see SPEC-QUESTIONS.md Q36
 */
import { z } from 'zod';

import type {
  InsertAfterDirective,
  WorkflowGuardrailCode,
  WorkflowGuardrailFinding,
  WorkflowStepSummary,
} from './types.ts';

/** A step patch or a whole new step: at minimum an `id`, plus whatever kind-specific fields exist. */
const stepItemSchema = z.object({ id: z.string().min(1) }).catchall(z.unknown());

const insertAfterEntrySchema = z
  .object({
    anchor: z.string().min(1),
    steps: z.array(stepItemSchema).min(1),
  })
  .strict();

/**
 * `steps`'s overlay-directive shape: P1's six generic array operators (`@forge/extensions/merge`'s
 * own `overlayArrayOperatorSchema` shape, restated here rather than extended — that helper returns
 * `z.ZodTypeAny`, not an extensible `ZodObject`, and this piece adds a genuinely new key rather than
 * changing an already-committed, already-reviewed export's own shape) plus a 7th, workflow-scoped
 * `$insertAfter` key `15` §15.7's own worked example shows and no other overlay-able kind needs.
 */
const workflowStepsDirectiveSchema = z
  .object({
    $set: z.array(stepItemSchema).optional(),
    $append: z.array(stepItemSchema).optional(),
    $prepend: z.array(stepItemSchema).optional(),
    $remove: z.array(z.union([stepItemSchema, z.string()])).optional(),
    $replaceWhere: z.array(z.record(z.string(), z.unknown())).optional(),
    $clear: z.boolean().optional(),
    $insertAfter: z.array(insertAfterEntrySchema).optional(),
  })
  .strict();

export const workflowStepsFieldSchema = z.union([
  z.array(stepItemSchema),
  workflowStepsDirectiveSchema,
]);

/** `$extends`/`$description` are stripped by `@forge/extensions/resolve` before this schema sees it. */
export const workflowOverlaySchema = z
  .object({
    steps: workflowStepsFieldSchema.optional(),
  })
  .strict();

export type WorkflowOverlay = z.infer<typeof workflowOverlaySchema>;
export type WorkflowStepsDirective = z.infer<typeof workflowStepsDirectiveSchema>;

const RED_STEP_AGENT = 'sdet';
const REVIEW_STEP_AGENT = 'reviewer';

const MANDATORY_RETRO_SESSION_TYPE = 'retro';

/**
 * For a `fanout` step, the nested `step`'s `agent` is what actually runs per item (`10` §10.1's own
 * worked example never sets `agent` on the outer `fanout` wrapper itself) — so a `fanout` step's own
 * `agent`, if present at all, is checked only as a fallback, never given priority over the nested
 * step's. Giving the outer field unconditional priority would let a `fanout` step whose outer `agent`
 * happens to be something else mask a `reviewer`/`sdet` agent actually doing the work underneath.
 */
function protectionReason(step: WorkflowStepSummary): string | undefined {
  if (step.kind === 'gate') return 'a gate step';
  if (step.kind === 'session' && step.sessionType === MANDATORY_RETRO_SESSION_TYPE) {
    return 'the mandatory Operate & Learn stage retro';
  }
  const agent = step.kind === 'fanout' ? (step.step?.agent ?? step.agent) : step.agent;
  if (agent === RED_STEP_AGENT) return 'the red (test-first) step';
  if (agent === REVIEW_STEP_AGENT) return 'the review step';
  return undefined;
}

function guardrailCode(step: WorkflowStepSummary): WorkflowGuardrailCode {
  if (step.kind === 'gate') return 'gate-step-removed';
  if (step.kind === 'session' && step.sessionType === MANDATORY_RETRO_SESSION_TYPE) {
    return 'mandatory-retro-step-removed';
  }
  return 'protected-step-removed';
}

/**
 * `10` §10.1: "gate steps may be re-scoped or have checks added, never deleted. Removing a `red`
 * (test-first) step or a `review` step is refused." Checked against `removedIds` (the raw `$remove`
 * target list, by id) rather than a post-merge result, so the refusal fires before any removal is
 * ever applied (`SPEC-QUESTIONS.md` Q36 records how "is this the red/review step" is decided).
 *
 * A fourth protected shape, `PLAN-M10.md` P14's own addition: a `kind: 'session', sessionType: 'retro'`
 * step, `16` §16.6's own mandatory Operate & Learn stage retro ("not optional" — "the only mechanism by
 * which the process improves itself"). `15` §15.7's literal text only names gate/red/review steps; `19`
 * §19.3's own template-overlay rule 3 ("may not remove a required schema field") is the closer textual
 * match in spirit but talks about a *field*, not a *step*. This is therefore an explicit, documented
 * extension of `15` §15.7's own established principle — "some steps are structurally load-bearing enough
 * that an overlay may not delete them outright" — to a fourth concrete case that principle's own literal
 * text does not yet enumerate, not a reading of existing spec text that already covers it. Recorded in
 * `SPEC-QUESTIONS.md` Q165. Given its own distinct `mandatory-retro-step-removed` code (`guardrailCode`)
 * rather than the generic `protected-step-removed` gate/red/review already share, so a caller (and this
 * piece's own tests) can name exactly which rule fired.
 */
export function checkWorkflowStepRemoval(
  baseSteps: readonly WorkflowStepSummary[],
  removedIds: readonly string[],
): readonly WorkflowGuardrailFinding[] {
  const removed = new Set(removedIds);
  const findings: WorkflowGuardrailFinding[] = [];
  for (const step of baseSteps) {
    if (!removed.has(step.id)) continue;
    const reason = protectionReason(step);
    if (reason === undefined) continue;
    findings.push({
      severity: 'error',
      code: guardrailCode(step),
      message: `Step "${step.id}" is ${reason} and cannot be removed by an overlay.`,
    });
  }
  return findings;
}

/**
 * `15` §15.7: "`$insertAfter` anchored on a step id that doesn't exist is refused." Per
 * `SPEC-QUESTIONS.md` Q35, this is a piece-local finding, not a real numbered `ForgeError` — unlike
 * `@forge/extensions/merge`'s six generic operators (which do throw `CFG-011` for a malformed
 * directive), `$insertAfter`'s missing-anchor case is this piece's own guardrail, exactly like
 * `checkWorkflowStepRemoval`'s findings, not a structural document error.
 *
 * Directives are checked left to right against a simulated running result, so an earlier directive's
 * own insertions are visible to a later one's anchor lookup — matching what `applyInsertAfter` (below)
 * actually does when every anchor resolves.
 */
export function checkInsertAfterAnchors(
  steps: readonly WorkflowStepSummary[],
  directives: readonly InsertAfterDirective[],
): readonly WorkflowGuardrailFinding[] {
  let current = [...steps];
  const findings: WorkflowGuardrailFinding[] = [];
  for (const directive of directives) {
    const index = current.findIndex((step) => step.id === directive.anchor);
    if (index === -1) {
      findings.push({
        severity: 'error',
        code: 'insert-after-anchor-missing',
        message: `"$insertAfter" names anchor "${directive.anchor}", which does not name an existing step.`,
      });
      continue;
    }
    current = [...current.slice(0, index + 1), ...directive.steps, ...current.slice(index + 1)];
  }
  return findings;
}

/**
 * Inserts each directive's `steps` immediately after the step named `anchor`, left to right, without
 * reordering anything else already in `steps`. A directive whose `anchor` does not resolve is skipped
 * (a no-op) rather than thrown — `checkInsertAfterAnchors` is what refuses it; a caller runs that
 * first and only trusts this function's output once there are no findings.
 *
 * Two directives naming the *same* anchor apply in LIFO order relative to each other (the second
 * directive re-finds the still-unmoved anchor and inserts immediately after it too, ending up closer
 * to the anchor than the first directive's own insertion) — `15` §15.7 gives no worked example for
 * this case, so this is a documented behavior, not a spec-derived guarantee either way.
 */
export function applyInsertAfter(
  steps: readonly WorkflowStepSummary[],
  directives: readonly InsertAfterDirective[],
): readonly WorkflowStepSummary[] {
  let result = [...steps];
  for (const directive of directives) {
    const index = result.findIndex((step) => step.id === directive.anchor);
    if (index === -1) continue;
    result = [...result.slice(0, index + 1), ...directive.steps, ...result.slice(index + 1)];
  }
  return result;
}
