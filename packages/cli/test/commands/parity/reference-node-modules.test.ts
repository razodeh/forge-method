/**
 * `linkReferenceNodeModules` — restores, via an explicit symlink, the `node_modules` reachability
 * `specs/13` F-TEST-9 and `process/SPEC-QUESTIONS.md` Q314 both document as a real regression M17 P8
 * caused by moving the reference's scratch worktree outside the project tree. Real subprocesses,
 * real filesystem symlinks and a real `git worktree remove` throughout (`QUALITY-BAR.md` R6): no
 * mock anywhere in this file.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q314
 */
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { isForgeError } from '@forge/core/errors';

import { linkReferenceNodeModules } from '../../../src/commands/parity/reference-node-modules.ts';

const execFileAsync = promisify(execFile);

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

describe('linkReferenceNodeModules: the ordinary no-op (specs/22, Q314 follow-up)', () => {
  it('does nothing, and raises nothing, when the project has no top-level node_modules at all', async () => {
    const projectRoot = await freshDir('forge-q314-noop-project-');
    const worktreeRoot = await freshDir('forge-q314-noop-worktree-');

    await linkReferenceNodeModules(projectRoot, worktreeRoot);

    expect(await exists(path.join(worktreeRoot, 'node_modules'))).toBe(false);
  });
});

describe('linkReferenceNodeModules: real module resolution through the symlink (specs/22, Q314 follow-up)', () => {
  it('lets a reference-side CommonJS require() resolve a real third-party package, from a path nested deep inside the scratch tree', async () => {
    const projectRoot = await freshDir('forge-q314-cjs-project-');
    const pkgDir = path.join(projectRoot, 'node_modules', 'forge-q314-fake-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'forge-q314-fake-pkg', version: '1.0.0', main: 'index.js' }),
      'utf8',
    );
    await writeFile(
      path.join(pkgDir, 'index.js'),
      'module.exports = "hello-from-forge-q314-fake-pkg";',
      'utf8',
    );

    const worktreeRoot = await freshDir('forge-q314-cjs-worktree-');
    await linkReferenceNodeModules(projectRoot, worktreeRoot);

    // Nested arbitrarily deep -- the real scratch-worktree shape (a checked-out copy of the project's
    // own tracked directory structure), proving this is ordinary directory walk-up, not a one-level
    // special case.
    const nestedDir = path.join(worktreeRoot, 'src', 'deep', 'nested');
    await mkdir(nestedDir, { recursive: true });
    const { stdout } = await execFileAsync(
      process.execPath,
      ['-e', 'console.log(require("forge-q314-fake-pkg"))'],
      { cwd: nestedDir },
    );

    expect(stdout.trim()).toBe('hello-from-forge-q314-fake-pkg');
  });

  it('lets a reference-side ES module import() resolve a real third-party package too -- NODE_PATH cannot do this, which is why it was rejected (Q314)', async () => {
    const projectRoot = await freshDir('forge-q314-esm-project-');
    const pkgDir = path.join(projectRoot, 'node_modules', 'forge-q314-fake-esm-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'forge-q314-fake-esm-pkg',
        version: '1.0.0',
        main: 'index.mjs',
        type: 'module',
      }),
      'utf8',
    );
    await writeFile(
      path.join(pkgDir, 'index.mjs'),
      'export const msg = "hello-from-forge-q314-fake-esm-pkg";',
      'utf8',
    );

    const worktreeRoot = await freshDir('forge-q314-esm-worktree-');
    await linkReferenceNodeModules(projectRoot, worktreeRoot);

    const nestedDir = path.join(worktreeRoot, 'src', 'deep', 'nested');
    await mkdir(nestedDir, { recursive: true });
    const scriptPath = path.join(nestedDir, 'import-test.mjs');
    await writeFile(
      scriptPath,
      'import { msg } from "forge-q314-fake-esm-pkg";\nconsole.log(msg);',
      'utf8',
    );
    const { stdout } = await execFileAsync(process.execPath, [scriptPath]);

    expect(stdout.trim()).toBe('hello-from-forge-q314-fake-esm-pkg');
  });

  it("links only the project ROOT's own top-level node_modules -- a workspace package's own nested one is not reachable, matching the old, accidental mechanism's real reach", async () => {
    const projectRoot = await freshDir('forge-q314-scope-project-');
    // A nested package directory with its OWN node_modules -- never linked by this mechanism.
    const nestedPkgNodeModules = path.join(
      projectRoot,
      'packages',
      'foo',
      'node_modules',
      'nested-only-pkg',
    );
    await mkdir(nestedPkgNodeModules, { recursive: true });
    await writeFile(
      path.join(nestedPkgNodeModules, 'package.json'),
      JSON.stringify({ name: 'nested-only-pkg', version: '1.0.0', main: 'index.js' }),
      'utf8',
    );
    await writeFile(
      path.join(nestedPkgNodeModules, 'index.js'),
      'module.exports = "nope";',
      'utf8',
    );
    // No top-level node_modules at the project root at all.

    const worktreeRoot = await freshDir('forge-q314-scope-worktree-');
    await linkReferenceNodeModules(projectRoot, worktreeRoot);

    expect(await exists(path.join(worktreeRoot, 'node_modules'))).toBe(false);
  });
});

