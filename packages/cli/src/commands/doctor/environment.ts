/**
 * `forge doctor`'s own environment checks — `03` §3.7's "Node version; pnpm/npm presence", "`git` ≥
 * 2.30..., user.name/user.email configured", "Platform adapters:... auth working, model access",
 * "Disk space for worktrees" bullets.
 *
 * @see specs/03 §3.7
 */
import { statfs } from 'node:fs/promises';

import { execa } from 'execa';
import type { PlatformAdapter } from '@forge/adapter-kit/types';

import { MIN_NODE_VERSION, isSupportedNodeVersion } from '../../entry/node-version.ts';
import type { CheckSeverity, DoctorCheck } from './types.ts';

function check(
  id: string,
  ok: boolean,
  severity: CheckSeverity,
  message: string,
  fix?: string,
): DoctorCheck {
  return fix === undefined ? { id, ok, severity, message } : { id, ok, severity, message, fix };
}

export function checkNodeVersion(processVersion: string): DoctorCheck {
  const ok = isSupportedNodeVersion(processVersion);
  return check(
    'node-version',
    ok,
    'hard',
    ok
      ? `Node ${processVersion} satisfies the ${MIN_NODE_VERSION} floor.`
      : `Node ${processVersion} is older than the required ${MIN_NODE_VERSION}.`,
    ok ? undefined : 'Install a supported Node.js version (nvm install --lts, or nvm use 20).',
  );
}

/** `pnpm`/`npm` presence — `03` §3.7's own "(informational)" qualifier: a real, honest check (a real
 * `execa` version probe, not a fabricated pass), but never `hard` — a missing package manager on
 * `PATH` does not itself block anything `forge` does. */
export async function checkPackageManager(name: 'pnpm' | 'npm'): Promise<DoctorCheck> {
  try {
    const { stdout } = await execa(name, ['--version']);
    return check(
      'package-manager-' + name,
      true,
      'warning',
      `${name} ${stdout.trim()} found on PATH.`,
    );
  } catch {
    return check(
      'package-manager-' + name,
      false,
      'warning',
      `${name} was not found on PATH.`,
      `Install ${name}, or ignore if this project only ever uses the other package manager.`,
    );
  }
}

const MIN_GIT_VERSION: readonly [number, number, number] = [2, 30, 0];

function parseGitVersion(stdout: string): readonly [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(stdout);
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor), Number(patch)];
}

function versionGte(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}

/** `git` ≥ 2.30 (`06` §6.4's own worktree-support floor) — real version parsing/comparison, not just
 * presence: `@forge/vcs`'s own `assertGitAvailable` only confirms `git --version` succeeds and `cwd`
 * is a repo, it never reads the reported version at all. */
export async function checkGitVersion(): Promise<DoctorCheck> {
  let stdout: string;
  try {
    ({ stdout } = await execa('git', ['--version']));
  } catch {
    return check(
      'git-version',
      false,
      'hard',
      'git was not found on PATH.',
      'Install git (https://git-scm.com/downloads) and ensure it is on PATH.',
    );
  }
  const parsed = parseGitVersion(stdout);
  const ok = parsed !== undefined && versionGte(parsed, MIN_GIT_VERSION);
  return check(
    'git-version',
    ok,
    'hard',
    ok
      ? `${stdout.trim()} satisfies the 2.30 worktree-support floor.`
      : `${stdout.trim()} is older than the required 2.30.`,
    ok ? undefined : 'Upgrade git to 2.30 or newer.',
  );
}

async function gitConfigValue(key: string, cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execa('git', ['config', '--get', key], { cwd });
    return stdout.trim() === '' ? undefined : stdout.trim();
  } catch {
    return undefined;
  }
}

/** `git`'s own `user.name`/`user.email` — a real, checkable prerequisite for the real commits `06`
 * §6.4's own lane lifecycle makes, but a `warning`, not `hard`: a read-only `forge status`/`forge
 * doctor` invocation itself needs neither. */
export async function checkGitIdentity(projectRoot: string): Promise<DoctorCheck> {
  const [name, email] = await Promise.all([
    gitConfigValue('user.name', projectRoot),
    gitConfigValue('user.email', projectRoot),
  ]);
  const ok = name !== undefined && email !== undefined;
  return check(
    'git-identity',
    ok,
    'warning',
    ok
      ? `git identity configured: ${name} <${email}>.`
      : 'git user.name/user.email are not configured.',
    ok ? undefined : 'Run `git config user.name "..."` and `git config user.email "..."`.',
  );
}

/** Platform adapter preflight (`07` §7.2's own `PlatformAdapter.preflight`, M4) — real, but only ever
 * over a real, caller-injected adapter: no concrete `PlatformAdapter` implementation exists anywhere
 * in this codebase yet (the same gap `@forge/cli/init`'s own `RunInitDeps.candidateAdapters` and
 * `@forge/cli/commands/run`'s own `buildRunEngineContext` already document), so `forge doctor` cannot
 * discover one to check on its own — an absent adapter is reported honestly as its own real finding,
 * never silently skipped or faked as passing. */
export async function checkPlatformAdapter(
  adapter: PlatformAdapter | undefined,
  projectRoot: string,
  env: Readonly<Record<string, string>>,
): Promise<DoctorCheck> {
  if (adapter === undefined) {
    return check(
      'platform-adapter',
      false,
      'warning',
      'No platform adapter is configured for this doctor run.',
      'Pass a real, concrete PlatformAdapter to forge doctor once one is available.',
    );
  }
  const result = await adapter.preflight({ projectRoot, env });
  const detail = result.issues.map((issue) => issue.message).join('; ');
  return check(
    'platform-adapter',
    result.ok,
    'hard',
    result.ok
      ? `Platform adapter preflight passed${result.version === undefined ? '' : ` (version ${result.version})`}.`
      : `Platform adapter preflight failed: ${detail}.`,
    result.ok ? undefined : (result.issues[0]?.remedy ?? 'Fix the platform adapter, then retry.'),
  );
}

/** Real free disk space at `projectRoot`'s own filesystem, via a real `fs.statfs` call — `03` §3.7's
 * own "disk space for worktrees" bullet. `MIN_FREE_BYTES` (500 MB) is a real, concrete, but
 * necessarily somewhat arbitrary floor (`03` gives no exact number): enough headroom for a handful of
 * real lane worktrees (`06` §6.4), the same "pick a defensible concrete value when the spec gives
 * none" precedent `@forge/engine/plan`'s own `DEFAULT_LIMITS` already sets. Windows' own inode/path-
 * length constraints (`03`'s own same bullet) are a real, separate, platform-specific check this
 * function does not attempt — genuinely no real mechanism for it exists anywhere in this codebase,
 * and none is invented here; see `SPEC-QUESTIONS.md` for the record. */
const MIN_FREE_BYTES = 500 * 1024 * 1024;

export async function checkDiskSpace(projectRoot: string): Promise<DoctorCheck> {
  try {
    const stats = await statfs(projectRoot);
    const freeBytes = stats.bavail * stats.bsize;
    const ok = freeBytes >= MIN_FREE_BYTES;
    const freeMb = Math.floor(freeBytes / (1024 * 1024));
    return check(
      'disk-space',
      ok,
      'warning',
      ok
        ? `${String(freeMb)} MB free.`
        : `Only ${String(freeMb)} MB free — real lane worktrees need real space.`,
      ok ? undefined : 'Free up disk space before running workflows that create lane worktrees.',
    );
  } catch (cause) {
    return check(
      'disk-space',
      false,
      'warning',
      `Could not read real disk space: ${cause instanceof Error ? cause.message : String(cause)}.`,
    );
  }
}
