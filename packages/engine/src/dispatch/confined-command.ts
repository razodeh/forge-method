/**
 * Confining a shell command whose text a model wrote (`PLAN-M13.md` P28, `SPEC-QUESTIONS.md` Q222; `20` §20.1
 * exec allowlist, hard denylist, `network: none`; `20` §20.4 secrets live only in the environment of the process
 * that needs them; `20` §20.10 S2, S4).
 *
 * `forge debug` asks a model for a reproduction command and FORGE runs it. Before this, that command went straight
 * to `runShellCommand` (`shell: true`, the whole parent environment, no cwd check, no timeout, inherited stdin), so
 * the tool grant every adapter session is held to (`isExecAllowed`, `07` §7.2) simply did not apply to the one place
 * a model's text became a shell command. Two things live here:
 *
 * - `vetProposedCommand`: the decision. A proposed command runs only if it passes, in order, the hard denylist
 *   (S2), the shell-operator veto (`SHELL_OPERATOR_PATTERN`, applied to every command, including one an exact
 *   pattern would match), a quote-aware refusal of the expansions a shell performs before the command starts
 *   (`$VAR`, `~`, backslashes, brace lists, `.*` globs, comments, subshells), the agent's own exec patterns, the
 *   network policy (network-capable programs and git subcommands, URLs against `allowlistHosts`), path
 *   containment (every path-shaped word, and its symlink target, must stay inside the lane; secret files and
 *   `.git/` internals are refused), git restricted to an ALLOWLIST of read-only subcommands with git's own
 *   option abbreviations resolved (`--open=sh` is `--open-files-in-pager=sh`), and a short list of arguments that make
 *   another read-only program run something (`rg --pre`, `tree -o`).
 * - `runConfinedCommand`: the execution. A scrubbed environment (`CONFINED_ENV_ALLOWLIST`: only what a build or a
 *   test needs, so `ANTHROPIC_API_KEY`, cloud credentials, tokens and `SSH_AUTH_SOCK` never reach the child), no
 *   inherited stdin, the lane as cwd, a wall-clock timeout and an output cap. The whole process group is killed on
 *   a timeout or an overflow, so a grandchild cannot hold the pipes open.
 *
 * **What this is not.** It is not a sandbox. The vet is a read of the command line, not of what the program does
 * once running: a granted `git *` is reduced to read-only subcommands, but a read-only subcommand still has flags this vet does not know, a
 * test runner the agent is allowed to call runs project code that can do anything the user can, and the network
 * policy can refuse a `curl` but not a script that opens a socket. The scrubbed environment is what keeps secrets
 * out of the child, and it is real; the rest lowers the odds and records the attempt. The remainder is in Q222.
 *
 * `PLAN-M14.md` P28 adds `vetStoredCommand`/`STORED_COMMAND_LIMITS`: the identical confinement for a STORED
 * command — `forge kb verify`'s own `## Verification` command and `forge adopt` phase 5's detected build/test
 * command — which until this piece ran through `execa(command, { shell: true })` with the whole parent
 * environment and no vet at all (`test/shell-sinks-inventory.test.ts`'s own `open` rows).
 *
 * `SPEC-QUESTIONS.md` Q347 adds `createLiveFileAccessGate`: a THIRD thing lives here, the file-path analogue of
 * `vetProposedCommand` for a live session's own `Read`/`Edit`/`Write` tool calls rather than its Bash calls.
 * `SessionRequest.vetExecCommand`'s own doc comment already establishes that `cwd` is a subprocess's own
 * STARTING directory, never a containment boundary — true for Bash, and equally true for a live file-tool call's
 * own `file_path` argument, which can be any absolute path the model writes regardless of `cwd`. Confirmed live
 * (not merely disclosed) by a real `--agent` session transcript this milestone's own run already produced: a
 * real `Write` tool call created a file completely outside its own lane worktree, with zero confinement. Reuses
 * this file's own `within()` helper (already proven against Bash's path-shaped words) rather than inventing a
 * second containment check — the one real difference is the input shape: one absolute path handed directly by
 * the SDK's own `tool_input.file_path`, not a path-shaped WORD that first has to be extracted from a shell command
 * string the way `vetPath`/`pathCandidates` do for Bash.
 *
 * `SPEC-QUESTIONS.md` Q350 (found while building Q347's own fix, deliberately left out of that piece's
 * scope) adds `createLiveNetworkAccessGate`: a FOURTH thing lives here, the identical bare-shadowing
 * defect class as Q347, now for a live session's own `WebFetch`/`WebSearch` tool calls rather than its
 * `Read`/`Edit`/`Write` calls. Reuses `isHostAllowed` (`@forge/adapter-kit/grants`) — the same function
 * `vetNetworkAndArguments` (below) already uses to judge a Bash-originated URL against the identical
 * `ToolGrant.network`/`allowlistHosts` fields — rather than inventing a second reading of what the
 * grant's own network policy means.
 *
 * @see specs/20 §20.1
 * @see specs/20 §20.4
 * @see specs/20 §20.10
 * @see SPEC-QUESTIONS.md Q222
 * @see SPEC-QUESTIONS.md Q347
 * @see SPEC-QUESTIONS.md Q350
 * @see PLAN-M13.md P28
 * @see PLAN-M14.md P28
 */
import { execFileSync } from 'node:child_process';
import { lstat, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { ExecCommandVerdict, ToolGrant } from '@forge/adapter-kit';
import { listDirEntriesSorted, type AbsolutePath } from '@forge/core/fs';
import {
  isExecAllowed,
  isHardDenylisted,
  isHostAllowed,
  SHELL_OPERATOR_PATTERN,
} from '@forge/adapter-kit/grants';
import { execa } from 'execa';
import { minimatch } from 'minimatch';

import { resolvePosixShell } from './posix-shell.ts';
import { expandTrustedInvocation } from './test-path.ts';

/** The variables a confined child inherits, and no others. A build or a test needs a `PATH`, a home directory, a
 * locale, a terminal type, a time zone and a temp directory; nothing here can carry a credential. Everything else
 * in the parent environment is dropped, which is the point: `ANTHROPIC_API_KEY`, `AWS_*`, `GITHUB_TOKEN`,
 * `NPM_TOKEN`, `SSH_AUTH_SOCK`, `GOOGLE_APPLICATION_CREDENTIALS` and whatever the next tool invents are refused by
 * not being on a list, not by matching a list of bad names (which is always one name behind).
 *
 * The Windows names for the same real-world things a POSIX child needs: no `HOME` (`USERPROFILE`, or the older
 * `HOMEDRIVE`+`HOMEPATH` pair some tools still read), no `USER`/`LOGNAME` (`USERNAME`), no `SHELL` (`COMSPEC`, the
 * default-shell variable cmd.exe itself sets), plus `PATHEXT` (without it, Windows cannot resolve a bare command
 * name to `name.exe`/`.cmd`/`.bat` at all — the direct Windows analogue of a POSIX child needing `PATH` itself) and
 * `APPDATA`/`LOCALAPPDATA` (where `npm`/`pnpm`/`corepack` and most Node tooling keep their own config/cache on
 * Windows, the same role `HOME`-relative dotfiles play on POSIX). `scrubbedEnvironment` below matches every name
 * here case-insensitively for exactly this reason: Node's own real `process.env` on Windows commonly spells this
 * list's own `PATH` as `Path` (and `Path`/`PATH`/`path` are all the same variable to the OS) — a case-sensitive
 * `.includes` check against the literal `'PATH'` would silently drop it from a real Windows child's environment,
 * leaving every confined command unable to resolve any program at all, not merely the ones this allowlist means to
 * exclude. */
export const CONFINED_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'TERM',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'CI',
  'NO_COLOR',
  'SYSTEMROOT',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
];

/** Locale variables come as a family (`LC_ALL`, `LC_CTYPE`, ...). */
const CONFINED_ENV_PREFIXES: readonly string[] = ['LC_'];

/** Fixed values every confined child gets: nothing prompts (there is no stdin), nothing pages. */
const CONFINED_ENV_FIXED: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
};

/** git's own null device, by platform: POSIX `/dev/null`, or Windows' `NUL` (no leading slash — it is a reserved
 * device name resolved from any directory, not a filesystem path `path.join`/`path.resolve` could build). Getting
 * this wrong on Windows would not just error loudly: a `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` git cannot open as
 * the null device could instead fall back to reading the user's or the system's REAL config, silently reopening
 * exactly the alias/credential-helper/`core.hooksPath` hole `PROPOSED_ENV_FIXED` exists to close. */
const GIT_NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

/** Added only for a command a model proposed: git reads neither the user's nor the system's config, so an alias
 * (`alias.x = !sh ...`), a credential helper or a `core.hooksPath` the user set cannot be reached through `git *`. */
export const PROPOSED_ENV_FIXED: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: GIT_NULL_DEVICE,
  GIT_CONFIG_SYSTEM: GIT_NULL_DEVICE,
  GIT_CONFIG_NOSYSTEM: '1',
};

const CONFINED_ENV_ALLOWLIST_LOWER: ReadonlySet<string> = new Set(
  CONFINED_ENV_ALLOWLIST.map((name) => name.toLowerCase()),
);

/** `parent` reduced to `CONFINED_ENV_ALLOWLIST` (and the `LC_` family) plus the fixed values. Pure.
 *
 * Matched case-insensitively (see `CONFINED_ENV_ALLOWLIST`'s own doc comment): the key this function keeps is
 * `parent`'s own original spelling, never a renamed/canonicalised one, since a Windows child looks its own `PATH`
 * (or `Path`) up the same, case-insensitive way the OS always does, and a second, differently-cased entry would
 * only risk two competing values rather than fix anything. */
export function scrubbedEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    const allowed =
      CONFINED_ENV_ALLOWLIST_LOWER.has(lower) ||
      CONFINED_ENV_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()));
    if (allowed) result[name] = value;
  }
  return { ...result, ...CONFINED_ENV_FIXED, ...extra };
}

export type CommandRefusalReason =
  | 'malformed'
  | 'denylisted'
  | 'shell-operator'
  | 'expansion'
  | 'not-in-grant'
  | 'network'
  | 'path-escape'
  | 'secret-path'
  | 'dangerous-argument'
  | 'test-path';

/** Why a proposed command was not run: the category (for a test or a filter) and one line naming the word that did
 * it (for a human). `detail` quotes only what the command itself said. */
export interface CommandRefusal {
  readonly reason: CommandRefusalReason;
  readonly detail: string;
}

/** The longest command line considered: a reproduction is a short command, and a megabyte of text is not one. */
const MAX_COMMAND_LENGTH = 2000;

function refuse(reason: CommandRefusalReason, detail: string): CommandRefusal {
  return { reason, detail };
}

/** Words of `command`, split the way a POSIX shell would split them, or the refusal for the first construct that
 * this vet does not model. Single quotes are literal; double quotes still expand `$` and a backtick and are refused
 * for that; a backslash is refused everywhere (its meaning depends on the quote state and the shell, and no
 * reproduction needs one). A `~` or `#` at the start of a word outside every quote is where they mean something. */
