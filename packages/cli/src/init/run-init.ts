/**
 * `runInit` — `03` §3.3's greenfield wizard, driven end to end via `--yes` plus flags.
 *
 * @see specs/03 §3.3
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { TierModelMap } from '@forge/adapter-kit/types';
import { execa } from 'execa';

import { ForgeError, ProjectPaths } from '@forge/core';

import type { ConflictHandlingOptions } from '../generated-header.ts';
import { buildForgeConfig } from './config.ts';
import { resolveInitLevel } from './level.ts';
import { selectPlatform } from './platform.ts';
import { backfillTierMap, deriveTierMap, reportFresh, type TierMapReport } from './tier-map.ts';
import type { InitOptions, InitResult, RunInitDeps } from './types.ts';
import { writeInitTree, writeRegenerableContent } from './write-tree.ts';

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

/**
 * The real branch `dir`'s own git repository has checked out right now, or `undefined` when there is
 * none to ask (`ensureGit` was asked not to run, or — unreachably in practice, since `symbolic-ref`
 * only inspects the `HEAD` -> `refs/heads/<name>` symlink-of-refs chain, never whether that branch has
 * any commits — detached `HEAD`). Called AFTER `ensureGit`, so for a freshly created repository this
 * is exactly the branch `git init` itself just picked (governed entirely by the user's own real git
 * `init.defaultBranch` config, or that git version's own unconfigured default — `"master"` for plain
 * upstream git, confirmed directly against this very environment, never assumed); for a pre-existing
 * repository (the brownfield/adopt path, or a project `forge init` is re-run against) it is whatever
 * branch a prior clone or checkout already left it on, which for anything cloned from a remote already
 * reflects that remote's own default branch, with no separate network call of this function's own.
 *
 * `specs/18` §18.3 / Decision 7 describe this as `vcs.trunk` being "proposed... from `origin/HEAD`...
 * or `init.defaultBranch`". This function delivers that guarantee's PRACTICAL substance — FORGE's own
 * assumption always matches the branch that genuinely exists — without separately re-implementing
 * either source as its own standalone check: a `git symbolic-ref` read-back, after the fact, is simpler
 * and sufficient for both named cases, and is NOT what `specs/18`'s own prose literally describes (see
 * this function's own caller for the one residual gap that reading leaves: a fresh `git init` run
 * against a directory that already has a remote configured but has never been fetched, where
 * `origin/HEAD` would differ from whatever branch `git init` itself just created — not handled, and not
 * expected to come up for a `forge init` invocation, which runs before any such remote is normally
 * added).
 */
async function detectRealTrunkBranch(dir: string): Promise<string | undefined> {
  const result = await execa('git', ['symbolic-ref', '--short', 'HEAD'], {
    cwd: dir,
    reject: false,
  });
  if (result.exitCode !== 0) return undefined;
  const branch = result.stdout.trim();
  return branch === '' ? undefined : branch;
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
  // one thing that keeps `--overlay` from *looking* like it worked. See `SPEC-QUESTIONS.md` Q103.
  if (options.overlay !== undefined && options.overlay.length > 0) {
    throw new ForgeError('USR-002', { flag: '--overlay', value: options.overlay.join(',') });
  }

  const resolvedDir = path.resolve(dir);
  if (isAlreadyInitialized(resolvedDir)) {
    // `03` §3.3's own idempotency rule: "re-running init on an existing project MUST detect it and
    // switch to upgrade semantics." Read narrowly and honestly: `runUpgrade` (`@forge/cli/upgrade`,
    // M6 C7) is a real, heavier seven-step *version-migration* procedure (manifest version compare,
    // schema migrations, a full `.forge`/`docs/forge` backup, `forge doctor`) keyed on an actual
    // version delta — invoking that whole pipeline just because `--name`/no flags were passed again
    // to `init` would be surprising (a bare re-`init` is not a version bump event) and would need a
    // well-formed `.forge/manifest.yaml` this function has no reason to require. The one real,
    // load-bearing piece of "upgrade semantics" a bare re-`init` genuinely needs is upgrade's own step
    // 5 — regenerate the regenerable directories, now for real going through the identical hash-drift
    // conflict resolution `runUpgrade` itself uses (`writeRegenerableContent`, extended by this piece)
    // — so that is what runs here. Everything else `init`'s own wizard would otherwise redo (name,
    // level, platform selection, `FORGE.md`, `config.yaml`, the docs skeleton, git) is deliberately
    // left untouched: none of it is in `03` §3.3's own "regenerable" file-tree list, and blindly
    // re-deriving it would risk silently discarding real project-specific answers a human already
    // gave. See `SPEC-QUESTIONS.md`.
    const target = new ProjectPaths(resolvedDir);
    const conflictOptions: ConflictHandlingOptions = {
      ...(options.onConflict !== undefined ? { mode: options.onConflict } : {}),
      ...(deps.conflictInput !== undefined ? { input: deps.conflictInput } : {}),
      ...(deps.conflictOutput !== undefined ? { output: deps.conflictOutput } : {}),
    };
    const files = await writeRegenerableContent(target, deps.modulesDir, conflictOptions);
    // Not part of `writeRegenerableContent`'s regenerable set (`config.yaml` is hand-owned), so it is
    // merged separately, and only ever *adds* missing `models.tiers` keys — see `backfillTierMap`.
    const { reports: modelTiers, notes: modelTierNotes } = await backfillTierMap(
      target,
      deps.candidateAdapters,
    );
    return { kind: 'reinitialized', projectRoot: resolvedDir, files, modelTiers, modelTierNotes };
  }

  const ideaContent = await readIdeaFile(options);

  await mkdir(resolvedDir, { recursive: true });
  const target = new ProjectPaths(resolvedDir);

  const { level, reasoning } = resolveInitLevel(options);
  const { primary, fallback } = await selectPlatform(resolvedDir, options, deps);

  // Primary first, then the fallback when it is a different adapter: both are written so a run that
  // falls back does not hit RUN-078 on its very first step. Each map is vetted against that adapter's
  // own `listModels()`; whatever cannot be vetted is left unmapped and reported (never guessed).
  const tierAdapters =
    fallback === undefined || fallback.id === primary.id ? [primary] : [primary, fallback];
  const tierModels = new Map<string, TierModelMap>();
  const modelTiers: TierMapReport[] = [];
  for (const adapter of tierAdapters) {
    const derivation = await deriveTierMap(adapter);
    tierModels.set(adapter.id, derivation.offered);
    modelTiers.push(reportFresh(adapter.id, derivation));
  }

  const builtConfig = buildForgeConfig({
    options,
    level,
    platformId: primary.id,
    fallbackPlatformId: fallback?.id,
    tierModels,
  });

  await ensureGit(resolvedDir, options);
  // `specs/22` M17 P9, `18` §18.3's own "`vcs.trunk`" paragraph: proposed from the real branch this
  // repository is actually on, not left at `buildForgeConfig`'s own schema-default guess, whenever
  // there is a real git repository to ask at all (`detectRealTrunkBranch`'s own doc comment has the
  // full account of what this does and does not cover).
  const realTrunk = await detectRealTrunkBranch(resolvedDir);
  const config =
    realTrunk === undefined
      ? builtConfig
      : { ...builtConfig, vcs: { ...builtConfig.vcs, trunk: realTrunk } };

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
    modelTiers,
  };
}
