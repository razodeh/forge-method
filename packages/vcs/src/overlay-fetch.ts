/**
 * The real git-channel overlay/module bundle fetch (`19` §19.5) plus the shared content-checksum
 * primitive both distribution channels this milestone builds need (`PLAN-M11.md` P1's own Surface
 * deviation: this lives in `@forge/vcs`, not `@forge/extensions`, since it needs this package's own
 * real git primitives — `simple-git`/`execa`, already `02` §2.1's chosen dependency — and
 * `@forge/extensions`'s new `install/` orchestration layer calls it through a new, deliberate
 * `extensions -> vcs` graph edge rather than re-implementing git plumbing of its own).
 *
 * `19` §19.5's own literal format: `git+https://…#tag-or-sha` — pinned to a tag or a SHA, with a
 * floating ref (a branch name, or anything else that is not one of those two) warned about, never
 * refused; the caller decides what to do with the warning. Uses the identical `mkdtemp` + real-git
 * pattern `packages/engine/test/e2e/crash-resume.test.ts`'s own `createTempRepo` and
 * `PLAN-M10.md` P17's own `createSandboxClone` (`packages/engine/src/adopt/verification.ts`) already
 * establish: a full, non-shallow clone (so an arbitrary historical SHA — not just a branch tip — is
 * always reachable for checkout) into a directory under a caller-supplied `workDir`, never
 * `os.tmpdir()` directly — `QUALITY-BAR.md` R10 forbids reading that host fact from production code,
 * and a caller-supplied base keeps the exact location deterministic and project-relative, matching
 * `createSandboxClone`'s own reasoning exactly.
 *
 * @see specs/19 §19.5
 * @see PLAN-M11.md P1
 */
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import { VcsError } from './errors.ts';
import { resolveHeadShaOrUndefined, wrapGitFailure } from './git.ts';

/** A parsed `git+<url>#<tag-or-sha>` overlay/module source spec. */
export interface GitOverlaySpec {
  readonly url: string;
  readonly ref: string;
}

const GIT_SPEC_PREFIX = 'git+';

/** A caller-supplied ref/URL shaped like a CLI flag (leading `-`) is not safely rejected by every git
 * subcommand it might be handed to (`git.ts`'s own `resolveRevision` doc comment names the identical,
 * empirically-confirmed hazard for a different call site) — rejected here, once, before either value
 * is ever passed to `execa`, rather than trusting every call site below to remember the guard.
 * Glob metacharacters (`*`, `?`, `[`) are rejected from `ref` specifically: `classifyRef` below asks
 * `git ls-remote` whether `ref` names a real tag/branch, and `ls-remote`'s own pattern arguments are
 * `fnmatch`-glob, not literal — a critic round found a ref like `"v*"` could match more than one real
 * tag and be misclassified as pinned when it names no single real ref at all. */
function assertSafeSpecPart(value: string, part: 'URL' | 'ref', spec: string): void {
  if (value === '' || value.startsWith('-') || /\s/.test(value)) {
    throw new VcsError({
      code: 'VCS-INVALID-OVERLAY-SPEC',
      message: `"${spec}" has an invalid ${part} ("${value}").`,
      remedy:
        'Use the literal format git+<url>#<tag-or-sha> (e.g. ' +
        '"git+https://example.com/repo.git#v1.0.0") — neither part may be empty, start with "-", ' +
        'or contain whitespace.',
    });
  }
  if (part === 'ref' && /[*?[]/.test(value)) {
    throw new VcsError({
      code: 'VCS-INVALID-OVERLAY-SPEC',
      message: `"${spec}" has a ref ("${value}") containing a glob metacharacter (*, ?, [).`,
      remedy: 'Pin to one literal tag name or commit SHA — a ref may not contain *, ?, or [.',
    });
  }
}

/** Schemes `execa('git', ['clone', url, ...])` is allowed to receive. A critic round found nothing
 * here restricted the URL's own scheme at all: git's own `ext::`/`fd::` remote helper transports run
 * an arbitrary local command or inherit a file descriptor when a git build has them enabled — an
 * adversarial spec (never a real, well-formed `19` §19.5 entry) could smuggle one through unnoticed.
 * A real remote is always one of these five in practice; anything else is refused before ever
 * reaching `execa`, regardless of what the locally-installed git's own `protocol.*.allow` defaults
 * happen to be. */
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'ssh', 'git', 'file']);

/** `user@host:path` — git's own scp-like syntax, schemeless but safe (it can only ever resolve to an
 * ssh remote), so it is accepted alongside the explicit-scheme URLs above rather than rejected for
 * lacking one. */
const SCP_LIKE_URL = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^:]/;