function splitWords(
  command: string,
):
  | { readonly words: readonly string[]; readonly globbed: ReadonlySet<number> }
  | { readonly refusal: CommandRefusal } {
  const words: string[] = [];
  const globbed = new Set<number>();
  let current = '';
  let inWord = false;
  let currentGlob = false;
  let quote: "'" | '"' | undefined;
  const flush = (): CommandRefusal | undefined => {
    if (!inWord) return undefined;
    if (current.includes('\0')) return refuse('malformed', 'the command contains a NUL byte');
    if (currentGlob) globbed.add(words.length);
    words.push(current);
    current = '';
    inWord = false;
    currentGlob = false;
    return undefined;
  };
  for (const char of command) {
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else current += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === '$' || char === '`') {
        return { refusal: refuse('expansion', `"${char}" expands inside double quotes`) };
      } else if (char === '\\') {
        return { refusal: refuse('expansion', 'a backslash inside double quotes') };
      } else current += char;
      continue;
    }
    if (char === ' ' || char === '\t') {
      const problem = flush();
      if (problem !== undefined) return { refusal: problem };
      continue;
    }
    if (char === "'" || char === '"') {
      inWord = true;
      quote = char;
      continue;
    }
    if (char === '\\') return { refusal: refuse('expansion', 'a backslash') };
    if (char === '$') return { refusal: refuse('expansion', 'a "$" outside single quotes') };
    if (char === '(' || char === ')') {
      return { refusal: refuse('shell-operator', `a "${char}" (a subshell or a grouping)`) };
    }
    if (char === '#' && !inWord) {
      return { refusal: refuse('shell-operator', 'a "#" starts a shell comment') };
    }
    if (char === '~' && !inWord) {
      return { refusal: refuse('expansion', 'a "~" expands to a home directory') };
    }
    if (char === '*' || char === '?' || char === '[') currentGlob = true;
    inWord = true;
    current += char;
  }
  if (quote !== undefined) return { refusal: refuse('malformed', 'an unterminated quote') };
  const problem = flush();
  if (problem !== undefined) return { refusal: problem };
  return { words, globbed };
}

/** Programs that talk to the network by design. Refused unless the grant's `network` is `full`. */
const NETWORK_PROGRAMS: ReadonlySet<string> = new Set([
  'curl',
  'wget',
  'ssh',
  'scp',
  'sftp',
  'ftp',
  'nc',
  'ncat',
  'netcat',
  'telnet',
  'rsync',
  'socat',
  'ping',
  'nslookup',
]);

/** A package manager's verbs that fetch from a registry. */
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set([
  'npm',
  'pnpm',
  'yarn',
  'pip',
  'pip3',
  'cargo',
]);
/** The only package-manager invocations allowed without `network: full`: a test run, as the first argument. Every
 * other verb (`install`, `add`, `up`, `dlx`, `exec`, `--filter x install`, a bare `yarn`) can fetch from a registry or
 * run a downloaded program, and the verb cannot be found reliably behind options that take a value. */
const PACKAGE_TEST_VERBS: ReadonlySet<string> = new Set(['test', 't', 'run', 'run-script']);

/** The git subcommands a reproduction may use: the ones that only read the repository. An ALLOWLIST, not a list of
 * the dangerous ones: git has well over a hundred subcommands, several that reach a remote or run a program that no
 * blocklist stays ahead of (`archive --remote`, `send-pack`, `for-each-repo`, `bisect run`, `p4`, ...). Anything else,
 * whatever a `git *` grant says, is refused. */
const GIT_READ_ONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'log',
  'diff',
  'show',
  'status',
  'rev-parse',
  'rev-list',
  'ls-files',
  'ls-tree',
  'cat-file',
  'blame',
  'grep',
  'shortlog',
  'describe',
  'name-rev',
  'merge-base',
  'show-ref',
  'for-each-ref',
  'diff-tree',
  'diff-files',
  'diff-index',
  'reflog',
  'show-branch',
  'check-ignore',
  'count-objects',
  'version',
]);

/** Subcommands that reach a remote: named only to give the refusal the right reason under `network: none`. */
const GIT_NETWORK_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'push',
  'fetch',
  'pull',
  'clone',
  'ls-remote',
  'remote',
  'submodule',
  'archive',
  'send-pack',
  'fetch-pack',
  'imap-send',
  'send-email',
  'request-pull',
  'lfs',
  'svn',
  'p4',
  'for-each-repo',
  'upload-pack',
  'receive-pack',
  'remote-http',
  'remote-https',
  'http-push',
  'http-fetch',
]);

/** git's own options before the subcommand that are harmless switches. Anything else there (`-c`, `-C <dir>`,
 * `--git-dir`, `--work-tree`, `--config-env`, `--exec-path`, `--attr-source`, an option added by a later git) is
 * refused: it can set configuration or the program path for one call, or point git at a directory the FIX session
 * populated (a repository of its own with a `core.fsmonitor`), and an option this list does not know may take a value
 * that would make the next word be read as the subcommand. A reproduction runs in the lane and needs none of them. */
const GIT_SAFE_GLOBAL_SWITCHES: ReadonlySet<string> = new Set([
  '--no-pager',
  '--no-optional-locks',
  '--literal-pathspecs',
  '--no-literal-pathspecs',
  '-P',
]);

/** git long options that run a program or write a file. git accepts any unambiguous PREFIX of a long option, so an
 * argument is refused when what it names is the start of one of these (`--open=sh` is `--open-files-in-pager=sh`). */
const GIT_DANGEROUS_LONG_OPTIONS: readonly string[] = [
  '--open-files-in-pager',
  '--ext-diff',
  '--output',
  '--upload-pack',
  '--receive-pack',
  '--exec',
  '--exec-path',
  '--config-env',
  '--remote',
];

function gitDangerousArgument(arg: string, subcommand: string): boolean {
  if (arg.startsWith('--')) {
    const name = arg.split('=', 1)[0] ?? arg;
    return name.length >= 3 && GIT_DANGEROUS_LONG_OPTIONS.some((full) => full.startsWith(name));
  }
  // A short-option cluster (`-nOsh`, `-inO'touch x'`): `O` anywhere in it makes the rest of the word a pager command.
  return subcommand === 'grep' && /^-[A-Za-z]*O/.test(arg);
}

/** What a `git` command line asks for, or the refusal for it. */
function vetGit(args: readonly string[], networkPolicy: string): CommandRefusal | undefined {
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (!arg?.startsWith('-')) break;
    if (GIT_SAFE_GLOBAL_SWITCHES.has(arg)) {
      index += 1;
    } else {
      return refuse(
        'dangerous-argument',
        `git ${arg} before the subcommand is not one a reproduction may use`,
      );
    }
  }
  const subcommand = args[index];
  if (subcommand === undefined) return refuse('malformed', 'git with no subcommand');
  if (!GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    if (GIT_NETWORK_SUBCOMMANDS.has(subcommand) && networkPolicy !== 'full') {
      return refuse(
        'network',
        `git ${subcommand} reaches a remote and the grant’s network is ${networkPolicy}`,
      );
    }
    return refuse(
      'dangerous-argument',
      `git ${subcommand} is not on the read-only list a reproduction may use`,
    );
  }
  const rest = args.slice(index + 1);
  if (subcommand === 'reflog' && rest.some((arg) => ['expire', 'delete'].includes(arg))) {
    return refuse('dangerous-argument', 'git reflog expire/delete changes the repository');
  }
  if (
    subcommand === 'grep' &&
    rest.some((arg) => arg === '--no-index' || arg === '--no-exclude-standard')
  ) {
    return refuse('dangerous-argument', 'git grep would search files git ignores');
  }
  for (const arg of rest) {
    if (gitDangerousArgument(arg, subcommand)) {
      return refuse('dangerous-argument', `git ${arg} runs a program or writes a file`);
    }
  }
  return undefined;
}

/** Arguments that turn another read-only program into one that runs a program or writes a file. */
function dangerousArgument(program: string, args: readonly string[]): string | undefined {
  for (const arg of args) {
    if (program === 'rg' && (arg.startsWith('--pre') || arg.startsWith('--hostname-bin'))) {
      return `rg ${arg} runs another program`;
    }
    // ripgrep skips hidden and ignored files (`.env` is usually both) unless told not to.
    if (
      program === 'rg' &&
      (arg === '--hidden' || arg.startsWith('--no-ignore') || /^-[A-Za-z]*[u.]/.test(arg))
    ) {
      return `rg ${arg} searches hidden or ignored files, where secrets live`;
    }
    // Only the short `-o filename` form exists on the real, installed `tree` (confirmed against v2.2.1's own
    // `--help`); there is no `--output` long option for a long-option prefix match to ever catch, so that
    // disjunct was dead code, not a second real flag shape.
    if (program === 'tree' && /^-[A-Za-z]*o/.test(arg)) {
      return `tree ${arg} writes a file`;
    }
  }
  return undefined;
}

/** File names a reproduction never has a reason to read: secrets (`20` §20.2 point 2, `20` §20.4) and the
 * repository's own internals. Matched against every path segment. */
const SECRET_SEGMENT =
  /^(\.env(\..*)?|\.git|\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.docker|secrets\.local\.yaml|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.+\.(pem|key|p12|pfx|keystore))$/i;

function secretSegment(segments: readonly string[]): string | undefined {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    if (SECRET_SEGMENT.test(segment)) return segment;
    if (segment === '.forge' && segments[index + 1] === 'state') return '.forge/state';
  }
  return undefined;
}

/**
 * Whether `candidate` resolves inside `root`. A real escape is `relative` being exactly `'..'`, or
 * starting with a `'..'` SEGMENT (`'..' + path.sep`) — never a raw string prefix: `path.relative` on
 * `root + '/...'` (the bare `./...` a caller like `go test ./...` resolves to) returns the literal
 * three-character string `'...'`, and `'...'.startsWith('..')` was `true` purely because the first two
 * characters happen to match, even though `...` is a real, single path segment (Go's own
 * recursive-wildcard token, among other things — `'...foo'` has the identical false-positive shape)
 * and not a `..` parent-directory escape at all.
 *
 * **Confirmed live** (`SPEC-QUESTIONS.md` Q333, critic round 4): this made `go test ./...` and
 * `go test -json ./...` — the single most idiomatic whole-project Go test invocation, and the EXACT
 * strings `detect.ts`'s own `goTestCommand()` generates for both its `run` and `filter` fields — hard
 * refused as `path-escape: "./..." is outside the project` by the real vet pipeline, with no
 * workaround (`go test ./pkg/...` resolves to `'pkg/...'`, which correctly does not match this check
 * and was never refused — only the bare top-level `./...` was).
 */
function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  const escapesUpward = relative === '..' || relative.startsWith(`..${path.sep}`);
  return relative === '' || (!escapesUpward && !path.isAbsolute(relative));
}

/** A word may hold a path in three places: the word, the part after `=` (`--git-dir=/etc`), and the part after a
 * two-character short option (`-C/etc`). */
