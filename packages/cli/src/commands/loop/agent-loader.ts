/**
 * `loadProjectAgent` — reads one already-materialized, fully-resolved agent definition back from
 * `<agentsRoot>/<id>.yaml` (`forge init`'s own real write target, `packages/cli/src/init/content.ts`'s
 * `readResolvedAgents`: `YAML.stringify(resolveExtends(...))`, a complete `AgentDefinition`, `extends`
 * already walked, per-project overrides already applied).
 *
 * Deliberately not `@forge/agents/registry`'s own `loadAgentRegistry`: that function reads `05` §5.3's
 * own *source* roster convention (`modules/<module>/agents/<id>.agent.yaml`, this repository's own
 * `modules/fm-core/agents/`) — the shape `forge init`'s own wizard selects *from*, before resolving and
 * copying the result flat into a real project as `.forge/agents/<id>.yaml`. A project's own
 * already-materialized roster is a genuinely different read (a flat directory, no `modules/` nesting, a
 * `.yaml` extension rather than `.agent.yaml`), which nothing built before this piece needed to do.
 */
import { ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import { readAgentDefinition } from '@forge/agents/schema';
import type { AgentDefinition } from '@forge/agents/schema';

/** @throws {ForgeError} `RUN-056` if `.forge/agents/<agentId>.yaml` does not exist or fails to parse —
 * an already-`forge init`'d project missing (or corrupting) a real, previously-written roster file. */
export async function loadProjectAgent(
  paths: ProjectPaths,
  agentsRoot: string,
  agentId: string,
): Promise<AgentDefinition> {
  const relative = `${agentsRoot}/${agentId}.yaml`;
  let result;
  try {
    result = await readAgentDefinition(paths, relative);
  } catch (cause) {
    throw new ForgeError('RUN-056', { agentId, path: relative }, { cause });
  }
  if (!result.success) {
    throw new ForgeError(
      'RUN-056',
      { agentId, path: relative },
      { cause: new Error(JSON.stringify(result.issues)) },
    );
  }
  return result.agent;
}
