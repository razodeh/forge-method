/**
 * Runs once in the main vitest process, before and after the whole suite.
 *
 * The pinned gitconfig (and, post-v1.0 `specs/22` M17, the pinned cache directory) live here rather
 * than in `test/setup.ts` because a setup file runs inside each pool fork, and vitest terminates those
 * forks — so a `process.on('exit')` cleanup registered there never fires. Measured: `$TMPDIR` gained
 * thirteen `forge-gitconfig-*` directories per run while the code carried a comment claiming it
 * cleaned up after itself.
 *
 * @see specs/21 §21.1
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let gitConfigDir: string | undefined;
let cacheDir: string | undefined;

export function setup(): void {
  gitConfigDir = mkdtempSync(path.join(tmpdir(), 'forge-gitconfig-'));
  const configPath = path.join(gitConfigDir, 'config');
  writeFileSync(configPath, '');
  // Read by `test/setup.ts` in every fork. Pinning identity alone does not make git deterministic:
  // the developer's and the runner's gitconfig still supply `core.autocrlf`, `init.defaultBranch`,
  // `commit.gpgsign` and `core.hooksPath`, each of which changes the bytes a test produces or hangs
  // it outright.
  process.env['FORGE_TEST_GITCONFIG'] = configPath;

  // `@forge/vcs`'s own `systemCacheDirRoot` (`PLAN-M17.md` P8) reads the real `XDG_CACHE_HOME` — a
  // disposable directory here, read by `test/setup.ts` in every fork, is what keeps every test in the
  // whole workspace that creates a real lane or integration worktree (directly, or indirectly through
  // `@forge/engine`'s facades, `forge debug`, or `forge parity`'s own reference scratch tree) from
  // ever reaching the real one on the machine running the suite, with no change needed to any
  // individual test file: the same "pin it once, centrally" reasoning the gitconfig above already
  // follows, for the identical "many unrelated call sites, one real ambient location" shape.
  cacheDir = mkdtempSync(path.join(tmpdir(), 'forge-test-cache-'));
  process.env['FORGE_TEST_CACHE_DIR'] = cacheDir;
}

export function teardown(): void {
  if (gitConfigDir !== undefined) {
    rmSync(gitConfigDir, { recursive: true, force: true });
    gitConfigDir = undefined;
  }
  if (cacheDir !== undefined) {
    rmSync(cacheDir, { recursive: true, force: true });
    cacheDir = undefined;
  }
}
