/**
 * `shell.ts` and `confined-command.ts` both run command text this codebase treats as POSIX shell syntax:
 * `command`-kind workflow steps (`intake.workflow.yaml`'s `for f in ...; do [ -s ... ] || ...; done`,
 * `replan.workflow.yaml`'s `[ "$FORGE_ANSWER_x" != approve ] && ... || ...`), `.check.yaml` module scripts
 * (every one of them a single-quoted `node -e '...'`), and `confined-command.ts`'s own `vetProposedCommand`
 * — whose `splitWords` explicitly models POSIX quoting and expansion (single quotes are literal, `$`/`~`/
 * a backslash are refused as "a shell would expand this"). `execa`'s `shell: true` means "the OS default
 * shell" (Node's own documented behaviour): `/bin/sh` on POSIX, `cmd.exe` on Windows. cmd.exe understands
 * none of the above — it has no single-quote grouping at all (a `node -e '...'` check script would be
 * split on every unquoted space inside the script text), no `[ ]` test command, no POSIX `for ... in ...;
 * do ... done`, and no `$VAR` expansion (`%VAR%` is its own, incompatible syntax) — so every one of those
 * real, shipped command strings would simply fail under cmd.exe, not run with different-but-equivalent
 * semantics.
 *
 * Rather than hand-translate each one into a second, cmd.exe-flavoured dialect (itself a second place every
 * one of them could drift from whatever the shell that actually runs it understands — exactly the
 * "two places that can drift" shape this codebase avoids elsewhere), this resolves a real POSIX shell to
 * run them through on Windows instead, when one is actually on `PATH`.
 *
 * Git for Windows — the git distribution GitHub's own `windows-latest` runner ships, and the one almost
 * every real Windows developer who runs `forge` already has (this codebase assumes a git repository
 * everywhere else, `15` §15.11) — bundles `bash.exe` on `PATH`. When no real POSIX shell is found (a bare
 * Windows install with no git, or git installed without bash), this falls back to `true` (cmd.exe): the
 * exact behaviour every caller of this module already had, not a new, harder failure.
 *
 * **Disclosed, unverified residual (needs a real Windows + Git-for-Windows rig to actually close, not
 * further reasoning from here).** Windows' `CreateProcess` takes one flat command-line string, not an
 * argv array: when `execa` builds that string for a non-cmd.exe `shell` (this module's own return value,
 * `bash.exe`'s full path), it applies Node's own default Windows argument-escaping to each piece, and
 * `bash.exe` itself (an MSYS2/Cygwin-built binary) then has to recover its own argv from that same string
 * through ITS runtime's own escaping convention — a different one than native `CreateProcess` callers
 * generally assume. `confined-command.ts`'s whole `vetProposedCommand`/`vetStoredCommand` security model
 * (`splitWords`'s own POSIX quoting/expansion rules) assumes what the vet approved is byte-for-byte what
 * the shell it hands off to receives and parses the same way. Whether that double round-trip (Node's
 * Windows escaping, then MSYS2 bash's own argv recovery) genuinely preserves single-quote/space/backslash
 * semantics identically to a native POSIX `exec`, or instead opens a gap between "what the vet approved"
 * and "what bash actually runs," is not something either a fresh reading of execa's/Node's own source or
 * Git-for-Windows' documentation can fully settle — it needs to be run, by hand, against a real Windows
 * host with a real Git-for-Windows install, with adversarial inputs (embedded quotes, backslashes,
 * trailing backslash-before-quote, spaces) proposed the way a model actually would. Treat this as an
 * open security question this piece's own reasoning could not close, not as confirmed-safe.
 *
 * @see SPEC-QUESTIONS.md Q351
 */
import { statSync } from 'node:fs';
import path from 'node:path';

/** Checked in this order; the first one found on `PATH` wins. `bash` with no extension is last — Windows
 * executables normally carry one, but nothing stops a shim or a WSL interop wrapper from being named bare. */
const POSIX_SHELL_CANDIDATES: readonly string[] = ['bash.exe', 'bash.cmd', 'bash'];

/** A real, regular FILE at `full` — never a directory (a stray `bash/` directory on `PATH`, e.g. an
 * unrelated project's own build output, must not be "resolved" as a shell and handed to `execa`, which
 * would fail confusingly at spawn time instead of this function correctly falling back to `true`).
 * `existsSync` alone cannot tell the two apart; `statSync` can. Swallows any error (permission denied, a
 * symlink that no longer resolves, a race with something deleting it between the two checks) as "not a
 * real usable shell here" rather than letting a filesystem quirk throw out of a function whose whole
 * contract is "never worse than `shell: true`." */
function isRealFile(full: string): boolean {
  try {
    return statSync(full).isFile();
  } catch {
    return false;
  }
}

/** The directories named by `env`'s `PATH` (or, on Windows, however that variable is actually spelled —
 * `Path`, `path`), in order. `''` entries (an empty `PATH`, or a stray leading/trailing delimiter) are
 * dropped rather than resolved as the current directory, matching how a real shell's own `PATH` lookup
 * treats them. */
function pathDirectories(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const key = Object.keys(env).find((name) => name.toLowerCase() === 'path');
  const value = key === undefined ? undefined : env[key];
  if (value === undefined || value === '') return [];
  return value.split(path.delimiter).filter((dir) => dir !== '');
}

/** The real POSIX shell to run an engine-authored command string through, as `execa`'s own `shell` option
 * (a string names a specific shell; `true` is the OS default) — `true` on every platform but Windows, where
 * this looks for a real `bash` on `PATH` first. `env` is the exact environment the command will actually run
 * with (the caller's own merged/scrubbed map, never read ambiently here), since that is what decides what a
 * real `PATH` lookup would find. Pure: touches no global state, including the real `process.env`. */
export function resolvePosixShell(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): string | true {
  if (platform !== 'win32') return true;
  for (const dir of pathDirectories(env)) {
    for (const candidate of POSIX_SHELL_CANDIDATES) {
      const full = path.join(dir, candidate);
      if (isRealFile(full)) return full;
    }
  }
  return true;
}
