/**
 * `resolveStepModel` — `PLAN-M13.md` P4, `05` §5.8's own tier -> model mapping, wired for real: an
 * agent's own `model.tier` (or a project's `models.overrides` entry for that agent's id, which wins
 * when present) resolved against `.forge/config.yaml`'s own `models.tiers.<tier>.<adapterId>` table,
 * replacing `packages/cli/src/commands/run/context.ts`'s own prior `resolveModel`, which picked
 * whichever model the adapter's `listModels()` happened to list first, for every step alike.
 *
 * Deliberately does not also cross-check the resolved model id against a live `PlatformAdapter.
 * listModels()` call — `05` §5.8's own text assigns that specific validation to `forge doctor`
 * ("Model identifiers MUST be resolved via the adapter's `listModels()` capability at doctor time"), a
 * distinct, separately-owned check; duplicating it here would mean this "standalone resolver"
 * (`PLAN-M13.md` P4's own words) needs a live adapter call to run at all, which its own test suite would
 * then have to fake. `startSession` itself still refuses any model id the adapter did not report
 * (carried forward from `context.ts`'s own prior `resolveModel` doc comment), so a stale config value
 * still fails at the adapter boundary either way — just not inside this function. `SPEC-QUESTIONS.md`
 * Q196.
 *
 * @see specs/05 §5.8
 * @see PLAN-M13.md P4
 * @see SPEC-QUESTIONS.md Q196
 */
import { ForgeError } from '@forge/core';
import type { ForgeConfig } from '@forge/schemas/config';

import type { AgentDefinition, ModelTier } from '../schema/types.ts';

const MODEL_TIERS = ['frugal', 'balanced', 'max'] as const satisfies readonly ModelTier[];

function isModelTier(value: string): value is ModelTier {
  // Widened to `readonly string[]` only so `includes` accepts an arbitrary string; the type predicate
  // is what narrows `value` back to `ModelTier`.
  return (MODEL_TIERS as readonly string[]).includes(value);
}

/**
 * The concrete model id `agent` resolves to on `adapterId`, read from `models`'s own tier table
 * (`ForgeConfig['models']`, `05` §5.8). Throws `RUN-078` — never a silent default — in either of two
 * genuinely different ways a config can fail to name a real model:
 *
 * 1. The *effective* tier (`models.overrides[agent.id]`, when a project sets one, else the agent's own
 *    already-schema-validated `model.tier`) is not one of `frugal`/`balanced`/`max`. `agent.model.tier`
 *    itself can never be wrong this way (`agentDefinitionSchema` already closes it to the three real
 *    tiers) — this only ever catches a bad *override*, which `models.overrides` schemas as a bare,
 *    unvalidated `Record<string, string>` (role id -> tier name) with nothing stopping a typo.
 * 2. The effective tier is real, but `models.tiers[<tier>]` has no entry for `adapterId`, or only a
 *    blank one — an incomplete config, not a reason to fall back to some other tier's model silently.
 */
export function resolveStepModel(
  agent: AgentDefinition,
  models: ForgeConfig['models'],
  adapterId: string,
): string {
  // `Object.hasOwn`, never a bare index: an agent or adapter id that happens to name an
  // `Object.prototype` member (`constructor`, `toString`) must not resolve to an inherited function.
  const override = Object.hasOwn(models.overrides, agent.id)
    ? models.overrides[agent.id]
    : undefined;
  const effectiveTier = override ?? agent.model.tier;

  if (!isModelTier(effectiveTier)) {
    throw new ForgeError('RUN-078', {
      agentId: agent.id,
      detail: `configured tier "${effectiveTier}" is not one of frugal, balanced, max`,
    });
  }

  const tierModels = models.tiers[effectiveTier];
  const modelId = Object.hasOwn(tierModels, adapterId) ? tierModels[adapterId] : undefined;
  if (modelId === undefined || modelId.trim() === '') {
    throw new ForgeError('RUN-078', {
      agentId: agent.id,
      detail: `no model configured for tier "${effectiveTier}" on adapter "${adapterId}"`,
    });
  }

  return modelId;
}
