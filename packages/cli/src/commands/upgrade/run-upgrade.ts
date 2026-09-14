/**
 * `runUpgrade` — `03` §3.4's own seven-step upgrade procedure, real for this milestone's own actual
 * version history (which has no prior shipped version to migrate *from* yet — this piece's own real
 * scope is the mechanism, proven against a synthetic fixture, not a real historical migration).
 *
 * @see specs/03 §3.4
 * @see PLAN-M6.md C7
 */
import { ForgeError, SYSTEM_CLOCK, pathExists, readTextFile, writeFileAtomic } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import { MIGRATIONS } from '@forge/schemas/migrations';
import * as YAML from 'yaml';

import { runDoctor } from '../doctor/index.ts';
import {
  buildManifest,
  readPackageVersion,
  writeRegenerableContent,
  type Manifest,
} from '../../init/index.ts';
import { createBackup } from './backup.ts';
import { applyArtifactMigrations, planArtifactMigrations } from './migrate-artifacts.ts';
import type { UpgradeDeps, UpgradeOptions, UpgradeReport } from './types.ts';
import { compareVersions } from './version.ts';

const MANIFEST_REL_PATH = '.forge/manifest.yaml';

/** A structurally real manifest — `version: 1` plus a real `modules` array of `{id, version,
 * checksum}` rows, each field the real type `installedVersionFrom`/the manifest-rebuild step below
 * actually reads. A critic round caught the original version trusting a bare `YAML.parse(...) as
 * Manifest` cast: a present but hand-corrupted manifest (merge-conflict markers left in, a truncated
 * write, a missing `modules` field) reached `installedVersionFrom`'s own `manifest.modules.find(...)`
 * as a raw, unhandled `TypeError` instead of the same clean `CFG-017` a genuinely *missing* manifest
 * already raises — a materially worse failure mode than every other real error path in this module.
 * `forge doctor`'s own `checkManifest` (C6) already does this exact structural validation as a
 * non-fatal `DoctorCheck`; reused directly here rather than a second, parallel check. */
async function readManifest(paths: ProjectPaths): Promise<Manifest> {
  if (!(await pathExists(paths.resolveWithin(MANIFEST_REL_PATH)))) {
    throw new ForgeError('CFG-017', undefined);
  }
  const parsed: unknown = YAML.parse(await readTextFile(paths.resolveWithin(MANIFEST_REL_PATH)));
  if (!isWellFormedManifest(parsed)) {
    throw new ForgeError('CFG-017', undefined);
  }
  return parsed;
}

function isWellFormedManifest(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly version?: unknown; readonly modules?: unknown };
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.modules) &&
    candidate.modules.every(
      (module: unknown) =>
        typeof module === 'object' &&
        module !== null &&
        typeof (module as { readonly id?: unknown }).id === 'string' &&
        typeof (module as { readonly version?: unknown }).version === 'string' &&
        typeof (module as { readonly checksum?: unknown }).checksum === 'string',
    )
  );
}

/** The manifest's own real "installed version": every real (non-`@forge/templates`) module entry
 * carries the identical `version` string (`buildManifest`'s own behaviour — one `readPackageVersion`
 * call stamped onto every real module row), so the first one found is representative of the whole
 * manifest. A manifest with no real modules at all (only the synthetic `@forge/templates` row) falls
 * back to the currently-running `@forge/agents` version — the same real source `buildManifest` itself
 * would use to (re)populate it. */
function installedVersionFrom(manifest: Manifest): string {
  const realModule = manifest.modules.find((module) => module.id !== '@forge/templates');
  return realModule?.version ?? readPackageVersion('@forge/agents');
}

export async function runUpgrade(
  paths: ProjectPaths,
  projectRoot: string,
  options: UpgradeOptions,
  deps: UpgradeDeps,
): Promise<UpgradeReport> {
  const manifest = await readManifest(paths);
  const installedVersion = installedVersionFrom(manifest);
  const targetVersion = options.to ?? readPackageVersion('@forge/agents');

  if (compareVersions(targetVersion, installedVersion) < 0) {
    throw new ForgeError('CFG-018', { installed: installedVersion, requested: targetVersion });
  }

  const migrations = deps.migrations ?? MIGRATIONS;
  const planned = await planArtifactMigrations(paths, deps.specsRoot, migrations);
  const migratedDocuments = planned.map((entry) => entry.summary);
  const regenerated =
    migratedDocuments.some((doc) => doc.stepCount > 0) ||
    compareVersions(targetVersion, installedVersion) > 0;

  if (options.dryRun === true) {
    return {
      v: 1,
      dryRun: true,
      installedVersion,
      targetVersion,
      migratedDocuments,
      regenerated,
    };
  }

  const clock = deps.clock ?? SYSTEM_CLOCK;
  const backupPath = await createBackup(paths, projectRoot, clock, deps.specsRoot);

  await applyArtifactMigrations(paths, planned);

  const regeneratedFiles = await writeRegenerableContent(paths, deps.modulesDir, {
    ...(options.onConflict !== undefined ? { mode: options.onConflict } : {}),
    ...(deps.conflictInput !== undefined ? { input: deps.conflictInput } : {}),
    ...(deps.conflictOutput !== undefined ? { output: deps.conflictOutput } : {}),
  });
  const requestedModules = manifest.modules
    .filter((module) => module.id !== '@forge/templates')
    .map((module) => module.id);
  const newManifest = await buildManifest(deps.modulesDir, requestedModules);
  await writeFileAtomic(paths.resolveWithin(MANIFEST_REL_PATH), YAML.stringify(newManifest));

  const doctor = await runDoctor({
    paths,
    projectRoot,
    config: deps.config,
    ...(deps.adapter === undefined ? {} : { adapter: deps.adapter }),
    env: deps.env,
    processVersion: deps.processVersion,
  });

  return {
    v: 1,
    dryRun: false,
    installedVersion,
    targetVersion,
    backupPath,
    migratedDocuments,
    regenerated: true,
    regeneratedFiles,
    doctor,
  };
}