function assertSafeGitUrl(url: string, spec: string): void {
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(url);
  if (schemeMatch !== null) {
    const scheme = (schemeMatch[1] ?? '').toLowerCase();
    if (ALLOWED_URL_SCHEMES.has(scheme)) return;
    throw new VcsError({
      code: 'VCS-INVALID-OVERLAY-SPEC',
      message: `"${spec}" uses a disallowed git URL scheme ("${scheme}").`,
      remedy: `Use one of: ${[...ALLOWED_URL_SCHEMES].join(', ')}.`,
    });
  }
  if (SCP_LIKE_URL.test(url)) return;
  throw new VcsError({
    code: 'VCS-INVALID-OVERLAY-SPEC',
    message: `"${spec}" has a URL ("${url}") that is neither a recognised scheme nor a scp-like (user@host:path) git remote.`,
    remedy: `Use an explicit scheme (${[...ALLOWED_URL_SCHEMES].join(', ')}) or a scp-like git remote.`,
  });
}

/**
 * Parses `19` §19.5's own literal `git+<url>#<tag-or-sha>` format. Rejects (never guesses at) a
 * missing `git+` prefix, a missing `#<ref>` fragment, either part being empty/flag-shaped/
 * whitespace-containing, a ref containing a glob metacharacter, or a URL scheme outside the
 * real-remote allowlist.
 */
export function parseGitOverlaySpec(spec: string): GitOverlaySpec {
  if (!spec.startsWith(GIT_SPEC_PREFIX)) {
    throw new VcsError({
      code: 'VCS-INVALID-OVERLAY-SPEC',
      message: `"${spec}" is not a valid git overlay spec: it must start with "git+".`,
      remedy:
        'Use the literal format git+<url>#<tag-or-sha>, e.g. "git+https://example.com/repo.git#v1.0.0".',
    });
  }
  const rest = spec.slice(GIT_SPEC_PREFIX.length);
  const hashIndex = rest.lastIndexOf('#');
  if (hashIndex === -1) {
    throw new VcsError({
      code: 'VCS-INVALID-OVERLAY-SPEC',
      message: `"${spec}" is missing a pinned "#<tag-or-sha>" fragment.`,
      remedy:
        'Use the literal format git+<url>#<tag-or-sha>, e.g. "git+https://example.com/repo.git#v1.0.0".',
    });
  }
  const url = rest.slice(0, hashIndex);
  const ref = rest.slice(hashIndex + 1);
  assertSafeSpecPart(url, 'URL', spec);
  assertSafeSpecPart(ref, 'ref', spec);
  assertSafeGitUrl(url, spec);
  return { url, ref };
}

/** A structural-hex-shape ref is treated as pinned only once it is confirmed to name neither a real
 * tag nor a real branch at `url` (`classifyRef` below checks both first) — a real, historical commit
 * SHA is never itself advertised by `git ls-remote` (only branch/tag tips are), but a critic round
 * found a *branch* whose own name happens to be hex-shaped (e.g. `deadbeef`) was misclassified as a
 * pinned SHA before ever asking the remote, silently defeating `19` §19.5's own "floating refs warned
 * about" guarantee for exactly that shape of real branch name. */
const SHA_SHAPE = /^[0-9a-f]{7,40}$/i;

export type GitRefKind = 'sha' | 'tag' | 'branch';

/** Whether `ref` matches a real ref under `refPrefix` (`refs/tags` or `refs/heads`) at `url` — checked
 * via `git ls-remote`, fully qualified so a plain, non-glob `ref` can only ever match the one real ref
 * of that exact name (`ls-remote`'s own patterns are `fnmatch`-glob; `assertSafeSpecPart` above already
 * rejects a glob-metacharacter-containing `ref` before it ever reaches this call). Works identically
 * for a real remote URL and a local `file://`/plain-path remote (this piece's own tests use the
 * latter, never a live network call). */
async function matchesRemoteRef(
  url: string,
  ref: string,
  refPrefix: 'refs/tags' | 'refs/heads',
): Promise<boolean> {
  const { stdout } = await wrapGitFailure(
    () => execa('git', ['ls-remote', '--refs', url, `${refPrefix}/${ref}`]),
    `checking whether "${ref}" is a real ref at "${url}"`,
  );
  return stdout.trim() !== '';
}

/** Classifies `ref` per `19` §19.5's own binary framing: pinned (a real tag, or a hex-shaped SHA that
 * is neither a real tag nor a real branch) or floating (a real branch, or anything else unrecognised —
 * checked last, and treated as floating rather than assumed safe, since "unrecognised" is exactly the
 * shape `19` §19.5 says to warn about, not to guess pinned for). */
async function classifyRef(url: string, ref: string): Promise<GitRefKind> {
  if (await matchesRemoteRef(url, ref, 'refs/tags')) return 'tag';
  if (await matchesRemoteRef(url, ref, 'refs/heads')) return 'branch';
  return SHA_SHAPE.test(ref) ? 'sha' : 'branch';
}

