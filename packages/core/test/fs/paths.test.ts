/**
 * `ProjectPaths` — the single gate every filesystem operation in `@forge/core/fs` passes through.
 *
 * Written from `specs/02` §2.5 ("path is inside the project root or lane worktree; path is not in
 * the deny list") and `PLAN-M1.md` P4's Checks: traversal, absolute escapes on both path shapes, a
 * symlink escape, and the deny list including nested paths.
 *
 * @see specs/02 §2.5
 * @see specs/18 §18.10
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ForgeError } from '../../src/errors/index.ts';
import { afterEach, describe, expect, it } from 'vitest';

import { DENIED_PREFIXES, ProjectPaths } from '../../src/fs/paths.ts';

let projectRoot: string | undefined;

/** A fresh, real project root directory, cleaned up after the test. */
function freshRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-paths-'));
  projectRoot = root;
  return root;
}

afterEach(() => {
  if (projectRoot !== undefined) rmSync(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

/** Symlink creation needs elevated privileges on Windows without Developer Mode. */
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

describe('ProjectPaths construction', () => {
  it('accepts a root that exists', () => {
    expect(() => new ProjectPaths(freshRoot())).not.toThrow();
  });

  it('refuses a root that does not exist, with an actionable ForgeError', () => {
    const missing = path.join(tmpdir(), 'forge-paths-does-not-exist');
    try {
      new ProjectPaths(missing);
      expect.unreachable('constructing over a missing root should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ForgeError);
      expect((error as ForgeError).remedy).not.toBe('');
    }
  });
});

describe('resolveWithin — valid resolution', () => {
  it('resolves a simple relative path inside the project', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(paths.resolveWithin('docs/forge/kb/a.md')).toBe(
      path.join(root, 'docs', 'forge', 'kb', 'a.md'),
    );
  });

  it('resolves the root itself', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(paths.resolveWithin('.')).toBe(root);
  });

  it('resolves a path that legitimately climbs and returns, net non-negative', () => {
    // "a/../b" never leaves the root even though it contains "..": the check is on the *resolved*
    // path, not on whether the literal string contains a dot-dot segment.
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(paths.resolveWithin('a/../b')).toBe(path.join(root, 'b'));
  });
});

describe('resolveWithin — traversal and absolute escapes', () => {
  it('rejects a relative traversal out of the root, with CFG-003', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(() => paths.resolveWithin('../../etc/passwd')).toThrow(
      expect.objectContaining({ code: 'CFG-003' }) as Error,
    );
  });

  it('rejects a POSIX-absolute path', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(() => paths.resolveWithin('/etc/passwd')).toThrow(
      expect.objectContaining({ code: 'CFG-003' }) as Error,
    );
  });

  it.each(['C:\\Windows\\system32', 'c:/windows/system32', '\\\\server\\share\\file'])(
    'rejects a Windows-shaped absolute path (%s), regardless of the host platform',
    (windowsPath) => {
      // specs/02 §2.7: Windows is first-class. This must be rejected on POSIX too — otherwise a
      // POSIX host silently treats it as a harmless relative subdirectory name and writes inside
      // the project at a path like "<root>/C:\Windows\system32", which is its own kind of wrong.
      const root = freshRoot();
      const paths = new ProjectPaths(root);
      expect(() => paths.resolveWithin(windowsPath)).toThrow(
        expect.objectContaining({ code: 'CFG-003' }) as Error,
      );
    },
  );

  it('names the offending path and the root in the error details', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    try {
      paths.resolveWithin('../outside');
      expect.unreachable('should have thrown');
    } catch (error) {
      const forgeError = error as ForgeError;
      expect(forgeError.details['path']).toBe('../outside');
      expect(forgeError.details['root']).toBe(root);
    }
  });
});

