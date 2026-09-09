/**
 * Shared test setup for `@forge/cli/upgrade` — a real project tree, produced by the real `runInit`
 * (not a hand-built minimal fixture): `03` §3.4's own checks need real, regenerable content already on
 * disk (real `.forge/workflows`, `.forge/agents`, a real manifest with real checksums) to prove
 * `runUpgrade`'s own backup/migrate/regenerate/re-doctor pipeline actually does something, not merely
 * that it runs.
 */
import { mkdtemp, rm } from 'node:fs/promises';
// Genuinely test-only, the identical exemption `packages/cli/test/commands/doctor/helpers.ts` already
// documents for its own `tmpdir` import.
// eslint-disable-next-line no-restricted-imports -- see comment above
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FakePlatformAdapter } from '@forge/testkit';
import { ProjectPaths, readTextFile } from '@forge/core/fs';
import { DEFAULT_CONFIG, type ForgeConfig } from '@forge/schemas/config';
import * as YAML from 'yaml';

import { runInit } from '../../../src/init/run-init.ts';
import type { InitOptions, RunInitDeps } from '../../../src/init/types.ts';

export const SPECS_ROOT = DEFAULT_CONFIG.paths.specs;

export const FIXTURE_MODULES_DIR = fileURLToPath(
  new URL('../../init/fixtures/modules/', import.meta.url),
);

export interface TestProject {
  readonly dir: string;
  readonly paths: ProjectPaths;
  readonly config: ForgeConfig;
  readonly modulesDir: string;
}

const cleanupDirs: string[] = [];

export function registerCleanup(dir: string): void {
  cleanupDirs.push(dir);
}

export async function cleanupAll(): Promise<void> {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

function initDeps(): RunInitDeps {
  return {
    candidateAdapters: [new FakePlatformAdapter()],
    env: {},
    modulesDir: FIXTURE_MODULES_DIR,
  };
}

/** A real, fully `forge init`-produced project — real git repo (`runInit`'s own step 9), real
 * `.forge/manifest.yaml`/`.forge/workflows`/`.forge/agents`, a real, schema-valid `.forge/config.yaml`
 * read back and returned so tests can pass it straight into `UpgradeDeps.config`. */
export async function createTestProject(): Promise<TestProject> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-upgrade-'));
  registerCleanup(dir);

  const options: InitOptions = { name: 'Fixture Project', yes: true, modules: ['fixture-mod'] };
  await runInit(dir, options, initDeps());

  const paths = new ProjectPaths(dir);
  const config = await configFromDisk(paths);
  return { dir, paths, config, modulesDir: FIXTURE_MODULES_DIR };
}

async function configFromDisk(paths: ProjectPaths): Promise<ForgeConfig> {
  const raw = await readTextFile(paths.resolveWithin('.forge/config.yaml'));
  return YAML.parse(raw) as ForgeConfig;
}