describe('linkReferenceNodeModules: removal safety (specs/22, Q314 follow-up)', () => {
  it('a plain recursive fs.rm of the scratch worktree unlinks the symlink without touching the real node_modules it points at', async () => {
    const projectRoot = await freshDir('forge-q314-rmsafe-project-');
    const pkgDir = path.join(projectRoot, 'node_modules', 'forge-q314-keepme-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(path.join(pkgDir, 'marker.txt'), 'keepme', 'utf8');

    const worktreeRoot = await freshDir('forge-q314-rmsafe-worktree-');
    await linkReferenceNodeModules(projectRoot, worktreeRoot);

    await rm(worktreeRoot, { recursive: true, force: true });

    expect(await exists(worktreeRoot)).toBe(false);
    expect(
      await exists(path.join(projectRoot, 'node_modules', 'forge-q314-keepme-pkg', 'marker.txt')),
    ).toBe(true);
  });

  it('a real `git worktree remove -f -f` unlinks the symlink without touching the real node_modules it points at', async () => {
    const projectRoot = await freshDir('forge-q314-gitrmsafe-project-');
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: projectRoot });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: projectRoot });
    await execa('git', ['config', 'user.name', 't'], { cwd: projectRoot });
    await writeFile(path.join(projectRoot, '.gitkeep'), '', 'utf8');
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: projectRoot });

    const pkgDir = path.join(projectRoot, 'node_modules', 'forge-q314-keepme-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(path.join(pkgDir, 'marker.txt'), 'keepme', 'utf8');

    const worktreeRoot = path.join(await freshDir('forge-q314-gitrmsafe-worktree-parent-'), 'wt');
    await execa('git', ['worktree', 'add', '-b', 'forge-q314-test-branch', worktreeRoot, 'HEAD'], {
      cwd: projectRoot,
    });

    await linkReferenceNodeModules(projectRoot, worktreeRoot);
    expect(await exists(path.join(worktreeRoot, 'node_modules'))).toBe(true);

    await execa('git', ['worktree', 'remove', '-f', '-f', worktreeRoot], { cwd: projectRoot });

    expect(await exists(worktreeRoot)).toBe(false);
    expect(
      await exists(path.join(projectRoot, 'node_modules', 'forge-q314-keepme-pkg', 'marker.txt')),
    ).toBe(true);
  });
});

describe('linkReferenceNodeModules: a project that tracks its own node_modules in git (specs/22, Q314 follow-up, critic round 1)', () => {
  it('is a no-op (never RUN-163, never replaces the real content) when the checkout already populated node_modules', async () => {
    const projectRoot = await freshDir('forge-q314-tracked-project-');
    await mkdir(path.join(projectRoot, 'node_modules'), { recursive: true });
    const worktreeRoot = await freshDir('forge-q314-tracked-worktree-');
    // Simulates what `createLaneWorktree`'s own ordinary checkout already did, BEFORE this function
    // ever runs, for a project that intentionally tracks `node_modules` in git (`specs/20` §20.2's
    // deny list names it as its own, separate bullet from "anything in .gitignore"): a real,
    // already-populated directory at the destination, not a symlink.
    const realPkgDir = path.join(worktreeRoot, 'node_modules', 'forge-q314-tracked-pkg');
    await mkdir(realPkgDir, { recursive: true });
    await writeFile(
      path.join(realPkgDir, 'index.js'),
      'module.exports = "tracked-for-real";',
      'utf8',
    );

    await linkReferenceNodeModules(projectRoot, worktreeRoot);

    // Still the real, checked-out directory -- never replaced by (or merged into) a symlink.
    const destinationStat = await lstat(path.join(worktreeRoot, 'node_modules'));
    expect(destinationStat.isSymbolicLink()).toBe(false);
    expect(destinationStat.isDirectory()).toBe(true);
    await expect(readFile(path.join(realPkgDir, 'index.js'), 'utf8')).resolves.toBe(
      'module.exports = "tracked-for-real";',
    );
  });
});

