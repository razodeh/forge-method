/**
 * The trust anchor (`specs/22` M16 P7, `13` F-TEST-9, `process/SPEC-QUESTIONS.md` Q294 Decision 3/
 * Amendment A3) — a brand-new mechanism with no earlier M16 piece to mirror: `forge parity check
 * --trusted <ref>` must confirm that the real, on-disk `.forge/parity/` tree has not silently
 * drifted from what a reviewed git ref says it should be, asking neither the index nor `git status`,
 * which a `skip-worktree`/`assume-unchanged` flag or an ignore rule can blind.
 *
 * Two independent questions, two exported entry points:
 *
 * - {@link resolveTrustedRef}: is `--trusted <ref>`'s own TEXT one of the two accepted forms (a full,
 *   lower-case commit sha, or a name that begins `refs/` and that `git check-ref-format` accepts),
 *   and does it name a REAL commit in THIS repository, exactly, never a name that merely resolves to
 *   one through git's own ambiguity rules? This is deliberately NOT `reference-ref.ts`/
 *   `reference-commit.ts` reused: those accept a bare TAG name or a sha for a declaration's
 *   `reference.ref`, a different, narrower grammar than `--trusted`'s "a full sha or any
 *   `refs/`-qualified name" (Q294 Decision 3 states both sets of rules side by side specifically
 *   because they differ).
 * - {@link compareTrustAnchor}: given a resolved commit, does the real, on-disk `.forge/parity/` tree
 *   — read directly with `fs`, never through git's index or working-tree filters — have the
 *   identical set of paths and the identical git blob id, byte for byte, as `git ls-tree` reports for
 *   that commit? {@link gitBlobId} is the one new primitive this needs: the git object-store's own
 *   blob-hashing algorithm (`"blob " + <decimal length> + "\0" + <raw bytes>`, then sha1 or sha256),
 *   computed IN-PROCESS so that `git hash-object <path>`'s own clean-filter application (`.gitattributes`
 *   smudge/clean, `-text`, `ident`) never substitutes a converted byte stream for what is actually on
 *   disk.
 *
 * Every git command either function runs sets `GIT_NO_REPLACE_OBJECTS=1` (`execa`'s `env` option
 * merges with the inherited environment, never replacing it): `git replace` can make a ref — or a
 * `ls-tree` of one — read as a different tree than the one actually named, in every worktree of the
 * repository, so the whole anchor is unsound without this.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q294 Decision 3
 * @see process/plans/PLAN-M16.md P7
 */
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import { ProjectPaths, listDirSorted, pathExists, type AbsolutePath } from '@forge/core/fs';
import { execa } from 'execa';

/** Disables `git replace` on every call this module makes — see this module's own file header. */
const NO_REPLACE_OBJECTS: Readonly<Record<string, string>> = { GIT_NO_REPLACE_OBJECTS: '1' };

async function git(
  root: string,
  args: readonly string[],
): Promise<{ readonly exitCode: number; readonly stdout: string }> {
  const result = await execa('git', [...args], {
    cwd: root,
    reject: false,
    env: NO_REPLACE_OBJECTS,
  });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout };
}

/** The result of resolving `--trusted <ref>`: the real commit it names, or why it is refused. A
 * refusal here is `ok: false` for the whole check (`13` F-TEST-9: "never a skipped comparison"),
 * never a declaration-level verdict — `--trusted` is a command-level argument, not a per-declaration
 * field, so it carries no `invalid`/`missing` distinction of its own. */
export type TrustedRefResolution =
  | { readonly outcome: 'resolved'; readonly sha: string }
  | { readonly outcome: 'refused'; readonly reason: string };

const LOWER_HEX_40 = /^[0-9a-f]{40}$/;
const LOWER_HEX_64 = /^[0-9a-f]{64}$/;
const ANY_CASE_HEX = /^[0-9a-fA-F]+$/;

function refused(reason: string): TrustedRefResolution {
  return { outcome: 'refused', reason };
}

