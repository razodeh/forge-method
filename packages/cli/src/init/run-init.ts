/**
 * `runInit` — `03` §3.3's greenfield wizard, driven end to end via `--yes` plus flags.
 *
 * @see specs/03 §3.3
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import { ForgeError, ProjectPaths } from '@forge/core';

import { buildForgeConfig } from './config.ts';
import { resolveInitLevel } from './level.ts';
import { selectPlatform } from './platform.ts';
import type { InitOptions, InitResult, RunInitDeps } from './types.ts';
import { writeInitTree } from './write-tree.ts';

/** Whether `dir` already looks like an initialized FORGE project — `03` §3.3's own idempotency check,
 * scoped to `dir` itself (not an ancestor walk: `init` targets a specific directory, unlike
 * `@forge/cli/entry`'s `resolveEntryContext`, which classifies the current working directory and its
 * ancestors before any project is known to exist at all). */
function isAlreadyInitialized(dir: string): boolean {
  return existsSync(path.join(dir, '.forge', 'config.yaml'));
}

/** Reads `options.ideaFile`'s real content — resolved against the real invocation `cwd`, matching
 * `03` §3.3's own worked example (`forge init . --idea-file ./idea.md`: both paths relative to the
 * same shell cwd, not to the target project directory `dir` names, which can itself differ from
 * `.`). `undefined` when no `--idea-file` was given.
 * @throws {ForgeError} `ENV-004` when the file cannot be read. */
async function readIdeaFile(options: InitOptions): Promise<string | undefined> {
  if (options.ideaFile === undefined) return undefined;
  try {
    return await readFile(path.resolve(options.ideaFile), 'utf8');
  } catch (cause) {
    throw new ForgeError('ENV-004', { tool: options.ideaFile }, { cause });
  }
}

async function ensureGit(dir: string, options: InitOptions): Promise<void> {
  const wantsGit = options.gitInit ?? true;
  if (!wantsGit) return;
  if (existsSync(path.join(dir, '.git'))) return;
  try {
    await execa('git', ['init'], { cwd: dir });
  } catch (cause) {
    throw new ForgeError('ENV-004', { tool: 'git' }, { cause });
  }
}

export async function runInit(
  dir: string,
  options: InitOptions,
  deps: RunInitDeps,
): Promise<InitResult> {
  if (!options.yes) {
    throw new ForgeError('USR-002', { flag: '--yes', value: '' });
  }
  // No real overlay-bundle installer exists anywhere in this codebase yet (no npm/git-URL fetch, no
  // capability-request-screen confirmation `03` §3.3 step 10 requires) — refusing loudly here is the
  // one thing that keeps `--overlay` from *looking* like it worked. See `SPEC-QUESTIONS.md` Q101.
  if (options.overlay !== undefined && options.overlay.length > 0) {
    throw new ForgeError('USR-002', { flag: '--overlay', value: options.overlay.join(',') });
  }

  const resolvedDir = path.resolve(dir);
  if (isAlreadyInitialized(resolvedDir)) {
    return { kind: 'already-initialized', projectRoot: resolvedDir };
  }

  const ideaContent = await readIdeaFile(options);

  await mkdir(resolvedDir, { recursive: true });
  const target = new ProjectPaths(resolvedDir);

  const { level, reasoning } = resolveInitLevel(options);
  const { primary, fallback } = await selectPlatform(resolvedDir, options, deps);

  const config = buildForgeConfig({
    options,
    level,
    platformId: primary.id,
    fallbackPlatformId: fallback?.id,
  });

  await ensureGit(resolvedDir, options);

  const files = await writeInitTree({
    target,
    modulesDir: deps.modulesDir,
    options,
    config,
    primary,
    ideaContent,
  });

  return {
    kind: 'initialized',
    projectRoot: resolvedDir,
    level,
    levelReasoning: reasoning,
    platform: primary.id,
    files,
  };
}
