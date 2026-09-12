/**
 * `computeChangedFiles` — `07` §7.6's own C14 ("`changedFiles` matches `git status --porcelain` in the
 * worktree"), made real for `files.changeDetection: 'git-status'`. This package has no boundary-graph
 * edge to `@forge/vcs`, so this is a small, local, direct `git status` invocation — the identical
 * duplication `@forge/adapter-claude-code`'s own `changed-files.ts` already establishes for the
 * identical reason (no `vcs` edge on that package's own graph row either).
 *
 * `files.changeDetection: 'fs-watch'` is a real, declared config value this package does not
 * implement: `07` §7.5 gives it no further specification (no debounce window, no ignore-pattern
 * contract), and every conformance fixture in this milestone runs inside a real git worktree anyway
 * (`@forge/adapter-kit/conformance`'s own `initGitRepo`) — `GenericAdapter` refuses outright with a
 * clear, typed error rather than silently falling back to `git-status` behaviour a `fs-watch` author
 * did not ask for. See `SPEC-QUESTIONS.md` for the full record.
 *
 * @see specs/07 §7.6
 * @see PLAN-M11.md P7
 */
import { execa } from 'execa';

/** Porcelain v1 with `-z` (confirmed directly against `git help status`, the identical citation
 * `@forge/adapter-claude-code`'s own sibling function already recorded): NUL-separates entries while
 * the two-character status and the path within one entry stay space-separated. No quoting/escaping
 * either way — safe for any real filename. */
function parsePorcelainZ(stdout: string): readonly string[] {
  const fields = stdout.split('\0').filter((field) => field.length > 0);
  const files: string[] = [];
  let skipNextField = false;
  for (const field of fields) {
    if (skipNextField) {
      skipNextField = false;
      continue;
    }
    if (field.length < 4) continue;
    const statusX = field.charAt(0);
    const statusY = field.charAt(1);
    const path = field.slice(3);
    files.push(path);
    if (statusX === 'R' || statusX === 'C' || statusY === 'R' || statusY === 'C') {
      skipNextField = true;
    }
  }
  return files;
}

/** Never throws: a `cwd` that is not a git repository, or any other real failure, resolves to an empty
 * list rather than propagating — a real environment failure degrades gracefully, it does not crash
 * `SessionResult` construction. */
export async function computeChangedFiles(cwd: string): Promise<readonly string[]> {
  try {
    const result = await execa('git', ['status', '--porcelain=v1', '-z'], { cwd, reject: false });
    if (result.exitCode !== 0) return [];
    return parsePorcelainZ(result.stdout);
  } catch {
    return [];
  }
}