function floatingRefWarning(ref: string): string {
  return (
    `"${ref}" is a floating reference (not a tag or a pinned SHA) — the resolved content can change ` +
    'later without this install changing. Pin to a tag or a commit SHA for a reproducible install.'
  );
}

export interface GitOverlayFetchResult {
  readonly path: string;
  readonly url: string;
  readonly ref: string;
  readonly refKind: GitRefKind;
  readonly resolvedCommit: string;
  /** `[]` for a pinned ref (a tag or a SHA); one floating-ref warning otherwise. Never thrown — `19`
   * §19.5 warns on a floating ref, it does not refuse one. */
  readonly warnings: readonly string[];
  readonly checksum: string;
}

export interface FetchGitOverlayOptions {
  /** The base directory a fresh, disposable checkout is created under (`mkdtemp`'d, never the raw
   * value itself). Created if it does not already exist. Never `os.tmpdir()` — see this module's own
   * doc comment for why the caller, not this function, supplies it. */
  readonly workDir: string;
}

/**
 * Fetches and checks out `spec`'s own pinned (or floating, with a warning) ref into a fresh,
 * disposable directory under `options.workDir`, and computes its content checksum.
 *
 * A full (non-shallow) clone, always: a shallow clone only fetches the tip of the default branch,
 * which would silently fail to have a historical SHA or a non-default-branch tag available to check
 * out at all.
 *
 * On any failure once the disposable checkout directory has been created, that directory is removed
 * before the error propagates — a critic round found the first version of this function left a full,
 * non-shallow clone behind permanently on any failure after `mkdtemp` (a bad ref, an unresolvable
 * HEAD, a checksum-phase failure), the identical class of leak `PLAN-M10.md` P17's own
 * `createSandboxClone` gauntlet round already found and fixed for the adjacent "clone succeeded, the
 * next step failed" shape.
 *
 * @throws {VcsError} `VCS-INVALID-OVERLAY-SPEC` if `spec` is not a valid `git+<url>#<tag-or-sha>`.
 * @throws {VcsError} `VCS-GIT-OPERATION-FAILED` if the clone, checkout, or checksum computation
 * itself fails (an unreachable URL, a ref that does not exist at `url`, an unreadable fetched file).
 */
export async function fetchGitOverlay(
  spec: string,
  options: FetchGitOverlayOptions,
): Promise<GitOverlayFetchResult> {
  const { url, ref } = parseGitOverlaySpec(spec);
  const refKind = await classifyRef(url, ref);

  await wrapGitFailure(
    () => mkdir(options.workDir, { recursive: true }),
    `creating "${options.workDir}"`,
  );
  const dest = await wrapGitFailure(
    () => mkdtemp(path.join(options.workDir, 'git-overlay-')),
    `creating a temporary checkout directory under "${options.workDir}"`,
  );

  try {
    await wrapGitFailure(
      () => execa('git', ['clone', '--quiet', url, dest]),
      `cloning "${url}" into "${dest}"`,
    );
    await wrapGitFailure(
      () => execa('git', ['checkout', '--quiet', ref], { cwd: dest }),
      `checking out "${ref}" in "${dest}"`,
    );

    const resolvedCommit = await wrapGitFailure(
      () => resolveHeadShaOrUndefined(dest),
      `resolving HEAD after checking out "${ref}" in "${dest}"`,
    );
    if (resolvedCommit === undefined) {
      // Unreachable in practice — a successful `checkout` of a real ref always leaves HEAD
      // resolvable — but `resolveHeadShaOrUndefined`'s own return type is `string | undefined`, and
      // R1 forbids an unexplained `as string`/`!` past that; a named, real error is the honest
      // alternative to either.
      throw new VcsError({
        code: 'VCS-GIT-OPERATION-FAILED',
        message: `Checking out "${ref}" in "${dest}" left HEAD unresolvable.`,
        remedy: 'Report this as a FORGE bug; a successful checkout should always resolve HEAD.',
      });
    }

    // `computeContentChecksum` already wraps its own failures into a `VcsError` (see its own doc
    // comment) — called directly rather than through a second, redundant `wrapGitFailure` layer.
    const checksum = await computeContentChecksum(dest);

    return {
      path: dest,
      url,
      ref,
      refKind,
      resolvedCommit,
      warnings: refKind === 'branch' ? [floatingRefWarning(ref)] : [],
      checksum,
    };
  } catch (cause) {
    await rm(dest, { recursive: true, force: true });
    throw cause;
  }
}

interface SortedDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
}

