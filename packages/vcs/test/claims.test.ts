/**
 * `diffLaneChanges`/`enforceClaim`/`applySharedPathStrategy` — `PLAN-M5.md` P4's own Checks section,
 * verbatim, against real git repositories.
 *
 * @see specs/06 §6.7
 * @see specs/18 §18.3
 * @see PLAN-M5.md P4
 */
import fsp, { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applySharedPathStrategy, diffLaneChanges, enforceClaim } from '../src/claims.ts';
import { VcsError } from '../src/errors.ts';
import { createLaneWorktree } from '../src/lanes.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-claims-'));
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function commitAll(cwd: string, message: string): Promise<string> {
  await execa('git', ['add', '-A'], { cwd });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd });
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

describe('diffLaneChanges', () => {
  it('reports added, modified, and deleted files relative to baseSha', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'kept.txt'), 'kept');
    await writeFile(path.join(cwd, 'doomed.txt'), 'doomed');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'kept.txt'), 'modified');
    await writeFile(path.join(handle.path, 'new.txt'), 'new');
    await rm(path.join(handle.path, 'doomed.txt'));
    await commitAll(handle.path, 'lane work');

    const changed = await diffLaneChanges(handle, baseSha);

    expect([...changed].sort()).toEqual(['doomed.txt', 'kept.txt', 'new.txt']);
  });

  it('returns empty for a lane with no changes relative to its own integration base', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });

    expect(await diffLaneChanges(handle, baseSha)).toEqual([]);
  });

  it('accepts a symbolic ref, not just a literal sha, as baseSha', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'seed');
    const { stdout: currentBranchRaw } = await execa('git', ['branch', '--show-current'], { cwd });
    const currentBranch = currentBranchRaw.trim();
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: currentBranch,
    });
    await writeFile(path.join(handle.path, 'b.txt'), 'b');
    await commitAll(handle.path, 'lane work');

    expect(await diffLaneChanges(handle, currentBranch)).toEqual(['b.txt']);
  });

  it('rejects a flag-shaped baseSha with a VcsError rather than letting it reach git diff unresolved', async () => {
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: 'HEAD',
    });

    await expect(diffLaneChanges(handle, '-q')).rejects.toBeInstanceOf(VcsError);
  });

  it('reports a rename as an independent deletion of the old path and addition of the new one, not one collapsed entry', async () => {
    const cwd = await createTempRepo();
    await mkdir(path.join(cwd, 'docs'), { recursive: true });
    await writeFile(
      path.join(cwd, 'docs', 'secret_plan.md'),
      "a fairly long file so git's similarity heuristic sees this as a rename rather than an unrelated delete+add pair\n",
    );
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await mkdir(path.join(handle.path, 'src'), { recursive: true });
    await execa('git', ['mv', 'docs/secret_plan.md', 'src/secret_plan.md'], { cwd: handle.path });
    await commitAll(handle.path, 'lane work');

    const changed = await diffLaneChanges(handle, baseSha);

    expect([...changed].sort()).toEqual(['docs/secret_plan.md', 'src/secret_plan.md']);
  });

  it('reports a file with a non-ASCII name intact, not C-quoted/escaped', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'café.txt'), 'accented filename');
    await commitAll(handle.path, 'lane work');

    expect(await diffLaneChanges(handle, baseSha)).toEqual(['café.txt']);
  });

  it('includes an uncommitted, untracked file rather than silently ignoring it', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    // Never committed — the exact shape of an untracked .env file (20 §20.2 point 2) that must not
    // silently pass through unreported.
    await writeFile(path.join(handle.path, '.env'), 'SECRET=1');

    expect(await diffLaneChanges(handle, baseSha)).toEqual(['.env']);
  });

  it('includes an uncommitted but staged change to a tracked file', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'tracked.txt'), 'original');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'tracked.txt'), 'staged but not committed');
    await execa('git', ['add', 'tracked.txt'], { cwd: handle.path });

    expect(await diffLaneChanges(handle, baseSha)).toEqual(['tracked.txt']);
  });

  it('is safe to call again once the caller has committed the first revert: the reverted file stops appearing', async () => {
    const cwd = await createTempRepo();
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src', 'a.ts'), 'in claim');
    await writeFile(path.join(cwd, 'shared.txt'), 'original');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'shared.txt'), 'lane modified this out of claim');
    await commitAll(handle.path, 'lane work');

    const first = await enforceClaim(handle, baseSha, ['src/**'], 'strict');
    expect(first.outOfClaim).toEqual(['shared.txt']);

    // `enforceClaim`'s own revert is deliberately left uncommitted (a caller decides when/how to
    // commit, `SPEC-QUESTIONS.md` Q66's own design point 4) -- `runLaneLifecycle` (`steps.ts`), the
    // one real production caller, always commits it immediately afterward, in the same function call,
    // before anything could call `enforceClaim` a second time. This call mirrors that real sequence.
    await commitAll(handle.path, 'revert out-of-claim changes');
    const second = await enforceClaim(handle, baseSha, ['src/**'], 'strict');
    expect(second.outOfClaim).toEqual([]);
    expect(second.reverted).toEqual([]);
  });

  // M17 P15 round 2 (gauntlet critics): a REVISION of this file's own prior claim, not a new concern.
  // Before this piece, this test (just above) called `enforceClaim` TWICE with no commit between the
  // calls and asserted the second call saw nothing -- true only because `diffLaneChanges` was
  // worktree-relative alone, so `enforceClaim`'s own uncommitted `git checkout` revert (which touches
  // the worktree AND stages it, but never commits) looked, to that narrower check, exactly like nothing
  // had ever been wrong. Once `diffLaneChanges` also asks `HEAD` directly (this file's own "history-
  // relative detection" tests), that is no longer true: `HEAD` genuinely still differs from `baseSha`
  // at `shared.txt` until a REAL commit moves it, so a second, uncommitted-interval call to
  // `enforceClaim` now correctly reports the violation again -- there is no real caller this breaks
  // (`enforceClaim` has exactly one production call site, `runLaneLifecycle`, `steps.ts:516`, which
  // always commits the revert in the same function call before anything else could call this again),
  // and treating the earlier version's unconditional "a second call sees nothing" claim as a timeless
  // promise this fix had to preserve would have meant leaving the BLOCKING gap open instead.
  it('without a commit in between, calling it again on the SAME uncommitted revert still reports the violation (HEAD has not moved)', async () => {
    const cwd = await createTempRepo();
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src', 'a.ts'), 'in claim');
    await writeFile(path.join(cwd, 'shared.txt'), 'original');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'shared.txt'), 'lane modified this out of claim');
    await commitAll(handle.path, 'lane work');

    const first = await enforceClaim(handle, baseSha, ['src/**'], 'strict');
    expect(first.outOfClaim).toEqual(['shared.txt']);
    // No commit here, deliberately.
    const second = await enforceClaim(handle, baseSha, ['src/**'], 'strict');
    expect(second.outOfClaim).toEqual(['shared.txt']);
    // Still reverted a second time -- `git checkout <baseSha> -- shared.txt` is itself idempotent, so
    // this is harmless busywork, never a destructive double-revert, and the file's own content is
    // identical either way.
    expect(second.reverted).toEqual(['shared.txt']);
    await expect(readFile(path.join(handle.path, 'shared.txt'), 'utf8')).resolves.toBe('original');
  });

  // M17 P15 round 2 (gauntlet critics, both independently): the one-ref worktree diff plus
  // untracked-files listing above is blind to anything whose trace lives ONLY in committed history,
  // never in the worktree a `git diff <oneRef>` actually compares against. A session with `exec` can
  // trivially arrange that split -- commit an out-of-claim file for real, then make the worktree look
  // clean again without a second commit (the simplest case below), or move the branch ref to a new
  // commit via raw plumbing that never touches the worktree or index at all (the second case). Either
  // way `git show HEAD:<path>` still has the content; the worktree-only check never asks `HEAD`.
  describe('history-relative detection (specs/22 M17 P15)', () => {
    it('reports a path whose committed HEAD diverges from baseSha even when a later, uncommitted worktree edit makes it look clean again', async () => {
      const cwd = await createTempRepo();
      await mkdir(path.join(cwd, 'src'), { recursive: true });
      await writeFile(path.join(cwd, 'src', 'a.ts'), 'in claim');
      const baseSha = await commitAll(cwd, 'seed');
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: baseSha,
      });
      // A real self-commit of an out-of-claim file -- not a hypothetical.
      await writeFile(path.join(handle.path, 'tampered.txt'), 'bad content');
      await commitAll(handle.path, 'self-commit: tampered');
      // Then the worktree is edited back to absent, WITHOUT a second commit: HEAD (the commit a
      // later rebase actually replays) still carries the tampered blob; only the live worktree is
      // clean. `git show HEAD:tampered.txt` below is the fact a worktree-only diff cannot see.
      await rm(path.join(handle.path, 'tampered.txt'));
      const headTampered = await execa('git', ['show', 'HEAD:tampered.txt'], { cwd: handle.path });
      expect(headTampered.stdout).toBe('bad content');

      const changed = await diffLaneChanges(handle, baseSha);

      expect(changed).toContain('tampered.txt');
    });

    it('reports a path a commit added via raw plumbing (hash-object/mktree/commit-tree/update-ref), even though neither the worktree nor the index was ever touched', async () => {
      const cwd = await createTempRepo();
      await mkdir(path.join(cwd, 'src'), { recursive: true });
      await writeFile(path.join(cwd, 'src', 'a.ts'), 'in claim');
      const baseSha = await commitAll(cwd, 'seed');
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: baseSha,
      });
      const headBefore = (
        await execa('git', ['rev-parse', 'HEAD'], { cwd: handle.path })
      ).stdout.trim();
      const { stdout: blob } = await execa('git', ['hash-object', '-w', '--stdin'], {
        cwd: handle.path,
        input: 'plumbing bad content',
      });
      const { stdout: baseTree } = await execa('git', ['rev-parse', 'HEAD^{tree}'], {
        cwd: handle.path,
      });
      const { stdout: existingEntries } = await execa('git', ['ls-tree', baseTree.trim()], {
        cwd: handle.path,
      });
      const { stdout: newTree } = await execa('git', ['mktree'], {
        cwd: handle.path,
        input: `${existingEntries}\n100644 blob ${blob.trim()}\tplumbed.txt\n`,
      });
      const { stdout: newCommit } = await execa(
        'git',
        ['commit-tree', newTree.trim(), '-p', headBefore, '-m', 'plumbing tamper'],
        { cwd: handle.path },
      );
      // No `git add`, no `git commit` -- only the branch ref moves. Confirmed: `plumbed.txt` is not on
      // disk at all, yet HEAD (now the plumbed commit) has it.
      await execa('git', ['update-ref', 'HEAD', newCommit.trim()], { cwd: handle.path });
      await expect(access(path.join(handle.path, 'plumbed.txt'))).rejects.toThrow();
      const headPlumbed = await execa('git', ['show', 'HEAD:plumbed.txt'], { cwd: handle.path });
      expect(headPlumbed.stdout).toBe('plumbing bad content');

      const changed = await diffLaneChanges(handle, baseSha);

      expect(changed).toContain('plumbed.txt');
    });

    // SPEC-QUESTIONS.md Q320: this round's own disclosed gap. The pre-existing rename test (in the
    // outer `diffLaneChanges` describe, above) commits its own rename and leaves the worktree clean
    // afterward, so the UNAFFECTED one-ref leg already reports both the old and new path on its own
    // -- a mutation removing `--no-renames` from the two-ref leg alone leaves that test green,
    // because the one-ref leg masks the gap completely. This test closes it by forcing detection
    // through the two-ref leg ALONE: the rename is edited in the same commit (one changed line out
    // of five keeps git's own similarity heuristic comfortably above its rename threshold), and the
    // worktree is then moved back to its exact baseSha state without a second commit -- so the
    // one-ref leg and the untracked-files listing both see nothing at all for this path, and only
    // the two-ref historical diff can report it. Without `--no-renames` on that leg (the mutation
    // this test exists to kill), git's own default rename detection collapses the two-ref diff to
    // the new path alone (this module's own doc comment above), and the old, out-of-claim path
    // vanishes from `changed` entirely.
    it('reports BOTH the old and new path of a same-commit rename+edit that only the two-ref leg can see (its own --no-renames)', async () => {
      const cwd = await createTempRepo();
      await mkdir(path.join(cwd, 'docs'), { recursive: true });
      const original =
        'line one of a fairly long file\n' +
        'line two of a fairly long file\n' +
        'line three of a fairly long file\n' +
        'line four of a fairly long file\n' +
        'line five of a fairly long file\n';
      await writeFile(path.join(cwd, 'docs', 'secret_plan.md'), original);
      const baseSha = await commitAll(cwd, 'seed');
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: baseSha,
      });

      // Self-commit: rename AND edit in the same commit.
      await mkdir(path.join(handle.path, 'src'), { recursive: true });
      await execa('git', ['mv', 'docs/secret_plan.md', 'src/secret_plan.md'], {
        cwd: handle.path,
      });
      const edited = original.replace('line three of a fairly long file', 'line three TAMPERED');
      await writeFile(path.join(handle.path, 'src', 'secret_plan.md'), edited);
      await commitAll(handle.path, 'self-commit: rename + edit');

      // The worktree is then moved back to its EXACT baseSha state, without a second commit: HEAD
      // (what a later rebase actually replays) still carries the rename+edit commit, but the live
      // worktree reads byte-for-byte identical to baseSha, so neither the one-ref leg nor the
      // untracked-files listing has anything to report for this path.
      await execa('git', ['mv', 'src/secret_plan.md', 'docs/secret_plan.md'], {
        cwd: handle.path,
      });
      await writeFile(path.join(handle.path, 'docs', 'secret_plan.md'), original);
      // Confirmed directly, rather than assumed: the one-ref leg (the exact invocation
      // `diffLaneChanges` itself uses for it) reports nothing for this path -- `git diff <oneRef>`
      // (no second ref) compares the ref's tree against the live worktree bytes on disk directly,
      // not through the index's own stale rename bookkeeping, so it reads clean even though `git
      // status` (which does compare against the index/HEAD) would still show the pending rename.
      const { stdout: oneRefDiff } = await execa(
        'git',
        ['diff', '--no-renames', '-z', '--name-only', baseSha],
        { cwd: handle.path },
      );
      expect(oneRefDiff).toBe('');

      const changed = await diffLaneChanges(handle, baseSha);

      expect(changed).toContain('docs/secret_plan.md');
      expect(changed).toContain('src/secret_plan.md');
    });
  });
});

