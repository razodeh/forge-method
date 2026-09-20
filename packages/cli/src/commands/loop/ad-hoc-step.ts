/**
 * `buildAdHocStepNode` — a synthetic, hand-built `StepNode` for `forge review`/`forge panel`, the two
 * `03` §3.2.5/§3.2.6 commands `PLAN-M6.md` C5's own Mandate text gives a real, already-built mechanism
 * to call directly (`@forge/engine/interaction`'s own `dispatchAgentStep`, A6) rather than a "not yet
 * implemented" refusal.
 *
 * `dispatchAgentStep(node, agent, ctx, mode, options)` requires a real, compiled `StepNode` — it has no
 * standalone entry point of its own, since every other real caller (`runAgentStep`, inside
 * `@forge/engine`'s own scheduler) only ever reaches it with one `compileRunPlan` already produced.
 * Neither `forge review` nor `forge panel` runs inside a workflow at all (no lane, no `runId` a real
 * scheduled step would have) — so this is a real, hand-built `StepNode`, never routed through
 * `parseWorkflow`/`compileRunPlan`, matching every field `dispatchAgentStep`'s own real code path
 * actually reads (confirmed directly against `dispatch-agent-step.ts`: `node.id`/`node.brief`/
 * `node.limits` are the only fields `runParticipantSession` touches) rather than a full, spec-accurate
 * `StepNode` no caller outside a real compiled plan could ever honestly produce.
 */
import type { StepNode, StepNodeLimits, StepNodeRetryPolicy } from '@forge/engine/plan';
import { toAgentId } from '@forge/engine/plan';

export const AD_HOC_LIMITS: StepNodeLimits = {
  maxTurns: 20,
  wallClockMs: 600_000,
  maxCostUsd: 2.0,
};
const AD_HOC_RETRY: StepNodeRetryPolicy = { maxAttempts: 1, backoffMs: [0, 0], retryOn: [] };

export function buildAdHocStepNode(id: string, agentId: string, brief: string): StepNode {
  return {
    id,
    kind: 'agent',
    agent: toAgentId(agentId),
    brief,
    inputs: [],
    outputs: [],
    dependsOn: [],
    produces: [],
    consumes: [],
    retry: AD_HOC_RETRY,
    limits: AD_HOC_LIMITS,
    idempotencyKey: id,
    onFailure: 'block',
  };
}
