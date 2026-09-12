/**
 * `20` §20.10 S8 — "Uncommitted user work is never discarded; a dirty tree halts the run with options."
 *
 * `PLAN-M11.md` P11's own direct investigation found `@forge/vcs`'s own `assertCleanWorkingTree`
 * (`packages/vcs/src/git.ts`) real, correct, and already thoroughly unit-tested
 * (`packages/vcs/test/git.test.ts` — dirty-file detection, a real `VCS-DIRTY-TREE` `VcsError` naming
 * every dirty file with a real "stash, commit, or abort" remedy, a real permission-failure path). The
 * genuine gap this piece found was not in that mechanism but around it: **`assertCleanWorkingTree` had
 * zero production call sites anywhere in this codebase** (confirmed by grep) — `@forge/cli`'s own
 * `buildRunEngineContext` (`packages/cli/src/commands/run/context.ts`) creates a lane worktree fresh
 * from `integrationBase` regardless of the *main* working tree's own state, so a real `forge run` never
 * actually checked the user's own uncommitted work at all, let alone halted for it. Fixed for real:
 * `runWorkflow` (`@forge/cli`'s own `packages/cli/src/commands/run/run.ts`) now calls
 * `assertCleanWorkingTree(deps.projectRoot)` before any lock/manifest/lane machinery starts.
 *
 * This file is the mechanism-level adversarial confirmation `@forge/engine` can reach on its own
 * dependency edge (`engine → vcs`, `02` §2.2) — a real dirty tree, constructed fresh here rather than
 * trusting `@forge/vcs`'s own already-passing suite, halts with the documented remedy options. The
 * *wired* half of this fix — that a real, non-dry-run `forge run` genuinely refuses to start against a
 * dirty tree — cannot be proven from here: `@forge/engine` has no dependency edge onto `@forge/cli`
 * (`02` §2.2's own graph runs the other way), so `runWorkflow` itself is untestable from this package.
 * That proof lives at `packages/cli/test/commands/run/run.test.ts`'s own
 * `"S8 (20 §20.10): refuses to start a real, non-dry-run run against a dirty working tree"` — disclosed
 * here rather than silently split across two files with no cross-reference, the identical "confirm the
 * real reason, then relocate/split the test rather than force it into a structurally wrong location"
 * precedent `PLAN-M11.md` P9 already established for S1.
 *
 * @see specs/20 §20.10 S8
 * @see PLAN-M11.md P9
 * @see PLAN-M11.md P11
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { assertCleanWorkingTree, VcsError } from '@forge/vcs';
import { afterEach, describe, expect, it } from 'vitest';

const cleanupDirs: string[] = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-engine-s8-'));
  cleanupDirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  return dir;
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await execa('git', ['add', '-A'], { cwd });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd });
}

describe('assertCleanWorkingTree (20 §20.10 S8)', () => {
  it('resolves for a real, genuinely clean working tree', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');

    await expect(assertCleanWorkingTree(cwd)).resolves.toBeUndefined();
  });

  it('halts for a real, adversarially dirty tree -- a modified tracked file -- naming it and offering real remedy options, never silently proceeding', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await writeFile(path.join(cwd, 'a.txt'), 'a real uncommitted edit');

    const rejection = assertCleanWorkingTree(cwd);
    await expect(rejection).rejects.toBeInstanceOf(VcsError);
    await expect(rejection).rejects.toMatchObject({ code: 'VCS-DIRTY-TREE' });
    await expect(assertCleanWorkingTree(cwd)).rejects.toThrow(/a\.txt/);
    // Real, actionable options -- "halts the run with options" (20 §20.10 S8's own literal text), not
    // merely a bare refusal with nothing a human can act on.
    await expect(assertCleanWorkingTree(cwd)).rejects.toMatchObject({
      remedy: expect.stringContaining('git stash') as unknown as string,
    });
  });

  it('halts for a real untracked file too -- not only modified tracked ones -- since an untracked file is real uncommitted work just the same', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await writeFile(path.join(cwd, 'new-work.txt'), 'never committed, never staged');

    await expect(assertCleanWorkingTree(cwd)).rejects.toThrow(/new-work\.txt/);
  });

  it('never discards anything it refuses -- the dirty file survives the refusal on disk exactly as written', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'a.txt'), 'a');
    await commitAll(cwd, 'initial');
    await writeFile(path.join(cwd, 'a.txt'), 'sacred uncommitted content');

    await expect(assertCleanWorkingTree(cwd)).rejects.toBeInstanceOf(VcsError);

    const { readFile } = await import('node:fs/promises');
    await expect(readFile(path.join(cwd, 'a.txt'), 'utf8')).resolves.toBe(
      'sacred uncommitted content',
    );
  });
});
