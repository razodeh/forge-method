/**
 * `createAnnotatedTag`/`tagExists`/`resolveTagCommit` — `PLAN-M10.md` P19's own real BASELINE tag
 * primitive, against a real git repository (no mocking, matching `git.test.ts`'s own established
 * tier).
 *
 * @see specs/17 §17.2 phase 8
 * @see PLAN-M10.md P19
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { VcsError } from '../src/errors.ts';
import { createAnnotatedTag, resolveTagCommit, tagExists } from '../src/tag.ts';

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-tag-'));
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

async function commitAll(cwd: string, message: string): Promise<string> {
  await execa('git', ['add', '-A'], { cwd });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd });
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repoWithCommit(): Promise<{ dir: string; sha: string }> {
  const dir = await createTempRepo();
  dirs.push(dir);
  await writeFile(path.join(dir, 'a.txt'), 'one\n');
  const sha = await commitAll(dir, 'initial');
  return { dir, sha };
}

describe('tagExists', () => {
  it('is false before a tag is created and true after', async () => {
    const { dir } = await repoWithCommit();
    expect(await tagExists(dir, 'BASELINE')).toBe(false);
    await createAnnotatedTag(dir, 'BASELINE', 'Adoption baseline');
    expect(await tagExists(dir, 'BASELINE')).toBe(true);
  });

  it('rejects a structurally invalid tag name before ever spawning git', async () => {
    const { dir } = await repoWithCommit();
    await expect(tagExists(dir, '-q')).rejects.toMatchObject({
      code: 'VCS-INVALID-TAG-NAME',
    });
  });
});

describe('createAnnotatedTag', () => {
  it('creates a real annotated tag at HEAD resolving to the current commit', async () => {
    const { dir, sha } = await repoWithCommit();
    await createAnnotatedTag(dir, 'BASELINE', 'Adoption baseline');
    expect(await resolveTagCommit(dir, 'BASELINE')).toBe(sha);
  });

  it('creates a tag at a specific, already-resolved commit-ish', async () => {
    const { dir, sha } = await repoWithCommit();
    await writeFile(path.join(dir, 'b.txt'), 'two\n');
    await commitAll(dir, 'second');
    await createAnnotatedTag(dir, 'BASELINE', 'Adoption baseline', sha);
    expect(await resolveTagCommit(dir, 'BASELINE')).toBe(sha);
  });

  it('refuses to silently move an existing tag', async () => {
    const { dir } = await repoWithCommit();
    await createAnnotatedTag(dir, 'BASELINE', 'first');
    await expect(createAnnotatedTag(dir, 'BASELINE', 'second')).rejects.toMatchObject({
      code: 'VCS-TAG-EXISTS',
    });
  });

  it('wraps a real git failure (invalid target commit) as a VcsError', async () => {
    const { dir } = await repoWithCommit();
    await expect(
      createAnnotatedTag(dir, 'BASELINE', 'msg', '0000000000000000000000000000000000000000'),
    ).rejects.toBeInstanceOf(VcsError);
  });
});

describe('resolveTagCommit', () => {
  it('rejects a non-existent tag with a VcsError', async () => {
    const { dir } = await repoWithCommit();
    await expect(resolveTagCommit(dir, 'NO-SUCH-TAG')).rejects.toBeInstanceOf(VcsError);
  });
});
