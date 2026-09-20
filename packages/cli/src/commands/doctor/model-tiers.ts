/**
 * `forge doctor`'s model-tier check — `PLAN-M13.md` P5b, `SPEC-QUESTIONS.md` Q204.
 *
 * Since M13 P5 a step whose tier has no `models.tiers.<tier>.<adapter id>` entry fails `RUN-078` (`05`
 * §5.8), which is right, but it is a failure discovered one dispatched step at a time. This reports it up
 * front, naming the agents and the remedy — and, when the adapter is available, also does the one thing
 * `05` §5.8 assigns to doctor and nothing else did yet: "Model identifiers MUST be resolved via the
 * adapter's `listModels()` at doctor time. Unknown/unavailable model -> doctor error with the available
 * list."
 *
 * The verdict for each installed agent comes from `resolveStepModel` itself — the function a real step
 * calls — not from a second implementation of its rules, so this check cannot drift from what a run does
 * (tier overrides, blank entries, prototype-named ids). Only the aggregation is local.
 *
 * Severity is `warning` throughout, deliberately. A tier with no usable model stops *agent* steps (RUN-078),
 * not FORGE itself (agent-free workflows, spec/KB commands and gates all still run), and `03` §3.7
 * reserves exit 5 for a hard prerequisite of `forge` as a whole. A configured model the adapter does not
 * list is *also* a warning, although `05` §5.8 words it "doctor error": an adapter's `listModels()` may be
 * a static table (the Claude Code one is) that does not gate what the platform accepts, so a valid, newer
 * id would otherwise fail `forge doctor` with exit 5 for a config that runs fine — and `forge init` would
 * never fix it, since it never overwrites a value you set. The message still names the model and the
 * available ids, which is what the spec wants a person to see. (`SPEC-QUESTIONS.md` Q204.)
 *
 * Scoped to the installed agents, so a tier no agent uses need not be mapped, and with no agents
 * installed there is nothing that can fail yet.
 *
 * @see specs/05 §5.8
 * @see specs/03 §3.7
 */
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { resolveStepModel } from '@forge/agents/resolve';
import { ForgeError } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import type { ForgeConfig } from '@forge/schemas/config';

import { sanitizeOneLine } from '../../init/tier-map.ts';
import { agentList } from '../agent.ts';
import { loadProjectAgent } from '../loop/agent-loader.ts';
import type { DoctorCheck } from './types.ts';

const AGENTS_ROOT = '.forge/agents';
const CHECK_ID = 'model-tiers';

/** The adapter's model ids for a message, capped so a large catalogue cannot bury the finding. */
function availableIds(ids: readonly string[]): string {
  const shown = ids.slice(0, 12).map(sanitizeOneLine).join(', ');
  return ids.length > 12 ? `${shown}, +${String(ids.length - 12)} more` : shown;
}

/** Agents named in a message, capped so a 34-agent roster does not bury the remedy. */
function nameAgents(ids: readonly string[]): string {
  const shown = ids.slice(0, 3).map(sanitizeOneLine).join(', ');
  return ids.length > 3 ? `${shown}, +${String(ids.length - 3)} more` : shown;
}

function fail(message: string, adapterId: string, unmappedTier: boolean): DoctorCheck {
  return {
    id: CHECK_ID,
    ok: false,
    severity: 'warning',
    message,
    fix: unmappedTier
      ? `Set models.tiers.<tier>.${sanitizeOneLine(adapterId)} to a model id in .forge/config.yaml. ` +
        "`forge init` on this project fills any tier entry that is missing or blank from the adapter's " +
        'own defaults (never overwriting one you set), when the adapter declares defaults.'
      : `Set models.tiers.<tier>.${sanitizeOneLine(adapterId)} to one of the available ids in ` +
        ".forge/config.yaml, or ignore this if your platform accepts the model (the adapter's list may " +
        'be a static table).',
  };
}

