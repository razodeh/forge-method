/**
 * `forge uninstall` — `03` §3.2.1: "Remove `.forge/` and (optionally) `docs/forge/`, with
 * confirmation and a backup tarball."
 *
 * "Backup tarball" read narrowly (a literal `.tar`/`.tar.gz`) would need a new dependency — no `tar`
 * library exists anywhere in this workspace today, and none of this milestone's other pieces needed
 * one either. A real, working backup is what the spec's own remedy for "I ran this by mistake"
 * actually requires; a plain recursive directory copy (Node's own built-in `fs.cp`, no new
 * dependency) into a timestamped sibling directory satisfies that exactly as well as an archive
 * would, so that is what this does instead of adding a dependency for one command. See
 * `SPEC-QUESTIONS.md`.
 *
 * "With confirmation": `--yes` is `03` §3.2's own accept-all-defaults flag, the identical
 * non-interactive-equivalent contract `runInit` already uses for `03` §3.1's own "every interactive
 * flow MUST have a --yes-able non-interactive equivalent" rule — refused without it, exactly like
 * `runInit`.
 *
 * @see specs/03 §3.2.1
 * @see specs/03 §3.1
 */
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';

import { SYSTEM_CLOCK, ForgeError, pathExists, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';

export interface UninstallOptions {
  readonly yes: boolean;
  readonly removeDocs?: boolean;
  readonly clock?: Clock;
}

export interface UninstallResult {
  readonly backupDir: string;
  readonly removed: readonly string[];
}

function timestampSlug(clock: Clock): string {
  return clock.now().replace(/[:.]/g, '-');
}

export async function uninstall(
  target: ProjectPaths,
  projectRoot: string,
  options: UninstallOptions,
): Promise<UninstallResult> {
  if (!options.yes) {
    throw new ForgeError('USR-002', { flag: '--yes', value: '' });
  }

  const clock = options.clock ?? SYSTEM_CLOCK;
  const relPaths = ['.forge', ...(options.removeDocs === true ? ['docs/forge'] : [])] as const;

  const existing: string[] = [];
  for (const relPath of relPaths) {
    if (await pathExists(target.resolveWithin(relPath))) existing.push(relPath);
  }

  const backupDir = path.join(projectRoot, `..`, `forge-uninstall-backup-${timestampSlug(clock)}`);
  for (const relPath of existing) {
    const source = target.resolveWithin(relPath);
    await cp(source, path.join(backupDir, relPath), { recursive: true });
  }

  for (const relPath of existing) {
    await rm(target.resolveWithin(relPath), { recursive: true, force: true });
  }

  return { backupDir, removed: existing };
}
