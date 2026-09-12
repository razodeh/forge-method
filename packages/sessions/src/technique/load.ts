/**
 * `loadTechnique`/`listTechniques` — reads `modules/<module>/techniques/<id>.technique.yaml` into
 * real, validated `Technique` values.
 *
 * Scoped to *every* module directory under `modulesDir`, the same shape `@forge/agents`'
 * `loadAgentRegistry` already uses for `modules/<module>/agents/<id>.agent.yaml` -- `19` §19.1's own module
 * layout names techniques as a per-module contribution type (`PLAN-M10.md`'s own header text: "the
 * technique library is core-method content available regardless of which `fm-*` modules are
 * installed"), so this reads every installed module's own `techniques/` directory rather than
 * hardcoding `fm-core`, even though `fm-core` is the only module that ships any today.
 *
 * A shipped technique file that fails to parse or validate is an authoring bug in this repository's
 * own first-party content, not ordinary runtime input -- thrown as a plain `Error`, the identical
 * "structural/config errors throw" split `loadAgentRegistry` already uses for the identical reason.
 * Asking for a technique id that genuinely does not exist is real, ordinary caller input (a `--technique`
 * flag, a `technique:` field on a workflow step) -- reported as a typed `ForgeError` (`RUN-065`)
 * instead.
 *
 * @see specs/16 §16.4
 * @see PLAN-M10.md P9
 */
import { ForgeError, listDirEntriesSorted, readTextFile, type AbsolutePath } from '@forge/core';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { techniqueSchema, type Technique, type TechniquePhase } from './schema.ts';

async function techniqueFilesIn(moduleDir: AbsolutePath): Promise<readonly AbsolutePath[]> {
  const techniquesDir = path.join(moduleDir, 'techniques') as AbsolutePath;
  let entries;
  try {
    entries = await listDirEntriesSorted(techniquesDir);
  } catch {
    // Not every module ships a techniques/ directory -- a legitimate shape, same as agents/.
    return [];
  }
  return entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith('.technique.yaml'))
    .map((entry) => path.join(techniquesDir, entry.name) as AbsolutePath);
}

function parseOneTechnique(source: string, filePath: AbsolutePath): Technique {
  const raw: unknown = parseYaml(source);
  const result = techniqueSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`loadTechniques: ${filePath} failed to load: ${issues}`);
  }
  return result.data;
}

/**
 * Every real technique across every module under `modulesDir`, sorted by module then filename.
 *
 * @throws {Error} if a shipped `*.technique.yaml` file fails to parse or validate, or if two files
 * (in the same module or across different modules) declare the same `id` -- ids are global, exactly
 * like `@forge/agents`' own roster ids, so a collision is an authoring bug caught here rather than
 * silently letting `loadTechnique` return whichever file happened to load first.
 */
async function loadAllTechniques(modulesDir: AbsolutePath): Promise<readonly Technique[]> {
  const moduleEntries = await listDirEntriesSorted(modulesDir);
  const techniques: Technique[] = [];
  const seenIds = new Map<string, AbsolutePath>();

  for (const moduleEntry of moduleEntries) {
    if (!moduleEntry.isDirectory) continue;
    const moduleDir = path.join(modulesDir, moduleEntry.name) as AbsolutePath;
    for (const file of await techniqueFilesIn(moduleDir)) {
      const source = await readTextFile(file);
      const technique = parseOneTechnique(source, file);
      const priorFile = seenIds.get(technique.id);
      if (priorFile !== undefined) {
        throw new Error(
          `loadTechniques: duplicate technique id ${JSON.stringify(technique.id)} in both ${priorFile} and ${file}`,
        );
      }
      seenIds.set(technique.id, file);
      techniques.push(technique);
    }
  }
  return techniques;
}

/** Every real technique under `modulesDir`, optionally narrowed to those applicable to `phase`. */
export async function listTechniques(
  modulesDir: AbsolutePath,
  phase?: TechniquePhase,
): Promise<readonly Technique[]> {
  const all = await loadAllTechniques(modulesDir);
  if (phase === undefined) return all;
  return all.filter((technique) => technique.phases.includes(phase));
}

/**
 * The one real technique named `id` under `modulesDir`.
 *
 * @throws {ForgeError} `RUN-065` if no module registers a technique with this id.
 */
export async function loadTechnique(modulesDir: AbsolutePath, id: string): Promise<Technique> {
  const all = await loadAllTechniques(modulesDir);
  const found = all.find((technique) => technique.id === id);
  if (found === undefined) {
    throw new ForgeError('RUN-065', { techniqueId: id });
  }
  return found;
}