async function resolveShaForm(root: string, sha: string): Promise<TrustedRefResolution> {
  const result = await git(root, ['rev-parse', '--verify', `${sha}^{commit}`]);
  if (result.exitCode !== 0) {
    return refused(`"${sha}" does not resolve to a commit in this repository.`);
  }
  const resolved = result.stdout.trim();
  if (resolved !== sha) {
    return refused(
      `"${sha}" resolves to a different object id ("${resolved}") once peeled to a commit, which ` +
        'means it names a tag object, not a commit itself; a commit sha must resolve to itself.',
    );
  }
  return { outcome: 'resolved', sha: resolved };
}

async function resolveRefNameForm(root: string, ref: string): Promise<TrustedRefResolution> {
  const formatCheck = await git(root, ['check-ref-format', ref]);
  if (formatCheck.exitCode !== 0) {
    return refused(`"${ref}" is not a ref name "git check-ref-format" accepts.`);
  }
  const showRef = await git(root, ['show-ref', '--verify', ref]);
  if (showRef.exitCode !== 0) {
    return refused(
      `"${ref}" does not name an existing ref ("git show-ref --verify" found none at that exact path).`,
    );
  }
  const revParse = await git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (revParse.exitCode !== 0) {
    return refused(`"${ref}" exists but does not resolve to a commit.`);
  }
  return { outcome: 'resolved', sha: revParse.stdout.trim() };
}

/**
 * Resolves `rawRef` (the literal text given to `--trusted`) to the one real commit it names in the
 * repository containing `root`, or to why it is refused. Neither accepted form can begin with `-`
 * (a sha is hex digits only; a `refs/`-prefixed name's own leading characters are literally `refs/`),
 * so `rawRef` is never read as an option by any git subprocess this calls.
 *
 * Accepted forms, in the order checked (`13` F-TEST-9, Q294 Decision 3):
 * 1. `HEAD` is refused outright — it moves with every commit.
 * 2. A full, LOWER-CASE commit sha (40 hex digits in a SHA-1 repository, 64 in a SHA-256 one):
 *    resolved by `git rev-parse --verify <sha>^{commit}`, and accepted only when that returns the
 *    IDENTICAL digits — an abbreviation, an upper-case spelling or (because peeling a tag object's id
 *    returns the commit it points at, not the tag object's own id) a tag object's id are each refused
 *    by this equality check, not merely "whatever `rev-parse` returns".
 * 3. A name that begins `refs/` and that `git check-ref-format` accepts: accepted only after
 *    `git show-ref --verify <ref>` confirms that EXACT ref exists (a name that merely resolves, as
 *    `refs/heads/refs/heads/main` can for `refs/heads/main`, is not that ref), then peeled to its
 *    commit by `git rev-parse --verify <ref>^{commit}` (so an annotated tag resolves to the commit it
 *    points at, never its own tag-object id).
 * 4. Anything else — a bare name with no `refs/` prefix (which a planted tag could shadow), any other
 *    hex string (too short/long, or the right length with an upper-case letter) — is refused without
 *    a git call: neither could be the two forms above no matter what this repository contains.
 */
export async function resolveTrustedRef(
  root: string,
  rawRef: string,
): Promise<TrustedRefResolution> {
  if (rawRef === 'HEAD') {
    return refused('"HEAD" moves with every commit and cannot be a stable trust anchor.');
  }
  if (LOWER_HEX_40.test(rawRef) || LOWER_HEX_64.test(rawRef)) {
    return resolveShaForm(root, rawRef);
  }
  if (ANY_CASE_HEX.test(rawRef)) {
    const fullLength = rawRef.length === 40 || rawRef.length === 64;
    return refused(
      fullLength
        ? `"${rawRef}" has the length of a full commit sha but contains an upper-case letter; a ` +
            'commit sha must be lower-case.'
        : `"${rawRef}" is ${String(rawRef.length)} hexadecimal digit(s), neither 40 nor 64, so it is ` +
            'refused as an abbreviated or malformed commit sha.',
    );
  }
  if (!rawRef.startsWith('refs/')) {
    return refused(
      `"${rawRef}" is a bare name, which a planted tag or branch elsewhere could shadow; --trusted ` +
        'requires a full commit sha or a name that begins "refs/".',
    );
  }
  return resolveRefNameForm(root, rawRef);
}

