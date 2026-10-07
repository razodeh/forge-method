/**
 * `computeHunks` — `specs/22` M16 P11: a pure module that turns the diff between an explicit base and
 * the current head into a list of hunks. Nothing here runs a test, mutates a project tree, or applies
 * anything for real — that is M16 P12's own `hunk-mutation.ts`, built on top of what this module
 * returns.
 *
 * **The diff is produced with fixed flags** (`git diff -U0 --no-renames --diff-algorithm=myers
 * --no-ext-diff`, fixed `a/`/`b/` prefixes): confirmed directly against real throwaway repositories
 * (`hunks.test.ts`) that dropping `-U0` or `--no-renames` genuinely changes the real output, not
 * merely in theory — `-U0` turns a context-bearing hunk into a zero-context one with a different
 * pinned count, and dropping `--no-renames` turns a real delete+add pair into a single `R100` rename
 * entry, a different shape the rest of this module does not parse. The algorithm is pinned explicitly
 * so the same pair always yields the same hunks regardless of a project's own `diff.algorithm` config.
 * `--no-ext-diff` (`specs/22` M16 P11 round-2 fix) is load-bearing too, not cosmetic: without it, an
 * ordinary, documented project configuration — a `.gitattributes` `diff=<name>` attribute plus a
 * configured `diff.<name>.command` — replaces this module's ENTIRE rendering with the external
 * driver's own arbitrary stdout, confirmed directly with a real driver config that prints a `+++`
 * line with no `@@` hunk at all. No adversarial input is needed for this mechanism, only an ordinary
 * project setting.
 *
 * **Binary, mode-only, added, deleted, type-changed and submodule paths are FILE-level hunks**, never
 * split into text hunks (`specs/13` F-TEST-10; Q294 Decision 8) — confirmed directly against real
 * fixtures for each shape, including two real surprises none of the spec text calls out. First: a
 * symlink-to-regular-file type change (`git diff --raw`'s own `T` status) prints as TWO SEPARATE
 * `diff --git` blocks for the identical path (one deleting the old blob, one adding the new one)
 * under `-U0`, never a single modify-shaped hunk diff — so `T` is classified from `git diff --raw`'s
 * own status letter, never inferred from the `-U0` output's shape. Second (`specs/22` M16 P11
 * round-2 fix): a submodule (gitlink, mode `160000` on either side) pointer bump is reported by
 * `--raw` as a plain `M` with two different blob ids and by `--numstat` as ordinary, non-binary text
 * (`1\t1\t<path>`), so without a dedicated check it parses as a perfectly well-formed `TextHunk` whose
 * `git apply -R --unidiff-zero` reversal reports success while leaving the gitlink pointer completely
 * untouched — confirmed directly with a real submodule bump and `git ls-files -s` before/after. A
 * plain symlink RETARGET (same mode, `120000`, on both sides — only the target text differs) is
 * deliberately left as an ordinary `TextHunk`: confirmed directly that its reversal correctly restores
 * the original target byte-for-byte, because git's own content model for a symlink already IS the
 * target string, so the generic text-hunk machinery is exactly right for it (unlike a submodule's
 * gitlink, where "content" is a commit reference `git apply` cannot meaningfully check out).
 *
 * **No path is ever recovered by parsing a diff's own human-readable text** (`specs/22` M16 P11
 * round-2 fix). `--raw -z`/`--numstat -z` output is NUL-delimited and structurally unquoted by git
 * regardless of content — confirmed directly with a real tab-named and a real quote-named file — so
 * every path this module returns comes from there. The `-U0` diff's own `+++ b/<path>` line is never
 * parsed for this: git C-quotes a path containing a control character, backslash or `"`
 * UNCONDITIONALLY in every human-readable diff line, which `core.quotePath=false` does not suppress
 * (that setting affects only bytes ≥0x80) — confirmed directly that such a path's `+++` line cannot be
 * matched at all. Each file's own section of the combined `-U0` diff is matched to its real path by
 * POSITION instead, zipped against the text-path list this module already built from the raw
 * listing — sound because both listings share the identical sorted (tree) order for the identical
 * base/head inputs, confirmed directly with a real multi-file, weird-named fixture, and guarded by an
 * explicit count check (`computeHunks`'s own `RUN-131`) rather than trusted blindly.
 *
 * **Every git invocation here reads `stdout` as raw bytes with `stripFinalNewline: false`.** execa
 * 9's own default (`stripFinalNewline: true`) strips the final newline from `stdout` — and, for a
 * CRLF file whose last line is the very last thing `git diff` prints, that default strips BOTH the
 * `\r` and the `\n` (`strip-final-newline`'s own binary-mode check treats a trailing `\r\n` as one
 * unit), silently discarding two real bytes of the file's own content, not merely a tool-added
 * newline. Confirmed directly: the same real diff against a real CRLF fixture, captured once with
 * execa's own default and once with `stripFinalNewline: false`, differs in exactly those two trailing
 * bytes. The raw-diff and numstat listings decode as plain UTF-8 (unquoted by `-z`, so plain UTF-8
 * decoding is exact for the mode numbers, blob ids, status letters and real paths they carry — never
 * a file's own content), but the `-U0` hunk diff is captured as a `Buffer` and decoded with
 * `'latin1'`, a byte-exact, bijective 0-255 mapping, so a hunk's own body bytes (its added/removed
 * lines, a CRLF line ending, a missing final newline, any non-UTF-8 byte) round-trip exactly through
 * string slicing, hashing and `git apply`'s own stdin — never `'utf8'`, which would either throw or
 * silently substitute U+FFFD for a byte sequence that is not valid UTF-8.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P11
 * @see process/SPEC-QUESTIONS.md Q294 Decision 8, Amendments A11/A12
 */
