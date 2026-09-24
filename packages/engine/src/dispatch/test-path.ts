/**
 * One test path, validated (`PLAN-M14.md` P5, `SPEC-QUESTIONS.md` Q230's "whole-layer reproduction"
 * problem: an exact `execution.testCommands` grant lets REPRODUCE/PROVE run only a whole test layer,
 * because a model cannot add a `-t` filter or a file argument to an exact pattern — any unrelated red
 * test "reproduces" the defect, and a pre-existing failure blocks PROVE forever). `20` §20.1's derived
 * test-command grant stays exact strings; this module is what lets a PROPOSED command be
 *
 *     <configured test command> <one validated file> [-t/-g/-k <token>]
 *
 * instead of the bare configured command, without widening the grant itself: nothing here adds a
 * pattern, a wildcard or a placeholder to `SessionRequest.tools.exec` or a `Bash(...)` rule (that stays
 * `test-command-grant.ts`'s exact strings, untouched). Two things live here:
 *
 * - `isTestPath` (moved verbatim from `packages/cli/src/commands/run/run-plan.ts`, `09` §9.3's own
 *   heuristic for which of a story's `files_expected` claims are its own tests) and `validateTestPath`,
 *   which decides whether one string is a real, safe, in-project test file: a plain token a shell and a
 *   runner's flag parser both read literally, no `..`, project-relative, an existing regular file that is
 *   never itself a symlink, whose real location stays inside the project even when an ancestor directory
 *   is a symlink, and that sits under a configured `execution.testRoots` entry (or, unconfigured, matches
 *   `isTestPath`'s own built-in rule).
 * - `expandTrustedInvocation`, which recognises the `<trusted> <path> [-t <token>]` shape against a list
 *   of already-configured test commands and a fixed runner table (`vitest`/`jest` take `-t`, `mocha`
 *   `-g`, `pytest` `-k`; a wrapper such as `pnpm test` gets the bare path only).
 *
 * This piece builds the validator only. `confined-command.ts`'s `vetProposedCommand` calls
 * `expandTrustedInvocation` as one more check in its existing pipeline (after the syntax stage, before the
 * grant check — see that module's own comment), but only when its caller passes `VetOptions.
 * allowTrustedPathExtension: true` — unset for every EXISTING caller, so `forge debug`'s RCA loop
 * (`rca/shell.ts`'s `createRcaShell`, which already supplies a non-empty `trustedCommands` for
 * `debug-isolate`'s REPRODUCE/PROVE since P23) is completely unaffected by this file's existence. No RCA
 * loop, no `forge story verify`, and no prompt text offers this form to a model, or turns the flag on, yet.
 *
 * @see specs/20 §20.1
 * @see specs/18 §18.3
 * @see specs/13 §13.1 F-TEST-1 rule 4
 * @see SPEC-QUESTIONS.md Q230
 * @see PLAN-M14.md P5
 */
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

/** A `files_expected` entry is a test path when it is under a conventional test directory or names a test
 * file. `09` §9.3 gives no separate field, and `10` §10.1's `generate-tests` step needs one; the heuristic is
 * deliberately narrow and only decides which of the story's own claims the test-writing step also claims.
 * Also `validateTestPath`'s fallback rule when a project configures no `execution.testRoots`. */
const TEST_PATH = /(^|\/)(tests?|__tests__|e2e)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|_test\.[a-z]+$/;

export function isTestPath(glob: string): boolean {
  return TEST_PATH.test(glob);
}

/** Why a proposed test path was refused. */
export type TestPathProblem = 'malformed' | 'path-escape' | 'not-a-file' | 'outside-test-roots';

export type TestPathCheck =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly problem: TestPathProblem; readonly detail: string };

export interface TestPathValidationOptions {
  /** The lane/project root the path must resolve inside (an absolute filesystem path). */
  readonly root: string;
  /** `execution.testRoots`: project-relative directories a test path must sit under. `undefined` (the key
   * is unset) falls back to `isTestPath`'s own built-in rule; `[]` (set but empty) accepts no path at all. */
  readonly testRoots?: readonly string[] | undefined;
}

