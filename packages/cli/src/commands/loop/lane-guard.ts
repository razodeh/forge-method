/**
 * The git calls FORGE makes in a `forge debug` lane the FIX session could write (`PLAN-M13.md` P28,
 * `SPEC-QUESTIONS.md` Q222; `20` §20.2 points 1-3, `20` §20.4).
 *
 * The lane is a worktree whose `.git` is a plain FILE pointing at the real git directory, and the FIX session may
 * write files in the lane. A file named `.git` (or a directory) that points somewhere else, with a
 * `core.fsmonitor` or hook in it, would make the next `git add -A` FORGE runs execute the session's program with
 * whatever environment FORGE passed, before any scan looked at anything. So every git call FORGE makes here:
 *   - restores the lane's `.git` pointer first (`LaneGuard.restore`, which also reports that it had been changed, so
 *     the attempt is refused);
 *   - runs with the scrubbed environment (`scrubbedEnvironment`, no keys or tokens) and with `core.fsmonitor` and
 *     `core.hooksPath` switched off for the call;
 *   - uses argv (never a shell string), `--literal-pathspecs`, and no external diff or text conversion.
 *
 * `collectLaneChanges` is what the FIX scan reads: git's own machine-readable listing (`--raw -z`, NUL-separated, so
 * a quoted or non-ASCII name cannot hide a file from the parser), the new mode of each file (a symlink is `120000`),
 * the ADDED text of each file (a binary treated as text; a line that starts with `+++ ` is content, not a header),
 * and any IGNORED file present (`git add -A` never lists it, but the project's tests would run it).
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { scrubbedEnvironment, type FixChange } from '@forge/engine/rca';
import type { LaneHandle } from '@forge/vcs';
import { execa } from 'execa';

export interface LaneGuard {
  readonly lane: LaneHandle;
  /** Runs `git <args>` in the lane, guarded as the module comment says (the pointer is restored before EVERY call, so
   * a new call site cannot forget); returns stdout (not trimmed). */
  git(args: readonly string[], options?: { readonly input?: string }): Promise<string>;
  /** Puts the lane's `.git` pointer back. `true` when it was already exactly as FORGE created it. */
  restore(): Promise<boolean>;
  /** Whether any restore since the last call found the pointer changed; clears the flag. The FIX scan refuses an
   * attempt whose session did that. */
  takeTamper(): boolean;
  /** `git reset --hard <sha>` and `git clean -ffdxq`: the lane back to `sha`, ignored files and nested repositories
   * included (`resetLaneWorktree` leaves those). */
  reset(sha: string): Promise<void>;
  /** Commits the index exactly as the last scan left it (`collectLaneChanges` stages, so nothing written after the scan
   * is committed): hooks off (`--no-verify`, `core.hooksPath`), and the signing agent's variables only when `sign`. */
  commit(message: string, sign: boolean): Promise<string>;
}

const GUARD_CONFIG: readonly string[] = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
];