import { createHash } from 'node:crypto';

import { execa } from 'execa';

import { ForgeError } from '@forge/core';
import { resolveRevision, wrapGitFailure } from '@forge/vcs';

/**
 * Why a binary, mode-only, added, deleted, type-changed or submodule path is one whole-file mutant
 * rather than text hunks (`specs/13` F-TEST-10): there is no text to split, or (`mode-only`) no
 * content change at all, or (`type-changed`) the path changed KIND of thing entirely (a real git diff
 * shows this case as a delete-block plus an add-block for the same path, never a modify-shaped hunk
 * diff), or (`submodule`, `specs/22` M16 P11 round-2 fix) the "content" is a gitlink (mode `160000`
 * on either side) whose two lines (`-Subproject commit <sha>` / `+Subproject commit <sha>`) parse as
 * a perfectly well-formed, reversible-looking `TextHunk` — confirmed directly against a real
 * submodule bump that `git apply -R --unidiff-zero` reports success for that hunk while
 * `git ls-files -s` shows the pointer completely untouched: a silent no-op `reversible: true` would
 * be, which is exactly the false signal a hunk-mutation consumer (M16 P12) must never be given for a
 * pinned dependency bump.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P11
 */
export type FileHunkReason =
  'added' | 'deleted' | 'binary' | 'mode-only' | 'type-changed' | 'submodule';

/**
 * A unit of *text* change between the explicit base and head, over one implementation path
 * (`specs/13` F-TEST-10). `oldStart`/`oldCount` and `newStart`/`newCount` are the hunk's own
 * `@@ -oldStart,oldCount +newStart,newCount @@` ranges verbatim (a count git omits, meaning 1, is
 * normalised to `1` here; an explicit `0` — an insertion with nothing removed, or vice versa — stays
 * `0`). `contentHash` is a sha256 over the hunk's own raw body bytes (every added and removed line,
 * including a trailing `\ No newline at end of file` marker where git prints one, in the exact bytes
 * git printed them, never the `@@...@@` header line itself — the header's own numbers already carry
 * the hunk's position, so the hash is free to answer a different question, "what changed", without
 * the two becoming redundant with each other for the id below).
 *
 * `id` is stable for one base/head pair (every input is a deterministic function of the base, the
 * head and the fixed diff flags) and distinct for two hunks that are textually identical but at
 * different positions in the same file (their `oldStart`/`oldCount`/`newStart`/`newCount` cannot be
 * equal — two real hunks never occupy the same range of one file in one diff — so position alone
 * already guarantees distinctness; the content hash is included anyway so the id also answers "what
 * changed", not only "where", and so that two files sharing one coincidentally-identical range and
 * body remain tied together by content as well as position). See `hunks.test.ts`'s own
 * `computeHunks — hunk id` suite for the mutation that drops both path and content, keeping only the
 * bare range, and the real cross-file collision that produces.
 *
 * `reversible` is whether `git apply -R --check --unidiff-zero` accepts this ONE hunk, alone, against
 * the current content of `path` in the tree `computeHunks` was given (never dropped when `false` — a
 * caller that cannot mutate this hunk still needs to know it exists, `specs/13` F-TEST-10).
 *
 * `patch` (`specs/22` M16 P12, additive) is the identical, byte-exact single-hunk unified diff text
 * (`header + hunkText`, `'latin1'`-decoded exactly as `parseTextSection` already decodes every other
 * substring of the real diff bytes it slices) that `reversible` above is already computed from and
 * then discards — kept, instead, only when `computeHunks` is called with `includePatches: true`
 * (`ComputeHunksOptions`), so a caller that actually needs to APPLY this one hunk's own reversal for
 * real (M16 P12's own hunk-mutation engine: `git apply -R --unidiff-zero`, the identical call minus
 * `--check`) does not have to re-derive the latin1/CRLF-correct patch bytes a second time, independently
 * of this file's own already-proven round-trip logic (this file's own header comment: two full gauntlet
 * rounds to get right). `undefined` for every EXISTING caller (every one omits `includePatches`, and
 * every hunk it ever produced keeps the identical shape it always had — `toEqual`/`toMatchObject`
 * against a literal with no `patch` key still passes, since `undefined` and absent compare equal) —
 * populated only for a caller that opts in. Converting back to the identical bytes `git apply` needs is
 * `Buffer.from(hunk.patch, 'latin1')`, the same bijective decode this file's own header comment already
 * establishes for every other byte-exact round trip here.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P11
 * @see specs/22 M16 P12
 */