/** The two git object-store formats this module computes a blob id for — chosen by the length of an
 * already-resolved commit sha (`13` F-TEST-9: "a 64-digit commit id means SHA-256"), never guessed or
 * configured separately. */
export type GitObjectFormat = 'sha1' | 'sha256';

/**
 * The git object format implied by `commitSha`'s own length — the same inference `resolveTrustedRef`'s
 * own resolved result already makes meaningful (every repository is internally consistent: every
 * object id in it, commits and blobs alike, has the identical digit count).
 *
 * @throws {Error} if `commitSha` is neither 40 nor 64 hex digits — unreachable for a sha this
 * module's own `resolveTrustedRef` returned, which is every real caller.
 */
export function gitObjectFormatForCommitSha(commitSha: string): GitObjectFormat {
  if (commitSha.length === 40) return 'sha1';
  if (commitSha.length === 64) return 'sha256';
  throw new Error(
    `unreachable: gitObjectFormatForCommitSha received a sha of length ${String(commitSha.length)}, ` +
      'neither 40 nor 64; every caller in this module only ever passes an already-resolved commit id.',
  );
}

/**
 * The git object store's own blob hash of `bytes`, computed in-process: `"blob " + <decimal byte
 * length> + "\0" + bytes`, hashed with `format`'s algorithm. Deliberately never `git hash-object
 * <path>`, which applies a `.gitattributes` clean filter (line-ending conversion, `ident` expansion,
 * a smudge/clean filter) to a WORKING-TREE path before hashing it — exactly the substitution the
 * trust anchor must not make, since it must compare the bytes that are actually on disk, not a
 * filtered reinterpretation of them (`13` F-TEST-9, Q294 Decision 3).
 */
export function gitBlobId(bytes: Uint8Array, format: GitObjectFormat): string {
  const header = Buffer.from(`blob ${String(bytes.length)}\0`, 'utf8');
  return createHash(format === 'sha1' ? 'sha1' : 'sha256')
    .update(Buffer.concat([header, Buffer.from(bytes)]))
    .digest('hex');
}

/** One path under `.forge/parity/` (or `.forge`/`.forge/parity` themselves) where the on-disk tree
 * and the trusted commit disagree — `13` F-TEST-9's own `oracle-changed` reason names each one of
 * these, never the content itself. */
export interface TrustAnchorDifference {
  readonly path: string;
  readonly reason: string;
}

export type TrustAnchorComparison =
  | { readonly outcome: 'clean' }
  | { readonly outcome: 'changed'; readonly differences: readonly TrustAnchorDifference[] };

/** A parsed `git ls-tree -r -z` blob/commit entry: mode, type, object id and path, exactly as
 * `-z` prints them (`<mode> <type> <oid>\t<path>`, NUL-terminated records, never `\n`-terminated,
 * which a path containing a literal newline would otherwise break). */
const LS_TREE_RECURSIVE_ENTRY = /^(\d{6}) (blob|tree|commit) ([0-9a-f]+)\t([\s\S]+)$/;

/** Every blob (and, if git's own tree-walking were ever to emit one at this exact depth, non-blob)
 * entry `git ls-tree -r` lists under `.forge/parity/`, keyed by its path EXACTLY as `ls-tree` prints
 * it — relative to `root` (`committed-tree.ts`'s own file header already confirms this for an
 * identical invocation style: "`git ls-tree ... -- .` shows paths relative to the current
 * directory"). A mode of `120000` (a committed symlink) or a type other than `blob` (a `commit`
 * gitlink/submodule entry; `tree` is not reachable with `-r`, which expands every tree it finds, but
 * is still classified rather than silently ignored if git's own behaviour ever changed) is recorded
 * with `kind: 'not-a-regular-file'` rather than an object id to compare — `13` F-TEST-9: "so is a
 * symlink or any other entry that is neither a regular file nor a directory, whatever the tree
 * holds".
 */
