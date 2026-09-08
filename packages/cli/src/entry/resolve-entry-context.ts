/**
 * `resolveEntryContext` — `03` §3.1's resolution logic end to end, as one pure function.
 *
 * Pure: it takes the directory listing it needs through `readdirSync`/`existsSync` (real, not
 * injected — `@forge/core/fs`'s own containment gate is for *writes*; this only ever reads, and
 * only ever above the current process, so there is nothing here for a lane worktree's containment
 * rules to apply to) and returns a value describing what should happen, rather than doing it. The
 * process-level side effects (launching the TUI, printing the exit-5 message, calling
 * `process.exit`) are a thin caller's job — see `src/entry/node-version.ts`'s own doc comment for
 * why that split makes the Node-version case testable at all.
 *
 * @see specs/03 §3.1
 */
import { existsSync } from 'node:fs';
// `@forge/core/fs`'s own `listDirEntriesSorted` is async and needs an already-branded
// `AbsolutePath`; this function is documented as synchronous (`PLAN-M6.md` C1's own surface) and
// runs *before* any project root — and so before any `ProjectPaths` — is known, and only ever needs
// a count (order-independent), not an ordered listing, so R10's determinism concern does not apply.
// Same exception, same justification, `packages/catalog/src/registry/load.ts` already establishes.
// eslint-disable-next-line no-restricted-imports -- see comment above
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { isSupportedNodeVersion, MIN_NODE_VERSION } from './node-version.ts';
import type { EntryEnv, EntryProjectBranch, EntryResolution } from './types.ts';

function realEntryEnv(): EntryEnv {
  return {
    nodeVersion: process.version,
    isStdinTty: process.stdin.isTTY,
    isStdoutTty: process.stdout.isTTY,
  };
}

/**
 * Walks up from `cwd` looking for `.forge/config.yaml`, stopping at the filesystem root or at a
 * `.forge-root` marker file — `03` §3.1 step 2, verbatim. Returns the directory containing
 * `.forge/config.yaml` when found, `undefined` otherwise (including when a `.forge-root` marker was
 * hit first).
 */
function findProjectRoot(cwd: string): string | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    if (existsSync(path.join(dir, '.forge', 'config.yaml'))) return dir;
    if (existsSync(path.join(dir, '.forge-root'))) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Whether `dir` has no *content* — `03` §3.1's "dir is empty" half of branch 1. `.git` itself does
 * not count: `mkdir proj && cd proj && git init && npx forge-method` is the ordinary greenfield
 * precondition, and a bare `git init` with nothing committed is not "existing code" by any reading
 * of branch 2 — without this exclusion that sequence would misclassify as `adopt-or-init` (offering
 * to adopt a brownfield codebase that does not exist) purely because `.git/` itself is one entry.
 */
function isEmptyDir(dir: string): boolean {
  try {
    return readdirSync(dir).every((name) => name === '.git');
  } catch {
    // Does not exist yet, or is unreadable: nothing to adopt, so treat it the same as empty.
    return true;
  }
}

/** `03` §3.1's non-project branch: empty-or-no-git → the init wizard; has code and git → adopt/init. */
function classifyNonProject(cwd: string): EntryProjectBranch {
  const hasGit = existsSync(path.join(cwd, '.git'));
  const hasCode = !isEmptyDir(cwd);
  return hasCode && hasGit ? 'adopt-or-init' : 'init-wizard';
}

/**
 * `03` §3.1's four-step resolution logic: Node version → context detection → branch → non-TTY
 * refusal. `env` defaults to the real `process`, so the documented two-argument call
 * (`resolveEntryContext(cwd, argv)`) is the common form; a caller only supplies `env` to inject a
 * different Node version or TTY-ness (tests; a future subprocess wrapper), per this package's own
 * determinism discipline (see `EntryEnv`'s own doc comment).
 *
 * `argv` is unused by this function today — `03` §3.1's own steps never branch on flag content, only
 * on the filesystem and the terminal — but is part of the documented surface (`PLAN-M6.md` C1)
 * because a later piece's non-TTY-refusal case (an interactive *command*, not just the bare
 * top-level invocation) will need it to know which command was requested.
 */
export function resolveEntryContext(
  cwd: string,
  _argv: readonly string[],
  env: EntryEnv = realEntryEnv(),
): EntryResolution {
  if (!isSupportedNodeVersion(env.nodeVersion)) {
    return {
      kind: 'unsupported-node-version',
      required: MIN_NODE_VERSION,
      actual: env.nodeVersion,
    };
  }

  const projectRoot = findProjectRoot(cwd);
  const branch: EntryProjectBranch =
    projectRoot !== undefined ? 'dashboard' : classifyNonProject(cwd);

  const isTty = env.isStdinTty && env.isStdoutTty;
  if (!isTty) {
    return { kind: 'non-tty-refusal', underlying: branch };
  }

  if (projectRoot !== undefined) {
    return { kind: 'dashboard', projectRoot };
  }
  return branch === 'adopt-or-init'
    ? { kind: 'adopt-or-init', defaultHighlight: 'adopt' }
    : { kind: 'init-wizard' };
}
