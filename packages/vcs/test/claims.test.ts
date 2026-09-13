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

  it('is safe to call again after enforceClaim has already reverted a file: the reverted file stops appearing', async () => {
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

    // enforceClaim's own revert is deliberately left uncommitted (a caller decides when/how to commit)
    // — this call must not treat that as an unrelated "dirty tree" problem, and must not still flag the
    // now-reverted file as a violation.
    const second = await enforceClaim(handle, baseSha, ['src/**'], 'strict');
    expect(second.outOfClaim).toEqual([]);
    expect(second.reverted).toEqual([]);
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
