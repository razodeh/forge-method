/**
 * Runs once in the main vitest process, before and after the whole suite.
 *
 * The pinned gitconfig lives here rather than in `test/setup.ts` because a setup file runs inside
 * each pool fork, and vitest terminates those forks — so a `process.on('exit')` cleanup registered
 * there never fires. Measured: `$TMPDIR` gained thirteen `forge-gitconfig-*` directories per run
 * while the code carried a comment claiming it cleaned up after itself.
 *
 * @see specs/21 §21.1
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let gitConfigDir: string | undefined;

export function setup(): void {
  gitConfigDir = mkdtempSync(path.join(tmpdir(), 'forge-gitconfig-'));
  const configPath = path.join(gitConfigDir, 'config');
  writeFileSync(configPath, '');
  // Read by `test/setup.ts` in every fork. Pinning identity alone does not make git deterministic:
  // the developer's and the runner's gitconfig still supply `core.autocrlf`, `init.defaultBranch`,
  // `commit.gpgsign` and `core.hooksPath`, each of which changes the bytes a test produces or hangs
  // it outright.
  process.env['FORGE_TEST_GITCONFIG'] = configPath;
}

export function teardown(): void {
  if (gitConfigDir === undefined) return;
  rmSync(gitConfigDir, { recursive: true, force: true });
  gitConfigDir = undefined;
}
