/**
 * `computeChangedFiles` — `07` §7.6's own C14 ("Determinism of reporting: `changedFiles` matches `git
 * status --porcelain` in the worktree") made real. This package has no boundary-graph edge to
 * `@forge/vcs` (confirmed: `adapter-claude-code: ['adapter-kit', 'schemas', 'telemetry']`), so this is
 * a small, local, direct `git status` invocation — not a re-use of `@forge/vcs`'s own richer worktree
 * machinery, which this piece has no need for beyond "what changed in this one directory."
 *
 * @see specs/07 §7.6
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
 */
import { execa } from 'execa';

/**
 * Porcelain v1 with `-z` (confirmed directly against `git help status`): NUL-separates *entries* (and
 * a rename/copy entry's own extra origPath field), while the two-character status and the path within
 * one entry stay space-separated ("a space still separates the status field from the first
 * filename"). No quoting/escaping of special characters either way -- safe for any real filename.
 */
function parsePorcelainZ(stdout: string): readonly string[] {
  const fields = stdout.split('\0').filter((field) => field.length > 0);
  const files: string[] = [];
  let skipNextField = false;
  for (const field of fields) {
    if (skipNextField) {
      // This field is the previous rename/copy entry's own original path -- not a new status entry.
      skipNextField = false;
      continue;
    }
    if (field.length < 4) continue;
    const statusX = field.charAt(0);
    const statusY = field.charAt(1);
    const path = field.slice(3);
    files.push(path);
    // A rename/copy entry (`R`/`C` in either status column) is followed by one extra NUL-terminated
    // field for the original path -- skipped, not pushed, since `SessionResult.changedFiles` is
    // documented as a flat list of paths, not a set of rename pairs, and the *target* path (already
    // pushed above) is the one that matters for "what does this worktree look like now."
    if (statusX === 'R' || statusX === 'C' || statusY === 'R' || statusY === 'C') {
      skipNextField = true;
    }
  }
  return files;
}

/**
 * Runs `git status --porcelain=v1 -z` in `cwd` and returns every changed path, relative to `cwd`.
 * Never throws: a `cwd` that is not a git repository, or any other real failure, resolves to an empty
 * list rather than propagating -- matching this whole package's own established "a real environment
 * failure degrades gracefully, it does not crash session-result construction" discipline
 * (`process.ts`, P1; `spawn.ts`/`run-query.ts`, P2/P3).
 */
export async function computeChangedFiles(cwd: string): Promise<readonly string[]> {
  try {
    const result = await execa('git', ['status', '--porcelain=v1', '-z'], { cwd, reject: false });
    if (result.exitCode !== 0) return [];
    return parsePorcelainZ(result.stdout);
  } catch {
    return [];
  }
}
