/**
 * `runDoctor` — `03` §3.7's own full checklist, assembled into one real `DoctorReport`.
 *
 * @see specs/03 §3.7
 * @see PLAN-M6.md C6
 */
import { renderCause } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import type { ForgeConfig } from '@forge/schemas/config';

import {
  checkDiskSpace,
  checkGitIdentity,
  checkGitVersion,
  checkNodeVersion,
  checkPackageManager,
  checkPlatformAdapter,
} from './environment.ts';
import {
  checkDanglingLaneBranches,
  checkOrphanedWorktrees,
  checkStaleLock,
} from './locks-and-worktrees.ts';
import { checkConfigValidity, checkKbLint, checkManifest, checkSpecGraph } from './project.ts';
import { checkDiagrams } from './diagrams.ts';
import { checkSecretReferences } from './secrets.ts';
import type { DoctorCheck, DoctorReport } from './types.ts';

export interface DoctorOptions {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
  /** No concrete `PlatformAdapter` exists anywhere in this codebase yet — injected, optional, the
   * identical stance every other real caller in this milestone already takes. */
  readonly adapter?: PlatformAdapter;
  /** A real environment snapshot, injected rather than read ambiently (`QUALITY-BAR.md` R10) — the
   * identical stance `SessionRequest.env` already takes for the identical reason. */
  readonly env: Readonly<Record<string, string>>;
  /** `process.version`, injected — a real host fact R10 forbids reading ambiently inside business
   * logic; the one real caller allowed to read it is the CLI entry point itself. */
  readonly processVersion: string;
}

/** One real check's own id, paired with its promise — needed so a check that throws instead of
 * returning (a genuinely unhealthy project: malformed Mermaid source, a corrupted lock file, a git
 * failure) still degrades to its own single failed `DoctorCheck` rather than aborting every other
 * check's own real result via a bare `Promise.all` rejection. */
interface NamedCheck {
  readonly id: string;
  readonly promise: Promise<DoctorCheck>;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const { paths, projectRoot, config, adapter, env, processVersion } = options;
  const kbRoot = config.paths.kb;
  const specsRoot = config.paths.specs;

  const named: readonly NamedCheck[] = [
    { id: 'node-version', promise: Promise.resolve(checkNodeVersion(processVersion)) },
    { id: 'package-manager-pnpm', promise: checkPackageManager('pnpm') },
    { id: 'package-manager-npm', promise: checkPackageManager('npm') },
    { id: 'git-version', promise: checkGitVersion() },
    { id: 'git-identity', promise: checkGitIdentity(projectRoot) },
    { id: 'platform-adapter', promise: checkPlatformAdapter(adapter, projectRoot, env) },
    { id: 'disk-space', promise: checkDiskSpace(projectRoot) },
    { id: 'config-validity', promise: checkConfigValidity(paths) },
    { id: 'manifest-structure', promise: checkManifest(paths) },
    {
      id: 'kb-lint',
      promise: checkKbLint({ paths, kbRoot, specsRoot, level: config.project.level }),
    },
    { id: 'spec-graph', promise: checkSpecGraph({ paths, specsRoot, kbRoot }) },
    { id: 'stale-lock', promise: checkStaleLock(paths) },
    { id: 'orphaned-worktrees', promise: checkOrphanedWorktrees(projectRoot) },
    { id: 'dangling-lane-branches', promise: checkDanglingLaneBranches(projectRoot) },
    { id: 'diagrams', promise: checkDiagrams(paths, kbRoot) },
    { id: 'secret-references', promise: checkSecretReferences(paths, env) },
  ];

  const checks: DoctorCheck[] = await Promise.all(
    named.map(async ({ id, promise }): Promise<DoctorCheck> => {
      try {
        return await promise;
      } catch (cause: unknown) {
        // `renderCause` only ever returns `undefined` for a literal `throw undefined` — not a real
        // shape any check in this module produces — so no fallback branch is added here to cover.
        return {
          id,
          ok: false,
          severity: 'hard',
          message: `Check crashed instead of completing: ${String(renderCause(cause))}.`,
        };
      }
    }),
  );

  const ok = checks.every((c) => c.ok || c.severity !== 'hard');
  return { v: 1, ok, checks };
}
