/**
 * `resolveReferenceCommit` — resolving a format-valid `reference.ref` (P2's own `classifyReferenceRefFormat`
 * stops at the FORMAT question; this piece resolves it against a real repository, `13` F-TEST-9, Q294
 * Decision 6 as corrected by Q295 Decision 4) to the real commit the scratch worktree must be built
 * at, or to the reason it cannot be: a name that is ALSO a branch (regardless of a same-named tag),
 * or a well-formed sha/tag that names no commit at all.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q294 Decision 6, Q295 Decision 4
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveReferenceCommit } from '../../../src/commands/parity/reference-commit.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-refcommit-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}

async function commit(dir: string, message: string): Promise<string> {
  await writeFile(path.join(dir, `${message}.txt`), message, 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

describe('resolveReferenceCommit (specs/22 M16 P3)', () => {
  it('resolves a full sha that names a real commit', async () => {
    const dir = await freshRepo();
    const sha = await commit(dir, 'one');
    const result = await resolveReferenceCommit(dir, { kind: 'sha', sha });
    expect(result).toEqual({ outcome: 'resolved', sha });
  });

  it('a well-formed sha that names no commit in this repository is not-found', async () => {
    const dir = await freshRepo();
    await commit(dir, 'one');
    const fakeSha = 'f'.repeat(40);
    const result = await resolveReferenceCommit(dir, { kind: 'sha', sha: fakeSha });
    expect(result).toEqual({ outcome: 'not-found' });
  });

  it('resolves a tag, peeled to the commit it names', async () => {
    const dir = await freshRepo();
    const sha = await commit(dir, 'one');
    await execa('git', ['tag', 'v1'], { cwd: dir });
    const result = await resolveReferenceCommit(dir, { kind: 'tag', name: 'v1' });
    expect(result).toEqual({ outcome: 'resolved', sha });
  });

  it('a tag name with no matching tag is not-found, never invalid', async () => {
    const dir = await freshRepo();
    await commit(dir, 'one');
    const result = await resolveReferenceCommit(dir, { kind: 'tag', name: 'does-not-exist' });
    expect(result).toEqual({ outcome: 'not-found' });
  });

  it('a name that names a branch is names-a-branch, with no same-named tag present', async () => {
    const dir = await freshRepo();
    await commit(dir, 'one');
    await execa('git', ['branch', 'release'], { cwd: dir });
    const result = await resolveReferenceCommit(dir, { kind: 'tag', name: 'release' });
    expect(result).toEqual({ outcome: 'names-a-branch' });
  });

  it('a name that names BOTH a branch and a tag, pointing at two different commits, is names-a-branch -- never silently resolved to the tag commit git itself would pick by default (Q295 Decision 4)', async () => {
    const dir = await freshRepo();
    const branchSha = await commit(dir, 'one');
    await execa('git', ['branch', 'release'], { cwd: dir });
    const tagSha = await commit(dir, 'two');
    await execa('git', ['tag', 'release'], { cwd: dir });
    expect(tagSha).not.toBe(branchSha);
    // Sanity: git's own bare-name resolution picks the tag here, which is exactly the trap the
    // explicit, namespace-qualified check below must not fall into.
    const bareResolution = await execa('git', ['rev-parse', 'release^{commit}'], {
      cwd: dir,
      reject: false,
    });
    expect(bareResolution.stdout.trim()).toBe(tagSha);

    const result = await resolveReferenceCommit(dir, { kind: 'tag', name: 'release' });
    expect(result).toEqual({ outcome: 'names-a-branch' });
  });

  it('a lightweight tag (not annotated) still resolves to its commit', async () => {
    const dir = await freshRepo();
    const sha = await commit(dir, 'one');
    await execa('git', ['tag', '-a', 'v-annotated', '-m', 'release note'], { cwd: dir });
    const result = await resolveReferenceCommit(dir, { kind: 'tag', name: 'v-annotated' });
    expect(result).toEqual({ outcome: 'resolved', sha });
  });
});