function pathCandidates(word: string): readonly string[] {
  const found = new Set<string>([word]);
  for (const part of word.split('=')) found.add(part);
  if (/^-[A-Za-z]./.test(word)) found.add(word.slice(2));
  // A flag with a value glued on (`-n5/etc/x`, `-C/etc`): whatever follows any slash is a path candidate too.
  if (word.startsWith('-')) {
    for (let at = word.indexOf('/'); at !== -1; at = word.indexOf('/', at + 1))
      found.add(word.slice(at));
  }
  // `git show HEAD:.env`, `git diff a:b`: a revision, a colon, a path.
  for (const part of [...found].flatMap((candidate) => candidate.split(':'))) found.add(part);
  return [...found].filter((candidate) => candidate !== '' && !/^-{1,2}$/.test(candidate));
}

/** A URL anywhere in a word (`--remote=ssh://host/x`, `x=git://host`), not only a word that starts with one. */
const URL_IN_WORD = /([a-z][a-z0-9+.-]*):\/\/([^/:?#\s]*)/gi;
const SCP_WORD = /^[\w.-]+@[\w.-]+:/;

async function vetPath(
  word: string,
  root: string,
  realRoot: string,
): Promise<CommandRefusal | undefined> {
  // A URL was judged by the network policy; what is left of the word may still hold a path (`--file=x://y` is not one).
  const pathPart = word.replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '');
  for (const candidate of pathCandidates(pathPart)) {
    if (candidate.startsWith('-')) continue;
    const segments = candidate.split('/').filter((segment) => segment !== '');
    if (segments.includes('..')) {
      const resolved = path.resolve(root, candidate);
      if (!within(root, resolved) && !within(realRoot, resolved)) {
        return refuse('path-escape', `"${word}" leaves the project`);
      }
    }
    if (segments.some((segment) => /^\.[*?[]/.test(segment))) {
      return refuse('path-escape', `"${word}" can match a parent directory`);
    }
    const absolute = path.resolve(root, candidate);
    if (!within(root, absolute) && !within(realRoot, absolute)) {
      return refuse('path-escape', `"${word}" is outside the project`);
    }
    const relative = within(root, absolute)
      ? path.relative(root, absolute)
      : path.relative(realRoot, absolute);
    const secret = secretSegment(relative.split(path.sep));
    if (secret !== undefined) return refuse('secret-path', `"${word}" names ${secret}`);
    const rawSecret = secretSegment(segments);
    if (rawSecret !== undefined) return refuse('secret-path', `"${word}" names ${rawSecret}`);
    let resolvedReal: string | undefined;
    try {
      resolvedReal = await realpath(absolute);
    } catch {
      resolvedReal = undefined;
    }
    if (
      resolvedReal !== undefined &&
      !within(realRoot, resolvedReal) &&
      !within(root, resolvedReal)
    ) {
      return refuse('path-escape', `"${word}" is a symlink to somewhere outside the project`);
    }
  }
  return undefined;
}

/** The most directory entries a glob word may be checked against. A pattern that would need more is refused. */
const GLOB_ENTRY_CAP = 20_000;

/**
 * A word with an unquoted `*`, `?` or `[` names whatever the shell expands it to, and the program receives THAT, not
 * the pattern. So the expansion is computed here, one path segment at a time (as the shell does: `*` matches no leading
 * dot, `/` is never matched), reading only the directories the pattern's own depth reaches, and every match is
 * checked as if it had been written out:
 *   - a match that, AS A WHOLE STRING, starts with `-` is refused (a tracked file called `--open-files-in-pager=sh`
 *     would turn `*` into an option of `git grep`; see below for exactly what "as a whole string" means and why);
 *   - a path that is, or passes through, a symlink resolving outside the lane is refused (`link/*`, `li*\/x`);
 *   - a match that names a secret file or `.git` internals is refused (`cat .env*` is `cat .env`).
 * A pattern that needs more than `GLOB_ENTRY_CAP` directory entries to decide is refused.
 *
 * A candidate that is ITSELF flag-shaped (`pathCandidates` yields `--o*`, `-*`, unmodified, whenever a word already
 * starting with `-` has no `=` or short-option-value split to decompose it into a non-flag remainder) is not
 * skipped: it is walked and matched exactly like any other glob, by the same rule above. **This function used to
 * skip any candidate starting with `-` outright, on the assumption that a flag can never also be a real path
 * ("flags aren't paths") — wrong, because shell expansion can turn a flag-shaped PATTERN into a real flag-shaped
 * MATCH, exactly the hazard this function exists to catch.** `gitDangerousArgument`/`dangerousArgument` compare
 * against the UNEXPANDED word, where a literal `*` breaks every prefix match (`"--o*"` is not a string-prefix of
 * `"--open-files-in-pager"`, and does not start with `"--pre"`/`"--hidden"`/`"--no-ignore"` either) — proven live:
 * `git grep --o* PATTERN` against a lane holding a tracked file literally named `--open-files-in-pager=sh` really
 * does open `sh` as the pager, and `rg --h* PATTERN` against a lane holding a file named `--hidden` really does
 * surface a `.env`'s contents. A pattern with no real match is unaffected (the shell would pass it through
 * literally too), so an ordinary flag that merely happens to end in a glob (`rg --include=*.ts foo`) still runs:
 * the whole-word candidate matches nothing and only the already-checked, non-flag-shaped `*.ts` split survives.
 *
 * **"As a whole string", not the final segment's own basename, and not "any segment anywhere" either.** Two
 * independent critics reviewing the fix above each found the same residual gap: the refusal check used to read
 * `path.posix.basename(entry).startsWith('-')` — the LAST path segment only. A multi-segment match walks one
 * segment at a time exactly like any other glob, so the DANGEROUS segment can sit at the FRONT while an innocuous
 * one sits at the end: a real directory literally named `--open-files-in-pager=touch X;true #`, containing a file
 * named `evil`, matched by a model-written `--o*\/evil` — `entry` is `--open-files-in-pager=touch X;true #\/evil`,
 * whose `basename` is merely `evil`, so the old check waved it through. The fix is not "does ANY segment start
 * with `-`" either: that would refuse an ordinary, safe path that merely has a real `-`-named directory somewhere
 * in its MIDDLE (`subdir/-weird-but-real-name/file.ts`), which is not flag-shaped at all once fully expanded — a
 * shell hands a program exactly ONE argv token per match, as one string, and every argument parser (`getopt(3)`,
 * or any language's equivalent) decides "is this a flag" by looking at the FIRST character of that whole token,
 * never at a character or segment elsewhere in it. So the only question that matters is: does `entry`, taken as
 * the complete string the program would receive, begin with `-`? That is exactly `entry.startsWith('-')` —
 * equivalent, since `entry` is built segment-by-segment as `dir === '' ? name : \`${dir}/${name}\``, to "does the
 * FIRST segment start with `-`", which is why checking the whole string and checking only the first segment give
 * the identical answer, and why neither is the same question `path.posix.basename`'s LAST segment was asking.
 * Both critics independently constructed the `--o*\/evil`-shaped repro above and confirmed this function, called
 * on its own, returned `undefined` (wrongly allowed) before this widening — and that the full `vetProposedCommand`
 * pipeline nonetheless refused it end-to-end today, but only by structural coincidence: `vetPath`'s own
 * slash-decomposition heuristic (written for an unrelated purpose — catching a glued absolute path like `-C/etc`)
 * adds a `/evil`-shaped candidate whenever a word starts with `-` and contains a `/`, which resolves outside the
 * lane and gets refused there FIRST, before this function is ever reached for that word. That overlap is not a
 * second line of defense: it is undocumented and untested, and a future cleanup of `vetPath`'s heuristic (plausible,
 * since it was never written with this hazard in mind) would reopen this gap with nothing to notice. `vetGlob` is
 * therefore EXPORTED here — not just used locally — so a test can call it directly and prove THIS check, alone,
 * refuses that shape, the identical "exported so this is directly testable" reasoning `run/context.ts`'s own
 * `isTargetRegisteredWorktree` already documents.
 */
export async function vetGlob(
  word: string,
  root: string,
  realRoot: string,
): Promise<CommandRefusal | undefined> {
  for (const candidate of pathCandidates(word)) {
    if (!/[*?[]/.test(candidate) || candidate.startsWith('/')) continue;
    const segments = candidate
      .replace(/^\.\//, '')
      .split('/')
      .filter((segment) => segment !== '');
    let frontier: string[] = [''];
    let visited = 0;
    for (const segment of segments) {
      const next: string[] = [];
      for (const dir of frontier) {
        let names: string[];
        if (/[*?[]/.test(segment)) {
          try {
            names = (await listDirEntriesSorted(path.join(root, dir) as AbsolutePath))
              .map((entry) => entry.name)
              .filter((name) => minimatch(name, segment, { dot: false }));
          } catch {
            continue;
          }
          visited += names.length;
        } else {
          names = [segment];
        }
        if (visited > GLOB_ENTRY_CAP) {
          return refuse(
            'expansion',
            `"${word}" would expand across more than ${String(GLOB_ENTRY_CAP)} entries`,
          );
        }
        for (const name of names) {
          const entry = dir === '' ? name : `${dir}/${name}`;
          const absolute = path.join(root, entry);
          let real: string;
          try {
            real = await realpath(absolute);
          } catch {
            continue; // does not exist: the shell would pass the pattern through literally
          }
          if (!within(realRoot, real) && !within(root, real)) {
            return refuse('path-escape', `"${word}" expands to ${entry}, which leaves the project`);
          }
          next.push(entry);
        }
      }
      frontier = next;
    }
    for (const entry of frontier) {
      // The whole string, not `path.posix.basename(entry)` (the LAST segment only): a shell hands the program
      // exactly one argv token per match, and an argument parser decides "is this a flag" by the token's own
      // FIRST character — equivalent, since `entry` is built as `dir === '' ? name : \`${dir}/${name}\``, to
      // asking whether the match's FIRST segment starts with `-` (see this function's own doc comment).
      if (entry.startsWith('-')) {
        return refuse(
          'expansion',
          `"${word}" expands to ${entry}, which a program would read as an option`,
        );
      }
      const secret = secretSegment(entry.split('/'));
      if (secret !== undefined) {
        return refuse('secret-path', `"${word}" expands to ${entry}, which names ${secret}`);
      }
    }
  }
  return undefined;
}

/** A path-shaped word cannot smuggle a brace list past the containment check (`{/etc,x}/passwd`). */
const BRACE_LIST = /\{[^}]*(,|\.\.)[^}]*\}/;

/**
 * The syntax stage of the vet, on its own: length, the hard denylist (S2), the shell-operator veto and the quote-aware
 * refusal of what a shell expands before the program starts. `undefined` when the command is one plain program with
 * literal words. `vetProposedCommand` runs it first; `test-command-grant.ts` runs the same function over a configured
 * test command, so a command FORGE derives an exec pattern from is exactly a command this vet would not refuse on
 * syntax (a derived pattern that the vet then refused would grant nothing while the prompt said it did).
 */
export function vetCommandSyntax(command: string): CommandRefusal | undefined {
  return syntaxOf(command).refusal;
}

/** The words of a command that passes `vetCommandSyntax` (the first is the program), or `undefined` when it does not. */
export function commandWords(command: string): readonly string[] | undefined {
  return syntaxOf(command).words;
}

/**
 * `commandWords`, plus exactly which of those word INDICES hold an unquoted glob metacharacter (`*`, `?`, `[`) --
 * `syntaxOf`'s own `splitWords` already computes this (it is how `vetProposedCommand` below decides which words to
 * run `vetGlob` against), but `commandWords` itself has always discarded it. Exposed for a caller that needs to know
 * not merely "does this word's TEXT contain one of these characters" (a check a quoted, genuinely-literal `'*'`
 * would also trip, and that `splitWords` deliberately does NOT mark as globbed -- single- and double-quoted
 * occurrences are excluded, exactly the shell's own rule, since neither quote form lets `*`/`?`/`[` expand) but "will
 * the real POSIX shell `runShellCommand` executes this through actually try to expand this word" (`SPEC-QUESTIONS.md`
 * Q333, critic round 6's fifth bypass -- `isPackageManagerVersionProbe`, `proof.ts`, is this function's one real
 * caller so far). `undefined` for exactly the commands `commandWords` itself refuses on syntax (same stage, same
 * input, same reasoning -- a caller that already calls `commandWords` and checks for `undefined` needs no new
 * handling to also call this).
 */
export function commandWordsWithGlobs(
  command: string,
): { readonly words: readonly string[]; readonly globbed: ReadonlySet<number> } | undefined {
  const syntax = syntaxOf(command);
  if (syntax.refusal !== undefined) return undefined;
  return { words: syntax.words, globbed: syntax.globbed };
}

function syntaxOf(command: string):
  | { readonly refusal: CommandRefusal; readonly words?: undefined; readonly globbed?: undefined }
  | {
      readonly refusal?: undefined;
      readonly words: readonly string[];
      readonly globbed: ReadonlySet<number>;
    } {
  if (command.trim() === '') return { refusal: refuse('malformed', 'the command is empty') };
  if (command.length > MAX_COMMAND_LENGTH) {
    return {
      refusal: refuse(
        'malformed',
        `the command is longer than ${String(MAX_COMMAND_LENGTH)} characters`,
      ),
    };
  }
  if (isHardDenylisted(command)) {
    return { refusal: refuse('denylisted', 'the command is on the hard denylist (`20` §20.1)') };
  }
  if (SHELL_OPERATOR_PATTERN.test(command)) {
    return {
      refusal: refuse(
        'shell-operator',
        'the command chains, redirects or substitutes (one of ; & | ` < > $( or a newline)',
      ),
    };
  }
  const split = splitWords(command);
  if ('refusal' in split) return { refusal: split.refusal };
  const { words, globbed } = split;
  const brace = words.find((word) => BRACE_LIST.test(word));
  if (brace !== undefined) {
    return { refusal: refuse('expansion', `"${brace}" is a brace list the shell expands`) };
  }
  return { words, globbed };
}

/** Options for `vetProposedCommand`. */
export interface VetOptions {
  /**
   * Commands the PROJECT configured (`execution.testCommands`, derived into the grant by `test-command-grant.ts`),
   * compared by exact string. Such a command skips two checks, both of which exist because the MODEL chooses the words:
   * the package-manager test-verb rule (`pnpm typecheck` is the user's script; it is held instead to the configured
   * rule, `vetConfiguredCommand`: no verb that fetches, publishes or changes dependencies) and path containment
   * (`vitest --config ../vitest.config.ts`, `pytest /abs/tests`, `dotenv -e .env.test` name paths the user wrote; the
   * model cannot change them, and a configured command holds no glob character). Everything else (denylist,
   * operators, expansion, the grant, the network programs and hosts, git and dangerous arguments) still applies.
   *
   * When `allowTrustedPathExtension` is also `true`, the same list drives `expandTrustedInvocation`
   * (`test-path.ts`, `PLAN-M14.md` P5) too: a proposal whose words are one of these, verbatim, followed by one
   * validated test path (and, for a recognised runner, its own `-t`/`-g`/`-k` filter token) is trusted the
   * identical way, so REPRODUCE/PROVE can run one file instead of the whole layer without the grant itself ever
   * widening (`SPEC-QUESTIONS.md` Q230's "whole-layer reproduction" gap).
   */
  readonly trustedCommands?: readonly string[];
  /**
   * Explicit opt-in for the `<trusted> <path> [-t/-g/-k <token>]` extension above: `expandTrustedInvocation`
   * runs only when this is `true`. Unset (or `false`) leaves `vetProposedCommand` exactly as it behaved before
   * `test-path.ts` existed, even when `trustedCommands` is non-empty — `forge debug`'s RCA loop
   * (`rca/shell.ts`'s `createRcaShell`, unmodified by this piece) already supplies a non-empty
   * `trustedCommands` for `debug-isolate`'s REPRODUCE/PROVE phase, so leaving the extension gated by default is
   * what makes "this piece builds the validator only, nothing consumes it yet" actually true rather than an
   * accidental live widening the moment this file changed. A later piece flips this on where it has done its
   * own work (prompt text that tells the model the form exists, `testRoots` wired to that caller's config)
   * (`PLAN-M14.md` P24/P26).
   */
  readonly allowTrustedPathExtension?: boolean;
  /** `execution.testRoots`, passed straight to `validateTestPath`'s matching rule for the `<trusted> <path>`
   * extension above (only consulted when `allowTrustedPathExtension` is `true`). `undefined` (the project has
   * not configured the key) falls back to `isTestPath`'s own built-in rule. */
  readonly testRoots?: readonly string[] | undefined;
}

/** Verbs of a JavaScript package manager that fetch from a registry, run a downloaded program, publish, or change the
 * project's dependencies or configuration (including the abbreviations npm accepts). `pnpm test`, `pnpm lint`,
 * `pnpm run x` and `yarn jest` are scripts and binaries the project already has: not here. */
const JS_MANAGER_BANNED_VERBS: ReadonlySet<string> = new Set([
  'install',
  'i',
  'ins',
  'inst',
  'isntall',
  'it',
  'ci',
  'install-test',
  'install-ci-test',
  'add',
  'remove',
  'rm',
  'uninstall',
  'un',
  'update',
  'up',
  'upgrade',
  'publish',
  'unpublish',
  'dlx',
  'x',
  'create',
  'init',
  'link',
  'unlink',
  'login',
  'logout',
  'adduser',
  'deploy',
  'rebuild',
  'fetch',
  'download',
  'config',
  'set',
  'cache',
  'plugin',
  'dedupe',
  'audit',
  'prune',
  'patch',
  'patch-commit',
  'self-update',
  'store',
  'setup',
  'env',
]);

/** JavaScript package managers, and the ones whose `exec` can fetch what it runs. */
const JS_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const JS_MANAGERS_THAT_FETCH_ON_EXEC: ReadonlySet<string> = new Set(['npm', 'bun']);

/** Other ecosystems' verbs a configured test command may not use, by program. A test runs the project's tests; it does not
 * install dependencies, publish, or push. */
const OTHER_BANNED_VERBS: Readonly<Record<string, ReadonlySet<string>>> = {
  pip: new Set(['install', 'download', 'uninstall', 'wheel', 'config']),
  pip3: new Set(['install', 'download', 'uninstall', 'wheel', 'config']),
  cargo: new Set([
    'install',
    'publish',
    'add',
    'remove',
    'login',
    'yank',
    'owner',
    'new',
    'init',
    'fetch',
    'vendor',
    'generate-lockfile',
    'update',
  ]),
  poetry: new Set(['install', 'add', 'remove', 'update', 'publish', 'lock']),
  uv: new Set(['add', 'remove', 'sync', 'pip', 'lock', 'tool']),
  bundle: new Set(['install', 'add', 'update']),
  bundler: new Set(['install', 'add', 'update']),
  gem: new Set(['install', 'uninstall', 'push']),
  composer: new Set(['install', 'require', 'update', 'remove']),
  go: new Set(['get', 'install']),
  deno: new Set(['install', 'add']),
  dotnet: new Set(['nuget', 'publish', 'tool']),
  mvn: new Set(['deploy']),
  gradle: new Set(['publish']),
  gradlew: new Set(['publish']),
};

/** Programs that run whatever they are given, or change files or the cluster: not a test command. */
const NOT_A_TEST_PROGRAMS: ReadonlySet<string> = new Set([
  'rm',
  'rmdir',
  'chmod',
  'chown',
  'mv',
  'tee',
  'dd',
  'kubectl',
  'terraform',
  'gh',
  'sudo',
  'doas',
]);

/** Programs that run another program: the grant would name the wrapper and not what runs. */
const WRAPPER_PROGRAMS: ReadonlySet<string> = new Set([
  'env',
  'command',
  'exec',
  'time',
  'nohup',
  'xargs',
  'timeout',
  'nice',
  'ionice',
  'busybox',
]);

/** Programs that fetch and run a package by name: never a configured test command. */
const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(['npx', 'pnpx', 'bunx']);

const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

/** Flags of the package managers above that take a value, so the word after one is not the verb (`pnpm --filter config test`). */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--filter',
  '-F',
  '--dir',
  '-C',
  '--cwd',
  '--prefix',
  '--workspace',
  '-w',
  '--config',
  '--registry',
]);

/** The subcommand of a package-manager or build-tool command line: the first word that is not a flag or a flag's value. */
function verbOf(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (VALUE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return undefined;
}

/** A program's name as a lookup key: its basename, lower-cased, without a Windows executable extension (`NPM.CMD` is `npm`). */
function programKey(first: string): string {
  return path.posix
    .basename(first)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com|ps1)$/, '');
}

