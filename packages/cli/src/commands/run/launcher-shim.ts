/**
 * A throwaway directory holding a `forge` executable that re-launches *this* CLI, so the shell commands a
 * run spawns (`forge kb sync`, `forge plan run-plan`, `forge spec validate`, ...) resolve `forge` to the
 * `forge` that started the run, even when none is on `PATH` (`PLAN-M13.md` P12, `Q208` finding 3).
 *
 * The CLI cannot assume a global install: it is also launched as `node packages/cli/bin/forge.mjs` from a
 * checkout, which spawns `node --experimental-strip-types .../src/bin.ts`. What survives every launch mode
 * is the running process itself: its node binary (`process.execPath`), the node flags it was started with
 * (`process.execArgv`) and the script node ran (`process.argv[1]`). The shim replays exactly those, then
 * the caller's own arguments.
 *
 * The directory is created under the OS temp directory (never the user's project or the repository, which
 * a run must not litter), is private to the user (created `0700`, named by a random UUID, never adopted if it exists), is removed when the run
 * ends, and also synchronously by the `SIGTERM`/`SIGINT`/`SIGHUP` handlers (`run.ts`), which exit without
 * running `finally` blocks. A `SIGKILL` (`forge abort`) leaves one small directory in the temp directory.
 *
 * Nothing about the paths is interpolated into a command line the run's shell parses: the launcher script
 * single-quotes each value (and re-quotes any `'` inside it), so a path with spaces, quotes or `$` is data.
 *
 * Trust boundary: the directory is the user's own (`0700`), and the launcher runs with the user's rights, so
 * a process of the same user that can write it could already do anything the user can; the shim adds no
 * privilege. Agent sessions that run shell commands in a lane are governed by their own tool grant, not by
 * this directory. A `TMPDIR` containing `:` breaks `PATH` resolution on POSIX (an unquotable delimiter).
 *
 * @see specs/03 §3.2.4
 * @see PLAN-M13.md P12
 */
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';

import { FORGE_RUN_ID, ForgeError, renderCause } from '@forge/core';

import { createSystemTempPath } from '../loop/test/system-temp.ts';

/** What replays the running CLI: the node binary, its flags, and the script node executed. */
export interface LauncherSpec {
  readonly execPath: string;
  readonly execArgv: readonly string[];
  readonly entry: string;
  /** The parent environment's variables (the CLI's own snapshot: R10 keeps ambient reads out of here), for
   * the one thing built from them, the child's `PATH`. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface LauncherShim {
  /** The directory holding the launcher. */
  readonly binDir: string;
  /** The environment overlay for the run's shell commands: `PATH` with `binDir` first. */
  readonly commandEnv: Readonly<Record<string, string>>;
  /** Removes the directory. Idempotent; never throws. */
  readonly cleanup: () => Promise<void>;
}

/** The running process as a `LauncherSpec`, or `undefined` when it cannot be replayed (no script path).
 * Debugger flags are dropped: a child that inherited `--inspect` would fight its parent for the port. */
export function currentLauncher(
  env: Readonly<Record<string, string | undefined>>,
): LauncherSpec | undefined {
  const entry = process.argv[1];
  if (entry === undefined || entry === '') return undefined;
  return {
    execPath: process.execPath,
    execArgv: process.execArgv.filter((flag) => !flag.startsWith('--inspect')),
    entry: path.resolve(entry),
    env,
  };
}

/** `spec.env` with every `undefined` value dropped — a real environment variable the parent process
 * carries at all is always a defined string; `undefined` only ever means "this object's own shape
 * allows a missing key," never a real value to pass on. The fallback `run.ts`/`resume.ts` use when
 * `createLauncherShimOrWarn` could not build a real shim (warned, not thrown): `shim?.commandEnv` is
 * then itself `undefined`, which otherwise reaches `runShellCommand` as its own `env === undefined`
 * and keeps `shell: true` (cmd.exe on Windows) unconditionally, never giving `resolvePosixShell` a
 * real `PATH` to search (`shell.ts`'s own doc comment) — this is the real environment `currentLauncher`
 * already captured, usable as that concrete fallback, just missing the (now-failed) shim's own
 * binDir-prepended `PATH`. `undefined` in, `undefined` out: a caller with no real `LauncherSpec` at
 * all (`currentLauncher`'s own "no script path" case) has nothing to fall back to either. */
export function definedLauncherEnv(
  spec: LauncherSpec | undefined,
): Readonly<Record<string, string>> | undefined {
  if (spec === undefined) return undefined;
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(spec.env)) {
    if (value !== undefined) result[name] = value;
  }
  return result;
}