export interface TextHunk {
  readonly kind: 'text';
  readonly id: string;
  readonly path: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly contentHash: string;
  readonly reversible: boolean;
  readonly patch?: string;
}

/**
 * One whole-file mutant for a binary, mode-only, added, deleted or type-changed path (`specs/13`
 * F-TEST-10) — never split into `TextHunk`s. `id` is a sha256 over the path, `reason` and the
 * path's old/new git blob ids (from `git diff --raw`), so it is stable for one base/head pair for the
 * identical reason a `TextHunk`'s own id is.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P11
 */
export interface FileHunk {
  readonly kind: 'file';
  readonly id: string;
  readonly path: string;
  readonly reason: FileHunkReason;
}

/** One hunk, text or whole-file (`specs/13` F-TEST-10). @see specs/22 M16 P11 */
export type Hunk = TextHunk | FileHunk;

/**
 * `computeHunks`'s own result. `baseSha`/`headSha` echo back the two resolved commits this list was
 * computed from (never re-derived by a caller) and `diffAlgorithm` echoes the pinned algorithm
 * (`specs/13` F-TEST-10: "the algorithm is pinned and recorded in the evidence") — a future piece
 * writing a `MutationEvidence` `revert-hunks` record (`specs/18` §18.7) reads both straight off this
 * shape rather than re-resolving or re-asserting them.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P11
 */
export interface HunkParseResult {
  readonly baseSha: string;
  readonly headSha: string;
  readonly diffAlgorithm: 'myers';
  readonly hunks: readonly Hunk[];
}

/**
 * `computeHunks`'s own input. `cwd` must be a real git working tree whose CURRENT on-disk content is
 * `headSha` (a lane worktree checked out there, ordinarily) — `reversible` above is checked against
 * whatever is actually on disk at `cwd`, never against a tree object alone, because `git apply` itself
 * has no "check against this tree object" mode. `implementationPaths` is the caller's own split
 * (`binding.ts`'s `splitImplementationAndTestPaths`, M15's own implementation-versus-test split,
 * `specs/22` M16 P11's own Mandate: "the change's own implementation paths only") — this module never
 * re-derives it and never looks at a test path.
 *
 * `includePatches` (`specs/22` M16 P12, additive): `false`/omitted (every caller before this option
 * existed) keeps `computeHunks`'s own output byte-for-byte as it always was — `TextHunk.patch` stays
 * `undefined` on every hunk, and no extra work happens. `true` additionally retains, on every returned
 * `TextHunk`, the identical solo-patch bytes already computed internally to answer `reversible` (see
 * `TextHunk.patch`'s own doc comment) — the one, narrow, additive surface the hunk-mutation engine
 * needs to apply a hunk's own reversal for real, without this module's own classification logic,
 * `TextHunk`'s existing fields, or any EXISTING caller's observed behaviour changing at all.
 *
 * @see specs/22 M16 P11
 * @see specs/22 M16 P12
 */
export interface ComputeHunksOptions {
  readonly cwd: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly implementationPaths: readonly string[];
  readonly includePatches?: boolean;
}

/** One `git diff --raw --no-renames` entry: a path's status, its old/new blob ids, and its old/new
 * *mode* (`specs/22` M16 P11 round-2 fix: a submodule/gitlink entry carries mode `160000` on either
 * side, which `computeHunks` checks for before trusting a blob-id difference to mean real text
 * content — see `FileHunkReason`'s own `'submodule'` member). */
interface RawDiffEntry {
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldBlob: string;
  readonly newBlob: string;
  readonly status: string;
}