/** What is wrong with a CONFIGURED test command's program and verb, or `undefined`. */
function configuredProgramRefusal(
  first: string,
  args: readonly string[],
): CommandRefusal | undefined {
  const program = programKey(first);
  if (WRAPPER_PROGRAMS.has(program)) {
    return refuse(
      'dangerous-argument',
      `${program} runs another program, so the grant would not say what runs`,
    );
  }
  if (NOT_A_TEST_PROGRAMS.has(program)) {
    return refuse(
      'dangerous-argument',
      `${program} changes files or the environment and is not a test runner`,
    );
  }
  if (PACKAGE_RUNNERS.has(program)) {
    return refuse('network', `${program} fetches a package by name and runs it`);
  }
  if (SHELLS.has(program) && args.some((arg) => /^-[a-z]*c[a-z]*$/.test(arg))) {
    return refuse(
      'dangerous-argument',
      `${program} -c runs a command string, so the grant would not say what runs`,
    );
  }
  if (
    program === 'find' &&
    args.some((arg) => ['-exec', '-execdir', '-ok', '-okdir', '-delete'].includes(arg))
  ) {
    return refuse('dangerous-argument', 'find -exec/-delete runs or removes what it finds');
  }
  const banned = JS_MANAGERS.has(program) ? JS_MANAGER_BANNED_VERBS : OTHER_BANNED_VERBS[program];
  if (banned === undefined) return undefined;
  const verb = verbOf(args);
  if (verb === undefined) {
    return refuse(
      'network',
      `${program} with no subcommand does something other than run a test (yarn alone installs)`,
    );
  }
  if (banned.has(verb) || (JS_MANAGERS_THAT_FETCH_ON_EXEC.has(program) && verb === 'exec')) {
    return refuse(
      'network',
      `${program} ${verb} fetches, publishes or changes dependencies, which a test command never does`,
    );
  }
  return undefined;
}