export async function createLaneGuard(
  lane: LaneHandle,
  parentEnv: Readonly<Record<string, string | undefined>>,
): Promise<LaneGuard> {
  const pointerPath = path.join(lane.path, '.git');
  const pointer = await readFile(pointerPath, 'utf8');
  // Every call but the commit reads neither the user's nor the system's git config: `.gitattributes` `filter=` and
  // textconv drivers from it would otherwise run on session-written files before any scan.
  const env = scrubbedEnvironment(parentEnv, {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  });
  const state = { tampered: false };
  const restore = async (): Promise<boolean> => {
    let current: string | undefined;
    try {
      current = await readFile(pointerPath, 'utf8');
    } catch {
      current = undefined; // missing, or a directory
    }
    if (current === pointer) return true;
    state.tampered = true;
    await rm(pointerPath, { recursive: true, force: true });
    await writeFile(pointerPath, pointer, 'utf8');
    return false;
  };
  const run = async (
    args: readonly string[],
    options: { readonly input?: string; readonly env?: Readonly<Record<string, string>> } = {},
  ): Promise<string> => {
    await restore();
    const result = await execa('git', [...GUARD_CONFIG, ...args], {
      cwd: lane.path,
      env: options.env ?? env,
      extendEnv: false,
      stdin: options.input === undefined ? 'ignore' : 'pipe',
      ...(options.input === undefined ? {} : { input: options.input }),
    });
    return result.stdout;
  };
  return {
    lane,
    restore,
    takeTamper() {
      const was = state.tampered;
      state.tampered = false;
      return was;
    },
    git: (args, options) => run(args, options?.input === undefined ? {} : { input: options.input }),
    async reset(sha) {
      await run(['reset', '--hard', '--quiet', sha]);
      try {
        await run(['clean', '-ffdxq']);
      } catch {
        // A directory the tests made read-only (or unreadable) stops `git clean`: make the lane writable again, once.
        await execa('chmod', ['-R', 'u+rwX', lane.path], { reject: false });
        await run(['clean', '-ffdxq']);
      }
    },
    async commit(message, sign) {
      // The commit needs what the user configured for it (identity, and signing when `sign`), so it keeps the user's
      // git config and the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` identity variables and, only when signing, the agent's
      // variables; hooks and `core.fsmonitor` stay off for the call. Signing is stated either way, so a global
      // `commit.gpgsign=true` cannot make an unsigned-by-setting run fail after the RCA was written.
      const passthrough = Object.fromEntries(
        Object.entries(parentEnv).filter(
          (entry): entry is [string, string] =>
            entry[1] !== undefined &&
            (/^GIT_(AUTHOR|COMMITTER)_/.test(entry[0]) ||
              (sign && ['GNUPGHOME', 'GPG_TTY', 'SSH_AUTH_SOCK'].includes(entry[0]))),
        ),
      );
      const commitEnv = scrubbedEnvironment(parentEnv, passthrough);
      await run(
        [
          '-c',
          `commit.gpgsign=${sign ? 'true' : 'false'}`,
          'commit',
          '--no-verify',
          '--quiet',
          '-m',
          message,
        ],
        { env: commitEnv },
      );
      return (await run(['rev-parse', 'HEAD'])).trim();
    },
  };
}

/** Everything `scanFixDiff` needs about what the lane holds against `baseSha`. Stages first (`git add -A`), which is
 * what `commitInLane` does; a rejected attempt is discarded by the next reset. */
export async function collectLaneChanges(
  guard: LaneGuard,
  baseSha: string,
): Promise<{ readonly changes: readonly FixChange[]; readonly ignored: readonly string[] }> {
  await guard.git(['add', '-A']);
  const raw = await guard.git([
    'diff',
    '--cached',
    '--raw',
    '-z',
    '--no-renames',
    '--no-abbrev',
    baseSha,
  ]);
  const tokens = raw.split('\0');
  const changes: FixChange[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const meta = tokens[index];
    if (!meta?.startsWith(':')) continue;
    const file = tokens[index + 1];
    index += 1;
    if (file === undefined || file === '') continue;
    // `:<old mode> <new mode> <old sha> <new sha> <status>`
    const fields = meta.slice(1).split(' ');
    const newMode = fields[1] ?? '000000';
    const status = fields[4] ?? 'M';
    let added = '';
    if (status !== 'D' && newMode !== '160000') {
      const text = await guard.git([
        '--literal-pathspecs',
        'diff',
        '--cached',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--text',
        '--no-renames',
        '-U0',
        baseSha,
        '--',
        file,
      ]);
      added = addedText(text);
    }
    changes.push({
      path: file,
      mode: newMode,
      deleted: status === 'D',
      submodule: newMode === '160000',
      added,
    });
  }
  const ignoredRaw = await guard.git([
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '-z',
  ]);
  return { changes, ignored: ignoredRaw.split('\0').filter((entry) => entry !== '') };
}

/** The added lines of one file's `-U0` diff: everything after the first hunk header that starts with `+`. A line whose
 * content begins `++ ` arrives as `+++ ...` and is content, so no `+++` line is skipped once a hunk has started. */
function addedText(diff: string): string {
  const lines = diff.split('\n');
  const start = lines.findIndex((line) => line.startsWith('@@'));
  if (start === -1) return '';
  return lines
    .slice(start)
    .filter((line) => line.startsWith('+'))
    .map((line) => line.slice(1))
    .join('\n');
}