/** POSIX single-quoting: wrap in `'...'`, and end/reopen the quote around each embedded `'`. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** The `.cmd` equivalent. `%` is doubled so `cmd` does not expand it; a `"` cannot be quoted inside a
 * quoted argument, and Windows forbids it in file names anyway, so it is refused rather than mangled. */
function cmdQuote(value: string): string {
  if (value.includes('"') || /[\r\n]/u.test(value)) {
    throw new ForgeError('RUN-086', {
      reason: `${JSON.stringify(value)} cannot be embedded in a .cmd launcher`,
    });
  }
  return `"${value.replaceAll('%', '%%')}"`;
}

/** The launcher script's text. Exported for tests; `platform` is injectable so both forms are checkable
 * on one host. */
export function launcherScript(spec: LauncherSpec, platform: NodeJS.Platform): string {
  const words = [spec.execPath, ...spec.execArgv, spec.entry];
  if (platform === 'win32') {
    return `@echo off\r\n${words.map(cmdQuote).join(' ')} %*\r\n`;
  }
  return `#!/bin/sh\nexec ${words.map(shellQuote).join(' ')} "$@"\n`;
}

/** `PATH` with `binDir` first, everything else about the parent's `PATH` unchanged, plus the FORGE run
 * marker (`@forge/core/session-marker`, `PLAN-M14.md` P4) when `runId` is given -- and, when it is NOT,
 * `FORGE_RUN_ID` explicitly STRIPPED from the child env this overlay produces, never merely left out of
 * this object (round-2 gauntlet fix, M16 P15: two independent critics, two different real repros; see
 * "Why an explicit strip" below). On Windows the variable is spelled `Path`; the spelling the parent
 * environment already uses is reused, so no second, competing entry is created. The value is an
 * environment variable, never spliced into a shell string, so a directory with spaces or quotes in its
 * name needs no quoting.
 *
 * `runId` is optional, and deliberately not threaded through every caller: `bin.ts`'s own ad-hoc `forge
 * gate check/approve/waive` shim (run directly from a person's own shell, never by the engine) calls this
 * with no run id, so its own commands never carry the marker -- a real human's own shell must never
 * incidentally pick one up (`SPEC-QUESTIONS.md` Q232 decision 9). Only `run.ts`'s own real run passes one.
 *
 * **Why an explicit strip, not just an omission (the real bug this fixes).** This object is handed to
 * `execa`'s own `env` option (`runShellCommand`, `@forge/engine/dispatch/shell.ts`), whose default
 * `extendEnv: true` merges `{...process.env, ...thisObject}` -- so a key this object never mentions AT
 * ALL falls straight through to whatever `process.env` already has. Before this fix, `runId === undefined`
 * produced an object with no `FORGE_RUN_ID` key, which is indistinguishable, for that merge, from an
 * object that never had one to begin with: an already-ambient `FORGE_RUN_ID` in the CALLING shell (left
 * over from an earlier `forge run` in the same terminal, or inherited from an `agent` step's own spawned
 * shell, `commandStepEnvironment`) survived into the child regardless. A round-2 critic confirmed this
 * end-to-end: a genuinely standalone `forge gate check <id>` -- not part of any workflow run at all --
 * silently wrote a real, MISATTRIBUTED `CheckRun` telemetry event into the real project's own event log,
 * because `gate-commands.ts`'s `evaluateFresh` runs with `ctx.projectRoot`, the real one (unlike an
 * in-run gate step's own `ctx.integrationPath` -- `check-command.ts`'s own `RunParityCheckOptions.runId`
 * doc comment has the full account of both real paths this affects).
 *
 * `delete`-ing the key instead of setting it (rather than never adding it) would look identical, for
 * that same merge, to never having added it at all -- confirmed directly against a real `execa` 9.6.1
 * subprocess extending a `process.env` that carries an ambient `FORGE_RUN_ID`: deleting the key beforehand
 * leaks the ambient value through exactly as omitting it does. An explicit `undefined` own property on
 * THIS object, by contrast, wins the spread (plain JS: a later spread's own key always overwrites an
 * earlier one, even when its value is `undefined`) and -- also confirmed directly against the same real
 * subprocess -- is then dropped from the child's actual environment entirely, never coerced to the
 * literal string `"undefined"`. The cast at this function's own return is to its pre-existing, widely
 * depended-on return type: every real caller already reads `commandEnv['FORGE_RUN_ID']` as a plain,
 * possibly-absent string and never relies on the key's own presence, so widening the type instead would
 * ripple into `GateCommandContext`/`ExecuteStepContext` and every other caller across both packages, far
 * past this one function's own surface. */
