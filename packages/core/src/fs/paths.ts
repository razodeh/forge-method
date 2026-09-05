/**
 * `ProjectPaths` — the single gate every write to a host project passes through.
 *
 * `specs/02` §2.5: "All FS writes to `<project>` go through `@forge/core/fs` which enforces: path is
 * inside the project root or lane worktree; path is not in the deny list... writes are atomic." This
 * file is the first of those three: containment and the deny list. `atomic.ts` and `operations.ts`
 * both require an `AbsolutePath`, a type only `resolveWithin` can produce — so a write that skipped
 * this gate is a type error, not a runtime hope.
 *
 * @see specs/02 §2.5
 * @see specs/02 §2.7
 */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { ForgeError } from '../errors/forge-error.ts';

declare const ABSOLUTE_PATH_BRAND: unique symbol;

/**
 * An absolute filesystem path that has passed `ProjectPaths.resolveWithin`'s containment and
 * deny-list checks.
 *
 * The brand exists so the type system enforces §2.5's rule: `writeFileAtomic`, `readTextFile`,
 * `ensureDir` and `listDirSorted` all require this type, and the only way to produce a value
 * assignable to it is a successful call to `resolveWithin`. A bare `string` cannot be passed to any
 * of them without an explicit, reviewable `as AbsolutePath` — which is exactly the kind of
 * unexplained assertion R1 forbids outside this one file.
 */
export type AbsolutePath = string & { readonly [ABSOLUTE_PATH_BRAND]: true };

/**
 * Directories FORGE must never write to directly (`specs/02` §2.5). Each is owned by another
 * subsystem: `.git/` by the VCS layer, `.forge/state/` by the run's own append-only event log,
 * `node_modules/` by the package manager. Trailing slashes are part of the value, matching how
 * `specs/02` §2.5 itself writes them — `isDenied` below relies on this to distinguish `.git/config`
 * (denied) from `.gitignore` (not).
 */
export const DENIED_PREFIXES = ['.git/', '.forge/state/', 'node_modules/'] as const;

/**
 * Patterns that mean a relative segment names an absolute location, checked as plain strings before
 * any `node:path` call, so the check is identical regardless of which platform is running it.
 *
 * `specs/02` §2.7 requires Windows to be first-class. On a POSIX host, `path.resolve` does not
 * recognise `C:\Windows\system32` as absolute at all — it would silently become a harmless-looking
 * relative subdirectory name and be written *inside* the project, which is its own kind of wrong.
 * Rejecting the shape outright, on every host, closes that regardless of which platform runs it.
 */
const ABSOLUTE_SHAPE_PATTERNS = [
  /^\//, // POSIX absolute
  /^[a-zA-Z]:[/\\]/, // Windows drive-absolute, either slash style
  /^\\\\/, // Windows UNC
] as const;

/** Whether `relative` is shaped like an absolute path, on any platform. */
function looksAbsolute(relative: string): boolean {
  return ABSOLUTE_SHAPE_PATTERNS.some((pattern) => pattern.test(relative));
}

/**
 * Whether a POSIX-normalised, root-relative path falls under a denied prefix.
 *
 * Case-folded before comparison: `specs/02` §2.7 makes Windows and macOS's default filesystem (APFS,
 * case-insensitive by default) both first-class targets, and both treat `.Git/config` and
 * `.git/config` as the same file. A case-sensitive check would let the deny list be bypassed by
 * capitalisation on exactly the platforms this project is required to support.
 */
function isDenied(relativePosix: string): boolean {
  const withTrailingSlash = `${relativePosix.toLowerCase()}/`;
  return DENIED_PREFIXES.some((denied) => withTrailingSlash.startsWith(denied));
}

/** Converts a resolved OS path to a `/`-separated path relative to `base`, or `undefined` if it escapes. */
function relativePosixWithin(base: string, resolved: string): string | undefined {
  const relative = path.relative(base, resolved);
  if (relative === '') return '';
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join('/');
}

/**
 * Resolves the real path of `candidate`, following any symlink in its deepest *existing* ancestor.
 *
 * Walking up to what exists — rather than requiring `candidate` itself to exist — is what lets this
 * catch a symlink escape for a *write* target, whose leaf file does not exist yet.
 */
function realpathOfDeepestExistingAncestor(candidate: string): string {
  let probe = candidate;
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realAncestor = realpathSync(probe);
  const suffix = path.relative(probe, candidate);
  return suffix === '' ? realAncestor : path.join(realAncestor, suffix);
}

/** The project (or lane worktree) a set of relative paths resolve against. */
export class ProjectPaths {
  private readonly root: string;
  private readonly realRoot: string;

  /**
   * @param root an existing directory. Checked eagerly — a `ProjectPaths` for a root that does not
   * exist is invalid the moment it is constructed, not the moment something is resolved against it.
   * @throws {ForgeError} `CFG-003` if `root` does not exist.
   */
  constructor(root: string) {
    this.root = path.resolve(root);
    try {
      this.realRoot = realpathSync(this.root);
    } catch (cause) {
      throw new ForgeError('CFG-003', { path: root, root }, { cause });
    }
  }

  /**
   * Resolves `relative` to an absolute path inside this project, or throws.
   *
   * @throws {ForgeError} `CFG-003` if the path escapes the root — by traversal, by being absolute
   * (POSIX or Windows-shaped), or by a symlink whose target is outside the root.
   * @throws {ForgeError} `CFG-004` if the path falls under `DENIED_PREFIXES`.
   */
  resolveWithin(relative: string): AbsolutePath {
    if (looksAbsolute(relative)) {
      throw new ForgeError('CFG-003', { path: relative, root: this.root });
    }

    const resolved = path.resolve(this.root, relative);
    const relPosix = relativePosixWithin(this.root, resolved);
    if (relPosix === undefined) {
      throw new ForgeError('CFG-003', { path: relative, root: this.root });
    }

    const realResolved = realpathOfDeepestExistingAncestor(resolved);
    const realRelPosix = relativePosixWithin(this.realRoot, realResolved);
    if (realRelPosix === undefined) {
      throw new ForgeError('CFG-003', { path: relative, root: this.root });
    }

    // Checked against the *resolved* path, not the nominal `relPosix`: a symlink inside the project
    // that points at a denied directory (`alias -> .git`) must not let `resolveWithin('alias/config')`
    // slip past the deny list just because the literal segment typed by the caller was not "git".
    if (isDenied(relPosix) || isDenied(realRelPosix)) {
      throw new ForgeError('CFG-004', { path: relPosix });
    }

    return resolved as AbsolutePath;
  }
}
