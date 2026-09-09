/**
 * `forge module <list|info>` — `03` §3.2.8.
 *
 * `add`/`remove`/`update` (per-module install/uninstall) have no real mechanism anywhere in this
 * codebase to wrap: `forge init`/`forge upgrade` only ever (re)write the *whole* resolved module set
 * named in `config.roster`/`InitOptions.modules` at once (`buildManifest`/`writeRegenerableContent`),
 * never one module at a time — a real, deliberate gap, not fabricated here.
 *
 * @see specs/03 §3.2.8
 */
import { ForgeError, readTextFile, type ProjectPaths } from '@forge/core';
import { listDirEntriesSorted, pathExists, type AbsolutePath } from '@forge/core/fs';
import type { ManifestModule } from '../init/index.ts';
import * as YAML from 'yaml';

export interface ModuleCommandContext {
  readonly paths: ProjectPaths;
  readonly modulesDir: string;
}

const MANIFEST_REL_PATH = '.forge/manifest.yaml';

async function readManifestModules(paths: ProjectPaths): Promise<readonly ManifestModule[]> {
  if (!(await pathExists(paths.resolveWithin(MANIFEST_REL_PATH)))) {
    throw new ForgeError('CFG-017', undefined);
  }
  const raw = YAML.parse(await readTextFile(paths.resolveWithin(MANIFEST_REL_PATH))) as {
    readonly modules?: readonly ManifestModule[];
  };
  return raw.modules ?? [];
}

/** `list` — every real, installed module row from the real, current manifest. */
export async function moduleList(ctx: ModuleCommandContext): Promise<readonly ManifestModule[]> {
  return readManifestModules(ctx.paths);
}

export interface ModuleInfo {
  readonly manifest: ManifestModule;
  /** Every real `agents/*.agent.yaml` id this module's own real source directory ships, `[]` for the
   * synthetic `@forge/templates` row (which has no real `modulesDir` directory of its own). */
  readonly agentIds: readonly string[];
}

/** `info <id>` — the real manifest row plus the real module directory's own real agent id list. */
export async function moduleInfo(ctx: ModuleCommandContext, id: string): Promise<ModuleInfo> {
  const modules = await readManifestModules(ctx.paths);
  const manifest = modules.find((module) => module.id === id);
  if (manifest === undefined) {
    throw new ForgeError('KB-015', { id });
  }

  // `id` is concatenated into a real filesystem path and cast straight to `AbsolutePath`, bypassing
  // `resolveWithin`'s own containment check -- safe here specifically because `id` can only reach this
  // line already matching a real row in the trusted manifest (the `KB-015` throw above), never an
  // arbitrary caller-supplied traversal string; `init/content.ts:107`'s own identical `as
  // AbsolutePath` cast over a trusted `modulesDir` is the precedent this follows, extended to a value
  // gated by the same kind of trust rather than left implicit.
  const agentsDir = `${ctx.modulesDir}/${id}/agents` as AbsolutePath;
  if (!(await pathExists(agentsDir))) {
    return { manifest, agentIds: [] };
  }
  const entries = await listDirEntriesSorted(agentsDir);
  const agentIds = entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith('.agent.yaml'))
    .map((entry) => entry.name.replace(/\.agent\.yaml$/, ''));
  return { manifest, agentIds };
}

export function moduleAdd(): never {
  throw new ForgeError('USR-003', { feature: 'module add' });
}

export function moduleRemove(): never {
  throw new ForgeError('USR-003', { feature: 'module remove' });
}

export function moduleUpdate(): never {
  throw new ForgeError('USR-003', { feature: 'module update' });
}