type CommittedEntry =
  { readonly kind: 'blob'; readonly oid: string } | { readonly kind: 'not-a-regular-file' };

async function listCommittedParityEntries(
  root: string,
  commitSha: string,
): Promise<ReadonlyMap<string, CommittedEntry>> {
  const result = await git(root, ['ls-tree', '-r', '-z', commitSha, '--', '.forge/parity']);
  const entries = new Map<string, CommittedEntry>();
  for (const record of result.stdout.split('\0')) {
    if (record === '') continue;
    const match = LS_TREE_RECURSIVE_ENTRY.exec(record);
    if (
      match?.[1] === undefined ||
      match[2] === undefined ||
      match[3] === undefined ||
      match[4] === undefined
    ) {
      continue; // Defensive: every real `ls-tree -r -z` record matches this shape.
    }
    // The entry's TYPE (blob/tree/commit) is not read here: `mode` alone already distinguishes a
    // regular file from everything else this module treats as `'not-a-regular-file'` (`120000`, a
    // symlink; `160000`, a submodule gitlink; `ls-tree -r` never emits a bare `tree` line at all,
    // since `-r` recurses through every tree it finds).
    const [, mode, , oid, entryPath] = match;
    entries.set(
      entryPath,
      mode === '100644' || mode === '100755'
        ? { kind: 'blob', oid }
        : { kind: 'not-a-regular-file' },
    );
  }
  return entries;
}

/** What one of `.forge`/`.forge/parity` IS at `commitSha`, in the committed tree: absent, a real
 * directory (tree), or anything else (a file, a symlink — `13` F-TEST-9: "where present, each must
 * be a directory"). `-d` (not `-r`) is load-bearing: a plain `ls-tree <tree> -- <dir>` without it
 * lists `<dir>`'s own CHILDREN, never a single entry describing `<dir>` itself, which is exactly the
 * wrong question here (confirmed directly against real git before relying on it, this module's own
 * test file).
 */
async function committedAncestorKind(
  root: string,
  commitSha: string,
  relativePath: string,
): Promise<'absent' | 'tree' | 'other'> {
  const result = await git(root, ['ls-tree', '-d', '-z', commitSha, '--', relativePath]);
  const record = result.stdout.split('\0').find((entry) => entry !== '');
  if (record === undefined) return 'absent';
  const match = /^(\d{6}) (blob|tree|commit) [0-9a-f]+\t[\s\S]+$/.exec(record);
  return match?.[2] === 'tree' ? 'tree' : 'other';
}

/** What one of `.forge`/`.forge/parity` IS on disk: absent, a real directory, or anything else (a
 * symlink, a regular file, a FIFO) — `lstat`, never `stat`, so a symlinked ancestor is reported as
 * itself, never followed.
 *
 * `ENOTDIR` is classified the identical way `ENOENT` already is: both mean "nothing real exists at
 * exactly this path" (`ENOTDIR` happens when a PARENT component — `.forge`, for `.forge/parity` —
 * is itself a plain file, so `.forge/parity` cannot exist as a path at all, not even as "a file
 * there"). Found missing by a round-2 critic: `.forge` replaced by a plain file made THIS function's
 * own call for `.forge/parity` throw a raw, unwrapped `ENOTDIR` `Error` (never a `ForgeError`),
 * because only `ENOENT` was special-cased here — the ancestor check for `.forge` ITSELF still caught
 * the real problem (a `tree`/`other` mismatch), but the second call crashed past it regardless. */
async function onDiskAncestorKind(absolutePath: string): Promise<'absent' | 'dir' | 'other'> {
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (cause) {
    if (isEnoentOrEnotdir(cause)) return 'absent';
    throw cause;
  }
  return stats.isDirectory() ? 'dir' : 'other';
}

