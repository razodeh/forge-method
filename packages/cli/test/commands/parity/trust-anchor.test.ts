/**
 * `resolveTrustedRef`/`compareTrustAnchor`/`gitBlobId` — the trust anchor (`specs/22` M16 P7,
 * `13` F-TEST-9, `process/SPEC-QUESTIONS.md` Q294 Decision 3/A3). A brand-new mechanism: no earlier
 * M16 piece built any part of it, so every scenario here is a real git repository, never a hand-
 * reasoned case.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q294 Decision 3
 */
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  compareTrustAnchor,
  gitBlobId,
  resolveTrustedRef,
} from '../../../src/commands/parity/trust-anchor.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshRepo(objectFormat?: 'sha256'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p7-anchor-'));
  dirs.push(dir);
  await execa(
    'git',
    [
      'init',
      '--quiet',
      '-b',
      'main',
      ...(objectFormat === undefined ? [] : [`--object-format=${objectFormat}`]),
    ],
    { cwd: dir },
  );
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, '.gitkeep'), '', 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

async function commit(dir: string, message: string): Promise<string> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

async function headSha(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

async function writeParityFile(dir: string, relativePath: string, content: string): Promise<void> {
  const absolute = path.join(dir, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}

describe('gitBlobId: the in-process git blob hash (specs/22 M16 P7)', () => {
  it('matches "git hash-object --stdin" exactly, for sha1 and (where supported) sha256 repositories', async () => {
    const dir = await freshRepo();
    const bytes = new TextEncoder().encode('hello parity\n');
    const { stdout } = await execa('git', ['hash-object', '--stdin'], { cwd: dir, input: bytes });
    expect(gitBlobId(bytes, 'sha1')).toBe(stdout.trim());

    const dirSha256 = await freshRepo('sha256');
    const { stdout: stdout256 } = await execa('git', ['hash-object', '--stdin'], {
      cwd: dirSha256,
      input: bytes,
    });
    expect(gitBlobId(bytes, 'sha256')).toBe(stdout256.trim());
  });

  it('differs for different bytes and is stable for the same bytes', () => {
    const a = gitBlobId(new TextEncoder().encode('a'), 'sha1');
    const b = gitBlobId(new TextEncoder().encode('b'), 'sha1');
    const aAgain = gitBlobId(new TextEncoder().encode('a'), 'sha1');
    expect(a).not.toBe(b);
    expect(a).toBe(aAgain);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(gitBlobId(new TextEncoder().encode('a'), 'sha256')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveTrustedRef: --trusted accepts only a full commit sha or a refs/-qualified name (specs/22 M16 P7)', () => {
  it('resolves a full lower-case commit sha to itself', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    await expect(resolveTrustedRef(dir, sha)).resolves.toEqual({ outcome: 'resolved', sha });
  });

  it('resolves a refs/heads/<name> that exists, peeling to its commit', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    await expect(resolveTrustedRef(dir, 'refs/heads/main')).resolves.toEqual({
      outcome: 'resolved',
      sha,
    });
  });

  it('resolves a refs/tags/<name> pointing at an annotated tag by peeling to the commit, not the tag object', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    await execa('git', ['tag', '-a', 'v1', '-m', 'release'], { cwd: dir });
    const result = await resolveTrustedRef(dir, 'refs/tags/v1');
    expect(result).toEqual({ outcome: 'resolved', sha });
  });

  it('refuses "HEAD" outright: it moves like any other branch', async () => {
    const dir = await freshRepo();
    const result = await resolveTrustedRef(dir, 'HEAD');
    expect(result.outcome).toBe('refused');
  });

  it('refuses an abbreviated sha', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    const result = await resolveTrustedRef(dir, sha.slice(0, 10));
    expect(result.outcome).toBe('refused');
  });

  it('refuses an upper-case sha, even when the lower-case spelling names a real commit', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    const result = await resolveTrustedRef(dir, sha.toUpperCase());
    expect(result.outcome).toBe('refused');
  });

  it('refuses a bare name (no refs/ prefix), which a planted tag could shadow', async () => {
    const dir = await freshRepo();
    const result = await resolveTrustedRef(dir, 'main');
    expect(result.outcome).toBe('refused');
  });

  it('refuses a refs/ name that "git check-ref-format" rejects', async () => {
    const dir = await freshRepo();
    const result = await resolveTrustedRef(dir, 'refs/heads/..bad');
    expect(result.outcome).toBe('refused');
  });

  it('refuses a refs/ name that is syntactically fine but names no real ref', async () => {
    const dir = await freshRepo();
    const result = await resolveTrustedRef(dir, 'refs/heads/does-not-exist');
    expect(result.outcome).toBe('refused');
  });

  it('refuses a well-formed sha that resolves to no commit', async () => {
    const dir = await freshRepo();
    const result = await resolveTrustedRef(dir, 'a'.repeat(40));
    expect(result.outcome).toBe('refused');
  });

  it("refuses a tag object's own id passed where a commit sha is expected", async () => {
    const dir = await freshRepo();
    await execa('git', ['tag', '-a', 'v1', '-m', 'release'], { cwd: dir });
    const { stdout: tagObjectId } = await execa('git', ['rev-parse', 'refs/tags/v1'], { cwd: dir });
    const result = await resolveTrustedRef(dir, tagObjectId.trim());
    expect(result.outcome).toBe('refused');
  });

  it('refuses refs/heads/release when only a differently-named ref literally called "refs/heads/release" exists', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    // Plants a branch whose own NAME is the literal text "refs/heads/release" -- its real ref path is
    // `.git/refs/heads/refs/heads/release`, a DIFFERENT ref from `refs/heads/release` itself, which
    // does not exist in this repository at all (Q294 Decision 3's own "a name that merely resolves...
    // is not that ref" scenario).
    await execa('git', ['update-ref', 'refs/heads/refs/heads/release', sha], { cwd: dir });
    const planted = await execa('git', ['show-ref', '--verify', 'refs/heads/refs/heads/release'], {
      cwd: dir,
      reject: false,
    });
    expect(planted.exitCode).toBe(0);
    const realRelease = await execa('git', ['show-ref', '--verify', 'refs/heads/release'], {
      cwd: dir,
      reject: false,
    });
    expect(realRelease.exitCode).not.toBe(0);
    const result = await resolveTrustedRef(dir, 'refs/heads/release');
    expect(result.outcome).toBe('refused');
  });

  // DISCLOSED, not tested here: `resolveTrustedRef` passes `GIT_NO_REPLACE_OBJECTS=1` on every git
  // call it makes (one shared helper, `trust-anchor.ts`'s own private `git()`), matching `13`
  // F-TEST-9's blanket "every git command the harness runs has replace objects disabled". A direct
  // probe against real git 2.39.5 (a throwaway repository, not this suite) confirmed that
  // `rev-parse --verify <full-sha>^{commit}` -- the only content-independent operation this function
  // performs on an already-fully-qualified sha -- prints the sha asked about regardless of whether a
  // replacement is registered for it or the env var is set: replacement substitutes CONTENT reads
  // (`cat-file`, `ls-tree`), never an identity/existence lookup. So there is no real git scenario in
  // which THIS function's own env var is independently observable; the behaviourally meaningful test
  // of the identical mechanism is below, on `compareTrustAnchor`'s own `ls-tree` call, which does read
  // content.
});

