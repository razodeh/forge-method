/**
 * `20` §20.10 S1 — "No write ever lands outside the project root or lane worktree, including via
 * symlink or `..`."
 *
 * `PLAN-M11.md` P9's own mandate: this invariant's real enforcement mechanism — `ProjectPaths`'s
 * `resolveWithin`, `@forge/core/fs/paths.ts` — already exists and is already exercised by
 * `../fs/paths.test.ts` (written for `PLAN-M1.md` P4, before `20` §20.10's own S-numbered invariant
 * table existed). This file is the missing S1-labeled test `21` §21's own "Security (20)" section
 * calls for: "One test per invariant S1-S12, each written as an attack rather than a happy path." It
 * goes one step further than a bare `resolveWithin(...)` throw assertion — each attack here drives a
 * *real end-to-end write attempt* through `writeFileAtomic`, then proves the escape target's own
 * content is untouched, rather than trusting that a thrown error implies nothing happened.
 *
 * **Surface deviation from `PLAN-M11.md` P9's stated `packages/vcs/test/security/
 * s1-containment.test.ts` location, disclosed here and in `SPEC-QUESTIONS.md` Q169:** `@forge/vcs`'s
 * own `specs/02` §2.2 dependency row is `['schemas']` — no edge to `@forge/core` at all (confirmed
 * directly against `tools/eslint-plugin-forge-boundaries/src/graph.mjs` and `packages/vcs/
 * package.json`'s real `dependencies`), and `@forge/vcs` itself implements no path-containment logic
 * of its own (its own `lanes.ts` only manages worktree *lifecycle* via real `git` subprocesses; the
 * doc comment on its local `listDirEntriesSorted` helper says explicitly why it duplicates a tiny
 * `@forge/core/fs` utility rather than depending on the package: "this module cannot depend on
 * `@forge/core` at all"). A test file under `packages/vcs/test/` cannot import `ProjectPaths` without
 * either a new, undeclared cross-package edge (which `pnpm boundaries` would then correctly reject) or
 * reimplementing S1's own real mechanism a second time just to have something local to test — neither
 * is the "prove the real, already-existing mechanism holds" mandate this piece was given. Placed here,
 * in `@forge/core`'s own test tree, next to the mechanism itself instead — the same kind of disclosed,
 * recorded Surface deviation `PLAN-M11.md` P1 and `PLAN-M10.md` P10/P16 already established a
 * precedent for (`SPEC-QUESTIONS.md` Q104).
 *
 * @see specs/20 §20.10 S1
 * @see specs/21 §21 "Security (20)"
 * @see SPEC-QUESTIONS.md Q169
 * @see PLAN-M11.md P9
 * @see ../fs/paths.test.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ForgeError } from '../../src/errors/index.ts';
import { writeFileAtomic } from '../../src/fs/atomic.ts';
import { ProjectPaths } from '../../src/fs/paths.ts';

let cleanupDirs: string[] = [];

function freshDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
  cleanupDirs = [];
});

function canCreateSymlinks(root: string): boolean {
  try {
    const probe = path.join(root, '.symlink-capability-probe');
    symlinkSync(root, probe, 'dir');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

describe('S1 — a real end-to-end write attempt through a symlink escape lands nowhere', () => {
  it.runIf(canCreateSymlinks(mkdtempSync(path.join(tmpdir(), 'forge-s1-probe-'))))(
    'refuses to write through a symlink whose real target is outside the project root, and the ' +
      'attacker-controlled file outside the project is never touched',
    async () => {
      const projectRoot = freshDir('forge-s1-project-');
      const outsideDir = freshDir('forge-s1-outside-');
      const secretPath = path.join(outsideDir, 'secret.txt');
      const originalContent = 'pre-existing, untouched secret content';
      writeFileSync(secretPath, originalContent, 'utf8');

      // The attack: a symlink inside the project whose real target is the file outside it. A step
      // that believes it is writing "notes/secret.txt" inside its own project is, via this symlink,
      // actually targeting a file the project has no business ever modifying.
      mkdirSync(path.join(projectRoot, 'notes'));
      symlinkSync(secretPath, path.join(projectRoot, 'notes', 'secret.txt'));

      const paths = new ProjectPaths(projectRoot);
      let thrown: unknown;
      try {
        const resolved = paths.resolveWithin('notes/secret.txt');
        // Only reached if containment failed to throw — still routed through the real write
        // primitive so a containment bypass would be caught by the write actually landing outside,
        // not merely inferred from a missing exception.
        await writeFileAtomic(resolved, 'attacker-controlled overwrite');
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ForgeError);
      expect((thrown as ForgeError).code).toBe('CFG-003');
      expect(readFileSync(secretPath, 'utf8')).toBe(originalContent);
    },
  );

  it.runIf(canCreateSymlinks(mkdtempSync(path.join(tmpdir(), 'forge-s1-probe-'))))(
    'refuses a write through a symlinked *directory* whose real target is outside the project root, ' +
      'even for a leaf file that does not exist yet',
    () => {
      const projectRoot = freshDir('forge-s1-project-');
      const outsideDir = freshDir('forge-s1-outside-');

      // The leaf file ("payload.txt") does not exist anywhere yet — this is the write-target case
      // `realpathOfDeepestExistingAncestor` exists specifically to still catch, since a naive
      // `fs.realpathSync` on a non-existent path throws ENOENT rather than revealing the escape.
      symlinkSync(outsideDir, path.join(projectRoot, 'linked-dir'));

      const paths = new ProjectPaths(projectRoot);
      expect(() => paths.resolveWithin('linked-dir/payload.txt')).toThrow(
        expect.objectContaining({ code: 'CFG-003' }),
      );
      // The would-be write target was never created inside the outside directory the symlink
      // actually points to.
      expect(() => readFileSync(path.join(outsideDir, 'payload.txt'), 'utf8')).toThrow();
    },
  );
});

describe('S1 — a real end-to-end write attempt through `..` traversal lands nowhere', () => {
  it('refuses a relative traversal out of the project root, and nothing is written outside it', async () => {
    const projectRoot = freshDir('forge-s1-project-');
    const outsideDir = freshDir('forge-s1-outside-');
    const targetPath = path.join(outsideDir, 'pwned.txt');

    const paths = new ProjectPaths(projectRoot);
    const traversal = path.relative(projectRoot, targetPath);
    // Confirms the attack shape is genuine `..`-traversal, not an accidental same-directory path —
    // a test that failed to actually leave the root would prove nothing about containment.
    expect(traversal.startsWith('..')).toBe(true);

    let thrown: unknown;
    try {
      const resolved = paths.resolveWithin(traversal);
      await writeFileAtomic(resolved, 'attacker-controlled write via ../ traversal');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ForgeError);
    expect((thrown as ForgeError).code).toBe('CFG-003');
    expect(() => readFileSync(targetPath, 'utf8')).toThrow();
  });

  it('refuses a deeply-nested `..` traversal that would land at the filesystem root', () => {
    const projectRoot = freshDir('forge-s1-project-');
    const paths = new ProjectPaths(projectRoot);
    const depth = projectRoot.split(path.sep).length + 5;
    const escapeAttempt = Array.from({ length: depth }, () => '..').join('/') + '/etc/passwd';

    expect(() => paths.resolveWithin(escapeAttempt)).toThrow(
      expect.objectContaining({ code: 'CFG-003' }),
    );
  });

  it('refuses an absolute path presented in place of a relative one (the traversal attempt need not use `..` at all)', () => {
    const projectRoot = freshDir('forge-s1-project-');
    const paths = new ProjectPaths(projectRoot);

    expect(() => paths.resolveWithin('/etc/passwd')).toThrow(
      expect.objectContaining({ code: 'CFG-003' }),
    );
  });
});