export async function checkModelTiers(
  paths: ProjectPaths,
  config: ForgeConfig,
  adapter?: PlatformAdapter,
): Promise<DoctorCheck> {
  // The id a real step resolves against: the recorded primary, else the adapter the CLI would build for
  // an empty one (`buildAdapterForConfig` falls back to the registry's first), which is the one passed in.
  const adapterId = config.platform.primary !== '' ? config.platform.primary : adapter?.id;
  if (adapterId === undefined) {
    return {
      id: CHECK_ID,
      ok: true,
      severity: 'warning',
      message:
        'Model tiers: no platform is recorded or available, so there is no adapter to map tiers for.',
    };
  }

  const agentIds = await agentList({ paths, agentsRoot: AGENTS_ROOT });
  const unreadable: string[] = [];
  /** Reason (as `resolveStepModel` words it) -> agents hitting it. */
  const unresolved = new Map<string, string[]>();
  /** Model id -> agents that resolve to it, for the `listModels()` cross-check below. */
  const resolved = new Map<string, string[]>();
  for (const agentId of agentIds) {
    let agent;
    try {
      agent = await loadProjectAgent(paths, AGENTS_ROOT, agentId);
    } catch {
      // A broken agent file is `forge agent validate`'s finding, not this check's; named, not fatal.
      unreadable.push(agentId);
      continue;
    }
    try {
      const model = resolveStepModel(agent, config.models, adapterId);
      resolved.set(model, [...(resolved.get(model) ?? []), agent.id]);
    } catch (cause) {
      if (!(cause instanceof ForgeError) || cause.code !== 'RUN-078') throw cause;
      const detail =
        typeof cause.details['detail'] === 'string' ? cause.details['detail'] : cause.message;
      unresolved.set(detail, [...(unresolved.get(detail) ?? []), agent.id]);
    }
  }

  const problems = [...unresolved].map(
    ([detail, agents]) => `${sanitizeOneLine(detail)} (agents: ${nameAgents(agents)})`,
  );

  // `05` §5.8's doctor-time validation: every model a step would actually ask for must be one the adapter
  // reports, because `startSession` refuses any other. Never guessed at: when it cannot run (no adapter, a
  // different adapter, no models listed, `listModels()` failing) the message says the models were not
  // verified, rather than implying they were.
  const unlisted: string[] = [];
  let listNote = '';
  if (resolved.size > 0) {
    if (adapter?.id !== adapterId) {
      listNote = ` Models were not verified against the adapter: ${adapter === undefined ? 'no adapter is available' : `the available adapter is "${sanitizeOneLine(adapter.id)}", not "${sanitizeOneLine(adapterId)}"`}.`;
    } else {
      try {
        const listed = (await adapter.listModels()).map((model) => model.id);
        if (listed.length === 0) {
          listNote = ' Models were not verified: the adapter lists none.';
        }
        for (const [model, agents] of resolved) {
          if (listed.length === 0 || listed.includes(model)) continue;
          unlisted.push(
            `"${sanitizeOneLine(model)}" is not a model "${sanitizeOneLine(adapterId)}" lists ` +
              `(agents: ${nameAgents(agents)}; available: ${availableIds(listed)})`,
          );
        }
      } catch (cause) {
        listNote = ` Models were not verified: listing them failed (${sanitizeOneLine(String(cause instanceof Error ? cause.message : cause))}).`;
      }
    }
  }

  const skipped =
    unreadable.length === 0
      ? ''
      : ` ${String(unreadable.length)} agent file(s) could not be read and were skipped (${nameAgents(unreadable)}); run \`forge agent validate\`.`;

  const all = [...problems, ...unlisted];
  if (all.length > 0) {
    return fail(
      `Model tiers on "${sanitizeOneLine(adapterId)}": ${all.join('; ')}. Agent steps on these fail (RUN-078 for a tier with no model).${skipped}${listNote}`,
      adapterId,
      problems.length > 0,
    );
  }
  const covered =
    resolved.size === 0 ? 'no agent could be checked' : 'every installed agent resolves a model';
  return {
    id: CHECK_ID,
    ok: true,
    severity: 'warning',
    message: `Model tiers on "${sanitizeOneLine(adapterId)}": ${covered}.${skipped}${listNote}`,
  };
}