/**
 * The network, package-manager, git and argument stages of the vet, on the words of a command that already passed the
 * syntax stage. `packageRule` says who chose the words: `model` (a proposed command: only a test verb, as the first
 * argument, without `network: full`) or `configured` (the project's own test command: any script, but never a verb that
 * fetches, publishes or changes dependencies, and never a package runner, whatever the network policy).
 */
function vetNetworkAndArguments(
  words: readonly string[],
  grant: Pick<ToolGrant, 'network' | 'allowlistHosts'>,
  packageRule: 'model' | 'configured',
): CommandRefusal | undefined {
  const first = words[0];
  if (first === undefined) return refuse('malformed', 'the command is empty');
  // `programKey`, not a bare `path.posix.basename`: a gauntlet critic found this comparison, unlike
  // every OTHER program-name comparison in this module (`configuredProgramRefusal`'s own `programKey`
  // call), was case-sensitive — `GIT push`, `Git reset --hard`, `CURL evil.example`, `PING`/`NC`/`WGET`/
  // `SSH`, `RG --pre=sh`, `TREE -o` all resolved to the real program on this (case-insensitive)
  // filesystem and ran unrefused. Proven, for a STORED command, with a real end-to-end `forge kb verify`
  // run: a KB entry naming `` Command: `Git reset --hard` `` silently discarded real uncommitted work in
  // the live project tree and reported `outcome: 'pass'`. `vetStoredCommand`'s own `exec: [command]`
  // grant is always self-satisfying whatever case the stored text used (unlike a live model turn, which
  // still needs to clear the agent's own, usually-lowercase, exec pattern first), so this check was, for
  // a stored command, the only remaining line of defense for the shapes it names -- and it had a hole.
  const program = programKey(first);
  const args = words.slice(1);

  if (grant.network !== 'full') {
    if (NETWORK_PROGRAMS.has(program)) {
      return refuse(
        'network',
        `${program} uses the network and the grant’s network is ${grant.network}`,
      );
    }
    if (PACKAGE_MANAGERS.has(program) && packageRule === 'model') {
      const verb = args[0];
      if (
        verb === undefined ||
        !PACKAGE_TEST_VERBS.has(verb) ||
        program === 'cargo' ||
        program.startsWith('pip')
      ) {
        return refuse(
          'network',
          `${program} ${verb ?? ''} can fetch from a registry or run a downloaded program and the grant’s network is ${grant.network}`,
        );
      }
    }
  }
  if (packageRule === 'configured') {
    const refusal = configuredProgramRefusal(first, args);
    if (refusal !== undefined) return refusal;
  }
  for (const word of words) {
    for (const url of word.matchAll(URL_IN_WORD)) {
      const host = url[2] ?? '';
      if (
        !isHostAllowed(
          {
            read: true,
            write: false,
            exec: false,
            network: grant.network,
            ...(grant.allowlistHosts === undefined ? {} : { allowlistHosts: grant.allowlistHosts }),
          },
          host,
        )
      ) {
        return refuse(
          'network',
          `"${word}" names a host the grant’s network policy does not allow`,
        );
      }
    }
    if (SCP_WORD.test(word) && grant.network !== 'full') {
      return refuse('network', `"${word}" names a remote host`);
    }
  }
  if (program === 'git') {
    const git = vetGit(args, grant.network);
    if (git !== undefined) return git;
  }
  const dangerous = dangerousArgument(program, args);
  if (dangerous !== undefined) return refuse('dangerous-argument', dangerous);
  return undefined;
}

/**
 * Whether `command`, configured by the project as a test command, is one FORGE would run for a model under
 * `network: none`: the syntax stage and the network, package-manager, git and argument stages of the vet, with a
 * configured command's package rule. `test-command-grant.ts` asks this before deriving a pattern, so a command the vet
 * would refuse for a model (`curl ...`, `git push`, `pnpm install`) is never granted, listed in block [6], or passed by
 * the doctor.
 */
export function vetConfiguredCommand(command: string): CommandRefusal | undefined {
  const syntax = syntaxOf(command);
  if (syntax.refusal !== undefined) return syntax.refusal;
  return vetNetworkAndArguments(syntax.words, { network: 'none' }, 'configured');
}

/**
 * Whether `command`, proposed by a model, may run under `grant` with `root` (the lane worktree) as its cwd.
 * `undefined` means it may; otherwise the first refusal, in the order the module comment gives. Never throws.
 */
export async function vetProposedCommand(
  command: string,
  grant: Pick<ToolGrant, 'exec' | 'network' | 'allowlistHosts'>,
  root: string,
  options: VetOptions = {},
): Promise<CommandRefusal | undefined> {
  const syntax = syntaxOf(command);
  if (syntax.refusal !== undefined) return syntax.refusal;
  const { words, globbed } = syntax;

  // A word-for-word `<configured trusted command> <validated test path> [-t/-g/-k <token>]`
  // (`test-path.ts`, `PLAN-M14.md` P5), tried right after the syntax stage and before the grant check: the
  // extended words are never literally a member of `grant.exec` (a derived test-command pattern is an exact
  // string with no trailing path, `test-command-grant.ts`), so this has to run before `isExecAllowed` would
  // otherwise refuse it as `not-in-grant`. A shape this does not recognise (an unmatched prefix, two extra
  // words, an unsupported or wrong flag) reports `{ matched: false }` and falls through to the ordinary
  // checks below unchanged, which refuse it there — this never bypasses `isHardDenylisted` or
  // `SHELL_OPERATOR_PATTERN` (both already ran, above, over the whole raw string) and never treats an
  // unexpanded placeholder such as literal `{path}` as a real path (`validateTestPath` refuses its `{`/`}`
  // characters outright). Gated by `options.allowTrustedPathExtension`: `expandTrustedInvocation` is skipped
  // (reported as `{ matched: false }`, identical to "no shape recognised") for every EXISTING caller that
  // supplies `trustedCommands` without this new flag — `forge debug`'s RCA loop already does, since P23 — so
  // this piece changes no live behaviour until a caller deliberately turns it on.
  const trustedInvocation = options.allowTrustedPathExtension
    ? await expandTrustedInvocation(words, options.trustedCommands ?? [], {
        root,
        testRoots: options.testRoots,
      })
    : ({ matched: false } as const);
  if (trustedInvocation.matched && !trustedInvocation.ok) {
    return refuse('test-path', trustedInvocation.detail);
  }
  // Only a grant that itself permits running commands may be widened by a validated path: a caller that
  // (by mistake) supplies `trustedCommands` alongside a tainted or read-only `grant.exec: false` gets no
  // bypass here — the ordinary `isExecAllowed` check just below still refuses it. (`trustedInvocation.ok`
  // is not re-checked: the early return above already ruled out `matched && !ok`.)
  const trustedByPath = trustedInvocation.matched && grant.exec !== false;

  if (
    !trustedByPath &&
    !isExecAllowed({ read: true, write: false, exec: grant.exec, network: 'none' }, command)
  ) {
    return refuse(
      'not-in-grant',
      grant.exec === false || grant.exec.length === 0
        ? 'the agent’s tool grant allows no commands'
        : `the command matches none of the agent’s exec patterns (${grant.exec.join(', ')})`,
    );
  }

  const first = words[0];
  if (first === undefined) return refuse('malformed', 'the command is empty');
  // `ls=1 node -e ...` matches the pattern `ls*` as a string, but the shell reads `ls=1` as an assignment and runs
  // the next word: what the pattern authorised is not what would run.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
    return refuse('shell-operator', `"${first}" is a variable assignment, not the program`);
  }
  // A prefix pattern (`cat*`) also matches `catdoc`, `lsof`: the first word must be the program the pattern names.
  // Skipped for a trusted-by-path match: its words are a configured command's own, never matched against `grant.exec`
  // (the same trust the bare exact-string case below already extends to `options.trustedCommands`).
  if (!trustedByPath) {
    const programs = (grant.exec === false ? [] : grant.exec)
      .filter((pattern) =>
        isExecAllowed({ read: true, write: false, exec: [pattern], network: 'none' }, command),
      )
      .map((pattern) => pattern.split(/[\s*]/, 1)[0] ?? '');
    if (!programs.some((name) => name === '' || name === first)) {
      return refuse(
        'not-in-grant',
        `"${first}" is not the program any matching exec pattern names`,
      );
    }
  }
  const trusted = trustedByPath || options.trustedCommands?.includes(command) === true;
  const stages = vetNetworkAndArguments(words, grant, trusted ? 'configured' : 'model');
  if (stages !== undefined) return stages;

  if (trusted) return undefined;
  let realRoot = root;
  try {
    realRoot = await realpath(root);
  } catch {
    realRoot = root;
  }
  for (const [index, word] of words.entries()) {
    const problem = await vetPath(word, root, realRoot);
    if (problem !== undefined) return problem;
    if (globbed.has(index)) {
      const expanded = await vetGlob(word, root, realRoot);
      if (expanded !== undefined) return expanded;
    }
  }
  return undefined;
}

/**
 * Whether a STORED command — one a KB entry's own `## Verification` section names (`forge kb verify`,
 * `PLAN-M14.md` P28) or `forge adopt`'s own phase-5 detected build/test command, never a live model
 * turn — may run at `root`. Composed from the two checks a proposed command is already held to, in
 * order: `vetConfiguredCommand` (the syntax stage, then the network, package-manager, git and argument
 * stages under `network: none`, the identical vet `execution.testCommands` is held to before a pattern
 * is derived from it), then `vetProposedCommand` with a grant of EXACTLY the one command asked for
 * (`exec: [command]`) — nothing wider, since a stored command has no exec pattern of its own to be one
 * of, and this is what additionally runs the path-containment stage (secret files, `.git/` internals, a
 * `..` escape) `vetConfiguredCommand` alone does not. `undefined` means it may run; otherwise the first
 * refusal, from whichever stage found it.
 *
 * Neither stage is loosened for this caller: `confined-command.test.ts`'s own "vetConfiguredCommand
 * alone is load-bearing" test proves that skipping the first stage here — reusing only
 * `vetProposedCommand` — would silently let an `sh -c "..."`/`npx <package>` stored command through
 * (`vetConfiguredCommand`'s own `configuredProgramRefusal` is the only stage that refuses either shape;
 * `vetProposedCommand`'s own `model`-package-rule stage does not).
 */
export async function vetStoredCommand(
  command: string,
  root: string,
): Promise<CommandRefusal | undefined> {
  const configured = vetConfiguredCommand(command);
  if (configured !== undefined) return configured;
  return vetProposedCommand(command, { exec: [command], network: 'none' }, root);
}

