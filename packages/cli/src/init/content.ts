/**
 * Reads the real, already-shipped regenerable content `runInit` copies into a project:
 * `@forge/templates`' own workflows/frameworks/checks/artifact-templates/skills content, and
 * `@forge/agents`' own resolved (post-`extends`) roster. The same readers, unchanged, are also what
 * `write-tree.ts`'s own `planRegenerableContent` (`PLAN-M14.md` P43) reads to classify each already
 * materialised copy without writing anything.
 *
 * Every read goes through `@forge/core/fs`'s sanctioned `listDirEntriesSorted`/`readTextFile` — even
 * though these reads are from this *package's own* installed dependency, not a host project
 * `@forge/core/fs`'s containment exists to protect, reusing the one already-sorted, already-tested
 * wrapper is simpler than a second one, and `ProjectPaths` accepts any existing directory as its
 * root, not only a project root.
 *
 * @see specs/03 §3.3
 */
import { listDirEntriesSorted, readTextFile, ProjectPaths, type AbsolutePath } from '@forge/core';
import { type AgentRegistry, loadAgentRegistry, resolveExtends } from '@forge/agents/registry';
import type { AgentDefinition } from '@forge/agents/schema';
import {
  BRIEF_INDEX,
  FRAMEWORK_INDEX,
  GATE_INDEX,
  PROMPT_INDEX,
  TEMPLATE_INDEX,
  WORKFLOW_INDEX,
} from '@forge/templates';
import path from 'node:path';
import * as YAML from 'yaml';

import { resolvePackageRoot } from './package-root.ts';

export interface ContentFile {
  /** Relative to the `.forge/<kind>/` directory this file belongs under. */
  readonly relPath: string;
  readonly content: string;
}

const templatesPaths = new ProjectPaths(resolvePackageRoot('@forge/templates'));

/**
 * Flattens every real path in `index` to its own basename under `.forge/<kind>/` — safe only because
 * every entry's basename really is unique today. Nothing else enforces that invariant, so a future
 * addition with a colliding basename would otherwise silently overwrite one regenerable file with
 * another; this throws instead, naming both colliding source paths, the moment that ever happens.
 */
async function readIndexed(
  index: Readonly<Record<string, string>>,
): Promise<readonly ContentFile[]> {
  const files: ContentFile[] = [];
  const seenBy = new Map<string, string>();
  for (const relPath of Object.values(index)) {
    const basename = path.basename(relPath);
    const collidesWith = seenBy.get(basename);
    if (collidesWith !== undefined) {
      throw new Error(
        `Basename collision writing regenerable content: "${relPath}" and "${collidesWith}" both resolve to "${basename}".`,
      );
    }
    seenBy.set(basename, relPath);
    const content = await readTextFile(templatesPaths.resolveWithin(relPath));
    files.push({ relPath: basename, content });
  }
  return files;
}

export async function readWorkflowFiles(): Promise<readonly ContentFile[]> {
  return readIndexed(WORKFLOW_INDEX);
}

export async function readFrameworkFiles(): Promise<readonly ContentFile[]> {
  return readIndexed(FRAMEWORK_INDEX);
}

export async function readCheckFiles(): Promise<readonly ContentFile[]> {
  return readIndexed(GATE_INDEX);
}

export async function readArtifactTemplateFiles(): Promise<readonly ContentFile[]> {
  return readIndexed(TEMPLATE_INDEX);
}

/** `PLAN-M13.md` P1's own real content category: workflow/gate step `brief:` content. `[]` today —
 * `BRIEF_INDEX` is still empty (`SPEC-QUESTIONS.md` Q197) — not a special case here, since `readIndexed`
 * already handles an empty index correctly (no directory read, nothing written).
 *
 * @see PLAN-M13.md P1 */
export async function readBriefFiles(): Promise<readonly ContentFile[]> {
  return readIndexed(BRIEF_INDEX);
}

/** `PLAN-M13.md` P1's own real content category: agent `prompt.system`/`prompt.briefs.*` content. `[]`
 * today, for the identical reason {@link readBriefFiles} above is.
 *
 * @see PLAN-M13.md P1 */
export async function readPromptFiles(): Promise<readonly ContentFile[]> {
  return readIndexed(PROMPT_INDEX);
}

/** Recursively walks `templates/skills/<relPrefix>`, reading every file it contains. Skills live
 * under nested `templates/skills/<skill-id>/SKILL.md`-shaped directories, unlike the other four (one
 * file per id) — walked rather than indexed, since `SKILL_INDEX` names the skill id, not its file's
 * own relative path within it. */