describe('enforceClaim', () => {
  async function setupLaneWithInClaimBaseline(): Promise<{
    cwd: string;
    baseSha: string;
    handle: Awaited<ReturnType<typeof createLaneWorktree>>;
  }> {
    const cwd = await createTempRepo();
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src', 'existing.ts'), 'original');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    return { cwd, baseSha, handle };
  }

  it('warn: reports every out-of-claim file but reverts none of them', async () => {
    const { baseSha, handle } = await setupLaneWithInClaimBaseline();
    await writeFile(path.join(handle.path, 'src', 'existing.ts'), 'in-claim change');
    await mkdir(path.join(handle.path, 'docs'), { recursive: true });
    await writeFile(path.join(handle.path, 'docs', 'readme.md'), 'out of claim');
    await commitAll(handle.path, 'lane work');

    const result = await enforceClaim(handle, baseSha, ['src/**'], 'warn');

    expect(result.outOfClaim).toEqual(['docs/readme.md']);
    expect(result.reverted).toEqual([]);
    await expect(readFile(path.join(handle.path, 'docs', 'readme.md'), 'utf8')).resolves.toBe(
      'out of claim',
    );
  });

  it('strict: reverts a modified out-of-claim file to its exact baseSha content', async () => {
    const cwd = await createTempRepo();
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src', 'a.ts'), 'in claim');
    await writeFile(path.join(cwd, 'shared.txt'), 'original shared content');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, 'shared.txt'), 'lane modified this out of claim');
    await commitAll(handle.path, 'lane work');

    const result = await enforceClaim(handle, baseSha, ['src/**'], 'strict');

    expect(result.outOfClaim).toEqual(['shared.txt']);
    expect(result.reverted).toEqual(['shared.txt']);
    await expect(readFile(path.join(handle.path, 'shared.txt'), 'utf8')).resolves.toBe(
      'original shared content',
    );
  });

  it('excluded globs are subtracted from the claim, never unioned (PLAN-M13.md P36): a broad glob cannot reach an excluded path', async () => {
    const { baseSha, handle } = await setupLaneWithInClaimBaseline();
    await mkdir(path.join(handle.path, '.github', 'workflows'), { recursive: true });
    await writeFile(path.join(handle.path, '.github', 'workflows', 'ci.yml'), 'on: push');
    await writeFile(path.join(handle.path, '.env'), 'TOKEN=x');
    await writeFile(path.join(handle.path, 'src', 'ok.ts'), 'fine');
    await commitAll(handle.path, 'lane work');

    const result = await enforceClaim(handle, baseSha, ['**'], 'strict', [
      '**/.github/**',
      '**/.env',
    ]);

    expect(result.outOfClaim).toEqual(['.env', '.github/workflows/ci.yml']);
    expect(result.reverted).toEqual(['.env', '.github/workflows/ci.yml']);
    await expect(access(path.join(handle.path, '.env'))).rejects.toThrow();
    await expect(readFile(path.join(handle.path, 'src', 'ok.ts'), 'utf8')).resolves.toBe('fine');
  });

  it('warn: an excluded path is reverted (a denial), an ordinary out-of-claim path is only reported; a modified tracked file is restored', async () => {
    const cwd = await createTempRepo();
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src', 'a.ts'), 'in claim');
    await writeFile(path.join(cwd, '.npmrc'), 'registry=https://example.test/');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await writeFile(path.join(handle.path, '.npmrc'), 'registry=https://evil.test/');
    await writeFile(path.join(handle.path, 'notes.md'), 'out of claim, not excluded');
    await commitAll(handle.path, 'lane work');

    const result = await enforceClaim(handle, baseSha, ['src/**'], 'warn', ['**/.npmrc']);

    expect(result.outOfClaim).toEqual(['.npmrc', 'notes.md']);
    expect(result.reverted).toEqual(['.npmrc']);
    await expect(readFile(path.join(handle.path, '.npmrc'), 'utf8')).resolves.toBe(
      'registry=https://example.test/',
    );
    await expect(readFile(path.join(handle.path, 'notes.md'), 'utf8')).resolves.toBe(
      'out of claim, not excluded',
    );
  });

  it('a `!` entry inside the claim globs still reads as a union member (the reason exclusions are a separate list)', async () => {
    const { baseSha, handle } = await setupLaneWithInClaimBaseline();
    await writeFile(path.join(handle.path, '.env'), 'TOKEN=x');
    await commitAll(handle.path, 'lane work');
    const result = await enforceClaim(handle, baseSha, ['**', '!.env'], 'warn');
    expect(result.outOfClaim).toEqual([]);
  });

  it('strict: removes a brand new out-of-claim file entirely, since it has no prior state to check out', async () => {
    const { baseSha, handle } = await setupLaneWithInClaimBaseline();
    await mkdir(path.join(handle.path, 'docs'), { recursive: true });
    await writeFile(path.join(handle.path, 'docs', 'new.md'), 'should be removed');
    await commitAll(handle.path, 'lane work');

    const result = await enforceClaim(handle, baseSha, ['src/**'], 'strict');

    expect(result.outOfClaim).toEqual(['docs/new.md']);
    expect(result.reverted).toEqual(['docs/new.md']);
    await expect(access(path.join(handle.path, 'docs', 'new.md'))).rejects.toThrow();
  });

  it('strict: restores a deleted out-of-claim file back to its baseSha content', async () => {
    const cwd = await createTempRepo();
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src', 'a.ts'), 'in claim');
    await writeFile(path.join(cwd, 'shared.txt'), 'must survive');
    const baseSha = await commitAll(cwd, 'seed');
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: baseSha,
    });
    await rm(path.join(handle.path, 'shared.txt'));
    await commitAll(handle.path, 'lane work');

    const result = await enforceClaim(handle, baseSha, ['src/**'], 'strict');

    expect(result.outOfClaim).toEqual(['shared.txt']);
    expect(result.reverted).toEqual(['shared.txt']);
    await expect(readFile(path.join(handle.path, 'shared.txt'), 'utf8')).resolves.toBe(
      'must survive',
    );
  });

  it('leaves in-claim files completely untouched under strict, and reports no violation at all', async () => {
    const { baseSha, handle } = await setupLaneWithInClaimBaseline();
    await writeFile(path.join(handle.path, 'src', 'existing.ts'), 'in-claim edit');
    await commitAll(handle.path, 'lane work');

    const result = await enforceClaim(handle, baseSha, ['src/**'], 'strict');

    expect(result.outOfClaim).toEqual([]);
    expect(result.reverted).toEqual([]);
    await expect(readFile(path.join(handle.path, 'src', 'existing.ts'), 'utf8')).resolves.toBe(
      'in-claim edit',
    );
  });

  it('treats a dotfile inside a claimed directory as in-claim, not a violation', async () => {
    const { baseSha, handle } = await setupLaneWithInClaimBaseline();
    await writeFile(path.join(handle.path, 'src', '.eslintrc.json'), '{}');
    await commitAll(handle.path, 'lane work');

    const result = await enforceClaim(handle, baseSha, ['src/**'], 'strict');

    expect(result.outOfClaim).toEqual([]);
    expect(result.reverted).toEqual([]);
    await expect(readFile(path.join(handle.path, 'src', '.eslintrc.json'), 'utf8')).resolves.toBe(
      '{}',
    );
  });

  // M17 P15 round 2: `enforceClaim` is only as good as `diffLaneChanges`' own detection (see that
  // describe block's own "history-relative detection" tests above) -- these two prove the REVERT side
  // completes cleanly once detection does, including the one case detection alone does not fully close:
  // a brand-new file that was never materialized in the worktree or index at all (raw plumbing), where
  // `git rm -f` has nothing on disk or in the index to match and would otherwise throw
  // `VCS-CLAIM-REVERT-FAILED` on a file there was never anything wrong with reverting.
  describe('history-relative detection (specs/22 M17 P15)', () => {
    it('strict: reverts a self-commit whose own later, uncommitted worktree edit had made it invisible to a worktree-only diff', async () => {
      const { baseSha, handle } = await setupLaneWithInClaimBaseline();
      await writeFile(path.join(handle.path, 'tampered.txt'), 'bad content');
      await commitAll(handle.path, 'self-commit: tampered');
      await rm(path.join(handle.path, 'tampered.txt'));

      const result = await enforceClaim(handle, baseSha, ['src/**'], 'strict');

      expect(result.outOfClaim).toEqual(['tampered.txt']);
      expect(result.reverted).toEqual(['tampered.txt']);
      await expect(access(path.join(handle.path, 'tampered.txt'))).rejects.toThrow();
      // The caller's own revert commit (enforceClaim never commits itself) then leaves HEAD's own
      // tree with no trace of it either -- the property that actually matters once this lane is
      // later rebased onto the integration branch, commit by commit.
      await commitAll(handle.path, 'revert out-of-claim changes');
      const { stdout: finalDiff } = await execa(
        'git',
        ['diff', '--no-renames', '-z', '--name-only', baseSha, 'HEAD', '--'],
        { cwd: handle.path },
      );
      expect(finalDiff.split('\0').filter((entry) => entry !== '')).not.toContain('tampered.txt');
    });

    it('strict: removes a brand-new out-of-claim file a commit introduced via raw plumbing, never materialized in the worktree or index, without VCS-CLAIM-REVERT-FAILED', async () => {
      const { baseSha, handle } = await setupLaneWithInClaimBaseline();
      const headBefore = (
        await execa('git', ['rev-parse', 'HEAD'], { cwd: handle.path })
      ).stdout.trim();
      const { stdout: blob } = await execa('git', ['hash-object', '-w', '--stdin'], {
        cwd: handle.path,
        input: 'plumbing bad content',
      });
      const { stdout: baseTree } = await execa('git', ['rev-parse', 'HEAD^{tree}'], {
        cwd: handle.path,
      });
      const { stdout: existingEntries } = await execa('git', ['ls-tree', baseTree.trim()], {
        cwd: handle.path,
      });
      const { stdout: newTree } = await execa('git', ['mktree'], {
        cwd: handle.path,
        input: `${existingEntries}\n100644 blob ${blob.trim()}\tplumbed.txt\n`,
      });
      const { stdout: newCommit } = await execa(
        'git',
        ['commit-tree', newTree.trim(), '-p', headBefore, '-m', 'plumbing tamper'],
        { cwd: handle.path },
      );
      await execa('git', ['update-ref', 'HEAD', newCommit.trim()], { cwd: handle.path });

      const result = await enforceClaim(handle, baseSha, ['src/**'], 'strict');

      expect(result.outOfClaim).toEqual(['plumbed.txt']);
      expect(result.reverted).toEqual(['plumbed.txt']);
      await commitAll(handle.path, 'revert out-of-claim changes');
      const { stdout: finalDiff } = await execa(
        'git',
        ['diff', '--no-renames', '-z', '--name-only', baseSha, 'HEAD', '--'],
        { cwd: handle.path },
      );
      expect(finalDiff.split('\0').filter((entry) => entry !== '')).not.toContain('plumbed.txt');
    });

    // SPEC-QUESTIONS.md Q320: the `enforceClaim`-level consequence of the gap the matching
    // `diffLaneChanges` test above closes. The rename moves an out-of-claim file INTO the claimed
    // directory, edited in the same commit, then the worktree is moved back to its exact baseSha
    // state without a second commit -- so only the two-ref historical leg can see the old path at
    // all. With `--no-renames` present on that leg (the real, shipped behaviour), the old path
    // correctly surfaces as out-of-claim and gets reverted. Without it (the mutation this test
    // exists to kill), git's own default rename detection collapses the historical diff to the new,
    // in-claim path alone: the old path never appears in `changed`, `outOfClaim` comes back empty,
    // and nothing is reverted -- a complete, silent bypass of claim enforcement.
    it("strict: still reverts a same-commit rename+edit's own out-of-claim old path, even though a worktree-only check would see nothing (two-ref leg's own --no-renames)", async () => {
      const cwd = await createTempRepo();
      await mkdir(path.join(cwd, 'docs'), { recursive: true });
      const original =
        'line one of a fairly long file\n' +
        'line two of a fairly long file\n' +
        'line three of a fairly long file\n' +
        'line four of a fairly long file\n' +
        'line five of a fairly long file\n';
      await writeFile(path.join(cwd, 'docs', 'secret_plan.md'), original);
      const baseSha = await commitAll(cwd, 'seed');
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: baseSha,
      });

      await mkdir(path.join(handle.path, 'src'), { recursive: true });
      await execa('git', ['mv', 'docs/secret_plan.md', 'src/secret_plan.md'], {
        cwd: handle.path,
      });
      const edited = original.replace('line three of a fairly long file', 'line three TAMPERED');
      await writeFile(path.join(handle.path, 'src', 'secret_plan.md'), edited);
      await commitAll(handle.path, 'self-commit: rename + edit');

      await execa('git', ['mv', 'src/secret_plan.md', 'docs/secret_plan.md'], {
        cwd: handle.path,
      });
      await writeFile(path.join(handle.path, 'docs', 'secret_plan.md'), original);
      // See the matching `diffLaneChanges` test's own comment above: this is the exact invocation
      // the one-ref leg uses, confirming it reports nothing for this path (a bare `git status`
      // would still show the pending index-level rename, which is not what either leg reads).
      const { stdout: oneRefDiff } = await execa(
        'git',
        ['diff', '--no-renames', '-z', '--name-only', baseSha],
        { cwd: handle.path },
      );
      expect(oneRefDiff).toBe('');

      const result = await enforceClaim(handle, baseSha, ['src/**'], 'strict');

      expect(result.outOfClaim).toEqual(['docs/secret_plan.md']);
      expect(result.reverted).toEqual(['docs/secret_plan.md']);
    });
  });

  // POSIX permission bits only, and never as root — see `packages/vcs/test/git.test.ts`'s identical
  // precedent for why: chmod 0o555 has no Windows ACL equivalent that blocks git's own unlink the
  // same way, and root bypasses the permission check entirely.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'strict: reverts every file it can even when one fails, and the thrown error names both what failed and what still succeeded',
    async () => {
      const { baseSha, handle } = await setupLaneWithInClaimBaseline();
      await mkdir(path.join(handle.path, 'locked'), { recursive: true });
      await writeFile(path.join(handle.path, 'aaa.txt'), 'aaa');
      await writeFile(path.join(handle.path, 'locked', 'bbb.txt'), 'bbb');
      await writeFile(path.join(handle.path, 'ccc.txt'), 'ccc');
      await commitAll(handle.path, 'lane work');
      // A read-only parent directory blocks git from unlinking the file inside it (confirmed
      // empirically: `git rm -f` fails with "Permission denied" for exactly this file, while
      // sibling files in writable locations succeed), without needing any test-double or mock.
      await chmod(path.join(handle.path, 'locked'), 0o555);

      try {
        let caught: unknown;
        try {
          await enforceClaim(handle, baseSha, ['src/**'], 'strict');
        } catch (error) {
          caught = error;
        }

        if (!(caught instanceof VcsError)) {
          throw new Error(`expected enforceClaim to reject with a VcsError, got ${String(caught)}`);
        }
        expect(caught.code).toBe('VCS-CLAIM-REVERT-FAILED');
        expect(caught.message).toContain('locked/bbb.txt');
        expect(caught.message).toContain('aaa.txt');
        expect(caught.message).toContain('ccc.txt');
        await expect(access(path.join(handle.path, 'aaa.txt'))).rejects.toThrow();
        await expect(access(path.join(handle.path, 'ccc.txt'))).rejects.toThrow();
        await expect(readFile(path.join(handle.path, 'locked', 'bbb.txt'), 'utf8')).resolves.toBe(
          'bbb',
        );
      } finally {
        await chmod(path.join(handle.path, 'locked'), 0o755);
      }
    },
  );

  // POSIX permission bits only, and never as root — see `packages/vcs/test/git.test.ts`'s identical
  // precedent for why: chmod 0o555 has no Windows ACL equivalent that blocks git's own unlink the
  // same way, and root bypasses the permission check entirely.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'strict: the thrown error reports "(none)" reverted when every out-of-claim file fails',
    async () => {
      const { baseSha, handle } = await setupLaneWithInClaimBaseline();
      await mkdir(path.join(handle.path, 'locked'), { recursive: true });
      await writeFile(path.join(handle.path, 'locked', 'aaa.txt'), 'aaa');
      await writeFile(path.join(handle.path, 'locked', 'bbb.txt'), 'bbb');
      await commitAll(handle.path, 'lane work');
      await chmod(path.join(handle.path, 'locked'), 0o555);

      try {
        let caught: unknown;
        try {
          await enforceClaim(handle, baseSha, ['src/**'], 'strict');
        } catch (error) {
          caught = error;
        }

        if (!(caught instanceof VcsError)) {
          throw new Error(`expected enforceClaim to reject with a VcsError, got ${String(caught)}`);
        }
        expect(caught.message).toContain('(none)');
      } finally {
        await chmod(path.join(handle.path, 'locked'), 0o755);
      }
    },
  );
});