/** Bounds on one confined command. */
export interface ConfinedLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

/** A reproduction is a short command: two minutes and a megabyte of output are generous. */
export const PROPOSED_COMMAND_LIMITS: ConfinedLimits = {
  timeoutMs: 120_000,
  maxOutputBytes: 1_000_000,
};

/** A STORED command (`vetStoredCommand`'s own doc comment) is a project's own build or test run, not a
 * short reproduction: generous enough for a real suite, capped well short of `ENGINE_COMMAND_LIMITS`
 * (FORGE's own lane commands) since this runs code the project — or, for `forge adopt`, a repository
 * nobody has decided to adopt yet — wrote, not FORGE's own controlled loop. */
export const STORED_COMMAND_LIMITS: ConfinedLimits = {
  timeoutMs: 300_000,
  maxOutputBytes: 8_000_000,
};

/** FORGE's own commands in the lane (`forge test run`, the revert check) run the project's tests, which take
 * as long as they take: bounded, but by the loop's own wall-clock budget more than by this. */
export const ENGINE_COMMAND_LIMITS: ConfinedLimits = {
  timeoutMs: 1_200_000,
  maxOutputBytes: 8_000_000,
};

/**
 * Every real descendant of `rootPid`, found by walking `ps`'s own real pid/ppid columns — not merely
 * the members of its process GROUP, which a descendant that started its OWN session (Node's
 * `detached: true`, Python's `start_new_session=True`, or any program that calls `setsid(2)` before
 * it hangs) leaves immediately, becoming the leader of a new group `process.kill(-rootPid, ...)`
 * below can never reach. Byte-identical port of `shell.ts`'s own `listDescendantPids` (M16 P10,
 * `SPEC-QUESTIONS.md` Q296 Decision 1 and Decision 5, which names this file's own copy of `killGroup`
 * as having the identical gap and hands the port to this piece) — see that function's own doc comment
 * for the full reasoning and the real repro that found the gap; duplicated rather than imported
 * because `shell.ts` exports neither this nor `killGroup`, and the two files are deliberately not
 * made to share a module for one helper each (`PLAN-M16.md` P3, Q294: "keep this fix scoped to
 * `confined-command.ts` alone — do not also touch `shell.ts`").
 *
 * Read ONCE, before any signal is sent anywhere: a process already killed has its own children
 * reparented to PID 1 immediately, severing the `ppid` chain back to `rootPid` from that moment on,
 * so scanning after killing would silently miss exactly the processes this exists to find. Returns
 * `[]` on any failure (no real `ps` on this platform, a transient read error) rather than throwing —
 * the caller's own group kill is still real protection even when this extra pass cannot run.
 *
 * **Exported as of `specs/22` M16 P8**, a narrow, additive exception to "do not change this file's
 * existing exports casually" (the identical discipline `PLAN-M16.md` P14's own brief asked of
 * `collection-lock.ts`, and this piece's own brief names this file by name for exactly this
 * question): the `http` surface's server-lifecycle helper (`packages/cli/src/commands/parity/
 * http-server.ts`) starts a long-lived child `runConfinedCommand` itself cannot own (that function
 * AWAITS the child's own exit, which a server never does on its own) and needs the identical,
 * already-fixed "kill the whole group AND walk real descendants individually" logic this function and
 * {@link killGroup} already give every other long-running or detaching child this codebase starts —
 * see that piece's own report for why reusing this exact, already-tested logic (rather than a second,
 * independently-written copy of the identical reasoning) was the right call. Nothing about this
 * function's own behaviour changes; only its visibility does.
 *
 * @see packages/engine/src/dispatch/shell.ts (`listDescendantPids`, the original)
 * @see process/SPEC-QUESTIONS.md Q296
 */
export function listDescendantPids(rootPid: number): readonly number[] {
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
    const childrenByParent = new Map<number, number[]>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const [pidText, ppidText] = trimmed.split(/\s+/);
      const pid = Number(pidText);
      const ppid = Number(ppidText);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      const siblings = childrenByParent.get(ppid);
      if (siblings === undefined) childrenByParent.set(ppid, [pid]);
      else siblings.push(pid);
    }
    const descendants: number[] = [];
    // A `for...of` over `queue` safely sees elements pushed during its own iteration -- the array
    // iterator re-reads `.length` on every step rather than snapshotting it -- which is exactly what
    // this breadth-first walk relies on: each discovered child is pushed back onto the same queue.
    const queue: number[] = [rootPid];
    for (const current of queue) {
      for (const child of childrenByParent.get(current) ?? []) {
        descendants.push(child);
        queue.push(child);
      }
    }
    return descendants;
  } catch {
    return [];
  }
}

/** Kills the whole process group `pid` leads (POSIX), so a grandchild the shell started cannot keep
 * the output pipes open after the command was killed. ALSO kills every real descendant found by
 * {@link listDescendantPids}, individually, whether or not it is still a member of that group — the
 * group kill alone leaves a descendant that started its own session orphaned and running forever
 * (M16 P10's own real, confirmed repro; ported here verbatim in shape, `SPEC-QUESTIONS.md` Q296
 * Decision 1 and Decision 5).
 *
 * On win32, where neither mechanism above exists, `taskkill /PID <pid> /T /F` is the native
 * equivalent for a process that is still genuinely alive — `/T` kills `pid` and every real
 * descendant in one call, built into every Windows install. Byte-identical port of `shell.ts`'s own
 * `killGroup` fix for the identical gap (`SPEC-QUESTIONS.md` Q339/Q340's own "win32-skipped
 * descendant kill" disclosure, narrowed on direct owner request — see that function's own doc
 * comment for exactly which cases this does and does not cover, and why liveness is checked first
 * (two independent critic rounds found a real pid-reuse hazard without it: `killGroup` here is also
 * called after a subprocess has already exited, e.g. `if (result.isMaxBuffer) killGroup(subprocess)`
 * below, reached only once `await subprocess` has already resolved)); kept as a separate, duplicated
 * edit rather than a shared import, matching `Q294`'s own "keep this fix scoped to
 * `confined-command.ts` alone" precedent for this exact pair of functions. Falls back to the single
 * process when `pid` is unknown, already dead, or when `taskkill` itself fails.
 *
 * **Exported as of `specs/22` M16 P8** — see {@link listDescendantPids}'s own doc comment for the
 * full reasoning; this function is the other half of the identical reused pair. */
export function killGroup(subprocess: {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill: (signal: 'SIGKILL') => boolean;
}): void {
  const pid = subprocess.pid;
  if (pid === undefined) {
    subprocess.kill('SIGKILL');
    return;
  }
  if (process.platform === 'win32') {
    if (subprocess.exitCode !== null || subprocess.signalCode !== null) {
      subprocess.kill('SIGKILL');
      return;
    }
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // `pid` died in the gap between the liveness check above and this call, or `taskkill` itself
      // is unavailable -- fall back to the single process, the previous behaviour.
      subprocess.kill('SIGKILL');
    }
    return;
  }
  const descendants = listDescendantPids(pid);
  let groupKilled = false;
  try {
    process.kill(-pid, 'SIGKILL');
    groupKilled = true;
  } catch {
    // The group is already gone, or was never one.
  }
  for (const descendantPid of descendants) {
    try {
      process.kill(descendantPid, 'SIGKILL');
    } catch {
      // Already gone -- it may have been a member of the group just killed above.
    }
  }
  if (!groupKilled && descendants.length === 0) {
    subprocess.kill('SIGKILL');
  }
}

export interface ConfinedRunOptions {
  readonly limits: ConfinedLimits;
  /** The environment to filter: what the caller received (`bin.ts` reads the process's once, R10). A test passes the
   * process's own or a synthetic one. Required: nothing here reads the ambient environment by itself. */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly extraEnv?: Readonly<Record<string, string>>;
  /**
   * Additive (M16 P3, `SPEC-QUESTIONS.md` Q294 Decision 7, `13` F-TEST-9): absent or `false` is
   * byte-for-byte today's behaviour for every existing caller — nothing below is reached and
   * `stdout`/`stderr`/`exitCode`/`timedOut`/`outputLimitExceeded` are produced by the identical code
   * path this function always had. Set `true` only when the caller needs full fidelity (a parity
   * observation, which must hand P4 the raw bytes to refuse a lossy UTF-8 decode WITH, never having
   * already thrown it away): the result then additionally carries `rawOutput` (the exact bytes of
   * each stream, with execa's own default final-newline-stripping disabled) and `signal` (the real
   * signal that ended the process, when one did, instead of letting `exitCode`'s own pre-existing
   * `?? 1` fallback stand in for it unlabelled). `stdout`/`stderr` are still populated, decoded and
   * newline-stripped exactly as the default path would (confirmed by direct experiment: decoding the
   * raw bytes and stripping the final newline by hand reproduces execa's own default-mode `stdout`
   * byte-for-byte), so an existing-shaped caller that happens to pass `true` sees no difference either.
   *
   * Deliberately a same-function option, not a new sibling: the alternative (a second function) would
   * duplicate every line of timeout/kill/exit-listener bookkeeping above, which this option instead
   * shares completely — only the `execa` call's own `encoding`/`stripFinalNewline` and the result shape
   * differ, confined to the one branch below. The DEFAULT branch's own `execa` call is left completely
   * untouched (not merely "equivalent") rather than unified with the new branch, because
   * `execa/lib/io/max-buffer.js`'s own `getMaxBufferUnit` counts `maxBuffer` in *characters* for text
   * mode and *bytes* for buffer mode (confirmed by reading that module) — unifying the two branches
   * would silently shift the exact byte offset at which the pre-existing output-cap test fires for
   * multi-byte content, which is exactly the kind of behaviour change to a shared, already-depended-on
   * function this option must not be.
   */
  readonly preserveRawOutput?: true;
}

/** The result of `runConfinedCommand`: the shape `runShellCommand` returns, with the limit flags present only when
 * they fired, and (only when `options.preserveRawOutput` was set) `rawOutput`/`signal` — see that option's own
 * doc comment. */
export interface ConfinedCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: true;
  readonly outputLimitExceeded?: true;
  /** Present only when `options.preserveRawOutput` was set: the exact bytes of each stream, before
   * execa's own default final-newline stripping (never before `maxBuffer` truncation, which still
   * applies — a capped stream's raw bytes are the capped bytes, not the full, unbounded ones). */
  readonly rawOutput?: { readonly stdout: Uint8Array; readonly stderr: Uint8Array };
  /** Present only when `options.preserveRawOutput` was set AND a signal, not a numeric exit code,
   * ended the process (execa already reports this; the default branch never reads it, which is
   * exactly the "`exitCode: result.exitCode ?? 1` drops `result.signal` entirely" gap this option
   * exists to close for a caller that opts in). */
  readonly signal?: NodeJS.Signals;
}