/** One token: letters, digits, `_.@-` and `/` — nothing a shell, a quoting layer, or a runner's own flag
 * parser reads specially. Everything outside this set (a space, a quote, `$`, `*`, NUL, a control or
 * invisible character, a non-ASCII lookalike) is refused as `malformed`, so a proposed path is exactly
 * the bytes that reach the runner, never something a shell would expand first. */
const PATH_TOKEN = /^[A-Za-z0-9_./@-]+$/;

function refusal(problem: TestPathProblem, detail: string): Extract<TestPathCheck, { ok: false }> {
  return { ok: false, problem, detail };
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Whether `relPath` (already `..`-free and project-relative) sits under `testRoot`, at a segment
 * boundary: a configured root of `tests` never matches `tests-extra/x.test.ts` (`PLAN-M14.md` P6 makes
 * the identical point for `produces` roots: never `docs/forge/kbx` for a root of `docs/forge/kb`). A
 * leading `./` or a trailing `/` on the configured root is tolerated.
 *
 * A deliberate, disclosed design property: once `execution.testRoots` is configured, matching is
 * DIRECTORY-scoped only — every real, non-symlink file under a listed root is accepted, not only one whose
 * NAME also looks test-shaped (`isTestPath`'s filename heuristic, the fallback for an unconfigured project,
 * is not additionally applied on top of a configured root). This is what lets a project whose test
 * directory does not follow the built-in naming convention (e.g. `spec/`) use the extension at all; the
 * boundary is `execution.testRoots` itself, a protected config key set only by the project (`20` §20.2),
 * the same trust level as `execution.testCommands`. */
function underTestRoot(relPath: string, testRoot: string): boolean {
  const normalizedRoot = testRoot.replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (normalizedRoot === '' || normalizedRoot === '.') return true;
  const rootSegments = normalizedRoot.split('/');
  const pathSegments = relPath.split('/');
  if (rootSegments.length >= pathSegments.length) return false;
  return rootSegments.every((segment, index) => pathSegments[index] === segment);
}

/**
 * Whether `rawPath`, exactly as a model would write it as one bare command-line argument, names one real,
 * project-relative test file: a plain token (no leading `-`, so a runner can never read it as an option),
 * no `..` segment, not absolute, an existing regular file that is never itself a symlink, whose real
 * location (`realpath`) stays inside `root` even when an ancestor directory is a symlink, and that sits
 * under a configured `testRoots` entry (or, when none is configured, matches `isTestPath`'s own built-in
 * rule). `rawPath` is returned verbatim on success — this function validates, it never rewrites, so the
 * string that was checked is exactly the string a caller may put in a command.
 */
export async function validateTestPath(
  rawPath: string,
  options: TestPathValidationOptions,
): Promise<TestPathCheck> {
  if (rawPath === '' || !PATH_TOKEN.test(rawPath)) {
    return refusal(
      'malformed',
      'the path is empty or holds a character other than letters, digits, "_.@-/"',
    );
  }
  if (rawPath.startsWith('-')) {
    return refusal('malformed', 'the path starts with "-", which a runner would read as an option');
  }
  if (rawPath.startsWith('/')) {
    return refusal('path-escape', 'the path is absolute; it must be project-relative');
  }
  if (rawPath.split('/').includes('..')) {
    return refusal('path-escape', 'the path contains ".."');
  }
  const normalized = path.posix.normalize(rawPath);
  const resolved = path.resolve(options.root, normalized);
  if (!within(options.root, resolved)) {
    return refusal('path-escape', 'the path resolves outside the project root');
  }
  let stat;
  try {
    stat = await lstat(resolved);
  } catch {
    return refusal('not-a-file', 'no such file');
  }
  if (stat.isSymbolicLink()) {
    return refusal('not-a-file', 'the path is a symlink, never accepted as the test file itself');
  }
  if (!stat.isFile()) {
    return refusal('not-a-file', 'the path is a directory, not a regular file');
  }
  let realRoot: string;
  let realResolved: string;
  try {
    realRoot = await realpath(options.root);
    realResolved = await realpath(resolved);
  } catch {
    return refusal('not-a-file', 'the real location of the path could not be resolved');
  }
  // The leaf is a real, non-symlink file (just checked), but an ANCESTOR directory in `resolved` may
  // still be a symlink (`tests` itself pointed outside the project) — lstat only reports the final
  // component, so containment has to be re-checked against where the path really resolves.
  if (!within(realRoot, realResolved) && !within(options.root, realResolved)) {
    return refusal(
      'path-escape',
      'the path resolves outside the project root (an ancestor directory is a symlink)',
    );
  }
  const matches =
    options.testRoots === undefined
      ? isTestPath(normalized)
      : options.testRoots.some((root) => underTestRoot(normalized, root));
  if (!matches) {
    return refusal(
      'outside-test-roots',
      options.testRoots === undefined
        ? 'the path is not under a conventional test directory and does not name a test file'
        : `the path is not under any configured execution.testRoots (${options.testRoots.length === 0 ? '(none configured)' : options.testRoots.join(', ')})`,
    );
  }
  return { ok: true, path: rawPath };
}

/** vitest/jest take a test-name filter as `-t`, mocha as `-g`, pytest as `-k` (`loop/test/reporter.ts`'s own
 * `runVitest`/`runPytest` build the identical `-t`/`-k` flags for these two; a test pins the two modules to
 * the same convention). A wrapper such as `pnpm test` or `npm test` names no recognised runner and gets the
 * bare `<trusted> <path>` form only — appending a flag it does not recognise would be a guess this module
 * does not make. */
const RUNNER_FILTER_FLAGS: Readonly<Record<string, '-t' | '-g' | '-k'>> = {
  vitest: '-t',
  jest: '-t',
  mocha: '-g',
  pytest: '-k',
};

/** `-t`/`-g`/`-k`'s own value: one token a shell never treats specially and never a second flag (no leading
 * `-`, no space, no `;&|$()<>` etc.). It still permits `/` and repeated `.` — harmless for the four
 * `RUNNER_FILTER_FLAGS` entries today, none of which reads its filter value as a filesystem path — but a
 * future runner added to that table whose filter flag DOES take a path must not reuse this token class
 * unchanged; this regex does not itself enforce "never a path" the way `PATH_TOKEN` plus the `..`/absolute
 * checks in `validateTestPath` do. */
const FILTER_TOKEN = /^[A-Za-z0-9_][A-Za-z0-9_.:@/-]{0,119}$/;

function runnerFlagFor(trustedWords: readonly string[]): '-t' | '-g' | '-k' | undefined {
  for (const word of trustedWords) {
    const base = word.includes('/') ? (word.split('/').pop() ?? word) : word;
    const flag = RUNNER_FILTER_FLAGS[base];
    if (flag !== undefined) return flag;
  }
  return undefined;
}

/** `trusted`, split the same way an `execution.testCommands` value is written: plain spaces only
 * (`checkTestCommand`'s own `UNUSUAL_CHARACTERS` rule already refuses every other kind of whitespace for a
 * command that can become an exec pattern, and multiple consecutive spaces collapse). No quote-awareness is
 * needed here: nothing in `TEST_LAYERS_BY_BRIEF`'s real-world corpus quotes a multi-word argument, and a
 * configured command that did would simply not word-prefix-match a proposal below — the bare configured
 * command still runs as an exact pattern; only this `<path>` extension would not recognise it. */
function splitTrustedCommand(trusted: string): readonly string[] {
  return trusted.trim().split(/ +/).filter(Boolean);
}

/** The filter flag `expandTrustedInvocation` would recognise for `trusted`'s own words — `undefined` for a
 * program `RUNNER_FILTER_FLAGS` does not know (a wrapper such as `pnpm test`, which gets the bare
 * `<trusted> <path>` form only). Exported so a caller can say, BEFORE any command is proposed, which of the
 * project's own configured commands this module's `<trusted> <path> [-t/-g/-k <token>]` shape actually
 * extends with a filter token — from the identical table `expandTrustedInvocation` itself vets a proposal
 * against, never a second, hand-copied list that could silently drift from it and overclaim (or underclaim)
 * what a proposal will really be accepted for (`rca/loop.ts`'s own REPRODUCE note, `PLAN-M14.md` P24). */
export function trustedCommandFilterFlag(trusted: string): '-t' | '-g' | '-k' | undefined {
  return runnerFlagFor(splitTrustedCommand(trusted));
}

export type TrustedInvocationMatch =
  | { readonly matched: false }
  | { readonly matched: true; readonly ok: true; readonly path: string; readonly token?: string }
  | {
      readonly matched: true;
      readonly ok: false;
      readonly problem: TestPathProblem;
      readonly detail: string;
    };

/**
 * Whether `words` (a proposed command, already split the way a shell would split it) is one configured
 * trusted command's own words followed by exactly one validated test path, and — only when that trusted
 * command runs a runner `RUNNER_FILTER_FLAGS` recognises — exactly that runner's own filter flag and one
 * plain token. `{ matched: false }` for every other shape: the bare trusted command with no extra words (the
 * caller's existing exact-string check handles that), an unrecognised trailing shape, two extra words, a
 * flag the trusted command's runner does not take, or the wrong flag for it. This function never invents a
 * refusal reason for a shape it does not recognise — the caller's ordinary grant check runs instead and
 * refuses it there. When one configured command's words are themselves a prefix of another's, the longest
 * matching trusted command wins.
 */
export async function expandTrustedInvocation(
  words: readonly string[],
  trustedCommands: readonly string[],
  options: TestPathValidationOptions,
): Promise<TrustedInvocationMatch> {
  let best: readonly string[] | undefined;
  for (const trusted of trustedCommands) {
    const trustedWords = splitTrustedCommand(trusted);
    if (trustedWords.length === 0 || trustedWords.length >= words.length) continue;
    if (!trustedWords.every((word, index) => words[index] === word)) continue;
    if (best === undefined || trustedWords.length > best.length) best = trustedWords;
  }
  if (best === undefined) return { matched: false };
  const extra = words.slice(best.length);

  if (extra.length === 1) {
    const rawPath = extra[0] ?? '';
    // A word shaped like an option was never a plausible attempt at this extension (a real test path
    // never starts with `-`) — leaving it unmatched here, rather than reporting `test-path`, means an
    // ordinary near-miss such as `<trusted> -u` is still refused, by the caller's own ordinary grant
    // check, exactly as it was before this extension existed.
    if (rawPath.startsWith('-')) return { matched: false };
    const checked = await validateTestPath(rawPath, options);
    return checked.ok
      ? { matched: true, ok: true, path: checked.path }
      : { matched: true, ok: false, problem: checked.problem, detail: checked.detail };
  }

  if (extra.length === 3) {
    const [rawPath, flag, token] = extra;
    if ((rawPath ?? '').startsWith('-')) return { matched: false };
    const expectedFlag = runnerFlagFor(best);
    if (expectedFlag === undefined || flag !== expectedFlag) return { matched: false };
    const checked = await validateTestPath(rawPath ?? '', options);
    if (!checked.ok) {
      return { matched: true, ok: false, problem: checked.problem, detail: checked.detail };
    }
    if (token === undefined || !FILTER_TOKEN.test(token)) {
      return {
        matched: true,
        ok: false,
        problem: 'malformed',
        detail: `"${token ?? ''}" is not a plain token for ${expectedFlag}`,
      };
    }
    return { matched: true, ok: true, path: checked.path, token };
  }

  return { matched: false };
}