describe('compareTrustAnchor: the on-disk .forge/parity/ tree against a trusted commit (specs/22 M16 P7)', () => {
  it('reads clean when the disk and the trusted commit agree exactly', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await expect(compareTrustAnchor(dir, sha)).resolves.toEqual({ outcome: 'clean' });
  });

  it('reports an untracked file added under .forge/parity/ since the trusted commit', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    await writeParityFile(dir, '.forge/parity/new.parity.yaml', 'name: new\n');
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toContain('.forge/parity/new.parity.yaml');
    }
  });

  it('reports a staged (but uncommitted) change to a committed file', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\nexpires: 2000-01-01\n');
    await execa('git', ['add', '.forge/parity/foo.parity.yaml'], { cwd: dir });
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toEqual(['.forge/parity/foo.parity.yaml']);
    }
  });

  it('reports a file deleted from disk but still named by the trusted commit', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await unlink(path.join(dir, '.forge/parity/foo.parity.yaml'));
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toEqual(['.forge/parity/foo.parity.yaml']);
    }
  });

  it('never consults the index or git status: a skip-worktree path that is edited on disk still reads changed', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await execa('git', ['update-index', '--skip-worktree', '.forge/parity/foo.parity.yaml'], {
      cwd: dir,
    });
    const statusBeforeEdit = await execa('git', ['status', '--porcelain=v1'], { cwd: dir });
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\nexpires: 2000-01-01\n');
    const statusAfterEdit = await execa('git', ['status', '--porcelain=v1'], { cwd: dir });
    // Confirms the premise: git status itself is blind to this edit (both are empty / identical).
    expect(statusAfterEdit.stdout).toBe(statusBeforeEdit.stdout);
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toEqual(['.forge/parity/foo.parity.yaml']);
    }
  });

  it('a .gitignore of "*" inside .forge/parity/ does not hide an added file from the comparison', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await writeParityFile(dir, '.forge/parity/.gitignore', '*\n');
    await writeParityFile(dir, '.forge/parity/sneaky.parity.yaml', 'name: sneaky\n');
    const statusIgnoresIt = await execa('git', ['status', '--porcelain=v1'], { cwd: dir });
    expect(statusIgnoresIt.stdout.trim()).toBe('');
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      const paths = result.differences.map((d) => d.path);
      expect(paths).toContain('.forge/parity/sneaky.parity.yaml');
      expect(paths).toContain('.forge/parity/.gitignore');
    }
  });

  it('a symlink in place of a committed file reads changed, never comparing against the link target', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    await writeParityFile(dir, '.forge/parity/real.txt', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await unlink(path.join(dir, '.forge/parity/foo.parity.yaml'));
    await symlink('real.txt', path.join(dir, '.forge/parity/foo.parity.yaml'));
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toContain('.forge/parity/foo.parity.yaml');
    }
  });

  it('a committed symlink under .forge/parity/ is itself a difference (the on-disk working tree checks out a real file)', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/real.txt', 'target\n');
    await symlink('real.txt', path.join(dir, '.forge/parity/link.parity.yaml'));
    const sha = await commit(dir, 'add symlink');
    // Replace the checked-out symlink with the real file content under the SAME path: now disk
    // disagrees with the commit about what kind of entry this path is.
    await unlink(path.join(dir, '.forge/parity/link.parity.yaml'));
    await writeParityFile(dir, '.forge/parity/link.parity.yaml', 'target\n');
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toContain('.forge/parity/link.parity.yaml');
    }
  });

  it('.forge and .forge/parity are themselves checked: a symlinked .forge/parity is a difference', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await rm(path.join(dir, '.forge/parity'), { recursive: true, force: true });
    await mkdir(path.join(dir, '.forge/elsewhere'), { recursive: true });
    await writeFile(path.join(dir, '.forge/elsewhere/foo.parity.yaml'), 'name: foo\n', 'utf8');
    await symlink('elsewhere', path.join(dir, '.forge/parity'));
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toContain('.forge/parity');
    }
  });

  it('.forge replaced by a plain file (not a directory) reads changed, never throwing a bare ENOTDIR (MUST-FIX 2a regression)', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await rm(path.join(dir, '.forge'), { recursive: true, force: true });
    await writeFile(path.join(dir, '.forge'), 'not a directory\n', 'utf8');
    // Before MUST-FIX 2a, `onDiskAncestorKind` lstat-ing ".../.forge/parity" -- a path THROUGH a
    // plain file, not a directory -- raised a raw ENOTDIR that propagated out of this call instead
    // of being read as "absent", rejecting the whole comparison rather than reporting a difference.
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toContain('.forge');
    }
  });

  it('.forge/parity replaced by a plain file (not a directory) reads changed, without being walked as though it still were one (MUST-FIX 2b regression)', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await rm(path.join(dir, '.forge/parity'), { recursive: true, force: true });
    await writeFile(path.join(dir, '.forge/parity'), 'not a directory\n', 'utf8');
    // Before MUST-FIX 2b, `walkOnDiskParity` was called unconditionally and went straight to
    // `listDirSorted(".../.forge/parity")` -- a `readdir` of a plain file -- raising ENOTDIR from a
    // path the ancestor check just above had already, correctly, reported as a difference.
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toContain('.forge/parity');
    }
  });

  it('a concurrent rename of .forge/parity away and back during the walk never crashes the comparison, even with no lock protecting it (round-2 critic repro; MUST-FIX 1 regression)', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    const parityPath = path.join(dir, '.forge/parity');
    const awayPath = path.join(dir, '.forge/parity-away');

    let renaming = true;
    // No lock protects `.forge/parity` during a walk (a disclosed limitation, not a defect this
    // piece closes): an ordinary concurrent edit can remove or replace an entry, or the directory
    // itself, between `listDirSorted` listing it and the `lstat` just after. This loop reproduces
    // that window directly -- the same shape of repro (a tight background rename loop) a round-2
    // critic used to crash this module with a bare, unwrapped ENOENT/ENOTDIR before `walkOnDiskParity`
    // wrapped its per-entry `lstat` in a try/catch.
    const renameLoop = (async () => {
      // A real, reachable check: the `finally` block below flips this from the OUTER `for` loop,
      // a different tick of the event loop than this one, once that loop has finished; the static
      // analysis here only sees this closure's own body, where `renaming` is never reassigned, and
      // narrows it to the literal `true`.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (renaming) {
        await rename(parityPath, awayPath).catch(() => undefined);
        await rename(awayPath, parityPath).catch(() => undefined);
      }
    })();

    const outcomes: string[] = [];
    try {
      for (let i = 0; i < 300; i++) {
        // The real property this test checks: 300 calls that each either resolve or throw. A throw
        // -- an ENOENT/ENOTDIR reaching the caller with no `--json` envelope at all, `10` §10.3's
        // check contract -- fails this test immediately, before `outcomes` ever reaches length 300.
        // Which outcome comes back on any given iteration depends on exactly where the concurrent
        // rename landed and is not itself meaningful (the union is exhaustive either way, so
        // recording it is the only way this loop expresses that it really did run 300 times).
        const result = await compareTrustAnchor(dir, sha);
        outcomes.push(result.outcome);
      }
    } finally {
      renaming = false;
      await renameLoop; // always ends on a completed away-then-back pair: .forge/parity is restored.
    }
    expect(outcomes).toHaveLength(300);
  });

  it('every declaration deleted reports every committed path as a difference (never reads as "nothing to compare")', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/alpha.parity.yaml', 'name: alpha\n');
    await writeParityFile(dir, '.forge/parity/beta.parity.yaml', 'name: beta\n');
    const sha = await commit(dir, 'add declarations');
    await rm(path.join(dir, '.forge/parity'), { recursive: true, force: true });
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path).sort()).toEqual([
        '.forge/parity/alpha.parity.yaml',
        '.forge/parity/beta.parity.yaml',
      ]);
    }
  });

  it('reads clean against a ref whose tree has no .forge/parity at all, when disk also has none', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    await expect(compareTrustAnchor(dir, sha)).resolves.toEqual({ outcome: 'clean' });
  });

  it('against a ref with no .forge/parity, every on-disk file under it reads "added"', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toContain('.forge/parity/foo.parity.yaml');
    }
  });

  it('an empty directory under .forge/parity/ is not an entry on either side', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    await mkdir(path.join(dir, '.forge/parity/empty-dir'), { recursive: true });
    await expect(compareTrustAnchor(dir, sha)).resolves.toEqual({ outcome: 'clean' });
  });

  it('git replace is disabled: a replaced blob does not make a genuinely matching file read as changed', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    // A SECOND, child commit that genuinely MODIFIES the same path -- confirmed directly (a
    // throwaway probe against real git 2.39.5, not this suite) that `git ls-tree <sha>` under an
    // active replacement reports the REPLACEMENT commit's own, different blob id for this exact
    // path, while `GIT_NO_REPLACE_OBJECTS=1` reports the original. An unrelated new file (as an
    // earlier version of this test used) proved nothing: inherited, unchanged content reads
    // identically either way, which is why that version passed regardless of whether replacement was
    // actually honoured.
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\nexpires: 2000-01-01\n');
    const rewrittenSha = await commit(dir, 'rewritten oracle');
    await execa('git', ['replace', sha, rewrittenSha], { cwd: dir });
    // The disk still holds the ORIGINAL content (as of `sha`, before the "rewrite"). With
    // replacement wrongly honoured, this would compare against `rewrittenSha`'s own, different
    // content and misreport "changed"; disabled, it must read clean.
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    await expect(compareTrustAnchor(dir, sha)).resolves.toEqual({ outcome: 'clean' });
  });

  it('works against a SHA-256 repository', async () => {
    const dir = await freshRepo('sha256');
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    expect(sha).toHaveLength(64);
    await expect(compareTrustAnchor(dir, sha)).resolves.toEqual({ outcome: 'clean' });
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\nexpires: 2000-01-01\n');
    const result = await compareTrustAnchor(dir, sha);
    expect(result.outcome).toBe('changed');
  });

  it('a project in a subdirectory of its repository is compared relative to the project root, not the repo root', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'forge-p7-anchor-repo-'));
    dirs.push(repoDir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: repoDir });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: repoDir });
    await execa('git', ['config', 'user.name', 't'], { cwd: repoDir });
    const projectDir = path.join(repoDir, 'nested-project');
    await mkdir(projectDir, { recursive: true });
    await writeParityFile(projectDir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    await writeFile(path.join(repoDir, 'outside.parity.yaml'), 'name: outside\n', 'utf8');
    const sha = await commit(repoDir, 'init nested project');
    await expect(compareTrustAnchor(projectDir, sha)).resolves.toEqual({ outcome: 'clean' });
    await writeParityFile(
      projectDir,
      '.forge/parity/foo.parity.yaml',
      'name: foo\nexpires: 2000-01-01\n',
    );
    const result = await compareTrustAnchor(projectDir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toEqual(['.forge/parity/foo.parity.yaml']);
    }
  });

  it('works against a linked worktree (a second checkout of the same repository)', async () => {
    const dir = await freshRepo();
    await writeParityFile(dir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(dir, 'add declaration');
    const linkedDir = await mkdtemp(path.join(tmpdir(), 'forge-p7-anchor-linked-'));
    dirs.push(linkedDir);
    await rm(linkedDir, { recursive: true, force: true });
    await execa('git', ['worktree', 'add', '--detach', linkedDir, sha], { cwd: dir });
    await expect(compareTrustAnchor(linkedDir, sha)).resolves.toEqual({ outcome: 'clean' });
  });

  it('a real "core.autocrlf=true" clone converts the checked-out bytes to CRLF, which must still read as changed against the LF-committed blob (SHOULD-FIX 4)', async () => {
    // A `.gitattributes` `eol=crlf` alone, written and committed in the same working tree with no
    // fresh checkout in between, does NOT actually convert the already-checked-out bytes on disk --
    // git only re-normalises line endings on a checkout/clone. An earlier version of this test did
    // exactly that (write the attribute, write the file, commit, re-read the SAME working tree) and
    // asserted a tautology: `onDisk` was always the untouched LF bytes this test had itself just
    // written, regardless of whether this module's own hashing was correct. A real
    // `core.autocrlf=true` clone is the one way to make git itself perform the LF->CRLF conversion
    // this test needs, so the premise -- a working tree whose bytes genuinely differ from the
    // committed blob, through no fault of this module -- is real rather than assumed.
    const sourceDir = await freshRepo();
    await writeParityFile(sourceDir, '.forge/parity/foo.parity.yaml', 'name: foo\n');
    const sha = await commit(sourceDir, 'add declaration');
    const clonedDir = await mkdtemp(path.join(tmpdir(), 'forge-p7-anchor-autocrlf-'));
    dirs.push(clonedDir);
    await execa('git', ['clone', '--quiet', '-c', 'core.autocrlf=true', sourceDir, clonedDir]);
    const onDisk = await readFile(path.join(clonedDir, '.forge/parity/foo.parity.yaml'));
    // Confirms the premise before trusting the "changed" assertion below: the clone's checkout really
    // did convert the line ending. Without this, a host or git version where autocrlf silently no-ops
    // would make that assertion vacuous in exactly the way the test it replaces was.
    expect(onDisk.equals(Buffer.from('name: foo\r\n', 'utf8'))).toBe(true);
    const result = await compareTrustAnchor(clonedDir, sha);
    expect(result.outcome).toBe('changed');
    if (result.outcome === 'changed') {
      expect(result.differences.map((d) => d.path)).toEqual(['.forge/parity/foo.parity.yaml']);
    }
  });
});