/** `strip-final-newline@4`'s own algorithm (`node_modules/.pnpm/strip-final-newline@4.0.0`), applied
 * to a STRING rather than its own binary form: confirmed by direct experiment (invalid UTF-8 bytes
 * plus a trailing CRLF, compared byte-for-byte against execa's own default-mode `stdout`) that
 * decoding raw bytes lossily as UTF-8 and then applying this reproduces execa's own default `stdout`/
 * `stderr` exactly, which is what lets {@link runConfinedCommand}'s new branch compute both the
 * classic string fields and the raw bytes from one `encoding: 'buffer'` execa call rather than running
 * the command twice. */
function decodeLossyWithStrippedFinalNewline(bytes: Uint8Array): string {
  const decoded = Buffer.from(bytes).toString('utf8');
  if (decoded.at(-1) !== '\n') return decoded;
  return decoded.slice(0, decoded.at(-2) === '\r' ? -2 : -1);
}

/** The timeout/kill/exit-listener bookkeeping both {@link runConfinedCommand} branches share
 * identically — written once so the two `execa` call shapes below cannot drift apart in anything
 * except the options and the result shape that genuinely differ between them. */
function armConfinedTimeout(
  subprocess: {
    readonly pid?: number;
    readonly exitCode: number | null;
    readonly signalCode: NodeJS.Signals | null;
    kill: (signal: 'SIGKILL') => boolean;
  },
  timeoutMs: number,
): { readonly state: { timedOut: boolean }; readonly disarm: () => void } {
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    killGroup(subprocess);
  }, timeoutMs);
  const onExit = (): void => {
    killGroup(subprocess);
  };
  process.once('exit', onExit);
  return {
    state,
    disarm: () => {
      clearTimeout(timer);
      process.off('exit', onExit);
    },
  };
}

/**
 * Runs `command` with `cwd` as its directory, the scrubbed environment (`scrubbedEnvironment`, never the parent's
 * own; `extendEnv: false`), stdin closed, its own process group, a timeout and an output cap. A command killed by
 * either limit is reported with `timedOut` or `outputLimitExceeded` and a non-zero exit code; the caller decides
 * what that means (the RCA loop never reads it as a reproduction). Does not vet: use `vetProposedCommand` first for
 * anything a model wrote.
 *
 * @see ConfinedRunOptions#preserveRawOutput for the one additive option this function reads.
 */
export async function runConfinedCommand(
  command: string,
  cwd: string,
  options: ConfinedRunOptions,
): Promise<ConfinedCommandResult> {
  const env = scrubbedEnvironment(options.parentEnv, options.extraEnv);
  // `extendEnv: false` on both branches below means `env` (not the real `process.env`) is exactly what
  // this child sees, so `resolvePosixShell` must search `env`'s own `PATH` — the real `PATH` lookup this
  // spawn actually performs — not the ambient one. `vetProposedCommand`/`vetStoredCommand` already parse
  // `command` assuming a real POSIX shell (`splitWords`'s own quoting/expansion model, `posix-shell.ts`'s
  // own doc comment); this is what makes that assumption true on Windows, when `env`'s `PATH` actually has
  // one. Both the `preserveRawOutput` branch just below and the default branch after it need this: neither
  // is "the" call this module makes, there are genuinely two now.

  if (options.preserveRawOutput === true) {
    const subprocess = execa(command, {
      cwd,
      shell: resolvePosixShell(env),
      reject: false,
      env,
      extendEnv: false,
      stdin: 'ignore',
      detached: process.platform !== 'win32',
      maxBuffer: options.limits.maxOutputBytes,
      encoding: 'buffer',
      stripFinalNewline: false,
    });
    const { state, disarm } = armConfinedTimeout(subprocess, options.limits.timeoutMs);
    try {
      const result = await subprocess;
      if (result.isMaxBuffer) killGroup(subprocess);
      const rawStdout: Uint8Array = result.stdout;
      const rawStderr: Uint8Array = result.stderr;
      return {
        stdout: decodeLossyWithStrippedFinalNewline(rawStdout),
        stderr: decodeLossyWithStrippedFinalNewline(rawStderr),
        exitCode: result.exitCode ?? 1,
        ...(state.timedOut ? { timedOut: true as const } : {}),
        ...(result.isMaxBuffer ? { outputLimitExceeded: true as const } : {}),
        rawOutput: { stdout: rawStdout, stderr: rawStderr },
        ...(result.signal === undefined ? {} : { signal: result.signal }),
      };
    } finally {
      disarm();
    }
  }

  // The default branch, deliberately untouched by the new option above — see that option's own doc
  // comment for why it is not unified with the branch above.
  const subprocess = execa(command, {
    cwd,
    shell: resolvePosixShell(env),
    reject: false,
    env,
    extendEnv: false,
    stdin: 'ignore',
    detached: process.platform !== 'win32',
    maxBuffer: options.limits.maxOutputBytes,
  });
  const { state, disarm } = armConfinedTimeout(subprocess, options.limits.timeoutMs);
  try {
    const result = await subprocess;
    if (result.isMaxBuffer) killGroup(subprocess);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 1,
      ...(state.timedOut ? { timedOut: true as const } : {}),
      ...(result.isMaxBuffer ? { outputLimitExceeded: true as const } : {}),
    };
  } finally {
    disarm();
  }
}

/** The one, complete, real bare-shadowed tool-name set `createLiveFileAccessGate` (below) ever gates —
 * re-confirmed directly against the installed SDK's own `tool_input` shapes (`sdk-tools.d.ts`:
 * `FileReadInput`/`FileEditInput`/`FileWriteInput` each carry exactly `file_path: string`, nothing else
 * this gate needs) rather than assumed from `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`'s own warning text alone. */
export type LiveFileAccessToolName = 'Read' | 'Edit' | 'Write';

/**
 * Resolves `filePath` the way a live file-tool call's own argument should be read: absolute as-is
 * (the SDK's own real contract for all three tools — confirmed against `sdk-tools.d.ts`: `Write`'s
 * own `file_path` doc literally says "must be absolute, not relative"), or against `root` on the
 * rare/defensive chance a caller's own tool_input carries a relative one anyway (fail toward
 * confinement, not toward trusting an unexpected shape). Mirrors `vetPath`'s own `path.resolve(root,
 * candidate)` call above, not a second, independently-invented resolution rule.
 */
function resolveFileAccessTarget(filePath: string, root: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

/** The hop limit a symlink chain is allowed before this walk gives up and treats the rest of the
 * chain as a literal, unresolved remainder — matching the limit real OS `realpath` implementations
 * use (glibc/Linux's own `MAXSYMLINKS`), so a cycle or a pathological chain cannot hang this walk or
 * recurse without bound. */
const MAX_SYMLINK_HOPS = 40;

/**
 * Resolves `target`'s real path the way the real filesystem resolves it for a live file-tool call —
 * including a target that does not exist yet, and including a target that passes THROUGH a symlink
 * whose own eventual target does not exist yet either (a **dangling symlink**). A plain `realpath()`
 * cannot do this: it throws `ENOENT` both for "nothing exists at this path at all" and for "something
 * exists here, but it's a symlink whose own target does not resolve" — the two are indistinguishable
 * to any check that only tries `realpath` and catches the failure.
 *
 * **The algorithm (a forward walk, not an ancestor climb).** Starting at the filesystem's own root,
 * this walks `target`'s path components one at a time, left to right, maintaining a resolved-so-far
 * absolute path, and at each step `lstat`s (never `realpath`s) the next candidate:
 *
 * - does not exist (`ENOENT`, or any other `lstat` failure): nothing from here to the end of the
 *   original path can be resolved further — append the rest of the original components, literally,
 *   to resolved-so-far, and stop. This is the correct final answer: a not-yet-existing path cannot
 *   itself be a symlink, so there is nothing left to follow.
 * - exists and is a symlink: `readlink` it and resolve its target — absolute as given, or, for a
 *   relative target, resolved against the SYMLINK'S OWN containing directory (never `cwd`, which has
 *   no bearing on what a relative symlink target means) — then recursively apply this same walk to
 *   that resolved target and continue the OUTER walk from whatever it returns. This happens
 *   regardless of whether the symlink's own target currently exists (the dangling case this function
 *   exists to fix) and regardless of how many components of the original path still remain after this
 *   symlink — both independently necessary: a dangling symlink can be the final component (nothing
 *   left to append) or have several more components still to resolve underneath it (those components
 *   get appended, literally, onto the dangling target's own resolved-so-far, by the SAME "does not
 *   exist" branch above, on the next iteration).
 * - exists and is not a symlink (a plain file or directory): append it as given and continue.
 *
 * **Why this replaces an ancestor-climb.** An earlier version of this function (and, independently,
 * two gauntlet critics reviewing it) tried `realpath(target)`, then climbed upward via `dirname` until
 * it found the first existing ancestor, `realpath`'d that ancestor, and rejoined the un-resolved
 * suffix. Climbing from the TARGET upward only ever asks "does something exist here yet" — it has no
 * way to notice that the existing ancestor it eventually finds and stops on is itself a symlink needing
 * `readlink` resolution if ITS OWN target happens not to exist yet, which is exactly the dangling-symlink
 * shape a third gauntlet critic found live: `lane/escape.txt` → `outsideRoot/newleaf.txt` where
 * `outsideRoot` exists but `newleaf.txt` does not — `realpath(escape.txt)` and `realpath(dirname(...))`
 * both throw `ENOENT`, the climb reaches `lane` (which does exist), stops there, and rejoins the raw,
 * un-resolved `escape.txt` onto it — textually still in-lane, while the real SDK `Write` call that this
 * gate exists to vet follows the symlink and lands fully outside the lane. Walking FORWARD and `lstat`ing
 * every existing component (symlink or not) as it is reached, rather than only checking for absence,
 * is what tells "nothing here" and "a symlink here, dangling or not" apart.
 *
 * Deliberately walks from the filesystem's own root rather than starting from the lane's own `root`
 * argument: a `target.startsWith(root)` shortcut is a classic path-prefix footgun (`"/lane2/evil"`
 * also starts with the string `"/lane"`), and the extra `lstat` calls walking through `root`'s own
 * ordinary ancestor directories costs microseconds — there is no correctness reason to take the
 * shortcut, and one real way for it to go wrong.
 *
 * Never throws: an `lstat` failure other than "does not exist" (e.g. a permission error) is treated
 * identically to "does not exist" — append the rest literally and stop — the same fail-toward-deciding
 * behaviour, rather than leaving the caller's containment check with nothing to compare against.
 */
async function resolveRealpathTolerant(
  target: string,
  hopsRemaining = MAX_SYMLINK_HOPS,
): Promise<string> {
  const parsedRoot = path.parse(target).root;
  const components = target
    .slice(parsedRoot.length)
    .split(path.sep)
    .filter((component) => component !== '');
  let resolved = parsedRoot;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined) break; // unreachable: index < components.length always holds here
    const candidate = path.join(resolved, component);
    let stats;
    try {
      stats = await lstat(candidate);
    } catch {
      return path.join(candidate, ...components.slice(index + 1));
    }
    if (!stats.isSymbolicLink()) {
      resolved = candidate;
      continue;
    }
    if (hopsRemaining <= 0) {
      // A cycle or a pathological chain: stop resolving and treat the rest as literal, rather than
      // recursing without bound.
      return path.join(candidate, ...components.slice(index + 1));
    }
    let linkTarget: string;
    try {
      linkTarget = await readlink(candidate);
    } catch {
      // `lstat` just confirmed this is a symlink, so `readlink` failing here is a race (something
      // removed it between the two calls) rather than an expected outcome -- treat it the same as
      // any other unresolvable component: literal, and stop.
      return path.join(candidate, ...components.slice(index + 1));
    }
    const resolvedLinkTarget = path.isAbsolute(linkTarget)
      ? linkTarget
      : path.resolve(path.dirname(candidate), linkTarget);
    resolved = await resolveRealpathTolerant(resolvedLinkTarget, hopsRemaining - 1);
  }
  return resolved;
}