describe('resolveWithin — symlink escapes', () => {
  it.runIf(canCreateSymlinks(mkdtempSync(path.join(tmpdir(), 'forge-symlink-probe-'))))(
    'rejects a path reaching through a symlink that points outside the project',
    () => {
      const root = freshRoot();
      const outside = mkdtempSync(path.join(tmpdir(), 'forge-outside-'));
      try {
        symlinkSync(outside, path.join(root, 'escape-link'), 'dir');
        const paths = new ProjectPaths(root);
        expect(() => paths.resolveWithin('escape-link/secret.txt')).toThrow(
          expect.objectContaining({ code: 'CFG-003' }) as Error,
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it.runIf(canCreateSymlinks(mkdtempSync(path.join(tmpdir(), 'forge-symlink-probe-'))))(
    'permits a symlink that points to somewhere inside the project',
    () => {
      const root = freshRoot();
      mkdirSync(path.join(root, 'real-target'));
      symlinkSync(path.join(root, 'real-target'), path.join(root, 'internal-link'), 'dir');
      const paths = new ProjectPaths(root);
      expect(() => paths.resolveWithin('internal-link/file.txt')).not.toThrow();
    },
  );

  it.runIf(canCreateSymlinks(mkdtempSync(path.join(tmpdir(), 'forge-symlink-probe-'))))(
    'denies a symlink whose real target is a denied directory, even though the literal segment typed is not',
    () => {
      // `alias` never contains the literal text "git", so a deny check against only the nominal,
      // pre-symlink-resolution path would miss this — the resolved *real* path is what actually gets
      // written to.
      const root = freshRoot();
      mkdirSync(path.join(root, '.git'));
      symlinkSync(path.join(root, '.git'), path.join(root, 'alias'), 'dir');
      const paths = new ProjectPaths(root);
      expect(() => paths.resolveWithin('alias/config')).toThrow(
        expect.objectContaining({ code: 'CFG-004' }) as Error,
      );
    },
  );
});

describe('resolveWithin — the deny list', () => {
  it('documents exactly the three prefixes specs/02 §2.5 names', () => {
    expect([...DENIED_PREFIXES].sort()).toEqual(['.forge/state/', '.git/', 'node_modules/'].sort());
  });

  it.each([
    ['.git', 'CFG-004'],
    ['.git/config', 'CFG-004'],
    ['.git/objects/pack/x.pack', 'CFG-004'],
    ['.forge/state', 'CFG-004'],
    ['.forge/state/events.ndjson', 'CFG-004'],
    ['node_modules', 'CFG-004'],
    ['node_modules/left-pad/index.js', 'CFG-004'],
  ])('denies %s with %s', (relative, code) => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(() => paths.resolveWithin(relative)).toThrow(expect.objectContaining({ code }) as Error);
  });

  it.each(['.gitignore', '.forge/config.yaml', 'node_modules_backup/x', 'docs/.git-notes.md'])(
    'does not deny the merely-similar path %s',
    (relative) => {
      const root = freshRoot();
      const paths = new ProjectPaths(root);
      expect(() => paths.resolveWithin(relative)).not.toThrow();
    },
  );

  it.each(['.GIT/config', '.Git/config', 'NODE_MODULES/x', '.FORGE/state/x'])(
    'denies %s case-insensitively, since Windows and macOS default filesystems are case-insensitive',
    (relative) => {
      const root = freshRoot();
      const paths = new ProjectPaths(root);
      expect(() => paths.resolveWithin(relative)).toThrow(
        expect.objectContaining({ code: 'CFG-004' }) as Error,
      );
    },
  );
});

describe('resolveWithin — a bare backslash is not treated as a separator', () => {
  it('resolves a relative segment containing a backslash as one literal path segment', () => {
    // `specs/02` §2.7: repo-relative paths are POSIX-style (forward slash) by convention; `\` is a
    // legal POSIX filename character, not a separator. Silently reinterpreting it would make
    // `resolveWithin`'s behaviour depend on the host platform for input that contains no drive
    // letter or UNC prefix — exactly the ambiguity the explicit Windows-absolute rejection above
    // exists to avoid for the shapes that matter. A bare backslash with no such prefix is simply
    // part of the name.
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(paths.resolveWithin('odd\\name.txt')).toBe(path.join(root, 'odd\\name.txt'));
  });
});

describe('resolveState', () => {
  it('resolves inside <root>/.forge/state/, unlike resolveWithin', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(paths.resolveState('ids.json')).toBe(path.join(root, '.forge', 'state', 'ids.json'));
    expect(() => paths.resolveWithin('.forge/state/ids.json')).toThrow(
      expect.objectContaining({ code: 'CFG-004' }) as Error,
    );
  });

  it('resolves a nested path inside .forge/state/', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(paths.resolveState('runs/run_01H/events.ndjson')).toBe(
      path.join(root, '.forge', 'state', 'runs', 'run_01H', 'events.ndjson'),
    );
  });

  it('rejects a relative traversal out of .forge/state/, with CFG-003', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(() => paths.resolveState('../../escape.txt')).toThrow(
      expect.objectContaining({ code: 'CFG-003' }) as Error,
    );
  });

  it('rejects an absolute path, with CFG-003', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(() => paths.resolveState('/etc/passwd')).toThrow(
      expect.objectContaining({ code: 'CFG-003' }) as Error,
    );
  });

  it('does not apply resolveWithin\'s deny list — a name that merely contains "git" is fine', () => {
    const root = freshRoot();
    const paths = new ProjectPaths(root);
    expect(() => paths.resolveState('gitignore-like-cache.json')).not.toThrow();
  });

  it.runIf(canCreateSymlinks(mkdtempSync(path.join(tmpdir(), 'forge-symlink-probe-'))))(
    'permits .forge/state itself being a symlink to somewhere inside the project',
    () => {
      // A legitimate way to relocate FORGE's state onto different storage. A naive
      // `path.join(this.realRoot, '.forge', 'state')` base (rather than actually resolving this
      // symlink) would compare the *target*'s real path against a base that never followed it,
      // rejecting this as an escape.
      const root = freshRoot();
      mkdirSync(path.join(root, 'real-state'));
      mkdirSync(path.join(root, '.forge'));
      symlinkSync(path.join(root, 'real-state'), path.join(root, '.forge', 'state'), 'dir');
      const paths = new ProjectPaths(root);
      expect(() => paths.resolveState('ids.json')).not.toThrow();
    },
  );

  it.runIf(canCreateSymlinks(mkdtempSync(path.join(tmpdir(), 'forge-symlink-probe-'))))(
    'rejects a path reaching through a symlink inside .forge/state/ that points outside the project',
    () => {
      const root = freshRoot();
      const outside = mkdtempSync(path.join(tmpdir(), 'forge-outside-'));
      try {
        mkdirSync(path.join(root, '.forge', 'state'), { recursive: true });
        symlinkSync(outside, path.join(root, '.forge', 'state', 'escape-link'), 'dir');
        const paths = new ProjectPaths(root);
        expect(() => paths.resolveState('escape-link/secret.txt')).toThrow(
          expect.objectContaining({ code: 'CFG-003' }) as Error,
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );
});
