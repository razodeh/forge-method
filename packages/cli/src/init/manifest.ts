/**
 * `buildManifest` — `.forge/manifest.yaml`'s own real content: "installed modules + versions +
 * checksums" (`03` §3.3's own file-tree comment).
 *
 * "Modules" here is `03` §3.3 step 8's own specialisation-module concept
 * (`fm-web`/`fm-service`/`fm-data`/`fm-mobile`), plus the always-included base roster (`fm-core`).
 * Of these, only `fm-core` ships as real content anywhere in this codebase today — the other four are
 * named in the spec's own worked example but have no real `modules/fm-web/` (etc.) directory to
 * install, so a request for one that does not exist on disk is dropped rather than recorded as
 * installed content that was never actually written. See `SPEC-QUESTIONS.md` Q103.
 */
import path from 'node:path';

import { listDirEntriesSorted, pathExists, readTextFile, type AbsolutePath } from '@forge/core';

import {
  readArtifactTemplateFiles,
  readCheckFiles,
  readFrameworkFiles,
  readSkillFiles,
  readWorkflowFiles,
} from './content.ts';
import { sha256 } from './hash.ts';
import { readPackageVersion } from './package-root.ts';

export interface ManifestModule {
  readonly id: string;
  readonly version: string;
  readonly checksum: string;
}

export interface Manifest {
  readonly version: 1;
  readonly modules: readonly ManifestModule[];
}

/** The real, currently-existing module directories among `requested` — `fm-core` is always included
 * (the base roster every project needs regardless of what was requested), matching every other
 * `modules/*` directory's own on-disk presence rather than the full spec-named set. */
async function realModuleIds(
  modulesDir: string,
  requested: readonly string[],
): Promise<readonly string[]> {
  const candidates = ['fm-core', ...requested.filter((id) => id !== 'fm-core')];
  const present: string[] = [];
  for (const id of candidates) {
    if (await pathExists(path.join(modulesDir, id) as AbsolutePath)) present.push(id);
  }
  return present;
}

async function moduleChecksum(modulesDir: string, id: string): Promise<string> {
  const agentsDir = path.join(modulesDir, id, 'agents');
  if (!(await pathExists(agentsDir as AbsolutePath))) return sha256('');
  const entries = await listDirEntriesSorted(agentsDir as AbsolutePath);
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    parts.push(await readTextFile(path.join(agentsDir, entry.name) as AbsolutePath));
  }
  return sha256(parts.join('\n'));
}

async function templatesChecksum(): Promise<string> {
  const files = [
    ...(await readWorkflowFiles()),
    ...(await readFrameworkFiles()),
    ...(await readCheckFiles()),
    ...(await readArtifactTemplateFiles()),
    ...(await readSkillFiles()),
  ];
  return sha256(files.map((file) => file.content).join('\n'));
}

export async function buildManifest(
  modulesDir: string,
  requestedModules: readonly string[],
): Promise<Manifest> {
  const ids = await realModuleIds(modulesDir, requestedModules);
  const agentsVersion = readPackageVersion('@forge/agents');

  const modules: ManifestModule[] = [];
  for (const id of ids) {
    modules.push({
      id,
      version: agentsVersion,
      checksum: await moduleChecksum(modulesDir, id),
    });
  }

  const templatesVersion = readPackageVersion('@forge/templates');
  modules.push({
    id: '@forge/templates',
    version: templatesVersion,
    checksum: await templatesChecksum(),
  });

  return { version: 1, modules };
}