/** Local, non-exported sort-before-return wrapper — `vcs`'s own row in `specs/02` §2.2's dependency
 * graph is `['schemas']`, so it cannot depend on `@forge/core/fs`'s `listDirEntriesSorted` for the
 * identical R10 reason `lanes.ts`'s own copy of this exact helper already documents; duplicated here
 * rather than exported from `lanes.ts`, since that module's own version deliberately swallows a
 * missing directory into `[]` (right for lane cleanup, wrong for a checksum walk, which should fail
 * loudly on a directory that is not there). */
async function listDirEntriesSorted(dir: string): Promise<readonly SortedDirEntry[]> {
  // eslint-disable-next-line no-restricted-syntax -- sorted immediately below, see this function's own doc comment
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Every regular file's path (POSIX-separated, relative to `dir`), sorted, excluding `.git` at any
 * depth — a git-fetched checkout's own `.git` directory is version-control bookkeeping, not content
 * a caller ever asked to install, and its own internal object timestamps/pack layout are not
 * deterministic across two clones of the identical content the way this checksum needs to be.
 *
 * A symlink anywhere in the tree is refused outright (`VCS-OVERLAY-SYMLINK-REJECTED`), never silently
 * followed — a critic round found `Dirent.isDirectory()` is `false` for a symlink, so the original
 * version of this walk fell through to the "regular file" branch and `readFile`'d straight through it.
 * For a symlink pointing outside the fetched/local content (an absolute host path, or `../` escaping
 * the checkout root) that reads and folds an arbitrary host file's bytes into a checksum that then
 * gets written into `manifest.yaml` — an information-disclosure vector — and, even for a symlink that
 * stays inside the tree, breaks this function's own documented "two fetches of identical content
 * checksum identically" guarantee the moment the link target differs machine to machine (or is simply
 * dangling, which throws an unwrapped `ENOENT` `readFile` never expects to need to handle here).
 * Refusing is the same fail-closed stance this codebase already takes for other adversarial-shaped
 * input it cannot safely interpret, rather than attempting a containment-checked resolution this
 * piece's own ~400-line budget does not have room to get right. */
async function collectContentFiles(root: string): Promise<readonly string[]> {
  const results: string[] = [];
  async function walk(current: string, relative: string): Promise<void> {
    const entries = await listDirEntriesSorted(current);
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const entryRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const entryAbs = path.join(current, entry.name);
      if (entry.isSymbolicLink) {
        throw new VcsError({
          code: 'VCS-OVERLAY-SYMLINK-REJECTED',
          message: `"${entryRelative}" is a symlink; overlay/module content may not contain symlinks.`,
          remedy: 'Remove the symlink and replace it with a real file or directory.',
        });
      }
      if (entry.isDirectory) {
        await walk(entryAbs, entryRelative);
      } else {
        results.push(entryRelative);
      }
    }
  }
  await walk(root, '');
  return results.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A real, deterministic SHA-256 over every regular file under `dir` (excluding `.git`) — a plain
 * "hash the directory's own bytes on disk" would depend on traversal order and per-file boundaries in
 * a way that is easy to get accidentally non-deterministic; this instead hashes one canonical
 * manifest line per file (`<posix-relative-path>\0<sha256-of-that-file's-content>\n`, files sorted by
 * path) and then hashes the manifest itself, so the *set of (path, content)* is what the checksum
 * actually commits to — the same two fetches of identical content always produce the identical
 * checksum regardless of filesystem enumeration order, and any single byte changing anywhere (content
 * or a file's own path) changes the result.
 *
 * Exported so both distribution channels this milestone builds (`19` §19.5 step 1: "fetch and verify
 * integrity") share one implementation rather than each computing its own.
 *
 * Every failure — a permission error, a TOCTOU race (a file removed between the directory listing and
 * the read), a rejected symlink — is wrapped into a real `VcsError` via `wrapGitFailure`, never left
 * as a raw `node:fs` exception: a critic round found the first version of this function let exactly
 * that leak straight out of both this function's own public contract and, transitively,
 * `fetchLocalOverlay`'s (`@forge/extensions/install`), whose own docstring promises only two named
 * `ForgeError` codes.
 *
 * @throws {VcsError} on any failure reading the directory tree.
 */
export async function computeContentChecksum(dir: string): Promise<string> {
  return wrapGitFailure(async () => {
    const files = await collectContentFiles(dir);
    const manifest = createHash('sha256');
    for (const relativePath of files) {
      const content = await readFile(path.join(dir, ...relativePath.split('/')));
      const fileHash = createHash('sha256').update(content).digest('hex');
      manifest.update(relativePath);
      manifest.update('\0');
      manifest.update(fileHash);
      manifest.update('\n');
    }
    return manifest.digest('hex');
  }, `computing the content checksum of "${dir}"`);
}
