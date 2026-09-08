/**
 * `loadAgentRegistry` — `05` §5.3's own canonical path convention (`modules/<module>/agents/<id>.agent.yaml`),
 * read into a real, populated `AgentRegistry`.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A4
 */
import { listDirEntriesSorted, readTextFile, type AbsolutePath } from '@forge/core';
import path from 'node:path';

import { loadAgentDefinition } from '../schema/load.ts';
import type { AgentDefinition } from '../schema/types.ts';
import { AgentRegistry } from './registry.ts';

/** Every `*.agent.yaml` file directly inside `dir`'s own `agents/` subdirectory, sorted -- `[]` if
 * `dir` has no `agents/` subdirectory at all (a module with no agents of its own, a legitimate shape
 * `05` §5.1's own per-module roster extension model allows). */
async function agentFilesIn(moduleDir: AbsolutePath): Promise<readonly AbsolutePath[]> {
  const agentsDir = path.join(moduleDir, 'agents') as AbsolutePath;
  let entries;
  try {
    entries = await listDirEntriesSorted(agentsDir);
  } catch {
    // `RUN-034` (ForgeError) for a missing `agents/` directory -- not every module ships one.
    return [];
  }
  return entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith('.agent.yaml'))
    .map((entry) => path.join(agentsDir, entry.name) as AbsolutePath);
}

/**
 * Reads every `modules/<module>/agents/<id>.agent.yaml` file under `modulesDir` into a real
 * `AgentRegistry`.
 *
 * Throws on the first malformed agent document (a schema violation, a YAML syntax error) -- the
 * shipped roster itself failing to load is an authoring bug in this codebase's own content, not
 * ordinary runtime input a caller should have to recover from at each entry, the same "structural/
 * config errors throw" split `resolveExtends` (A1) already uses for the identical reason.
 */
export async function loadAgentRegistry(modulesDir: AbsolutePath): Promise<AgentRegistry> {
  const moduleEntries = await listDirEntriesSorted(modulesDir);
  const definitions: AgentDefinition[] = [];

  for (const moduleEntry of moduleEntries) {
    if (!moduleEntry.isDirectory) continue;
    const moduleDir = path.join(modulesDir, moduleEntry.name) as AbsolutePath;
    for (const agentFile of await agentFilesIn(moduleDir)) {
      const source = await readTextFile(agentFile);
      const result = loadAgentDefinition(source, agentFile);
      if (!result.success) {
        throw new Error(
          `loadAgentRegistry: ${agentFile} failed to load: ${JSON.stringify(result.issues, null, 2)}`,
        );
      }
      definitions.push(result.agent);
    }
  }

  return new AgentRegistry(definitions);
}
