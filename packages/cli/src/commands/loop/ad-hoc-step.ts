/**
 * `buildAdHocStepNode` — a synthetic, hand-built `StepNode` for `forge debug`/`forge review`/`forge
 * panel`, the three `03` §3.2.5/§3.2.6 commands `PLAN-M6.md` C5's own Mandate text gives a real,
 * already-built mechanism to call directly (`@forge/engine/interaction`'s own `dispatchAgentStep`, A6)
 * rather than a "not yet implemented" refusal.
 *
 * `dispatchAgentStep(node, agent, ctx, mode, options)` requires a real, compiled `StepNode` — it has no
 * standalone entry point of its own, since every other real caller (`runAgentStep`, inside
 * `@forge/engine`'s own scheduler) only ever reaches it with one `compileRunPlan` already produced.
 * None of `forge debug`/`forge review`/`forge panel` runs inside a workflow at all (no lane, no `runId`
 * a real scheduled step would have) — so this is a real, hand-built `StepNode`, never routed through
 * `parseWorkflow`/`compileRunPlan`, matching every field `dispatchAgentStep`'s own real code path
 * actually reads (confirmed directly against `dispatch-agent-step.ts`: `node.id`/`node.brief`/
 * `node.limits` are the only fields `runParticipantSession` touches) rather than a full, spec-accurate
 * `StepNode` no caller outside a real compiled plan could ever honestly produce.
 *
 * `limits` is a required, real caller-supplied argument (`PLAN-M14.md` P32) — none of these three
 * commands compiles a workflow step whose own authored `limits:` a caller could fall back to, so the one
 * real, authored number left to request is the dispatched agent's own `05` §5.3 `limits` block
 * (`agentStepLimits` below), not a placeholder every agent+command pair shared regardless of what its
 * own definition actually declares. `AD_HOC_LIMITS` stays exported, and `ask.test.ts` pins its value,
 * though no real caller in this codebase reads it any more: `forge ask` (`ask.ts`) is `03` §3.2.6's own
 * one deliberate exception with no real agent dispatch at all (it throws `USR-003` unconditionally, so
 * it never imports this constant either) — kept rather than deleted as the one honest description left
 * of what a genuinely agent-less ad-hoc step would request, should a later `forge ask` implementation
 * ever need it, not because anything today actually depends on it.
 */
import type { AgentDefinition } from '@forge/agents/schema';
import type { StepNode, StepNodeLimits, StepNodeRetryPolicy } from '@forge/engine/plan';
import { toAgentId } from '@forge/engine/plan';

export const AD_HOC_LIMITS: StepNodeLimits = {
  maxTurns: 20,
  wallClockMs: 600_000,
  maxCostUsd: 2.0,
};
const AD_HOC_RETRY: StepNodeRetryPolicy = { maxAttempts: 1, backoffMs: [0, 0], retryOn: [] };

/** An agent's own declared `05` §5.3 `limits` block (`max_turns`/`wall_clock_ms`/`max_cost_usd`),
 * converted to the camelCase `StepNodeLimits` shape a dispatched step carries. */
export function agentStepLimits(agent: AgentDefinition): StepNodeLimits {
  return {
    maxTurns: agent.limits.max_turns,
    wallClockMs: agent.limits.wall_clock_ms,
    maxCostUsd: agent.limits.max_cost_usd,
  };
}

export function buildAdHocStepNode(
  id: string,
  agentId: string,
  brief: string,
  limits: StepNodeLimits,
): StepNode {
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
    limits,
    idempotencyKey: id,
    onFailure: 'block',
  };
}
