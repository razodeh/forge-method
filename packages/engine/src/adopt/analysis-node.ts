/**
 * `analysisNode` — builds the synthetic `StepNode` `runParticipantSession` needs for one CARTOGRAPHY/
 * INFERENCE dispatch call. `forge adopt`'s own CARTOGRAPHY/INFERENCE phases run outside a compiled
 * workflow entirely (`17` §17.2: an adoption run, not a `StepNode` graph an author wrote), so there is no
 * pre-existing `StepNode` to derive one from the way `session.ts`'s own `phaseNode` derives a per-phase
 * copy from the real session step already being executed — this is that helper's own from-scratch
 * equivalent for a piece with no such step to start from.
 *
 * The limits below are this piece's own conservative defaults, not a spec quote — `17` §17.2 gives no
 * numbers for a CARTOGRAPHY/INFERENCE dispatch's own turn/time/cost budget, the identical spec-silence
 * shape `compile.ts`'s own `DEFAULT_LIMITS` already resolves for a compiled agent step.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P16
 */
import { toAgentId, type StepNode } from '../plan/index.ts';

const ANALYSIS_LIMITS = { maxTurns: 10, wallClockMs: 300_000, maxCostUsd: 1.0 };

export function analysisNode(id: string, agentId: string): StepNode {
  return {
    id,
    kind: 'agent',
    agent: toAgentId(agentId),
    inputs: [],
    outputs: [],
    dependsOn: [],
    produces: [],
    consumes: [],
    retry: { maxAttempts: 1, backoffMs: [0, 0], retryOn: [] },
    limits: ANALYSIS_LIMITS,
    idempotencyKey: id,
    onFailure: 'block',
  };
}
