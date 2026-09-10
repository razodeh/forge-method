/**
 * Two small `git` helpers C14 (determinism of reporting) needs: `SessionRequest.cwd`'s own doc comment
 * calls it a "lane worktree" (always a real git repository in normal FORGE operation), but a
 * conformance scratch directory is a bare empty one — `initGitRepo` makes it a real repository first.
 * Shelled out to directly via `node:child_process`, not a `@forge/core` helper: `02` §2.2's graph gives
 * `adapter-kit ← schemas, telemetry`, no `core` edge (`SPEC-QUESTIONS.md` Q60 point 6).
 *
 * @see specs/07 §7.6
 * @see SPEC-QUESTIONS.md Q60 point 6
 * @see PLAN-M4.md P4
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function initGitRepo(cwd: string): Promise<void> {
  await execFileAsync('git', ['init', '--quiet'], { cwd });
}

/** The paths `git status --porcelain` reports as changed (untracked, modified, or renamed) in `cwd`,
 * relative to it — for a rename (`R  old.txt -> new.txt`), the *current* path (`new.txt`) is what a
 * caller comparing against "what exists now" wants, not the glued `"old.txt -> new.txt"` line a naive
 * `line.slice(3)` would return (a gauntlet critic found this exact bug). `--untracked-files=all` is
 * required, not optional: git's own default (`normal`) collapses a brand-new untracked *directory* into
 * one line for the directory itself (`?? newdir/`), never individually listing the files inside it — a
 * gauntlet verify pass found this made C13's own filesystem leak-check silently miss a secret written
 * inside a newly-created subdirectory, and separately made C14 wrongly reject a fully compliant adapter
 * that had accurately self-reported a file inside one. Parsed proportionately to what this suite's own
 * fixture paths ever need otherwise — plain ASCII relative paths with no embedded quotes — not a
 * general porcelain-format parser: each line is a two-character status code, a space, then the path
 * (or, for a rename, `old -> new`), per `git status --porcelain`'s own documented format. */
export async function gitStatusPaths(cwd: string): Promise<readonly string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd },
  );
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .map((line) => {
      const pathPart = line.slice(3).trim();
      const renameSeparator = ' -> ';
      const arrowIndex = pathPart.indexOf(renameSeparator);
      return arrowIndex === -1 ? pathPart : pathPart.slice(arrowIndex + renameSeparator.length);
    });
}
