/**
 * Reads the real, already-shipped regenerable content `runInit` copies into a project:
 * `@forge/templates`' own workflows/frameworks/checks/artifact-templates/skills content, and
 * `@forge/agents`' own resolved (post-`extends`) roster.
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
import { FRAMEWORK_INDEX, GATE_INDEX, TEMPLATE_INDEX, WORKFLOW_INDEX } from '@forge/templates';
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
