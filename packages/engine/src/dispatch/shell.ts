/**
 * `runShellCommand` — the one place this module actually spawns a real subprocess, shared by `command`-
 * kind steps, `gate`-kind steps' own `CheckRunner` (`@forge/engine/gates`, P14), and a `merge`-kind step's
 * own pre/post-check commands (`MergePolicy.preChecks`/`postChecks`, a single command string each). One
 * shared implementation, not three, for the same reason `@forge/engine/plan`'s own `globsOverlap` is
 * shared by `computeReadySet`/`Scheduler` rather than reimplemented per caller.
 *
 * @see PLAN-M5.md P15
 */
import { execa } from 'execa';

export interface ShellCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Present (and `true`) only when the caller passed `ShellLimits.timeoutMs` and the command was killed for
   * outliving it. Absent otherwise, so a caller that never asks for limits sees the shape it always did. */
  readonly timedOut?: true;
  /** Present (and `true`) only when the caller passed `ShellLimits.maxOutputBytes` and the command wrote more
   * than that on stdout or stderr; the command is stopped and the retained output is truncated to the cap. */
  readonly outputLimitExceeded?: true;
}

/** Caps for a command whose author the caller does not control (a project's own configured test command). The
 * default call has none: gate checks and `command` steps are the engine's own strings and keep today's
 * behaviour. `timeoutMs` and `maxOutputBytes` are both required to be positive integers by the caller. */
export interface ShellLimits {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

/** `shell: true` — every real command this module ever runs (`10` §10.3's own gate checks, a `command`-
 * kind step's own `run`, a merge policy's own `preChecks`/`postChecks`) is authored as one shell-syntax
 * string with flags (`"forge spec validate --json"`), not a pre-split argv array; `execa`'s own shell mode
 * is what makes a single string like that runnable at all. `reject: false` — this function reports an
 * exit code as data for its own caller to interpret (a `command` step's own outcome, a gate's own `failOn`
 * evaluation, a merge check's own pass/fail), the identical "never throw on a nonzero exit, that is not
 * this layer's failure" stance `@forge/engine/gates`' own `CheckRunner` contract already establishes —
 * `execa`'s own default (reject on nonzero exit) would turn every merely-failing command into a thrown
 * exception this module would immediately have to catch and unwrap right back into the same data shape.
 *
 * A command that cannot even be spawned at all (the executable itself missing, a shell syntax error) still
 * resolves, not rejects, under `reject: false` — `execa`'s own documented behaviour represents that case as
 * exit code `1` (or the shell's own non-zero code) with the real error text on `stderr`, not as a distinct
 * outcome shape — so no separate try/catch is needed here for that case either; it already arrives through
 * the same `{ stdout, stderr, exitCode }` shape every other outcome does. */
export async function runShellCommand(
  command: string,
  cwd: string,
  env?: Readonly<Record<string, string>>,
  limits?: ShellLimits,
): Promise<ShellCommandResult> {
  if (limits !== undefined) return runLimitedShellCommand(command, cwd, env, limits);
  // `exactOptionalPropertyTypes` treats an explicit `env: undefined` differently from omitting the key
  // entirely — execa's own `Options.env` has no `| undefined` in its own declared type, so this project's
  // own stricter setting rejects passing the key at all when this function's own caller didn't supply one,
  // not just a bare `undefined` value for it.
  const result =
    env === undefined
      ? await execa(command, { cwd, shell: true, reject: false })
      : await execa(command, { cwd, shell: true, reject: false, env });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 1 };
}

/** Kills the whole process group `pid` leads (POSIX), so a grandchild the shell started cannot keep the output
 * pipes open after the command was killed: with `execa`'s own `timeout`, `sleep 30 & sleep 30` under a 400 ms
 * limit still took 30 s to return, because `execa` waits for the streams to close, not only for the shell to
 * exit. Falls back to the single process where a group kill is not available. */
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

/** After the group is killed, a process that left the group (`setsid`) can still hold the output pipes; `execa` waits
 * for them to close. This long after the kill, the streams are destroyed and the result is returned anyway. */
const PIPE_GRACE_MS = 1_000;

async function runLimitedShellCommand(
  command: string,
  cwd: string,
  env: Readonly<Record<string, string>> | undefined,
  limits: ShellLimits,
): Promise<ShellCommandResult> {
  const base = {
    cwd,
    shell: true,
    reject: false,
    // A group of its own, so `killGroup` can end everything the command started. The command therefore no
    // longer receives the terminal's Ctrl-C; the signal handlers below end it when this process is signalled.
    detached: process.platform !== 'win32',
    // Nothing is ever typed at a project's test command: a command that reads stdin (`cat`) would otherwise wait
    // for the timeout, and the check would report a hang for a command that only wanted input.
    stdin: 'ignore',
    ...(limits.maxOutputBytes === undefined ? {} : { maxBuffer: limits.maxOutputBytes }),
  } as const;
  const subprocess =
    env === undefined ? execa(command, { ...base }) : execa(command, { ...base, env });

  // An object, not `let`s: callbacks assign it, which the compiler cannot see from the reads below.
  const state = { timedOut: false, flooded: false };
  const stop = (): void => {
    killGroup(subprocess);
    setTimeout(() => {
      subprocess.stdout.destroy();
      subprocess.stderr.destroy();
    }, PIPE_GRACE_MS).unref();
  };
  const timer =
    limits.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          state.timedOut = true;
          stop();
        }, limits.timeoutMs);
  // `maxBuffer` alone stops the shell only once `await` returns, which a background child holding the pipe delays
  // until it exits; counting here ends the whole group as soon as the cap is passed.
  if (limits.maxOutputBytes !== undefined) {
    const cap = limits.maxOutputBytes;
    // Per stream, as `maxOutputBytes` says: a command may write up to the cap on stdout AND on stderr.
    for (const stream of [subprocess.stdout, subprocess.stderr]) {
      const seen = { bytes: 0 };
      stream.on('data', (chunk: Buffer | string) => {
        seen.bytes += chunk.length;
        if (seen.bytes > cap && !state.flooded) {
          state.flooded = true;
          stop();
        }
      });
    }
  }
  // The command has finished when its shell has: whatever it left running (a server it started for the smoke test, a
  // daemon holding the output pipe) is ended then, and the timeout no longer applies. Otherwise a command that
  // exited 0 but left a child holding the pipe would be reported as timed out and failed, or wait out the timeout.
  subprocess.once('exit', () => {
    if (timer !== undefined) clearTimeout(timer);
    stop();
  });
  // `exit` is not emitted when this process dies of a signal, so a termination signal ends the group too. Then our
  // listener is removed, and the signal is re-raised only when nothing else is listening for it, so the process
  // terminates exactly as it would have (its default action) and another listener still runs exactly once.
  const onExit = (): void => {
    killGroup(subprocess);
  };
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const removeSignalHandlers = (): void => {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const handler = (): void => {
      killGroup(subprocess);
      removeSignalHandlers();
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  process.once('exit', onExit);
  try {
    const result = await subprocess;
    if (result.isMaxBuffer) state.flooded = true;
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 1,
      ...(state.timedOut ? { timedOut: true as const } : {}),
      ...(state.flooded ? { outputLimitExceeded: true as const } : {}),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    process.off('exit', onExit);
    removeSignalHandlers();
  }
}
