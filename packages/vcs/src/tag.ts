/**
 * `createAnnotatedTag`/`tagExists`/`resolveTagCommit` — the real git tag/commit primitives
 * `PLAN-M10.md` P19's own BASELINE phase needs (`17` §17.2 phase 8: "a `BASELINE` tag/commit recording
 * the state at adoption"). Mirrors `git.ts`'s own established shape exactly: every exported function
 * rejects only `VcsError`, direct mutation goes through a raw `git` subprocess via `execa` (never
 * `simple-git`, per this package's own top-of-file tech decision), and a caller-supplied ref/name is
 * always validated structurally before being handed to a second git subcommand (`resolveRevision`'s own
 * established reasoning: a flag-shaped value silently misbehaves rather than failing closed).
 *
 * @see specs/17 §17.2 phase 8
 * @see PLAN-M10.md P19
 */
import { execa } from 'execa';

import { VcsError } from './errors.ts';
import { wrapGitFailure } from './git.ts';

/** `git tag` refuses a name containing whitespace or most punctuation anyway; this rejects it before
 * ever spawning git, with a real remedy, rather than surfacing git's own less-actionable failure text. */
const VALID_TAG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertValidTagName(name: string): void {
  if (VALID_TAG_NAME.test(name)) return;
  throw new VcsError({
    code: 'VCS-INVALID-TAG-NAME',
    message: `"${name}" is not a valid git tag name.`,
    remedy:
      'Use a tag name matching [A-Za-z0-9][A-Za-z0-9._-]* — no whitespace or leading punctuation.',
  });
}

/** Whether `name` already names a real, existing tag in `cwd` — checked via `git rev-parse
 * --verify -q`'s own structural exit-code contract (`isNoCommitsYetResult`'s own sibling reasoning: a
 * missing ref exits 1, never anything to parse from stderr text). */
export async function tagExists(cwd: string, name: string): Promise<boolean> {
  assertValidTagName(name);
  try {
    await execa('git', ['rev-parse', '--verify', '-q', `refs/tags/${name}`], { cwd });
    return true;
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode;
    if (exitCode === 1) return false;
    throw error;
  }
}

/** The commit sha `name` (an existing tag) points at, resolved via `git rev-parse` — never the tag
 * object's own sha for an annotated tag, matching `^{commit}`'s own dereference meaning. Rejects with a
 * `VcsError` if `name` does not exist rather than letting a bare git failure propagate. */
export async function resolveTagCommit(cwd: string, name: string): Promise<string> {
  assertValidTagName(name);
  return wrapGitFailure(async () => {
    const { stdout } = await execa('git', ['rev-parse', '--verify', `${name}^{commit}`], { cwd });
    return stdout.trim();
  }, `resolving tag "${name}" to a commit in "${cwd}"`);
}

/**
 * Creates a real annotated tag at `HEAD` (or `at`, when given a specific commit-ish already resolved
 * via `resolveRevision` by the caller — this function does not itself resolve an arbitrary ref, since
 * every one of its own callers already has a concrete sha in hand by the time BASELINE runs). Refuses
 * — rather than silently moving it — when `name` already exists: a baseline tag is a point-in-time
 * marker; overwriting one is a real, surprising loss of history a caller must ask for explicitly
 * (delete the old tag first) rather than get as a side effect of calling this function again.
 */
export async function createAnnotatedTag(
  cwd: string,
  name: string,
  message: string,
  at?: string,
): Promise<void> {
  assertValidTagName(name);
  if (await tagExists(cwd, name)) {
    throw new VcsError({
      code: 'VCS-TAG-EXISTS',
      message: `Tag "${name}" already exists.`,
      remedy: `Delete the existing tag first (\`git tag -d ${name}\`) if you intend to replace it, or choose a different name.`,
    });
  }
  await wrapGitFailure(async () => {
    const args = ['tag', '-a', name, '-m', message];
    if (at !== undefined) args.push(at);
    await execa('git', args, { cwd });
  }, `creating annotated tag "${name}" in "${cwd}"`);
}