const RAW_ENTRY_RE = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])$/;
const NUMSTAT_ENTRY_RE = /^(-|\d+)\t(-|\d+)\t(.*)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Every real git invocation in this module goes through here: replace-objects is left at its
 * default (unlike `specs/13` F-TEST-9's own trust anchor, nothing in F-TEST-10 asks for
 * `GIT_NO_REPLACE_OBJECTS=1`), `core.quotePath=false` so an ordinary non-ASCII path prints as real
 * UTF-8 bytes rather than a C-style-quoted escape, and `stripFinalNewline: false` always — see this
 * file's own header comment for why that default is actively dangerous for a CRLF file's own content. */
async function runGit(
  cwd: string,
  args: readonly string[],
  context: string,
): Promise<{ readonly stdout: string }> {
  return wrapGitFailure(
    () =>
      execa('git', ['-c', 'core.quotePath=false', ...args], {
        cwd,
        stripFinalNewline: false,
      }),
    context,
  );
}

/** The same call as `runGit`, decoded as a `Buffer` instead of a UTF-8 string — for the one
 * invocation (`-U0`'s own hunk body text) where a file's own raw bytes, not git's own ASCII/UTF-8
 * metadata, are what is being read. See this file's own header comment. */
async function runGitBuffer(
  cwd: string,
  args: readonly string[],
  context: string,
): Promise<Buffer> {
  const result = await wrapGitFailure(
    () =>
      execa('git', ['-c', 'core.quotePath=false', ...args], {
        cwd,
        encoding: 'buffer',
        stripFinalNewline: false,
      }),
    context,
  );
  // execa's own `encoding: 'buffer'` result is typed `Uint8Array`, not `Buffer` — `Buffer.from` on an
  // existing `Uint8Array` wraps it (same backing memory, no copy), never re-decodes or re-encodes a
  // single byte of it.
  return Buffer.from(result.stdout);
}

/** `git diff --raw --no-renames -z <base> <head> -- <paths>`: one entry per changed path, in git's
 * own (path-sorted) order — the order `computeHunks` below re-assembles its final list in. `-z`
 * NUL-separates every field so a path holding a literal tab or newline still parses correctly (never
 * relying on `core.quotePath`'s own C-style quoting, which this module does not implement an unquoter
 * for). */
async function runRawDiff(
  cwd: string,
  baseSha: string,
  headSha: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, RawDiffEntry>> {
  const { stdout } = await runGit(
    cwd,
    ['diff', '--raw', '--no-renames', '-z', baseSha, headSha, '--', ...paths],
    `listing the raw diff between "${baseSha}" and "${headSha}"`,
  );
  // The real output always ends in exactly one trailing NUL (confirmed directly): splitting on `\0`
  // therefore always produces exactly one trailing empty string, which `.filter` below drops — never
  // a real (non-empty) meta or path token, each of which is at least one real character.
  const tokens = stdout.split('\0').filter((token) => token.length > 0);
  const entries = new Map<string, RawDiffEntry>();
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const meta = tokens[index];
    const path = tokens[index + 1];
    // Unreachable given the loop guard above (`index + 1 < tokens.length`): a real index inside a
    // real array always has a value. Checked explicitly anyway, the same idiom
    // `doctor/committed-tree.ts` already establishes for a regex match, so `noUncheckedIndexedAccess`
    // narrows both to `string` for the rest of this iteration without a `!` assertion.
    if (meta === undefined || path === undefined) {
      throw new Error(
        'forge/hunks: unreachable: a raw-diff token pair lost one of its two halves.',
      );
    }
    const match = RAW_ENTRY_RE.exec(meta);
    if (match === null) {
      throw new Error(`forge/hunks: unrecognised "git diff --raw" entry for "${path}": "${meta}"`);
    }
    const [, oldMode, newMode, oldBlob, newBlob, status] = match;
    // None of `RAW_ENTRY_RE`'s five capture groups is optional (no `?` in the pattern): a
    // successful match (checked above) makes all five defined; checked explicitly, the same
    // reasoning as the pair check above, so no `!` assertion is needed here either.
    if (
      oldMode === undefined ||
      newMode === undefined ||
      oldBlob === undefined ||
      newBlob === undefined ||
      status === undefined
    ) {
      throw new Error(`forge/hunks: unreachable: "${meta}" matched RAW_ENTRY_RE with a hole.`);
    }
    entries.set(path, { oldMode, newMode, oldBlob, newBlob, status });
  }
  return entries;
}

/** `git diff --numstat --no-renames -z <base> <head> -- <paths>`: which of the given paths git
 * itself calls binary (`-\t-\t<path>`, a structural, locale-independent marker — never the
 * locale-sensitive "Binary files ... differ" text a `-U0` diff prints for the same path). Only
 * consulted for a path `git diff --raw` already reports `M` with a changed blob (a path that is
 * added, deleted, type-changed or mode-only is already a `FileHunk` before this result is ever read). */
