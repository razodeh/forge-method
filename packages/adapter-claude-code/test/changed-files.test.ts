/**
 * `computeChangedFiles` — `07` §7.6's own C14 ("`changedFiles` matches `git status --porcelain` in
 * the worktree"), proven against a real git repository, not a fixture NDJSON line.
 *
 * @see specs/07 §7.6
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { computeChangedFiles } from '../src/changed-files.ts';

async function createGitFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-adapter-claude-code-changed-files-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await writeFile(path.join(dir, 'committed.txt'), 'original content\n', 'utf8');
  await execa('git', ['add', 'committed.txt'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('computeChangedFiles', () => {
  let scratchDirs: string[] = [];
  afterEach(async () => {
    for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
    scratchDirs = [];
  });

  it('returns an empty list for a clean worktree', async () => {
    const dir = await createGitFixture();
    scratchDirs.push(dir);
    expect(await computeChangedFiles(dir)).toEqual([]);
  });

  it('reports a new, untracked file', async () => {
    const dir = await createGitFixture();
    scratchDirs.push(dir);
    await writeFile(path.join(dir, 'untracked.txt'), 'new\n', 'utf8');
    expect(await computeChangedFiles(dir)).toEqual(['untracked.txt']);
  });

  it('reports a modified, already-tracked file', async () => {
    const dir = await createGitFixture();
    scratchDirs.push(dir);
    await writeFile(path.join(dir, 'committed.txt'), 'changed content\n', 'utf8');
    expect(await computeChangedFiles(dir)).toEqual(['committed.txt']);
  });

  it('reports a staged (added-to-index) new file', async () => {
    const dir = await createGitFixture();
    scratchDirs.push(dir);
    await writeFile(path.join(dir, 'staged.txt'), 'staged\n', 'utf8');
    await execa('git', ['add', 'staged.txt'], { cwd: dir });
    expect(await computeChangedFiles(dir)).toEqual(['staged.txt']);
  });

  it('reports only the new (target) path for a real, detected rename -- never the original path, and never a joined "from -> to" string', async () => {
    const dir = await createGitFixture();
    scratchDirs.push(dir);
    await execa('git', ['mv', 'committed.txt', 'renamed.txt'], { cwd: dir });
    const changed = await computeChangedFiles(dir);
    expect(changed).toEqual(['renamed.txt']);
  });

  it('reports several distinct changed files at once', async () => {
    const dir = await createGitFixture();
    scratchDirs.push(dir);
    await writeFile(path.join(dir, 'a.txt'), 'a\n', 'utf8');
    await writeFile(path.join(dir, 'b.txt'), 'b\n', 'utf8');
    const changed = await computeChangedFiles(dir);
    expect(new Set(changed)).toEqual(new Set(['a.txt', 'b.txt']));
  });

  it('never throws for a cwd that is not a git repository at all -- resolves to an empty list', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-adapter-claude-code-not-a-repo-'));
    scratchDirs.push(dir);
    expect(await computeChangedFiles(dir)).toEqual([]);
  });
});