/** True for an ENOENT or ENOTDIR -- either directly (a raw `lstat`/`open` failure) or one level
 * down, on a wrapped error's own `.cause`. `@forge/core/fs`'s `listDirSorted` always wraps a raw
 * `readdir` failure as `RUN-034` (its own TSDoc: "on any failure, including `path` not existing"),
 * the real Node error code living on `.cause`, not on the `ForgeError` itself — the identical
 * "unwrap one level" pattern `loop/test/oracle-lint.ts`'s own `isRealErrnoCode` already establishes
 * for the same two primitives. Found missing by a round-2 critic's own stress test: `walk`'s call to
 * `listDirSorted` raced against a concurrent rename threw exactly this wrapped shape, which the
 * direct-only check below did not recognise, so it propagated past `walk`'s own catch as though it
 * were some other, genuinely unexpected failure. Both forms mean the same thing here: nothing real
 * exists at this exact path right now. */
function isEnoentOrEnotdir(error: unknown): boolean {
  if (hasEnoentOrEnotdirCode(error)) return true;
  return error instanceof Error && hasEnoentOrEnotdirCode(error.cause);
}

function hasEnoentOrEnotdirCode(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** On-disk entries under `.forge/parity/` (never including `.forge`/`.forge/parity` themselves,
 * which {@link onDiskAncestorKind} covers), recursively: a regular file's content, read via
 * {@link readOneFile}'s TOCTOU-safe open, or a reason it is a difference regardless of what the
 * committed side holds there (a symlink, a FIFO/socket/device, or a read failure). An EMPTY directory
 * contributes no entry at all (`13` F-TEST-9: "an empty directory... is not an entry", since git
 * itself never tracks one), so this never reports one as added. Sorted by path (`QUALITY-BAR.md`
 * R10): `readdir` gives no ordering guarantee of its own.
 */
async function walkOnDiskParity(
  root: string,
  format: GitObjectFormat,
): Promise<{
  readonly blobs: ReadonlyMap<string, string>;
  readonly violations: ReadonlyMap<string, string>;
}> {
  const blobs = new Map<string, string>();
  const violations = new Map<string, string>();
  const paths = new ProjectPaths(root);

  async function walk(relativeDir: string): Promise<void> {
    // Resolving and listing THIS directory is wrapped too, not only the per-entry `lstat` below: a
    // round-2 critic's stress test found `paths.resolveWithin` -- which does its OWN internal
    // `realpathSync` walk up the ancestor chain, including for the SEED call on `.forge/parity`
    // itself -- throws a raw ENOENT when the directory is renamed away in the exact instant this
    // runs, even though `compareTrustAnchor`'s own caller had just confirmed it was a real directory
    // moments earlier (no lock holds that fact true across the gap). Treated exactly like
    // `pathExists` returning false: nothing found here, never a crash of the whole comparison -- any
    // committed child this directory would have held still surfaces correctly, as "absent on disk",
    // via the ordinary committed-vs-disk join below.
    let absoluteDir: AbsolutePath;
    let names: readonly string[];
    try {
      absoluteDir = paths.resolveWithin(relativeDir);
      if (!(await pathExists(absoluteDir))) return;
      // `listDirSorted` (not a raw `readdir`, R10) gives names only; this module still needs each
      // entry's own type (file/dir/symlink/other) to detect a symlink, which the names alone cannot,
      // so each is `lstat`-ed individually below -- the same per-entry `lstat` style this module's
      // own `onDiskAncestorKind` and `readOneFile` already use, never following a link.
      names = await listDirSorted(absoluteDir);
    } catch (cause) {
      if (isEnoentOrEnotdir(cause)) return;
      throw cause;
    }
    for (const name of names) {
      const relativePath = `${relativeDir}/${name}`;
      const absolutePath = path.join(root, relativePath);
      // Wrapped (never a bare call): an ordinary concurrent edit under `.forge/parity/` -- no lock
      // protects this walk, a disclosed limitation -- can remove or replace this exact entry between
      // `listDirSorted` listing it and this `lstat`. A round-2 critic reproduced a real crash this
      // way (a tight background loop renaming `.forge/parity` away and back while a check ran),
      // which reached `bin.ts`'s own top-level handler as a bare, unwrapped `Error`, printing NO
      // `--json` envelope at all -- a direct violation of `10` §10.3's check contract. Treated as a
      // violation of this one path, the same as an unreadable file below, never a crash of the whole
      // comparison: a genuinely vanished entry is reported as a difference (it will not match
      // whatever the trusted commit says), never silently dropped.
      let stats;
      try {
        stats = await lstat(absolutePath);
      } catch {
        violations.set(relativePath, 'could not be read');
        continue;
      }
      if (stats.isSymbolicLink()) {
        violations.set(relativePath, 'is a symlink on disk');
        continue;
      }
      if (stats.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      if (!stats.isFile()) {
        violations.set(relativePath, 'is neither a regular file nor a directory on disk');
        continue;
      }
      let bytes: Buffer | undefined;
      try {
        bytes = await readOneFile(absolutePath);
      } catch {
        violations.set(relativePath, 'could not be read');
        continue;
      }
      if (bytes === undefined) {
        violations.set(relativePath, 'is neither a regular file nor a directory on disk');
        continue;
      }
      blobs.set(relativePath, gitBlobId(bytes, format));
    }
  }

  await walk('.forge/parity');
  return { blobs, violations };
}

/** The TOCTOU-safe read {@link hashOnDiskFile} documents, returning the raw bytes (hashing is the
 * caller's job, which already knows the object format). Split out from {@link hashOnDiskFile}'s own
 * narrative so `walkOnDiskParity`'s loop can tell "not a regular file" (`undefined`) from "could not
 * be opened or read at all" (thrown) without re-reading this function's own doc comment twice. */
async function readOneFile(absolutePath: string): Promise<Buffer | undefined> {
  const handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return undefined;
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** `differences` (path -> reason) as a sorted-by-path list (`QUALITY-BAR.md` R10: a `Map`'s own
 * iteration order follows insertion, which this module's `Set`-driven union of paths does not fix
 * to any deterministic order on its own). */
function sortedDifferences(
  differences: ReadonlyMap<string, string>,
): readonly TrustAnchorDifference[] {
  return [...differences.entries()]
    .map(([entryPath, reason]) => ({ path: entryPath, reason }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Compares the real, on-disk `.forge/parity/` tree (as it is right now — no symlink followed,
 * ignored and untracked entries included) against what `commitSha` says it should be, and reports
 * every differing path (`13` F-TEST-9, Q294 Decision 3). Never consults the index or `git status`,
 * which a `skip-worktree`/`assume-unchanged` flag or an ignore rule can blind; the object format
 * (sha1/sha256) is inferred from `commitSha`'s own length ({@link gitObjectFormatForCommitSha}).
 *
 * `.forge` and `.forge/parity` are checked as entries in their own right, not merely as a prefix of
 * the recursive listing below (`git ls-tree -r` never emits a line for a tree it recurses into): each
 * must be a real directory, or absent, on BOTH sides alike; a mismatch (present as something else, or
 * present on only one side) is one difference, reported once under that exact path.
 *
 * The recursive comparison below is a parsed-pair-of-maps join: every path either side lists; a path
 * present on only one side (`added`/`deleted`), a path whose on-disk blob id differs from the
 * committed one (`modified`), and a path recorded as a difference regardless of the other side (a
 * symlink or anything else that is neither a regular file nor a directory, on either side) are all
 * reported, each with a short, structural (never content-bearing) reason.
 */
export async function compareTrustAnchor(
  root: string,
  commitSha: string,
): Promise<TrustAnchorComparison> {
  const format = gitObjectFormatForCommitSha(commitSha);
  const differences = new Map<string, string>();

  // `.forge/parity`'s own on-disk kind is captured here (not just used locally in this loop) so the
  // recursive walk below can be skipped outright when it is not actually usable as a directory
  // (absent, or present as a plain file/symlink) -- see the comment just above `walkOnDiskParity`'s
  // own call site for why `walkOnDiskParity` must never be handed a `.forge/parity` that is not a
  // real directory.
  let parityDirIsRealDirectory = false;
  for (const ancestor of ['.forge', '.forge/parity'] as const) {
    const [committedKind, diskKind] = await Promise.all([
      committedAncestorKind(root, commitSha, ancestor),
      onDiskAncestorKind(path.join(root, ancestor)),
    ]);
    if (ancestor === '.forge/parity') parityDirIsRealDirectory = diskKind === 'dir';
    // A `tree`<->`absent` transition for the ancestor ITSELF needs no entry of its own here: git
    // never commits an empty tree (a tree with no blob descendant is pruned from its own parent), so
    // whenever one side is `tree`, that side has at least one child blob under it, and that child is
    // already reported, individually and non-redundantly, by the recursive comparison below (as
    // `added`/`deleted`). What this check exists to catch, and what neither side's `tree`/`absent`
    // alone can produce, is `.forge`/`.forge/parity` being present as something OTHER than a
    // directory — most dangerously a SYMLINK, which `walkOnDiskParity`'s own `readdir` would
    // otherwise transparently follow, silently comparing the symlink's TARGET's contents instead of
    // noticing the substitution at all (`13` F-TEST-9: "where present, each must be a directory").
    if (committedKind === 'other' || diskKind === 'other') {
      differences.set(
        ancestor,
        `the trusted commit has ${describeAncestor(committedKind)} here, and the working tree has ` +
          `${describeAncestor(diskKind)}; each must be a directory, or absent, on both sides.`,
      );
    }
  }

  // `walkOnDiskParity` is called ONLY when the ancestor check immediately above has already
  // confirmed `.forge/parity` is a real, on-disk directory -- never when it is absent (nothing to
  // walk) or present as something else (a plain file or a symlink, already reported as a difference
  // above). A round-2 critic found that calling it unconditionally let its own SEED call
  // (`walk('.forge/parity')`, which — unlike every recursive call one level down, which only ever
  // recurses into a path its OWN parent already `lstat`-ed and confirmed is a directory — went
  // straight to `listDirSorted` with no such confirmation of its own) hit a raw `ENOTDIR` when
  // `.forge` itself was a plain file, surfacing as `RUN-034`: the right FAMILY of error (wrapped, not
  // a crash) but the wrong one for this mechanism's own `oracle-changed` finding, which the ancestor
  // check above already produces correctly and non-redundantly on its own.
  const [committed, disk] = await Promise.all([
    listCommittedParityEntries(root, commitSha),
    parityDirIsRealDirectory
      ? walkOnDiskParity(root, format)
      : { blobs: new Map<string, string>(), violations: new Map<string, string>() },
  ]);

  const allPaths = new Set<string>([
    ...committed.keys(),
    ...disk.blobs.keys(),
    ...disk.violations.keys(),
  ]);
  for (const entryPath of allPaths) {
    const committedEntry = committed.get(entryPath);
    const diskViolation = disk.violations.get(entryPath);
    const diskBlob = disk.blobs.get(entryPath);

    if (committedEntry?.kind === 'not-a-regular-file') {
      differences.set(entryPath, 'the trusted commit holds this path as a symlink or a gitlink.');
      continue;
    }
    if (diskViolation !== undefined) {
      differences.set(entryPath, diskViolation);
      continue;
    }
    const committedOid = committedEntry?.kind === 'blob' ? committedEntry.oid : undefined;
    if (committedOid === undefined && diskBlob !== undefined) {
      differences.set(entryPath, 'exists on disk but the trusted commit has no such path.');
      continue;
    }
    if (committedOid !== undefined && diskBlob === undefined) {
      differences.set(entryPath, 'the trusted commit has this path, but it is absent on disk.');
      continue;
    }
    if (committedOid !== undefined && diskBlob !== undefined && committedOid !== diskBlob) {
      differences.set(entryPath, 'its on-disk content differs from the trusted commit.');
    }
  }

  return differences.size === 0
    ? { outcome: 'clean' }
    : { outcome: 'changed', differences: sortedDifferences(differences) };
}

function describeAncestor(kind: 'absent' | 'tree' | 'dir' | 'other'): string {
  if (kind === 'absent') return 'nothing';
  if (kind === 'tree' || kind === 'dir') return 'a directory';
  return 'something that is not a directory';
}
