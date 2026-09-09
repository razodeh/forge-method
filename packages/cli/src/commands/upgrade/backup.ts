/**
 * `createBackup` — `03` §3.4 step 3's own "back up to `.forge/backups/<timestamp>.tar.gz`, retaining
 * the last 5" step.
 *
 * "Tarball" read narrowly (a literal `.tar`/`.tar.gz`) would need a new dependency — no `tar` library
 * exists anywhere in this workspace today. `forge uninstall` (`03` §3.2.1) already resolved the
 * identical tension the same way: a plain recursive directory copy (Node's own built-in `fs.cp`, no
 * new dependency) into a timestamped directory satisfies "a real, restorable backup" exactly as well
 * as an archive would. This reuses that precedent rather than reintroducing the same dependency
 * question a second time.
 *
 * @see specs/03 §3.4
 * @see packages/cli/src/commands/uninstall.ts
 */
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';

import type { Clock } from '@forge/core';
import {
  listDirEntriesSorted,
  pathExists,
  type AbsolutePath,
  type ProjectPaths,
} from '@forge/core/fs';

const RETAIN_BACKUPS = 5;

/** Everything real backups exclude: `.forge/state/` (`06` §6.4's own runtime state, never a project
 * asset to restore) and `.forge/backups/` itself (a backup of backups is never useful and would let
 * `pruneOldBackups`' own retention count silently include itself). */
const EXCLUDED_TOP_LEVEL = new Set(['state', 'backups']);

function timestampSlug(clock: Clock): string {
  return clock.now().replace(/[:.]/g, '-');
}

/** Deletes every backup past the real, retained last 5 (oldest first) — `03` §3.4 step 3's own
 * "retaining the last 5" rule. Backup directory names are `clock.now()`-derived ISO-8601-shaped
 * timestamps with `:`/`.` replaced by `-`, which sort lexicographically in the same order as
 * chronologically, so a plain string sort is a real, correct oldest-first ordering. */
async function pruneOldBackups(paths: ProjectPaths): Promise<void> {
  const backupsRoot = paths.resolveWithin('.forge/backups');
  if (!(await pathExists(backupsRoot))) return;
  const entries = await listDirEntriesSorted(backupsRoot);
  const names = entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
  const excess = names.length - RETAIN_BACKUPS;
  if (excess <= 0) return;
  for (const name of names.slice(0, excess)) {
    await rm(path.join(backupsRoot, name), { recursive: true, force: true });
  }
}

/** Copies every real top-level entry under `.forge/` (except `state/`/`backups/` themselves) into a
 * fresh, real `.forge/backups/<timestamp>/` directory, plus — at its own, real `specsRoot`-shaped
 * subpath, so it can never collide with anything under `.forge/` — every real spec-tree document
 * `applyArtifactMigrations` is about to mutate.
 *
 * A critic round caught the original version backing up only `.forge/` while the one step that
 * actually rewrites content on disk (`03` §3.4 step 4, per-artifact schema migrations) mutates
 * `specsRoot`, entirely outside `.forge/` — a "backup" step that protected the one tree the rest of
 * the pipeline does not touch, and nothing at all for the one it does. Backing up `specsRoot` here,
 * before `applyArtifactMigrations` ever runs, closes that gap directly.
 *
 * Prunes down to the last 5 real backups (including the one just made) once both copies are done.
 * Returns the real, project-root-relative path of the backup just created. */
export async function createBackup(
  paths: ProjectPaths,
  projectRoot: string,
  clock: Clock,
  specsRoot: string,
): Promise<string> {
  const relPath = `.forge/backups/${timestampSlug(clock)}`;
  const backupDir = paths.resolveWithin(relPath);
  const forgeRoot = path.join(projectRoot, '.forge');
  const entries = await listDirEntriesSorted(forgeRoot as AbsolutePath);
  for (const entry of entries) {
    if (EXCLUDED_TOP_LEVEL.has(entry.name)) continue;
    await cp(path.join(forgeRoot, entry.name), path.join(backupDir, entry.name), {
      recursive: true,
    });
  }

  const specsSource = path.join(projectRoot, specsRoot);
  if (await pathExists(specsSource as AbsolutePath)) {
    await cp(specsSource, path.join(backupDir, specsRoot), { recursive: true });
  }

  await pruneOldBackups(paths);
  return relPath;
}