async function runNumstatDiff(
  cwd: string,
  baseSha: string,
  headSha: string,
  paths: readonly string[],
): Promise<ReadonlySet<string>> {
  const { stdout } = await runGit(
    cwd,
    ['diff', '--numstat', '--no-renames', '-z', baseSha, headSha, '--', ...paths],
    `listing the numstat diff between "${baseSha}" and "${headSha}"`,
  );
  const tokens = stdout.split('\0').filter((token) => token.length > 0);
  const binaryPaths = new Set<string>();
  for (const token of tokens) {
    const match = NUMSTAT_ENTRY_RE.exec(token);
    if (match === null) {
      throw new Error(`forge/hunks: unrecognised "git diff --numstat" entry: "${token}"`);
    }
    const [, added, removed, numstatPath] = match;
    // None of `NUMSTAT_ENTRY_RE`'s three capture groups is optional (no `?` in the pattern): a
    // successful match (checked above) makes all three defined; checked explicitly rather than with
    // a `!` assertion, the same idiom this file uses throughout.
    if (added === undefined || removed === undefined || numstatPath === undefined) {
      throw new Error(`forge/hunks: unreachable: "${token}" matched NUMSTAT_ENTRY_RE with a hole.`);
    }
    if (added === '-' || removed === '-') binaryPaths.add(numstatPath);
  }
  return binaryPaths;
}

/** `git diff -U0 --no-renames --diff-algorithm=myers --no-ext-diff <base> <head> -- <textPaths>`: the
 * one combined unified diff for every path `computeHunks` has already classified as real text
 * content (never a path that is binary, mode-only, added, deleted, type-changed or a submodule —
 * each of those is a `FileHunk` already, and is never passed here). `--no-ext-diff` (`specs/22` M16
 * P11 round-2 fix) forces git's own internal diff generation: without it, an ordinary, documented
 * project configuration (a `.gitattributes` `diff=<name>` attribute plus a configured
 * `diff.<name>.command`) can replace this call's ENTIRE rendering with the external driver's own
 * arbitrary stdout, confirmed directly — including a real repro that prints a `+++` line with no
 * `@@` hunk at all, and one that omits the `diff --git` boundary line this module splits sections
 * on. No adversarial filename or fixture is needed for this mechanism; it is a real feature a real
 * project can configure for entirely ordinary reasons (a binary format's own human-readable diff
 * driver, for one). */
async function runUnifiedDiff(
  cwd: string,
  baseSha: string,
  headSha: string,
  textPaths: readonly string[],
): Promise<Buffer> {
  return runGitBuffer(
    cwd,
    [
      'diff',
      '-U0',
      '--no-renames',
      '--diff-algorithm=myers',
      '--no-ext-diff',
      baseSha,
      headSha,
      '--',
      ...textPaths,
    ],
    `producing the unified diff between "${baseSha}" and "${headSha}"`,
  );
}

