/**
 * `resolveStepCostCeilings` — the per-step cost ceiling, resolved once per run so every consumer reads
 * the same number (`PLAN-M13.md` P12, `Q210`, `Q208` finding 2).
 *
 * The number on `StepNode.limits.maxCostUsd` is three things at once: what admission control reserves
 * against `budget.perRunUsd` (`06` §6.3, `20` §20.8), what block [6] of the compiled prompt tells the agent
 * its budget is (`05` §5.3), and the cap handed to the adapter (`SessionRequest.limits.maxCostUsd`, `06`
 * §6.9). Resolving it on the node, before the scheduler sees it, is what keeps those three from drifting.
 *
 * Precedence for a model step: the workflow step's own `limits.maxCostUsd` (the most specific author),
 * then the agent's `limits.max_cost_usd` (`05` §5.2: the role's own ceiling), then the project's
 * `budget.perStepUsdDefault` (`18` §18.2, "default maximum spend for one step"), then the compile-time
 * placeholder. Steps that run no model reserve `0` already at compile time (`compileLimits`).
 *
 * @see specs/05 §5.2
 * @see specs/06 §6.9
 * @see specs/18 §18.2
 * @see specs/20 §20.8
 */
import { isForgeError } from '@forge/core/errors';

import type { StepNode } from '../plan/index.ts';

/** What resolution reads from the run context: the agent loader (assembly's own, cached per run) and the
 * project's `budget.perStepUsdDefault` when the caller supplies one. */
export interface CostCeilingSource {
  readonly assembly: {
    readonly loadAgent: (
      agentId: string,
    ) => Promise<{ readonly limits: { readonly max_cost_usd: number } }>;
  };
  readonly budget?: { readonly perStepUsdDefault?: number } | undefined;
}

function isUsableCeiling(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Returns `nodes` with each still-`'default'` model step's ceiling replaced by the agent's, else the
 * project default's. A node whose ceiling the workflow step declared, or that runs no model, is returned
 * as is. An agent that cannot be loaded keeps the placeholder: that step fails with its own precise
 * refusal (`RUN-056`) at dispatch, and guessing a ceiling here would only hide it behind a budget message. */
export async function resolveStepCostCeilings(
  nodes: readonly StepNode[],
  source: CostCeilingSource,
): Promise<readonly StepNode[]> {
  const configDefault = source.budget?.perStepUsdDefault;
  const agentCeilings = new Map<string, number | undefined>();

  async function agentCeiling(agentId: string): Promise<number | undefined> {
    if (agentCeilings.has(agentId)) return agentCeilings.get(agentId);
    let ceiling: number | undefined;
    try {
      const agent = await source.assembly.loadAgent(agentId);
      ceiling = isUsableCeiling(agent.limits.max_cost_usd) ? agent.limits.max_cost_usd : undefined;
    } catch (cause) {
      // Only "this agent is not in the roster or does not parse" (`RUN-056`) falls back: dispatch reports
      // that precisely. Any other failure (a transient I/O error) must not silently reserve the placeholder
      // while the session is later assembled from the real agent file and told a different budget.
      if (!(isForgeError(cause) && cause.code === 'RUN-056')) throw cause;
      ceiling = undefined;
    }
    agentCeilings.set(agentId, ceiling);
    return ceiling;
  }

  const resolved: StepNode[] = [];
  for (const node of nodes) {
    if (node.maxCostSource !== 'default') {
      resolved.push(node);
      continue;
    }
    const fromAgent = node.agent === undefined ? undefined : await agentCeiling(String(node.agent));
    if (fromAgent !== undefined) {
      resolved.push({
        ...node,
        limits: { ...node.limits, maxCostUsd: fromAgent },
        maxCostSource: 'agent',
      });
    } else if (isUsableCeiling(configDefault)) {
      resolved.push({
        ...node,
        limits: { ...node.limits, maxCostUsd: configDefault },
        maxCostSource: 'config',
      });
    } else {
      resolved.push(node);
    }
  }
  return resolved;
}