export function commandEnvFor(
  binDir: string,
  parentEnv: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
  runId?: string,
): Readonly<Record<string, string>> {
  const key =
    platform === 'win32'
      ? (Object.keys(parentEnv).find((name) => name.toLowerCase() === 'path') ?? 'Path')
      : 'PATH';
  const existing = parentEnv[key];
  const delimiter = platform === 'win32' ? ';' : ':';
  // An empty or missing parent PATH would leave `sh` unable to find `git` or `node`: fall back to the usual
  // system directories on POSIX rather than to the launcher alone (Windows resolves system directories itself).
  const pathEnv =
    existing === undefined || existing === ''
      ? { [key]: platform === 'win32' ? binDir : `${binDir}${delimiter}${DEFAULT_POSIX_PATH}` }
      : { [key]: `${binDir}${delimiter}${existing}` };
  // `FORGE_RUN_ID` is ALWAYS its own explicit key below -- `runId` itself when given, `undefined` (an
  // own property, not a missing key) when not. See this function's own doc comment above: a plain
  // omission (or a `delete`) does not actually strip an already-ambient value from the child once
  // `execa`'s own `extendEnv: true` merges this object over `process.env`; an explicit `undefined` does
  // (confirmed with a real execa 9.6.1 subprocess, not assumed). The cast is to this function's own
  // pre-existing return type -- see the doc comment above for why widening it instead would ripple far
  // past this function's own surface.
  return { ...pathEnv, [FORGE_RUN_ID]: runId } as Readonly<Record<string, string>>;
}

const DEFAULT_POSIX_PATH = '/usr/local/bin:/usr/bin:/bin';

/** Directories whose removal a `SIGTERM` must do itself (`forge pause` exits without unwinding). */
const liveDirs = new Set<string>();

/** Synchronously removes every shim directory still alive. For the `SIGTERM` handler only. */
export function removeLiveLauncherShims(): void {
  for (const dir of liveDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort: the process is exiting, and the directory holds nothing but a tiny script.
    }
  }
  liveDirs.clear();
}

/** Creates the shim directory and its launcher.
 *
 * `runId`, when given, is stamped into `commandEnv` as the FORGE run marker (`commandEnvFor`); omitted
 * by a caller with no run of its own (`bin.ts`'s ad-hoc gate shim).
 *
 * @throws {ForgeError} `RUN-086` when the directory or script cannot be created (disk full, unwritable temp
 * directory, a Windows path that cannot be quoted); nothing is left behind. Callers warn and carry on: only
 * command steps that call `forge` are affected. */
export async function createLauncherShim(
  spec: LauncherSpec,
  platform: NodeJS.Platform = process.platform,
  newDirPath: () => string = () => createSystemTempPath('forge-launcher'),
  runId?: string,
): Promise<LauncherShim> {
  let binDir: string | undefined;
  try {
    // Not recursive, and named by a random UUID: an existing path (a squatter's) fails with EEXIST rather
    // than being adopted. `0700`: no other user can list it or drop a `forge` beside ours.
    const target = newDirPath();
    await mkdir(target, { mode: 0o700 });
    binDir = target;
    // Registered before anything else awaits, so a signal that lands mid-creation still removes it.
    liveDirs.add(binDir);
    const file = path.join(binDir, platform === 'win32' ? 'forge.cmd' : 'forge');
    await writeFile(file, launcherScript(spec, platform), { mode: 0o755 });
    await chmod(file, 0o755);
  } catch (cause) {
    if (binDir !== undefined) {
      liveDirs.delete(binDir);
      await rm(binDir, { recursive: true, force: true }).catch(() => undefined);
    }
    throw new ForgeError('RUN-086', { reason: renderCause(cause) ?? 'unknown failure' }, { cause });
  }
  const dir = binDir;
  return {
    binDir: dir,
    commandEnv: commandEnvFor(dir, spec.env, platform, runId),
    cleanup: async () => {
      liveDirs.delete(dir);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** `createLauncherShim` for a run: a failure becomes a warning (`warn`) and `undefined`, never a refusal.
 * `runId`, when given, is threaded straight through to `createLauncherShim` (and so to `commandEnvFor`). */
export async function createLauncherShimOrWarn(
  spec: LauncherSpec | undefined,
  warn: ((message: string) => void) | undefined,
  runId?: string,
): Promise<LauncherShim | undefined> {
  if (spec === undefined) return undefined;
  try {
    return await createLauncherShim(spec, undefined, undefined, runId);
  } catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    warn?.(`forge: warning: ${error.message} ${error.remedy}`);
    return undefined;
  }
}