describe('applySharedPathStrategy', () => {
  describe('serialize', () => {
    it('is a no-op: makes no change to the lane worktree at all', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });

      await applySharedPathStrategy(handle, { glob: 'CHANGELOG.md', strategy: 'serialize' });

      const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: handle.path });
      expect(stdout).toBe('');
    });
  });

  describe('append-only', () => {
    it('creates .gitattributes with the union merge line when none exists yet', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });

      await applySharedPathStrategy(handle, { glob: 'CHANGELOG.md', strategy: 'append-only' });

      await expect(readFile(path.join(handle.path, '.gitattributes'), 'utf8')).resolves.toBe(
        'CHANGELOG.md merge=union\n',
      );
    });

    it('appends to an existing .gitattributes without disturbing its other lines', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });
      await writeFile(path.join(handle.path, '.gitattributes'), '*.bin binary\n');

      await applySharedPathStrategy(handle, { glob: 'CHANGELOG.md', strategy: 'append-only' });

      await expect(readFile(path.join(handle.path, '.gitattributes'), 'utf8')).resolves.toBe(
        '*.bin binary\nCHANGELOG.md merge=union\n',
      );
    });

    it('adds a trailing newline before appending when the existing file does not already end in one', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });
      await writeFile(path.join(handle.path, '.gitattributes'), '*.bin binary');

      await applySharedPathStrategy(handle, { glob: 'CHANGELOG.md', strategy: 'append-only' });

      await expect(readFile(path.join(handle.path, '.gitattributes'), 'utf8')).resolves.toBe(
        '*.bin binary\nCHANGELOG.md merge=union\n',
      );
    });

    it('rethrows a non-ENOENT read failure rather than treating it as "file does not exist"', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });
      vi.spyOn(fsp, 'readFile').mockRejectedValueOnce(new Error('unexplained failure'));

      await expect(
        applySharedPathStrategy(handle, { glob: 'CHANGELOG.md', strategy: 'append-only' }),
      ).rejects.toThrow('unexplained failure');
    });

    it('is idempotent: calling it twice for the same glob does not duplicate the line', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });

      await applySharedPathStrategy(handle, { glob: 'CHANGELOG.md', strategy: 'append-only' });
      await applySharedPathStrategy(handle, { glob: 'CHANGELOG.md', strategy: 'append-only' });

      const content = await readFile(path.join(handle.path, '.gitattributes'), 'utf8');
      expect(
        content.split('\n').filter((line) => line === 'CHANGELOG.md merge=union'),
      ).toHaveLength(1);
    });

    it('treats an existing line with incidental trailing whitespace as already present, not a near-duplicate to append', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });
      await writeFile(path.join(handle.path, '.gitattributes'), 'CHANGELOG.md merge=union \n');

      await applySharedPathStrategy(handle, { glob: 'CHANGELOG.md', strategy: 'append-only' });

      const content = await readFile(path.join(handle.path, '.gitattributes'), 'utf8');
      expect(
        content.split('\n').filter((line) => line.trim() === 'CHANGELOG.md merge=union'),
      ).toHaveLength(1);
    });

    it('lets a real concurrent two-branch edit to the same file merge cleanly, with both additions present', async () => {
      const cwd = await createTempRepo();
      await writeFile(path.join(cwd, 'CHANGELOG.md'), 'line1\n');
      const baseSha = await commitAll(cwd, 'seed');

      const handleA = await createLaneWorktree(cwd, {
        runId: 'run-a',
        stepId: 'a',
        integrationBase: baseSha,
      });
      await applySharedPathStrategy(handleA, { glob: 'CHANGELOG.md', strategy: 'append-only' });
      await writeFile(path.join(handleA.path, 'CHANGELOG.md'), 'line1\nadded-by-a\n');
      await commitAll(handleA.path, 'a change');

      const handleB = await createLaneWorktree(cwd, {
        runId: 'run-b',
        stepId: 'b',
        integrationBase: baseSha,
      });
      await applySharedPathStrategy(handleB, { glob: 'CHANGELOG.md', strategy: 'append-only' });
      await writeFile(path.join(handleB.path, 'CHANGELOG.md'), 'line1\nadded-by-b\n');
      await commitAll(handleB.path, 'b change');

      await execa('git', ['merge', handleB.branch, '--no-edit', '-m', 'merge'], {
        cwd: handleA.path,
      });

      const merged = await readFile(path.join(handleA.path, 'CHANGELOG.md'), 'utf8');
      expect(merged).toContain('added-by-a');
      expect(merged).toContain('added-by-b');
      const { stdout: status } = await execa('git', ['status', '--porcelain'], {
        cwd: handleA.path,
      });
      expect(status).toBe('');
    });
  });

  describe('regenerate', () => {
    it('runs the configured command with cwd set to the lane worktree', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });

      await applySharedPathStrategy(handle, {
        glob: 'generated.txt',
        strategy: 'regenerate',
        command: 'echo regenerated > generated.txt',
      });

      await expect(readFile(path.join(handle.path, 'generated.txt'), 'utf8')).resolves.toBe(
        'regenerated\n',
      );
    });

    it('interprets shell operators in the command, proving it runs through a real shell, not a naive split', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });

      await applySharedPathStrategy(handle, {
        glob: 'x',
        strategy: 'regenerate',
        command: 'echo first && echo second > two.txt',
      });

      await expect(readFile(path.join(handle.path, 'two.txt'), 'utf8')).resolves.toBe('second\n');
    });

    it('rejects with a VcsError, not a raw execa error, when the configured command fails, with a message about the command — not git', async () => {
      const cwd = await createTempRepo();
      const handle = await createLaneWorktree(cwd, {
        runId: 'run-1',
        stepId: 'a',
        integrationBase: 'HEAD',
      });

      let caught: unknown;
      try {
        await applySharedPathStrategy(handle, {
          glob: 'x',
          strategy: 'regenerate',
          command: 'exit 1',
        });
      } catch (error) {
        caught = error;
      }

      if (!(caught instanceof VcsError)) {
        throw new Error(
          `expected applySharedPathStrategy to reject with a VcsError, got ${String(caught)}`,
        );
      }
      expect(caught.code).toBe('VCS-REGENERATE-COMMAND-FAILED');
      // The bug this guards against: reusing the git-flavoured wrapper's generic remedy text for an
      // ordinary failing shell command, which tells an operator to check their *git* installation for a
      // failure that has nothing to do with git at all.
      expect(caught.remedy.toLowerCase()).not.toContain('git is installed');
      expect(caught.message).toContain('exit 1');
    });
  });
});