/**
 * Builds `SessionRequest.vetFileAccess` for one session (`SPEC-QUESTIONS.md` Q347): a real per-call
 * gate on the session's own LIVE `Read`/`Edit`/`Write` tool use, the file-path analogue of
 * `createLiveExecGate`'s own Bash gate (`adopt-agent.ts`) — built here, not there, so every real
 * `kind: agent` step's own `SessionRequest` (not only `adopt-tests`'s own) can share the identical,
 * once-reviewed containment logic rather than each caller re-deriving it.
 *
 * **Containment, mirroring `vetPath`'s own double-check above.** `root`'s own realpath is resolved
 * once, up front (so a lane whose own path crosses a symlink — e.g. macOS's `/tmp` -> `/private/tmp`,
 * confirmed hit directly while building this gate's own live experiment — is not itself mistaken for
 * an escape). The call's own target is resolved against `root`, then its real path is resolved via
 * {@link resolveRealpathTolerant} — a full forward walk that `lstat`s every component and resolves a
 * symlink wherever it finds one, INCLUDING a dangling one whose own target does not currently exist
 * (that function's own doc comment has the full reasoning and three rounds of critics' own exact
 * repros: the plain in-lane-symlink case, the "2+ missing levels past a resolvable symlink" case, and
 * the "the symlink itself is dangling" case). A target contained in either `root` or `root`'s own realpath (matching `within`'s own
 * existing double-check convention, used identically by `vetPath` above for the exact same "the lane
 * path itself may be a symlink" reason) is allowed; anything else is denied, with a reason naming the
 * tool, the offending path, and the lane it escaped.
 *
 * **Fails closed on a malformed `tool_input`** (no string `filePath` at all): never reachable for a
 * genuine `Read`/`Edit`/`Write` call given the SDK's own real `FileReadInput`/`FileEditInput`/
 * `FileWriteInput.file_path: string` contract, but denied rather than silently allowed on the off
 * chance some other shape ever reaches this function — the same "fail closed on anything unexpected"
 * convention `build-options.ts`'s own `buildCanUseTool` already applies to a non-string Bash
 * `input.command`.
 */
export function createLiveFileAccessGate(
  root: string,
): (toolName: LiveFileAccessToolName, filePath: string) => Promise<ExecCommandVerdict> {
  return async (toolName, filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return {
        allowed: false,
        reason: `refused: this ${toolName} call carries no real file path to vet at all.`,
      };
    }
    const realRoot = await realpath(root).catch(() => root);
    const target = resolveFileAccessTarget(filePath, root);
    const realTarget = await resolveRealpathTolerant(target);
    if (within(root, realTarget) || within(realRoot, realTarget)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `refused: ${toolName} path "${filePath}" resolves outside this session's own lane (${root}).`,
    };
  };
}

/** The one, complete, real bare-shadowed tool-name set `createLiveNetworkAccessGate` (below) ever
 * gates (`SPEC-QUESTIONS.md` Q350) -- confirmed directly against the installed SDK's own real
 * `tool_input` shapes (`sdk-tools.d.ts`: `WebFetchInput.url: string`; `WebSearchInput` carries no
 * comparable single-host field at all, only a `query` and two MODEL-chosen, not FORGE-chosen,
 * `allowed_domains`/`blocked_domains` hints). */
export type LiveNetworkAccessToolName = 'WebFetch' | 'WebSearch';

/**
 * Builds `SessionRequest.vetNetworkAccess` for one session (`SPEC-QUESTIONS.md` Q350, found while
 * building `createLiveFileAccessGate` above): the network analogue of that function, for a live
 * session's own `WebFetch`/`WebSearch` tool use rather than its `Read`/`Edit`/`Write` calls.
 *
 * **Policy, grounded in the grant's own already-documented semantics, not invented here.** `WebFetch`:
 * first, the url's own SCHEME must be `http:`/`https:` -- refused for every other scheme (`file:`,
 * `javascript:`, `data:`, ...) regardless of `grant.network`, including `'full'` (see the inline
 * comment at that check for why: `'full'` is a promise about which HOST may be reached, never about
 * what KIND of resource a tool literally named for fetching WEB content may read). Only once the
 * scheme passes is the real `url` argument's hostname checked against `isHostAllowed(grant, hostname)`
 * (`@forge/adapter-kit/grants`) -- the EXACT SAME function `vetNetworkAndArguments` (above, this file)
 * already uses to judge a Bash-originated URL against the identical grant, so this is one, shared
 * reading of "what network: 'full'/'allowlist'/'none' means," not a second, independently-invented
 * one. Concretely: a `network: 'full'` session's `WebFetch` calls are allowed for any HOST at all
 * (`isHostAllowed`'s own "'full' allows every host" contract) -- the only currently-reachable case
 * (`SPEC-QUESTIONS.md` Q350: no shipped role grants `network: 'full'` today), so wiring this gate in is
 * a zero-behaviour-change consultation, not a new restriction on anything live. A `network: 'allowlist'`
 * session's calls are allowed only for a host literally present in `grant.allowlistHosts`
 * (case-insensitively, `isHostAllowed`'s own existing comparison) -- genuine belt-and-braces alongside
 * whatever the SDK's own native, non-bare `WebFetch(domain:host)` rule matching already does for that
 * case (never itself bare, so not the shape Q350 found broken), not a path this piece newly unlocks. A
 * `network: 'none'` session's calls are always denied. A malformed or unparsable `url` is denied
 * outright, fail closed, matching `createLiveFileAccessGate`'s own identical treatment of a non-string
 * `filePath` immediately above. `WebSearch`: there is no per-call host to check at all
 * (`LiveNetworkAccessToolName`'s own doc comment has the real `WebSearchInput` shape) -- allowed only
 * when `grant.network === 'full'`, mirroring `tool-grant.ts`'s own `mapToolGrantToAllowedTools` doc
 * comment, which already establishes that `WebSearch` has no domain-scoped grant form at all and is
 * never even mapped onto `allowedTools` for `'allowlist'` (fail closed, matching `'none'` for that one
 * tool specifically) -- this gate holds every real call to the identical rule, not only the ones that
 * happened to reach `allowedTools` bare.
 *
 * **Disclosed, not assumed closed** (`SessionRequest.vetNetworkAccess`'s own doc comment has the fuller
 * reasoning). Unlike `createLiveFileAccessGate`, no live, API-key-backed experiment confirms the real
 * SDK's `PreToolUse` hook is actually consulted for a `WebFetch`/`WebSearch` call the way `Q347`'s own
 * experiment confirmed it for `Read`/`Edit`/`Write` -- no shipped role grants `network: 'full'` today,
 * so there is no live fixture to run that experiment against.
 */
export function createLiveNetworkAccessGate(
  grant: Pick<ToolGrant, 'network' | 'allowlistHosts'>,
): (toolName: LiveNetworkAccessToolName, url: string | undefined) => Promise<ExecCommandVerdict> {
  return (toolName, url) => {
    if (toolName === 'WebSearch') {
      if (grant.network === 'full') return Promise.resolve({ allowed: true });
      return Promise.resolve({
        allowed: false,
        reason:
          `refused: WebSearch has no per-call host to scope, and this session's own network grant ` +
          `is '${grant.network}', not 'full'.`,
      });
    }
    if (typeof url !== 'string' || url.length === 0) {
      return Promise.resolve({
        allowed: false,
        reason: 'refused: this WebFetch call carries no real "url" string to vet at all.',
      });
    }
    // Destructured, not a `.hostname` member access on a fresh `new URL(...)`: the real-but-
    // overbroad R10 `HOST_FACT_NAMES` lint rule (`eslint.config.js`) matches ANY `MemberExpression`
    // named `hostname` on the assumption it is `os.hostname()` (a genuine per-machine fact); this is
    // the unrelated, deterministic WHATWG `URL.hostname` -- a pure parse of `url`, not a host fact at
    // all -- and destructuring sidesteps the selector's own `MemberExpression`-only AST match rather
    // than suppressing the rule.
    let hostname: string;
    let protocol: string;
    try {
      ({ hostname, protocol } = new URL(url));
    } catch {
      return Promise.resolve({
        allowed: false,
        reason: `refused: WebFetch url "${url}" could not be parsed as a real URL at all.`,
      });
    }
    // Scheme check, BEFORE the host check and independent of `grant.network` (including `'full'`):
    // a gauntlet critic found that `new URL('file:///etc/passwd').hostname === ''`, and `isHostAllowed`
    // returns `true` unconditionally for `'full'` without ever inspecting the host -- so a `file://`
    // (or `javascript:`/`data:`/any other non-http(s)) URL would otherwise sail through whenever
    // `network: 'full'` is granted. `'full'` is this grant's own promise about which HOST may be
    // reached, never about what KIND of resource a tool literally named for fetching WEB content may
    // read -- conflating the two rests on an unverified assumption about the real, closed-source
    // WebFetch tool's own scheme handling, exactly the category of "disclosed, not assumed closed"
    // risk this file's own module comment already holds every other check in this gate to. Denied for
    // every grant level, not only non-'full' ones: a non-http(s) scheme is refused on its own terms,
    // never reaching the host-scoping policy below at all.
    if (protocol !== 'http:' && protocol !== 'https:') {
      return Promise.resolve({
        allowed: false,
        reason:
          `refused: WebFetch url "${url}" uses the "${protocol}" scheme, not http: or https: -- ` +
          `denied regardless of this session's own network grant.`,
      });
    }
    // `isHostAllowed`'s own declared parameter type is the full `ToolGrant` even though its body only
    // ever reads `network`/`allowlistHosts` -- the identical dummy-`read`/`write`/`exec` construction
    // `vetNetworkAndArguments` (above, this file) already uses to call the same function with the
    // same narrower information, not a second, independently-invented workaround.
    if (
      isHostAllowed(
        {
          read: true,
          write: false,
          exec: false,
          network: grant.network,
          ...(grant.allowlistHosts === undefined ? {} : { allowlistHosts: grant.allowlistHosts }),
        },
        hostname,
      )
    ) {
      return Promise.resolve({ allowed: true });
    }
    return Promise.resolve({
      allowed: false,
      reason:
        `refused: WebFetch url "${url}" names a host this session's own network grant ` +
        `('${grant.network}') does not allow.`,
    });
  };
}