function parseHunkHeaderRange(hunkText: string): {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
} {
  const match = HUNK_HEADER_RE.exec(hunkText);
  if (match === null) {
    throw new Error(`forge/hunks: unrecognised hunk header line: "${hunkText.slice(0, 80)}"`);
  }
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/** Whether `patch` (a complete, standalone, single- or multi-hunk unified diff for one file, as raw
 * bytes) reverses cleanly against the real content currently on disk at `cwd` — `git apply -R --check
 * --unidiff-zero`, exactly as `specs/13` F-TEST-10 names it, never with an added flag. A non-zero exit
 * is a normal, expected DATA outcome (a hunk whose context has since been touched by a later real
 * commit, for one — confirmed directly against a constructed fixture) and is read from `exitCode`,
 * never thrown as a failure: `reject: false` suppresses execa's own exit-code rejection while a
 * genuine inability to even run `git apply` (not installed, not a repository) still throws, through
 * `wrapGitFailure`, exactly as every other call in this module does. */
async function isPatchReversible(cwd: string, patch: Buffer): Promise<boolean> {
  const result = await wrapGitFailure(
    () =>
      execa('git', ['apply', '-R', '--check', '--unidiff-zero'], {
        cwd,
        input: patch,
        reject: false,
      }),
    'checking whether a hunk reverses cleanly against the current tree',
  );
  return result.exitCode === 0;
}

/** One file's own section of the combined `-U0` diff (starting at its own `diff --git a/... b/...`
 * line, up to the next one or the end of the buffer) into its own `TextHunk`s. `path` is NEVER
 * recovered by parsing this section's own `+++ b/<path>` line (`specs/22` M16 P11 round-2 fix): git
 * C-quotes a path containing a control character, backslash or `"` in every human-readable diff
 * line UNCONDITIONALLY, which `core.quotePath=false` does not suppress (that setting only affects
 * bytes ≥0x80) — confirmed directly with a real tab-named and a real quote-named file, both of which
 * this module's own former `+++`-parsing regex could not match at all. `computeHunks` instead passes
 * the real path it already holds from the structurally unquoted `--raw -z` listing, zipped
 * positionally against this section (see `computeHunks`'s own comment for why that zip is sound).
 * `sectionText` is a `'latin1'`-decoded slice of the real diff bytes (see this file's own header
 * comment) — every substring this function slices out of it (a hunk's own header-plus-body text, the
 * shared file header reused for each solo reversibility check) is therefore still byte-exact, and is
 * converted back to real bytes with `Buffer.from(x, 'latin1')` at the one place that matters: the
 * patch handed to `git apply`.
 *
 * `includePatches` (`specs/22` M16 P12): when `true`, every returned `TextHunk` additionally carries
 * its own `patch` — the identical `header + hunkText` string `soloPatch` below is already built from,
 * kept instead of discarded once `isPatchReversible` has used it. `false` (every caller before this
 * option existed) keeps every returned hunk exactly as it always was. */
async function parseTextSection(
  cwd: string,
  sectionText: string,
  path: string,
  includePatches: boolean,
): Promise<readonly TextHunk[]> {
  const hunkStarts: number[] = [];
  const hunkStartRe = /^@@ /gm;
  for (let m = hunkStartRe.exec(sectionText); m !== null; m = hunkStartRe.exec(sectionText)) {
    hunkStarts.push(m.index);
  }
  if (hunkStarts.length === 0) {
    // `computeHunks` only ever calls this with a section for a path `--numstat` already confirmed
    // has a real, non-binary content difference, and `runUnifiedDiff`'s own `--no-ext-diff` (`specs/
    // 22` M16 P11 round-2 fix) forces git's own internal diff generation, which always emits at
    // least one `@@` hunk for a real content difference (confirmed directly) — re-verified directly
    // against the same external-diff-driver repro that used to reach this exact throw: with
    // `--no-ext-diff` in place, the driver is never invoked at all and the normal shape returns. An
    // empty `hunkStarts` here would mean this module's own upstream classification is wrong (or a
    // THIRD git mechanism this piece has not found), not a legitimate empty-diff case.
    throw new Error(
      `forge/hunks: a text file's diff section has no "@@" hunk at all: "${sectionText.slice(0, 160)}"`,
    );
  }
  const header = sectionText.slice(0, hunkStarts[0]);

  const hunks: TextHunk[] = [];
  for (let index = 0; index < hunkStarts.length; index += 1) {
    // `String.prototype.slice`'s own two parameters are both optional (`start?: number, end?:
    // number`), so `hunkStarts[index]`'s `number | undefined` type (every index in this loop is a
    // real index of `hunkStarts` by construction, but `noUncheckedIndexedAccess` cannot see that)
    // needs no narrowing at all here — unlike every other index/capture-group read in this file,
    // which flows into something that genuinely requires a definite value.
    const hunkText = sectionText.slice(hunkStarts[index], hunkStarts[index + 1]);
    const range = parseHunkHeaderRange(hunkText);
    // Every hunk's own `@@...@@` header line is always `\n`-terminated by git itself (confirmed
    // directly: `runGitBuffer`'s own `stripFinalNewline: false` preserves even the real diff's very
    // last line's own trailing newline, see this file's own header comment) -- `indexOf` therefore
    // always finds one here, never `-1`.
    const body = hunkText.slice(hunkText.indexOf('\n') + 1);
    const contentHash = sha256Hex(Buffer.from(body, 'latin1'));
    const id = sha256Hex(
      `${path}\0${String(range.oldStart)},${String(range.oldCount)}` +
        `\0${String(range.newStart)},${String(range.newCount)}\0${contentHash}`,
    );
    const patchText = header + hunkText;
    const soloPatch = Buffer.from(patchText, 'latin1');
    // Each hunk's own `git apply --check` runs one at a time, deliberately: it is cheap and
    // independent, and running N of them concurrently would spawn N subprocesses against the same
    // working tree for no real benefit at the hunk counts this mode is bounded to (about two dozen,
    // `specs/13` F-TEST-10's own cost disclosure).
    const reversible = await isPatchReversible(cwd, soloPatch);
    hunks.push({
      kind: 'text',
      id,
      path,
      ...range,
      contentHash,
      reversible,
      // Omitted (never `patch: undefined`) when not requested -- `exactOptionalPropertyTypes` and
      // this codebase's own established convention (`reporter.ts`'s `makeOutcome`) both treat the two
      // differently, and only genuine omission keeps every EXISTING caller's own `toEqual`/
      // `toMatchObject` assertions (none of which ever expects a `patch` key) trivially unaffected.
      ...(includePatches ? { patch: patchText } : {}),
    });
  }
  return hunks;
}

function makeFileHunk(path: string, reason: FileHunkReason, entry: RawDiffEntry): FileHunk {
  const id = sha256Hex(`${path}\0${reason}\0${entry.oldBlob}\0${entry.newBlob}`);
  return { kind: 'file', id, path, reason };
}

/**
 * Turns the diff between `baseSha` and `headSha`, over `implementationPaths` alone, into a list of
 * hunks (`specs/13` F-TEST-10) — nothing here runs a test or mutates anything. See this file's own
 * header comment for the fixed flags, the file-vs-text-hunk split and the byte-exactness this
 * function keeps throughout.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P11
 */
export async function computeHunks(options: ComputeHunksOptions): Promise<HunkParseResult> {
  const { cwd, baseSha, headSha, implementationPaths, includePatches = false } = options;

  if (implementationPaths.length === 0) {
    // `git diff <base> <head> --` with a trailing `--` and NOTHING after it diffs the WHOLE
    // repository, not nothing — confirmed directly against a real repository before relying on this
    // guard (`03` §3.2.5, `13` F-TEST-10's own "the change's own implementation paths only"). Every
    // git invocation below always receives at least one real path, so none of them is ever reached
    // with an empty pathspec.
    return { baseSha, headSha, diffAlgorithm: 'myers', hunks: [] };
  }

  const [rawEntries, binaryPaths] = await Promise.all([
    runRawDiff(cwd, baseSha, headSha, implementationPaths),
    runNumstatDiff(cwd, baseSha, headSha, implementationPaths),
  ]);

  const textPaths: string[] = [];
  const fileHunksByPath = new Map<string, FileHunk>();
  for (const [path, entry] of rawEntries) {
    if (entry.status === 'A') {
      fileHunksByPath.set(path, makeFileHunk(path, 'added', entry));
    } else if (entry.status === 'D') {
      fileHunksByPath.set(path, makeFileHunk(path, 'deleted', entry));
    } else if (entry.status === 'T') {
      fileHunksByPath.set(path, makeFileHunk(path, 'type-changed', entry));
    } else if (entry.status === 'M') {
      // `specs/22` M16 P11 round-2 fix: checked BEFORE the mode-only/binary checks below, since a
      // submodule bump is a real content difference (`oldBlob !== newBlob`, confirmed directly) that
      // `--numstat` reports as ordinary, non-binary text (`1\t1\t<path>`, confirmed directly) -- the
      // gitlink mode is the only signal that distinguishes it from a real text file, and the whole
      // point of this check is to never let it reach `textPaths` below.
      if (entry.oldMode === '160000' || entry.newMode === '160000') {
        fileHunksByPath.set(path, makeFileHunk(path, 'submodule', entry));
      } else if (entry.oldBlob === entry.newBlob) {
        fileHunksByPath.set(path, makeFileHunk(path, 'mode-only', entry));
      } else if (binaryPaths.has(path)) {
        fileHunksByPath.set(path, makeFileHunk(path, 'binary', entry));
      } else {
        textPaths.push(path);
      }
    } else {
      // `--no-renames` eliminates the `R`/`C` statuses, and a two-commit diff (never the index or the
      // worktree) never produces `U`/`X` either — confirmed directly against a real repository that
      // `A`/`M`/`D`/`T` is the exhaustive set this exact invocation can produce. An unrecognised
      // letter here is a real, loud defect (a wider git version, an unexpected flag) to surface, never
      // a silent, possibly-wrong guess at which bucket it belongs in.
      throw new Error(
        `forge/hunks: unrecognised "git diff --raw" status "${entry.status}" for "${path}"`,
      );
    }
  }

  const textHunksByPath = new Map<string, readonly TextHunk[]>();
  if (textPaths.length > 0) {
    const diffBuffer = await runUnifiedDiff(cwd, baseSha, headSha, textPaths);
    // Every path in `textPaths` already has a real, non-binary content difference (`--numstat`
    // confirmed it before this path was ever added to the list), so `-U0`'s own combined diff over
    // exactly these paths is never empty: `.split` always returns at least one real section here,
    // never the lone `['']` an empty `diffText` would otherwise produce.
    const sections = diffBuffer.toString('latin1').split(/(?=^diff --git )/m);
    // `specs/22` M16 P11 round-2 fix: `sections[i]` is zipped against `textPaths[i]` POSITIONALLY,
    // never by re-parsing a path out of this section's own human-readable `+++ b/<path>` line (see
    // `parseTextSection`'s own doc comment for the real, non-fabricated mechanisms that line cannot
    // always be matched or trusted). The zip is sound because both `runRawDiff` (which `textPaths`
    // is built from, in order) and `runUnifiedDiff` list paths in git's own sorted tree order,
    // independent of the order pathspec arguments are given on the command line — confirmed directly
    // with a real multi-file fixture mixing a tab-named, a quote-named and a plain path, over the
    // identical base/head/--no-renames inputs both calls share. That said, this is an invariant
    // ACROSS two separate git invocations, not a fact this function can see hold at every call site,
    // so a mismatched count is a typed refusal, never a silent misattribution of one path's hunks to
    // another path's name.
    if (sections.length !== textPaths.length) {
      throw new ForgeError('RUN-131', {
        sectionCount: sections.length,
        pathCount: textPaths.length,
      });
    }
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index];
      const sectionPath = textPaths[index];
      // Every index in this loop is a real index of both `sections` and `textPaths` (the loop bound,
      // and the length check just above) — checked explicitly rather than with a `!` assertion.
      if (section === undefined || sectionPath === undefined) {
        throw new Error('forge/hunks: unreachable: the section/path zip lost an index.');
      }
      // Each file's own hunks are parsed (and solo reversibility-checked) one section at a time,
      // deliberately — see `parseTextSection`'s own loop for the identical reasoning against running
      // every check concurrently instead.
      const hunks = await parseTextSection(cwd, section, sectionPath, includePatches);
      textHunksByPath.set(sectionPath, hunks);
    }
  }

  const hunks: Hunk[] = [];
  for (const path of rawEntries.keys()) {
    const fileHunk = fileHunksByPath.get(path);
    if (fileHunk !== undefined) {
      hunks.push(fileHunk);
      continue;
    }
    const pathHunks = textHunksByPath.get(path);
    if (pathHunks === undefined) {
      // Every path this loop reaches was classified, above, as either a `FileHunk` (handled by the
      // branch above) or pushed into `textPaths` — and every path in `textPaths` gets a real entry
      // in `textHunksByPath` from the loop just above, since `runUnifiedDiff` was called with
      // exactly those paths. A path that is neither is this module's own classification disagreeing
      // with itself, never a legitimate "nothing to report" case.
      throw new Error(`forge/hunks: "${path}" was classified as text but produced no hunks at all`);
    }
    for (const hunk of pathHunks) hunks.push(hunk);
  }

  return { baseSha, headSha, diffAlgorithm: 'myers', hunks };
}

