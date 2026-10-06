/**
 * `resolveReferenceCommit` — resolving a `reference.ref` that has already passed P2's own FORMAT
 * check (`reference-ref.ts`'s `classifyReferenceRefFormat`: a well-formed sha, or a tag name
 * `git check-ref-format` accepts) to an actual commit in a REAL repository, which that format check
 * explicitly does not have (`reference-ref.ts`'s own doc comment: "a question only a real git tree
 * can answer, which this piece does not have"). `13` F-TEST-9's observation bullets need that real
 * commit to build the reference's scratch worktree at — this piece's own brief names the resolution
 * itself ("resolving a format-valid ref/sha to an actual commit against a real repository... is THIS
 * piece's job — P2 explicitly deferred it to you") as distinct from DECIDING the declaration-level
 * verdict name (`invalid`/`missing`) that a caller (P4/P6/P7) attaches to the fact this reports: this
 * module hands back a plain, three-way FACT (`resolved`/`names-a-branch`/`not-found`), never the
 * spec's own verdict vocabulary.
 *
 * **The branch-exclusion check is folded in here, not left partial.** `reference-ref.ts`'s own FORMAT
 * check cannot tell a branch name from a tag name — git's ref grammar is identical for both — so a
 * `reference.ref` naming an existing branch would otherwise resolve as a tag (or fail outright) with
 * no warning that it is actually a moving target, exactly what `13` F-TEST-9's self-agreeing-oracle
 * ban (F-TEST-2) exists to catch. `SPEC-QUESTIONS.md` Q295 Decision 4's own corrected rule is applied
 * literally: `refs/heads/<name>` is checked FIRST and unconditionally, before any tag resolution is
 * even attempted, and a match there is `names-a-branch` regardless of whether a same-named tag also
 * exists (confirmed directly, this module's own test file: a branch and a tag of the identical name,
 * pointing at two different commits, where git's own bare `<name>^{commit}` resolution silently picks
 * the TAG's commit with only a `warning:` on stderr — exactly the ambiguity a `reference.ref` must
 * never lean on).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/SPEC-QUESTIONS.md Q294 Decision 6
 * @see process/SPEC-QUESTIONS.md Q295 Decision 4
 * @see packages/cli/src/commands/parity/reference-ref.ts (the FORMAT half this module continues)
 */
import { execa } from 'execa';

/** The two shapes {@link resolveReferenceCommit} accepts: a declaration's `reference.ref` that has
 * already passed `classifyReferenceRefFormat`'s own FORMAT check (never `invalid` -- a declaration
 * with an invalid-shaped `reference.ref` never reaches observation at all, per P2's own loader). */
export type FormatValidReferenceRef =
  { readonly kind: 'sha'; readonly sha: string } | { readonly kind: 'tag'; readonly name: string };

/** The fact this module resolves to: a real commit, a bare name that turned out to be a branch
 * (never resolved as if it were a tag), or a well-formed sha/tag naming no commit at all. Deliberately
 * NOT the spec's own `invalid`/`missing` verdict words -- see this module's own doc comment. */
export type ReferenceCommitResolution =
  | { readonly outcome: 'resolved'; readonly sha: string }
  | { readonly outcome: 'names-a-branch' }
  | { readonly outcome: 'not-found' };

async function revParseCommit(root: string, revision: string): Promise<string | undefined> {
  const result = await execa('git', ['rev-parse', '--verify', `${revision}^{commit}`], {
    cwd: root,
    reject: false,
  });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

/**
 * Resolves `ref` to the real commit it names in the repository containing `root`, or to why it
 * cannot be resolved. Never throws for an ordinary "this does not resolve" outcome (that is
 * `not-found`/`names-a-branch`, both legitimate, anticipated facts, not failures of this function);
 * a genuine git-level failure (not a repository at all, a corrupted one) propagates as whatever
 * `execa` raises, which is this piece's own precondition (observation already requires a real
 * repository to do anything at all) rather than a case this function's own callers need a distinct
 * code for.
 */
export async function resolveReferenceCommit(
  root: string,
  ref: FormatValidReferenceRef,
): Promise<ReferenceCommitResolution> {
  if (ref.kind === 'sha') {
    const sha = await revParseCommit(root, ref.sha);
    return sha === undefined ? { outcome: 'not-found' } : { outcome: 'resolved', sha };
  }
  // Checked first and unconditionally, regardless of whether a same-named tag also exists -- see
  // this module's own doc comment for why the order is load-bearing.
  const branchSha = await revParseCommit(root, `refs/heads/${ref.name}`);
  if (branchSha !== undefined) return { outcome: 'names-a-branch' };
  const tagSha = await revParseCommit(root, `refs/tags/${ref.name}`);
  return tagSha === undefined ? { outcome: 'not-found' } : { outcome: 'resolved', sha: tagSha };
}
