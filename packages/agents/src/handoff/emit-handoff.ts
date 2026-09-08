/**
 * `emitHandoff` — `05` §5.6's `FORGE_HANDOFF:` → real `HandoffRecord` → event log.
 *
 * @see specs/05 §5.6
 * @see PLAN-M6.md A7
 */
import { ForgeError } from '@forge/core';
import type { ParsedControlToken } from '@forge/adapter-kit';
import { handoffRecordSchema, type HandoffRecord } from '@forge/schemas/artifacts';

import type { EmitHandoffContext } from './types.ts';

/**
 * `token.reason` (`FORGE_HANDOFF: <role> <reason>`, `05` §5.5 point 3) is real content this piece
 * must not silently discard — folded in as the first `open_questions` entry, since a handoff's own
 * stated reason ("the correct next action belongs to another role") is, structurally, exactly the
 * kind of thing the receiving agent needs surfaced up front, and `HandoffRecord` has no dedicated
 * field of its own for "why this was handed off" to put it in instead.
 */
export async function emitHandoff(
  token: ParsedControlToken,
  ctx: EmitHandoffContext,
): Promise<HandoffRecord> {
  if (token.token !== 'FORGE_HANDOFF') {
    throw new ForgeError('RUN-047', { stepId: ctx.stepId ?? ctx.step, got: token.token });
  }

  const record = handoffRecordSchema.parse({
    id: ctx.id,
    from: ctx.from,
    to: token.role,
    step: ctx.step,
    timestamp: ctx.timestamp,
    delivered: ctx.delivered,
    open_questions: [token.reason, ...(ctx.openQuestions ?? [])],
    assumptions: ctx.assumptions ?? [],
    constraints_for_receiver: ctx.constraintsForReceiver ?? [],
    acceptance_for_receiver: ctx.acceptanceForReceiver ?? [],
  });

  await ctx.telemetry.emit({
    type: 'ArtifactCreated',
    runId: ctx.runId,
    ts: ctx.timestamp,
    ...(ctx.stepId === undefined ? {} : { stepId: ctx.stepId }),
    agentId: ctx.from,
    payload: record,
  });

  return record;
}