async function walkSkills(relPrefix: string): Promise<readonly ContentFile[]> {
  const dirRelPath = relPrefix === '' ? 'templates/skills' : `templates/skills/${relPrefix}`;
  const entries = await listDirEntriesSorted(templatesPaths.resolveWithin(dirRelPath));
  const files: ContentFile[] = [];
  for (const entry of entries) {
    const entryRelPath = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...(await walkSkills(entryRelPath)));
    } else {
      const content = await readTextFile(
        templatesPaths.resolveWithin(`templates/skills/${entryRelPath}`),
      );
      files.push({ relPath: entryRelPath, content });
    }
  }
  return files;
}

export async function readSkillFiles(): Promise<readonly ContentFile[]> {
  return walkSkills('');
}

/** Every real `*.technique.yaml` file directly inside `moduleDir`'s own `techniques/` subdirectory --
 * `[]` if the module ships none at all (`19` §19.1's own module layout lists `techniques/` as one of
 * several optional per-module content kinds). Mirrors `@forge/agents`' own `loadAgentRegistry`-internal
 * `agentFilesIn` (identical shape, a different file suffix) -- no shared helper exists between the two
 * packages for this, since neither has a boundary-graph edge to the other (`@forge/cli` depends on
 * both, never the reverse). */
async function techniqueFilesIn(moduleDir: AbsolutePath): Promise<readonly ContentFile[]> {
  const techniquesDir = path.join(moduleDir, 'techniques') as AbsolutePath;
  let entries;
  try {
    entries = await listDirEntriesSorted(techniquesDir);
  } catch {
    return [];
  }
  const files: ContentFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith('.technique.yaml')) continue;
    const content = await readTextFile(path.join(techniquesDir, entry.name) as AbsolutePath);
    files.push({ relPath: entry.name, content });
  }
  return files;
}

/** Every real technique (`modules/<module>/techniques/*.technique.yaml`), copied verbatim into
 * `.forge/techniques/` (`PLAN-M14.md` P29) -- unlike {@link readResolvedAgents}, a technique has no
 * `extends` chain to resolve at all (`techniqueSchema`, `@forge/sessions`, declares no such field), so
 * this reads each shipped file's own real bytes directly rather than parsing and re-serialising it
 * (`YAML.stringify` would silently drop a shipped file's own comments --
 * `steel-man-debate.technique.yaml`'s own `16` §16.7 point 3 citation, for one real example). The flat,
 * one-file-per-id destination layout `loadTechniqueFromDir` (`@forge/sessions`) reads has no
 * per-module subdirectory of its own, so a basename collision across two modules is checked here
 * (`readIndexed`'s own identical guard, above) -- today only `fm-core` ships a `techniques/` directory
 * at all, so this never fires yet, but a second module doing so would otherwise silently overwrite the
 * first's file with no report at all. */
export async function readTechniqueFiles(modulesDir: string): Promise<readonly ContentFile[]> {
  const moduleEntries = await listDirEntriesSorted(modulesDir as AbsolutePath);
  const files: ContentFile[] = [];
  const seenBy = new Map<string, string>();
  for (const moduleEntry of moduleEntries) {
    if (!moduleEntry.isDirectory) continue;
    const moduleDir = path.join(modulesDir, moduleEntry.name) as AbsolutePath;
    for (const file of await techniqueFilesIn(moduleDir)) {
      const collidesWith = seenBy.get(file.relPath);
      if (collidesWith !== undefined) {
        throw new Error(
          `Basename collision writing regenerable content: "${moduleEntry.name}/techniques/${file.relPath}" and "${collidesWith}" both resolve to "${file.relPath}".`,
        );
      }
      seenBy.set(file.relPath, `${moduleEntry.name}/techniques/${file.relPath}`);
      files.push(file);
    }
  }
  return [...files].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}

/** Every real roster agent (`modules/<module>/agents/<id>.agent.yaml`), resolved through its own
 * `extends` chain — `.forge/agents/`'s own real content, standing in for real prompt compilation
 * (`@forge/agents` A5, not yet built) until that piece exists. See `SPEC-QUESTIONS.md` Q103. */
export async function readResolvedAgents(
  modulesDir: string,
): Promise<
  readonly { readonly id: string; readonly displayName: string; readonly yaml: string }[]
> {
  const registry: AgentRegistry = await loadAgentRegistry(modulesDir as AbsolutePath);
  return registry.all().map((entry: AgentDefinition) => {
    const resolved = resolveExtends(entry.id, registry);
    return { id: resolved.id, displayName: resolved.name, yaml: YAML.stringify(resolved) };
  });
}
