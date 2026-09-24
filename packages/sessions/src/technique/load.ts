/**
 * `loadTechnique`/`listTechniques` — reads `modules/<module>/techniques/<id>.technique.yaml` into
 * real, validated `Technique` values. `loadTechniqueFromDir`/`listTechniquesInDir` below read the
 * *other* real, materialised location this content lives at (`PLAN-M14.md` P29): `.forge/techniques/`,
 * a flat, one-file-per-id copy of the identical content a real project's own `forge init`/`forge
 * upgrade` write, with no per-module subdirectory of its own -- the pair `@forge/engine`'s
 * `loadSteelManTechnique` now reads a real project through, kept side by side with the module-scoped
 * pair (still real, still used by whatever reads the *shipped* module tree directly) rather than
 * replacing it.
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
 * @see PLAN-M14.md P29
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

/**
 * Every `*.technique.yaml` file directly under `dir` -- the flat, single, no-module-subdirectory
 * layout `forge init`/`forge upgrade` materialise into `.forge/techniques/` (`PLAN-M14.md` P29,
 * `writeRegenerableContent`, `@forge/cli/init/write-tree.ts`), each file named `<id>.technique.yaml`
 * exactly like its shipped `modules/*\/techniques/` source. `[]` for a directory that does not exist at
 * all (a project that has not run `forge init`, or predates this piece) -- the identical "nothing to
 * offer" shape `loadTechniqueFromDir`'s own caller (`loadSteelManTechnique`, `@forge/engine`) already
 * degrades from, never a throw.
 *
 * A malformed file, or one whose own `id` field disagrees with its file name, throws {@link ForgeError}
 * `RUN-065` naming the real file path -- a materialised project file a human can hand-edit is ordinary,
 * reportable runtime input (the identical id/filename check `RUN-056` already makes for
 * `.forge/agents/*.yaml`, `@forge/engine/dispatch/assembly-context.ts`'s own `readProjectAgent`), not
 * the shipped-content authoring bug {@link loadAllTechniques} above throws a plain `Error` for.
 */
async function techniqueFilesInDir(dir: AbsolutePath): Promise<readonly AbsolutePath[]> {
  let entries;
  try {
    entries = await listDirEntriesSorted(dir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith('.technique.yaml'))
    .map((entry) => path.join(dir, entry.name) as AbsolutePath);
}

const TECHNIQUE_SUFFIX = '.technique.yaml';

function parseFlatTechnique(source: string, filePath: AbsolutePath): Technique {
  const idFromFileName = path.basename(filePath, TECHNIQUE_SUFFIX);
  const raw: unknown = parseYaml(source);
  const result = techniqueSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ForgeError('RUN-065', { techniqueId: idFromFileName, path: filePath, issues });
  }
  if (result.data.id !== idFromFileName) {
    throw new ForgeError('RUN-065', {
      techniqueId: idFromFileName,
      path: filePath,
      issues: `file declares id ${JSON.stringify(result.data.id)}`,
    });
  }
  return result.data;
}

/**
 * Every real technique directly under `dir` (no per-module traversal at all, unlike
 * {@link listTechniques} above), optionally narrowed to those applicable to `phase`.
 *
 * @throws {ForgeError} `RUN-065` if any file in `dir` is malformed, fails `techniqueSchema`, or
 * declares an `id` other than its own file name.
 */
export async function listTechniquesInDir(
  dir: AbsolutePath,
  phase?: TechniquePhase,
): Promise<readonly Technique[]> {
  const files = await techniqueFilesInDir(dir);
  const techniques: Technique[] = [];
  for (const file of files) {
    techniques.push(parseFlatTechnique(await readTextFile(file), file));
  }
  if (phase === undefined) return techniques;
  return techniques.filter((technique) => technique.phases.includes(phase));
}

/**
 * The real technique named `id` directly under `dir`, or `undefined` when `dir` has no
 * `<id>.technique.yaml` file at all -- a real, honest "nothing to offer" a caller degrades from, never
 * thrown (see {@link techniqueFilesInDir}'s own doc comment). A *malformed* `<id>.technique.yaml` (or
 * one whose own `id` field disagrees with the file name) is a different, real failure and still throws
 * `RUN-065`, from {@link listTechniquesInDir}.
 *
 * @throws {ForgeError} `RUN-065` -- see {@link listTechniquesInDir}.
 */
export async function loadTechniqueFromDir(
  dir: AbsolutePath,
  id: string,
): Promise<Technique | undefined> {
  const all = await listTechniquesInDir(dir);
  return all.find((technique) => technique.id === id);
}
