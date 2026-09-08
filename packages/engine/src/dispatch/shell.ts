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
): Promise<ShellCommandResult> {
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
