/**
 * `forge panel <question> --roles architect,security,sre` — `03` §3.2.6: "Multi-agent structured
 * debate." Real dispatch to `@forge/engine/interaction`'s own `dispatchAgentStep(node, agent, ctx,
 * 'panel', options)` (A6) — `PLAN-M6.md` C5's own Mandate text names this command as the one real
 * exception to `session`/`ask`'s own "not yet implemented" refusal, since A6 already gives it a real,
 * built mechanism to call directly.
 *
 * `dispatchPanel`'s own real code (confirmed directly) frames every one of the N independent
 * perspective sessions with the identical single `AgentDefinition` — `--roles` names *perspectives*
 * (labels a shared framing prompt answers independently from), not N separately-personified agents
 * each dispatched under their own distinct identity; the first named role's own real, materialized
 * agent definition (`.forge/agents/<role>.yaml`) is loaded as that shared framing identity.
 *
 * Same known, accepted `.forge/state/runs/<runId>/` growth limitation `review.ts`'s own doc comment
 * documents in full — harmless to correctness, a real cleanup mechanism is `forge doctor`'s own remit.
 *
 * @see specs/03 §3.2.6
 * @see specs/05 §5.7
 */
import { ForgeError } from '@forge/core/errors';
import { SYSTEM_CLOCK, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import { dispatchAgentStep, type InteractionOutcome } from '@forge/engine/interaction';
import type { ForgeConfig } from '@forge/schemas/config';

import { buildAdHocStepNode } from './ad-hoc-step.ts';
import { loadProjectAgent } from './agent-loader.ts';
import { buildRunEngineContext } from '../run/context.ts';

export interface PanelDeps {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  readonly adapter: PlatformAdapter;
  readonly checksRoot: string;
  readonly agentsRoot: string;
}

export interface PanelOptions {
  readonly clock?: Clock;
}

export async function panelQuestion(
  deps: PanelDeps,
  question: string,
  roles: readonly string[],
  options: PanelOptions = {},
): Promise<InteractionOutcome> {
  const primaryRole = roles[0];
  if (primaryRole === undefined) {
    throw new ForgeError('USR-002', { flag: '--roles', value: '' });
  }
  const clock = options.clock ?? SYSTEM_CLOCK;
  const agent = await loadProjectAgent(deps.paths, deps.agentsRoot, primaryRole);

  const runId = `panel-${clock.now().replace(/[^0-9]/g, '')}`;
  const ctx = await buildRunEngineContext({
    paths: deps.paths,
    projectRoot: deps.projectRoot,
    config: deps.config,
    runId,
    adapter: deps.adapter,
    checksRoot: deps.checksRoot,
    agentsRoot: deps.agentsRoot,
    clock,
  });

  const node = buildAdHocStepNode(runId, primaryRole, question);

  return dispatchAgentStep(node, agent, ctx, 'panel', { perspectives: roles });
}
