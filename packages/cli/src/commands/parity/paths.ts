/**
 * `unsafeDeclaredPathReason` — the one path-safety check every declared path in a parity declaration
 * is held to: a `file` surface's declared output path, and a case's overlay `inputs[].to` destination
 * (`13` F-TEST-9: "a declared file output... must be relative, with no `..` component, and lie
 * outside `.git` and `.forge`").
 *
 * A pure, string-only check — no `node:fs` call, no dependence on whether the path exists, so it
 * applies identically whichever tree a case eventually runs against (the reference's scratch
 * worktree, the candidate in place) and at load time, before either exists. Deliberately independent
 * of `@forge/core/fs`'s `ProjectPaths.resolveWithin`: that gate's own deny list
 * (`.git/`, `.forge/state/`, `node_modules/`) is narrower than this one (every declared path must lie
 * outside the whole of `.forge`, not only `.forge/state/`, since `.forge/parity/` itself — the
 * declaration's own home — must never be a case's own output target either), and it requires a real
 * root to resolve against, which a load-time check, run before any case's tree exists, does not have.
 * The absolute-path SHAPE check below mirrors `ProjectPaths`'s own (`packages/core/src/fs/paths.ts`,
 * `looksAbsolute`/`ABSOLUTE_SHAPE_PATTERNS`, not exported from that module's barrel) rather than
 * importing it, for the identical reason `specs/02` §2.7 gives there: a POSIX host's `path.resolve`
 * does not recognise `C:\Windows\system32` as absolute, so the shape is checked as plain text,
 * identically on every platform, before any `node:path` call.
 *
 * @see specs/13 F-TEST-9
 * @see QUALITY-BAR.md R11
 */

/** Why a declared path (a `file` surface output, or a case's overlay `inputs[].to`) is unusable. */
export type UnsafeDeclaredPathReason =
  'empty' | 'absolute' | 'backslash' | 'parent-segment' | 'under-git' | 'under-forge';

const WINDOWS_DRIVE_ABSOLUTE = /^[a-zA-Z]:[/\\]/;

/**
 * The first reason `declaredPath` is unsafe as a destination written into an observed tree, or
 * `undefined` when it is safe. Every reason is checked, in this fixed order, against the raw text —
 * never `node:path`'s own parsing, which is platform-dependent in exactly the way a path a model or a
 * declaration author wrote must not be (`QUALITY-BAR.md` R11).
 *
 * `under-git`/`under-forge` fire only on the path's FIRST segment, matching F-TEST-9's "lie outside
 * `.git` and `.forge`" (a sibling file named `.gitkeep` or a directory named `.forge-backup` is not
 * "under" either; a path matches case-insensitively, since Windows and macOS's default APFS are both
 * case-insensitive, the identical reasoning `@forge/core/fs`'s own `isDenied` gives).
 */
export function unsafeDeclaredPathReason(
  declaredPath: string,
): UnsafeDeclaredPathReason | undefined {
  if (declaredPath.trim() === '') return 'empty';
  if (
    declaredPath.startsWith('/') ||
    WINDOWS_DRIVE_ABSOLUTE.test(declaredPath) ||
    declaredPath.startsWith('\\\\')
  ) {
    return 'absolute';
  }
  // A backslash is refused outright rather than treated as a separator: accepting it as one would
  // make the SAME declared path mean two different things depending on which platform split it, and
  // refusing it is simpler and safer than normalising it — the identical choice `specs/02` §2.7 and
  // `QUALITY-BAR.md` R11 make for every other on-disk path in this codebase ("`path.posix` used only
  // for repo-relative artifact ids").
  if (declaredPath.includes('\\')) return 'backslash';
  const segments = declaredPath.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return 'empty';
  if (segments.some((segment) => segment === '.' || segment === '..')) return 'parent-segment';
  const first = (segments[0] ?? '').toLowerCase();
  if (first === '.git') return 'under-git';
  if (first === '.forge') return 'under-forge';
  return undefined;
}

/**
 * The same text-only shape and `..`-escape checks as {@link unsafeDeclaredPathReason}, but for a
 * case's overlay `inputs[].from` — a SOURCE identifier that is meant to live under `.forge/parity/`
 * (`13` F-TEST-9: "its inputs are overlaid files, copied from under `.forge/parity/`"), so
 * `under-git`/`under-forge` are not refusals here the way they are for a destination.
 */
export function unsafeOverlaySourceReason(
  sourcePath: string,
): Exclude<UnsafeDeclaredPathReason, 'under-git' | 'under-forge'> | undefined {
  const reason = unsafeDeclaredPathReason(sourcePath);
  if (reason === 'under-git' || reason === 'under-forge') return undefined;
  return reason;
}
