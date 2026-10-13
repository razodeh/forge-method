/**
 * `forge doctor --fix` — `applyDoctorFix`'s own per-check remediation, and `runDoctor({ fix: true })`'s
 * own real re-run-after-fix contract.
 *
 * @see specs/03 §3.7
 * @see specs/21 E10
 * @see PLAN-M11.md P14
 */
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { worktreesRootFor } from '@forge/vcs';
import { afterEach, describe, expect, it } from 'vitest';

import { applyDoctorFix } from '../../../src/commands/doctor/fix.ts';
import { runDoctor } from '../../../src/commands/doctor/run-doctor.ts';
import { acquireRunLock, readRunLock } from '../../../src/commands/run/lock.ts';
import { cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

async function spawnDeadPid(): Promise<number> {
  const child = spawn('node', ['-e', 'process.exit(0)']);
  const pid = child.pid;
  if (pid === undefined) throw new Error('child process failed to spawn (no pid)');
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
}

/** The exact lane-worktree-root `createLaneWorktree` itself would compute for `projectDir` — this
 * file builds its own orphans with a raw `git worktree add` (never `createLaneWorktree`), so it needs
 * the identical real, post-`PLAN-M17.md`-P8 location independently. */
async function expectedWorktreesRoot(projectDir: string): Promise<string> {
  return worktreesRootFor(await realpath(projectDir));
}

describe('applyDoctorFix — stale-lock', () => {
  it('clears a real lock naming a genuinely dead pid, and reports applied:true', async () => {
    const project = await createTestProject();
    const deadPid = await spawnDeadPid();
    await acquireRunLock(project.paths, {
      pid: deadPid,
      host: 'h',
      runId: 'r',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    const outcome = await applyDoctorFix(
      { id: 'stale-lock', ok: false, severity: 'warning', message: 'stale' },
      project.paths,
      project.dir,
    );
    expect(outcome.applied).toBe(true);
    expect(await readRunLock(project.paths)).toBeUndefined();
  });

  it('never touches a lock held by a real, live process', async () => {
    const project = await createTestProject();
    await acquireRunLock(project.paths, {
      pid: process.pid,
      host: 'h',
      runId: 'r',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    const outcome = await applyDoctorFix(
      { id: 'stale-lock', ok: true, severity: 'warning', message: 'live' },
      project.paths,
      project.dir,
    );
    expect(outcome.applied).toBe(false);
    expect(await readRunLock(project.paths)).toBeDefined();
  });
});

describe('applyDoctorFix — orphaned-worktrees', () => {
  it('removes a real orphaned lane worktree, deliberately leaving its own lane branch in place, and reports applied:true', async () => {
    const project = await createTestProject();
    const target = path.join(await expectedWorktreesRoot(project.dir), 'orphan');
    await execa('git', ['worktree', 'add', '-b', 'forge/run-1/implement-abcd1234', target], {
      cwd: project.dir,
    });

    const outcome = await applyDoctorFix(
      { id: 'orphaned-worktrees', ok: false, severity: 'warning', message: '1 orphan' },
      project.paths,
      project.dir,
    );
    expect(outcome.applied).toBe(true);

    const { stdout: worktrees } = await execa('git', ['worktree', 'list', '--porcelain'], {
      cwd: project.dir,
    });
    expect(worktrees).not.toContain('implement-abcd1234');
    // The branch is deliberately left in place — deleting it automatically would risk destroying real,
    // unmerged commits a human has not yet reviewed (see `fix.ts`'s own doc comment).
    const { stdout: branches } = await execa(
      'git',
      ['branch', '--list', 'forge/run-1/implement-abcd1234'],
      { cwd: project.dir },
    );
    expect(branches.trim()).not.toBe('');
  });

  it('removes every real orphan it can, and reports the count even when several exist', async () => {
    const project = await createTestProject();
    const worktreesRoot = await expectedWorktreesRoot(project.dir);
    await execa(
      'git',
      [
        'worktree',
        'add',
        '-b',
        'forge/run-1/implement-aaaa1111',
        path.join(worktreesRoot, 'orphan-a'),
      ],
      { cwd: project.dir },
    );
    await execa(
      'git',
      [
        'worktree',
        'add',
        '-b',
        'forge/run-1/implement-bbbb2222',
        path.join(worktreesRoot, 'orphan-b'),
      ],
      { cwd: project.dir },
    );

    const outcome = await applyDoctorFix(
      { id: 'orphaned-worktrees', ok: false, severity: 'warning', message: '2 orphans' },
      project.paths,
      project.dir,
    );
    expect(outcome.applied).toBe(true);
    expect(outcome.message).toContain('Removed 2 real orphaned lane worktree(s)');

    const { stdout: worktrees } = await execa('git', ['worktree', 'list', '--porcelain'], {
      cwd: project.dir,
    });
    expect(worktrees).not.toContain('orphan-a');
    expect(worktrees).not.toContain('orphan-b');
  });

  // `it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)` — the identical,
  // already-established pattern `packages/vcs/test/git.test.ts`/`claims.test.ts`/`overlay-fetch.test.ts`
  // and `packages/extensions/test/install/manifest.test.ts` already use for a chmod-induced permission
  // test: root ignores POSIX permission bits entirely (a real, common CI-container default), so this
  // test would otherwise silently observe both removals succeed and fail on its own assertion for a
  // reason that has nothing to do with the code under test; Windows has no equivalent chmod semantics.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'isolates one orphan’s own real removal failure from the rest, reporting a real partial success',
    async () => {
      const project = await createTestProject();
      const worktreesRoot = await expectedWorktreesRoot(project.dir);
      await execa(
        'git',
        [
          'worktree',
          'add',
          '-b',
          'forge/run-1/implement-aaaa1111',
          path.join(worktreesRoot, 'orphan-a'),
        ],
        { cwd: project.dir },
      );
      await execa(
        'git',
        [
          'worktree',
          'add',
          '-b',
          'forge/run-1/implement-bbbb2222',
          path.join(worktreesRoot, 'orphan-b'),
        ],
        { cwd: project.dir },
      );
      // A real, reproducible removal failure for the *second* orphan only: its own worktrees-root parent
      // directory is made unwritable, so both `git worktree remove` (which must rewrite the shared
      // administrative dir) and the raw-`rm` fallback genuinely fail with a real `EACCES` — the exact
      // shape of failure `removeOrphanedWorktreeOnly` has no special handling for, proving the *other*
      // orphan is still removed and the failure is reported honestly rather than silently swallowed or
      // propagated out of the whole fix pass.
      const orphanBPath = path.join(worktreesRoot, 'orphan-b');
      await chmod(orphanBPath, 0o000);

      try {
        const outcome = await applyDoctorFix(
          { id: 'orphaned-worktrees', ok: false, severity: 'warning', message: '2 orphans' },
          project.paths,
          project.dir,
        );
        expect(outcome.message).toMatch(/Removed 1 of 2/);
        expect(outcome.applied).toBe(true);

        const { stdout: worktrees } = await execa('git', ['worktree', 'list', '--porcelain'], {
          cwd: project.dir,
        });
        expect(worktrees).not.toContain('orphan-a');
        expect(worktrees).toContain('orphan-b');
      } finally {
        await chmod(orphanBPath, 0o700).catch(() => undefined);
      }
    },
  );
});

describe('applyDoctorFix — legacy-in-tree-worktrees (specs/22 M17 P8)', () => {
  it('removes a real, git-registered leftover worktree under the pre-M17 .forge/state/worktrees/, reporting applied:true', async () => {
    const project = await createTestProject();
    const legacyTarget = path.join(project.dir, '.forge', 'state', 'worktrees', 'leftover');
    await execa('git', ['worktree', 'add', '-b', 'forge/run-1/leftover', legacyTarget], {
      cwd: project.dir,
    });

    const outcome = await applyDoctorFix(
      { id: 'legacy-in-tree-worktrees', ok: false, severity: 'warning', message: '1 entry' },
      project.paths,
      project.dir,
    );
    expect(outcome.applied).toBe(true);
    expect(outcome.message).toContain('Removed 1 real legacy in-tree worktree entry');

    const checked = await applyDoctorFix(
      { id: 'legacy-in-tree-worktrees', ok: true, severity: 'warning', message: 'clean' },
      project.paths,
      project.dir,
    );
    // Re-checking a clean project reports the honest "nothing to fix" outcome, not a fabricated
    // repeat success.
    expect(checked.applied).toBe(false);
    expect(checked.message).toContain(
      'No real, git-registered legacy in-tree worktrees remain to fix',
    );
  });

  it('reports applied:false honestly when nothing is there to fix', async () => {
    const project = await createTestProject();
    const outcome = await applyDoctorFix(
      { id: 'legacy-in-tree-worktrees', ok: true, severity: 'warning', message: 'clean' },
      project.paths,
      project.dir,
    );
    expect(outcome.applied).toBe(false);
    expect(outcome.message).toContain(
      'No real, git-registered legacy in-tree worktrees remain to fix',
    );
  });

  it('uses git-mediated removal first (not a bare rm) for an entry that is STILL a real, git-registered worktree — the "project upgraded mid-run" case', async () => {
    const project = await createTestProject();
    const legacyTarget = path.join(project.dir, '.forge', 'state', 'worktrees', 'still-registered');
    // Simulates a worktree a pre-M17 (or pre-upgrade) FORGE engine created directly in-tree, which
    // git itself still has a real administrative record for.
    await execa('git', ['worktree', 'add', '-b', 'forge/run-1/implement-abcd1234', legacyTarget], {
      cwd: project.dir,
    });

    const outcome = await applyDoctorFix(
      { id: 'legacy-in-tree-worktrees', ok: false, severity: 'warning', message: '1 entry' },
      project.paths,
      project.dir,
    );
    expect(outcome.applied).toBe(true);

    // Git's own bookkeeping was genuinely reconciled, not left dangling behind a raw filesystem
    // deletion git never heard about.
    const { stdout: worktrees } = await execa('git', ['worktree', 'list', '--porcelain'], {
      cwd: project.dir,
    });
    expect(worktrees).not.toContain('still-registered');
  });

  it('CRITICAL (gauntlet critic round, M17 P8): a stray file with real content at the legacy path survives --fix completely untouched', async () => {
    const project = await createTestProject();
    // The exact repro a gauntlet critic round proved directly: a real, unrelated file with real
    // content, never a worktree, sitting at the legacy path for any ordinary reason (nothing
    // adversarial -- once this migration ships, this is the expected steady state of every stray file
    // a project happens to have there, since nothing ever creates a REAL worktree here again).
    const strayDir = path.join(project.dir, '.forge', 'state', 'worktrees', 'my-personal-notes');
    await mkdir(strayDir, { recursive: true });
    const strayFile = path.join(strayDir, 'notes.txt');
    const realContent = 'these are my real, important notes -- not a worktree\n';
    await writeFile(strayFile, realContent);

    const outcome = await applyDoctorFix(
      { id: 'legacy-in-tree-worktrees', ok: false, severity: 'warning', message: 'maybe 1 entry' },
      project.paths,
      project.dir,
    );

    // The old, buggy behaviour was `{applied:true, message:"Removed 1 real legacy in-tree worktree
    // entry."}` and the file was gone. The fix must never touch something that was never a worktree.
    expect(outcome.applied).toBe(false);
    await expect(readFile(strayFile, 'utf8')).resolves.toBe(realContent);
  });

  it('a mix of one real stray file and one real registered worktree: only the real worktree is removed, the stray file survives untouched', async () => {
    const project = await createTestProject();
    const legacyTarget = path.join(project.dir, '.forge', 'state', 'worktrees', 'real-lane');
    await execa('git', ['worktree', 'add', '-b', 'forge/run-1/real-lane', legacyTarget], {
      cwd: project.dir,
    });
    const strayFile = path.join(project.dir, '.forge', 'state', 'worktrees', 'stray.txt');
    await writeFile(strayFile, 'unrelated real content\n');

    const outcome = await applyDoctorFix(
      { id: 'legacy-in-tree-worktrees', ok: false, severity: 'warning', message: '1 entry' },
      project.paths,
      project.dir,
    );

    expect(outcome.applied).toBe(true);
    expect(outcome.message).toContain('Removed 1 real legacy in-tree worktree entry');
    const { stdout: worktrees } = await execa('git', ['worktree', 'list', '--porcelain'], {
      cwd: project.dir,
    });
    expect(worktrees).not.toContain('real-lane');
    await expect(readFile(strayFile, 'utf8')).resolves.toBe('unrelated real content\n');
  });
});

describe("applyDoctorFix — the orphan-removal fallback's own unscoped `git worktree prune` can collaterally de-register an unrelated, still-real worktree, a gauntlet critic round (specs/22 M17 P8)", () => {
  it('detects and loudly reports the real collateral loss, without ever touching the collateral worktree’s own real directory or content', async () => {
    const project = await createTestProject();

    // Worktree A: the real target of this fix -- under the legacy path, with its OWN `.git` pointer
    // file already gone, a stand-in for "a permission hiccup, an unmounted path, nothing adversarial"
    // (confirmed directly, outside this suite: `git worktree remove -f -f` refuses to touch a worktree
    // in exactly this state -- "fatal: validation failed, cannot remove working tree: ... .git does
    // not exist" -- which is exactly what forces `removeOrphanedWorktreeOnly` down into its own
    // raw-filesystem-plus-`prune` fallback in the first place).
    const legacyTarget = path.join(project.dir, '.forge', 'state', 'worktrees', 'orphan-a');
    await execa('git', ['worktree', 'add', '-b', 'forge/run-1/orphan-a', legacyTarget], {
      cwd: project.dir,
    });
    await rm(path.join(legacyTarget, '.git'));

    // Worktree B: a completely unrelated, still-real worktree -- never at the legacy path, never a
    // target of this fix at all (`fixLegacyInTreeWorktrees` only ever looks under the legacy root; see
    // its own doc comment). Standing in for any other real, in-progress lane worktree elsewhere in the
    // same repository. Its own `.git` pointer is ALSO gone, for the identical "transiently unreadable"
    // reason -- this is what the fallback's own unscoped `git worktree prune` call finds and silently
    // de-registers, purely as a side effect of fixing A, never because B was ever a target itself.
    const collateralTarget = path.join(await expectedWorktreesRoot(project.dir), 'real-lane-b');
    await execa('git', ['worktree', 'add', '-b', 'forge/run-1/real-lane-b', collateralTarget], {
      cwd: project.dir,
    });
    const collateralFile = path.join(collateralTarget, 'real-work.txt');
    await writeFile(collateralFile, 'real, in-progress work -- not safe to touch\n');
    await rm(path.join(collateralTarget, '.git'));

    const outcome = await applyDoctorFix(
      { id: 'legacy-in-tree-worktrees', ok: false, severity: 'warning', message: '1 entry' },
      project.paths,
      project.dir,
    );

    // A itself is still genuinely fixed -- the collateral damage to a different worktree is not a
    // reason to report the fix that actually happened as a failure.
    expect(outcome.applied).toBe(true);

    // The collateral loss is real -- confirmed independently below -- but it is DETECTED and loudly
    // reported, never silently absorbed into an ordinary success message.
    expect(outcome.message).toContain('WARNING');
    expect(outcome.message).toContain(collateralTarget);

    // B's own real directory and content are completely untouched on disk -- only git's OWN
    // registration for it is gone, never the real file a human (or another lane) actually wrote; this
    // is the whole reason detection, not prevention, is the most this fallback can honestly do (see
    // `removeOrphanedWorktreeOnly`'s own doc comment).
    await expect(readFile(collateralFile, 'utf8')).resolves.toBe(
      'real, in-progress work -- not safe to touch\n',
    );

    // Confirmed independently: git itself really did lose its own registration for B -- otherwise this
    // test would not actually be exercising the collateral-loss path it claims to.
    const { stdout: worktreesAfter } = await execa('git', ['worktree', 'list', '--porcelain'], {
      cwd: project.dir,
    });
    expect(worktreesAfter).not.toContain(collateralTarget);
  });
});

describe('applyDoctorFix — no safe automatic fix', () => {
  it('reports applied:false with an honest message for a check with no automatic remedy', async () => {
    const project = await createTestProject();
    const outcome = await applyDoctorFix(
      {
        id: 'dangling-lane-branches',
        ok: false,
        severity: 'warning',
        message: '1 dangling branch',
        fix: 'Run `git branch -D <branch>` for each, once you have confirmed its work already merged.',
      },
      project.paths,
      project.dir,
    );
    expect(outcome.applied).toBe(false);
    expect(outcome.message).toContain('git branch -D');
  });

  it('reports applied:false honestly even for a check with no remedy text of its own', async () => {
    const project = await createTestProject();
    const outcome = await applyDoctorFix(
      { id: 'secret-references', ok: false, severity: 'warning', message: 'unresolved' },
      project.paths,
      project.dir,
    );
    expect(outcome.applied).toBe(false);
    expect(outcome.message.length).toBeGreaterThan(0);
  });
});

describe('runDoctor({ fix: true })', () => {
  it('applies real fixes, then re-runs every check so the returned report reflects the post-fix state', async () => {
    const project = await createTestProject();
    const deadPid = await spawnDeadPid();
    await acquireRunLock(project.paths, {
      pid: deadPid,
      host: 'h',
      runId: 'r',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    await execa(
      'git',
      [
        'worktree',
        'add',
        '-b',
        'forge/run-1/implement-abcd1234',
        path.join(await expectedWorktreesRoot(project.dir), 'orphan'),
      ],
      { cwd: project.dir },
    );

    const before = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
    });
    expect(before.checks.find((c) => c.id === 'stale-lock')?.ok).toBe(false);
    expect(before.checks.find((c) => c.id === 'orphaned-worktrees')?.ok).toBe(false);

    const fixed = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
      fix: true,
    });

    expect(fixed.fixes).toBeDefined();
    const staleLockFix = fixed.fixes?.find((f) => f.id === 'stale-lock');
    const orphanFix = fixed.fixes?.find((f) => f.id === 'orphaned-worktrees');
    expect(staleLockFix?.applied).toBe(true);
    expect(orphanFix?.applied).toBe(true);

    expect(fixed.checks.find((c) => c.id === 'stale-lock')?.ok).toBe(true);
    expect(fixed.checks.find((c) => c.id === 'orphaned-worktrees')?.ok).toBe(true);
    // The worktree's own lane branch is deliberately left in place (never auto-deleted — see
    // `fix.ts`'s own doc comment), so it now, correctly, shows up as a real, newly-dangling branch:
    // an honest side effect of the safe fix, not a bug in it.
    expect(fixed.checks.find((c) => c.id === 'dangling-lane-branches')?.ok).toBe(false);

    // Re-running plain `forge doctor` afterward confirms the fix is real and durable, not merely a
    // one-shot in-memory result.
    const after = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
    });
    expect(after.checks.find((c) => c.id === 'stale-lock')?.ok).toBe(true);
    expect(after.checks.find((c) => c.id === 'orphaned-worktrees')?.ok).toBe(true);
  });

  it('leaves a check with no safe automatic fix genuinely failing, and reports that honestly', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, '.forge/config.yaml'));

    const fixed = await runDoctor({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      env: {},
      processVersion: process.version,
      fix: true,
    });

    expect(fixed.ok).toBe(false);
    const configCheck = fixed.checks.find((c) => c.id === 'config-validity');
    expect(configCheck?.ok).toBe(false);
    const configFix = fixed.fixes?.find((f) => f.id === 'config-validity');
    expect(configFix?.applied).toBe(false);
  });
});