describe('linkReferenceNodeModules: a genuine failure (RUN-163) (specs/22, Q314 follow-up)', () => {
  it('fails typed (RUN-163) when the symlink cannot be created for a reason other than the destination already existing (a read-only worktree root)', async () => {
    const projectRoot = await freshDir('forge-q314-fail-project-');
    await mkdir(path.join(projectRoot, 'node_modules'), { recursive: true });
    const worktreeRoot = await freshDir('forge-q314-fail-worktree-');
    // A read-only worktree root makes the real `symlink()` call itself genuinely fail (EACCES, not
    // the benign EEXIST the no-op above covers) -- confirmed by direct execution (not assumed) that
    // this reliably fails under the current, non-root test user (id -u 501 locally).
    await chmod(worktreeRoot, 0o555);
    try {
      await expect(linkReferenceNodeModules(projectRoot, worktreeRoot)).rejects.toSatisfy(
        (error: unknown) => isForgeError(error) && error.code === 'RUN-163',
      );
    } finally {
      await chmod(worktreeRoot, 0o755);
    }
  });

  it('fails typed (RUN-163), never a silent no-op, when a plain FILE occupies the destination (EEXIST, but not a directory -- critic round 2)', async () => {
    const projectRoot = await freshDir('forge-q314-fail-file-project-');
    await mkdir(path.join(projectRoot, 'node_modules'), { recursive: true });
    const worktreeRoot = await freshDir('forge-q314-fail-file-worktree-');
    // A plain file at the destination raises EEXIST too, exactly like a real tracked directory does
    // -- but a file could never have made module resolution work, so the no-op's own stated
    // rationale does not apply here, and this must still raise RUN-163 (this is the real scenario a
    // critic found the bare-EEXIST version of this function would have wrongly swallowed).
    await writeFile(
      path.join(worktreeRoot, 'node_modules'),
      'a stray file, not a real checkout',
      'utf8',
    );

    await expect(linkReferenceNodeModules(projectRoot, worktreeRoot)).rejects.toSatisfy(
      (error: unknown) => isForgeError(error) && error.code === 'RUN-163',
    );
    // Untouched: still the stray file, never silently adopted or replaced.
    const destinationStat = await lstat(path.join(worktreeRoot, 'node_modules'));
    expect(destinationStat.isDirectory()).toBe(false);
  });

  it('fails typed (RUN-163), never a silent no-op, when a SYMLINK (even a broken one) occupies the destination (EEXIST, but lstat reports isSymbolicLink, never isDirectory, regardless of target)', async () => {
    const projectRoot = await freshDir('forge-q314-fail-symlink-project-');
    await mkdir(path.join(projectRoot, 'node_modules'), { recursive: true });
    const worktreeRoot = await freshDir('forge-q314-fail-symlink-worktree-');
    // A tracked `node_modules` checked in as a symlink, not a real directory -- confirmed directly
    // that `lstat` on a symlink itself reports `isSymbolicLink()`, never `isDirectory()`, regardless
    // of what it points to (even a target that does not exist at all, as here), so this still raises
    // RUN-163 -- the clearer attribution being preferable to a silent no-op this function cannot
    // actually verify works.
    await symlink('/path/does/not/exist/at/all', path.join(worktreeRoot, 'node_modules'));

    await expect(linkReferenceNodeModules(projectRoot, worktreeRoot)).rejects.toSatisfy(
      (error: unknown) => isForgeError(error) && error.code === 'RUN-163',
    );
  });

  it('fails typed (RUN-163), never a silent no-op, when an EMPTY junk directory occupies the destination (EEXIST, isDirectory() true, but empty -- critic round 3)', async () => {
    const projectRoot = await freshDir('forge-q314-fail-empty-dir-project-');
    await mkdir(path.join(projectRoot, 'node_modules'), { recursive: true });
    const worktreeRoot = await freshDir('forge-q314-fail-empty-dir-worktree-');
    // An empty directory at the destination satisfies `isDirectory()` identically to a real, tracked
    // checkout, but makes module resolution there no truer than a stray file does -- confirmed by two
    // independent critics via direct construction that an `isDirectory()`-only guard silently no-ops
    // here, exactly the "confusing, unattributed crash deep inside the reference run" scenario this
    // function exists to avoid. This is the one realistic shape the EACCES/file/symlink tests above
    // do not cover.
    await mkdir(path.join(worktreeRoot, 'node_modules'), { recursive: true });

    await expect(linkReferenceNodeModules(projectRoot, worktreeRoot)).rejects.toSatisfy(
      (error: unknown) => isForgeError(error) && error.code === 'RUN-163',
    );
    // Untouched: still the empty directory, never silently adopted or replaced.
    const destinationStat = await lstat(path.join(worktreeRoot, 'node_modules'));
    expect(destinationStat.isDirectory()).toBe(true);
    expect(destinationStat.isSymbolicLink()).toBe(false);
  });
});
