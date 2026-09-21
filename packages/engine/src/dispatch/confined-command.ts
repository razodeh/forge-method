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
 * @see specs/20 §20.1
 * @see specs/20 §20.4
 * @see specs/20 §20.10
 * @see SPEC-QUESTIONS.md Q222
 * @see PLAN-M13.md P28
 */
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type { ToolGrant } from '@forge/adapter-kit';
import { listDirEntriesSorted, type AbsolutePath } from '@forge/core/fs';
import {
  isExecAllowed,
  isHardDenylisted,
  isHostAllowed,
  SHELL_OPERATOR_PATTERN,
} from '@forge/adapter-kit/grants';
import { execa } from 'execa';
import { minimatch } from 'minimatch';

/** The variables a confined child inherits, and no others. A build or a test needs a `PATH`, a home directory, a
 * locale, a terminal type, a time zone and a temp directory; nothing here can carry a credential. Everything else
 * in the parent environment is dropped, which is the point: `ANTHROPIC_API_KEY`, `AWS_*`, `GITHUB_TOKEN`,
 * `NPM_TOKEN`, `SSH_AUTH_SOCK`, `GOOGLE_APPLICATION_CREDENTIALS` and whatever the next tool invents are refused by
 * not being on a list, not by matching a list of bad names (which is always one name behind). */
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
];

/** Locale variables come as a family (`LC_ALL`, `LC_CTYPE`, ...). */
const CONFINED_ENV_PREFIXES: readonly string[] = ['LC_'];

/** Fixed values every confined child gets: nothing prompts (there is no stdin), nothing pages. */
const CONFINED_ENV_FIXED: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
};

/** Added only for a command a model proposed: git reads neither the user's nor the system's config, so an alias
 * (`alias.x = !sh ...`), a credential helper or a `core.hooksPath` the user set cannot be reached through `git *`. */
export const PROPOSED_ENV_FIXED: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

/** `parent` reduced to `CONFINED_ENV_ALLOWLIST` (and the `LC_` family) plus the fixed values. Pure. */
export function scrubbedEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    const allowed =
      CONFINED_ENV_ALLOWLIST.includes(name) ||
      CONFINED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
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
  | 'dangerous-argument';

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
    if (program === 'tree' && (/^-[A-Za-z]*o/.test(arg) || arg.startsWith('--output'))) {
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

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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
 *   - a match whose name starts with `-` is refused (a tracked file called `--open-files-in-pager=sh` would turn `*`
 *     into an option of `git grep`);
 *   - a path that is, or passes through, a symlink resolving outside the lane is refused (`link/*`, `li*\/x`);
 *   - a match that names a secret file or `.git` internals is refused (`cat .env*` is `cat .env`).
 * A pattern that needs more than `GLOB_ENTRY_CAP` directory entries to decide is refused.
 */
async function vetGlob(
  word: string,
  root: string,
  realRoot: string,
): Promise<CommandRefusal | undefined> {
  for (const candidate of pathCandidates(word)) {
    if (!/[*?[]/.test(candidate) || candidate.startsWith('-') || candidate.startsWith('/'))
      continue;
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
      if (path.posix.basename(entry).startsWith('-')) {
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
   */
  readonly trustedCommands?: readonly string[];
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
  const program = path.posix.basename(first);
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

  if (!isExecAllowed({ read: true, write: false, exec: grant.exec, network: 'none' }, command)) {
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
  const programs = (grant.exec === false ? [] : grant.exec)
    .filter((pattern) =>
      isExecAllowed({ read: true, write: false, exec: [pattern], network: 'none' }, command),
    )
    .map((pattern) => pattern.split(/[\s*]/, 1)[0] ?? '');
  if (!programs.some((name) => name === '' || name === first)) {
    return refuse('not-in-grant', `"${first}" is not the program any matching exec pattern names`);
  }
  const trusted = options.trustedCommands?.includes(command) === true;
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

/** FORGE's own commands in the lane (`forge test run`, the revert check) run the project's tests, which take
 * as long as they take: bounded, but by the loop's own wall-clock budget more than by this. */
export const ENGINE_COMMAND_LIMITS: ConfinedLimits = {
  timeoutMs: 1_200_000,
  maxOutputBytes: 8_000_000,
};

function killGroup(subprocess: {
  readonly pid?: number;
  kill: (signal: 'SIGKILL') => boolean;
}): void {
  const pid = subprocess.pid;
  if (pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
      return;
    } catch {
      // The group is already gone, or was never one: fall through to the single-process kill.
    }
  }
  subprocess.kill('SIGKILL');
}

export interface ConfinedRunOptions {
  readonly limits: ConfinedLimits;
  /** The environment to filter: what the caller received (`bin.ts` reads the process's once, R10). A test passes the
   * process's own or a synthetic one. Required: nothing here reads the ambient environment by itself. */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly extraEnv?: Readonly<Record<string, string>>;
}

/** The result of `runConfinedCommand`: the shape `runShellCommand` returns, with the limit flags present only when
 * they fired. */
export interface ConfinedCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: true;
  readonly outputLimitExceeded?: true;
}

/**
 * Runs `command` with `cwd` as its directory, the scrubbed environment (`scrubbedEnvironment`, never the parent's
 * own; `extendEnv: false`), stdin closed, its own process group, a timeout and an output cap. A command killed by
 * either limit is reported with `timedOut` or `outputLimitExceeded` and a non-zero exit code; the caller decides
 * what that means (the RCA loop never reads it as a reproduction). Does not vet: use `vetProposedCommand` first for
 * anything a model wrote.
 */
export async function runConfinedCommand(
  command: string,
  cwd: string,
  options: ConfinedRunOptions,
): Promise<ConfinedCommandResult> {
  const env = scrubbedEnvironment(options.parentEnv, options.extraEnv);
  const subprocess = execa(command, {
    cwd,
    shell: true,
    reject: false,
    env,
    extendEnv: false,
    stdin: 'ignore',
    detached: process.platform !== 'win32',
    maxBuffer: options.limits.maxOutputBytes,
  });
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    killGroup(subprocess);
  }, options.limits.timeoutMs);
  const onExit = (): void => {
    killGroup(subprocess);
  };
  process.once('exit', onExit);
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
    clearTimeout(timer);
    process.off('exit', onExit);
  }
}