/**
 * `--base`'s own CLI-level validation and resolution (`specs/13` F-TEST-10; `process/
 * SPEC-QUESTIONS.md` Q294 Decision 8): `--hunks` without `--base` is a usage error, and so is `--base`
 * without `--hunks` — both `USR-005`, before any git call is even attempted. With both given,
 * `--base` is resolved once, here, to a real commit sha (`@forge/vcs`'s own `resolveRevision`); a
 * `--base` that does not resolve is the third, distinct `USR-005` cause — the plan leaves this case
 * open ("What a `--base` that does not resolve to a commit does is not in the spec; P11 settles it")
 * and Q294 Decision 8 itself names a typed refusal as the expected answer.
 *
 * Returns `undefined` when hunk mode is not engaged at all (neither flag given) — a caller threads
 * that straight through to whatever its own non-hunk default already is (`binding.ts`'s own
 * `baseRevision`, M15-shipped as `'HEAD~1'`); returns the resolved sha otherwise, which then governs
 * the WHOLE run, the change-level portion included (`specs/13` F-TEST-10).
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P11
 * @see process/SPEC-QUESTIONS.md Q294 Decision 8
 */
export async function resolveHunkModeBase(options: {
  readonly cwd: string;
  readonly base: string | undefined;
  readonly hunks: boolean;
}): Promise<string | undefined> {
  const { cwd, base, hunks } = options;
  if (hunks && base === undefined) {
    throw new ForgeError('USR-005', { value: '', reason: 'hunks-without-base' });
  }
  if (!hunks && base !== undefined) {
    throw new ForgeError('USR-005', { value: base, reason: 'base-without-hunks' });
  }
  if (base === undefined) return undefined;
  try {
    return await resolveRevision(cwd, base);
  } catch (cause) {
    throw new ForgeError('USR-005', { value: base, reason: 'base-unresolvable' }, { cause });
  }
}
