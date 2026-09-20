/**
 * Shared test setup for `@forge/cli/doctor` — a real temp git repository with a real, valid
 * `.forge/config.yaml`/`.forge/manifest.yaml`, matching the real shape `forge init` (`PLAN-M6.md` C2)
 * writes, so a clean project passes every real check cleanly and each test introduces exactly the one
 * real deviation it means to test.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
// Genuinely test-only, the identical exemption `packages/cli/test/commands/helpers.ts` already
// documents for its own `tmpdir` import.
// eslint-disable-next-line no-restricted-imports -- see comment above
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { DEFAULT_CONFIG, type ForgeConfig } from '@forge/schemas/config';
import { ProjectPaths } from '@forge/core/fs';
import * as YAML from 'yaml';

export const KB_ROOT = DEFAULT_CONFIG.paths.kb;
export const SPECS_ROOT = DEFAULT_CONFIG.paths.specs;

export interface TestProject {
  readonly dir: string;
  readonly paths: ProjectPaths;
  readonly config: ForgeConfig;
}

const cleanupDirs: string[] = [];

export function registerCleanup(dir: string): void {
  cleanupDirs.push(dir);
}

export async function cleanupAll(): Promise<void> {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

const VALID_MANIFEST = {
  version: 1,
  modules: [{ id: 'fm-core', version: '0.0.0', checksum: 'a'.repeat(64) }],
};

/** A real, minimal, `forge init`-shaped project: a real git repo, a real, schema-valid
 * `.forge/config.yaml`, a real, well-formed `.forge/manifest.yaml`, and empty (but present, so
 * `pathExists` checks succeed) KB/specs trees — every real check in this module passes cleanly
 * against it by default. */
export async function createTestProject(): Promise<TestProject> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-doctor-'));
  registerCleanup(dir);

  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });

  const config: ForgeConfig = { ...DEFAULT_CONFIG };
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(config));
  await writeFile(path.join(dir, '.forge/manifest.yaml'), YAML.stringify(VALID_MANIFEST));

  await mkdir(path.join(dir, KB_ROOT), { recursive: true });
  await mkdir(path.join(dir, SPECS_ROOT), { recursive: true });

  return { dir, paths: new ProjectPaths(dir), config };
}

/** Writes `files` (relative path -> text) into `dir`, then stages and commits everything, so a gate rule that reads
 * the committed project (what a clean clone would contain) sees them. */
export async function writeAndCommit(
  dir: string,
  files: Readonly<Record<string, string>>,
  message = 'fixture',
): Promise<void> {
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
    await writeFile(path.join(dir, relative), text);
  }
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', message], { cwd: dir });
}

/** Writes `files` without staging or committing them: present in the working tree, absent from a clean clone. */
export async function writeUncommitted(
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
    await writeFile(path.join(dir, relative), text);
  }
}
