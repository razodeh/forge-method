/**
 * `spawnGenericBinary` — the real `execa`-backed process spawn for `07` §7.5's `binary`, yielding raw
 * stdout lines (never parsed here — that is `events-map.ts`'s job, since the mapping is config-driven,
 * not fixed like `@forge/adapter-claude-code`'s own `spawn.ts`). Mirrors that package's own real,
 * confirmed `execa@9.6.1` usage precedent (`cancelSignal`, `lines: true`, `extendEnv: false`, the
 * already-aborted-signal short-circuit its own gauntlet critic found necessary) — this package has no
 * boundary-graph edge to `@forge/adapter-claude-code` (a sibling adapter, not a shared dependency), so
 * this is a small, deliberate duplication of a proven shape, the same "duplicate rather than force a
 * disallowed cross-package edge" precedent that package's own `session-handle.ts` already documents for
 * the identical reason.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import { execa } from 'execa';

export interface SpawnGenericBinaryOptions {
  readonly binary: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Never merged with this process's own ambient `process.env` (`extendEnv: false`, below) -- `07`
   * §7.6 C13's own no-secret-leak guarantee, enforced structurally rather than by convention. */
  readonly env: Readonly<Record<string, string>>;
  readonly input: string | undefined;
  readonly abortSignal: AbortSignal;
}

export interface SpawnedGenericBinary {
  readonly lines: AsyncIterable<string>;
  readonly exitCode: Promise<number>;
  /** `true` whenever this side (via `stop()` or the caller's own `abortSignal`) requested the end —
   * takes priority over the real exit code for the caller's own `07` §7.2 `session.ended.reason`
   * decision, the identical split `@forge/adapter-claude-code`'s own `spawn.ts` already establishes.
   * Deliberately not itself deciding `'complete'` vs `'error'` (unlike that sibling package): whether a
   * given exit code counts as success is `07` §7.5's own configurable `result.successExitCodes`, a
   * config-driven fact this process-plumbing-only module has no business hardcoding. */
  readonly wasAborted: Promise<boolean>;
  stop(): void;
}

/** `forceKillAfterDelay`: `07` §7.6 C5's own "no orphan child processes remain" -- a real external
 * binary that ignores `SIGTERM` (P8's own `scripted-binary.ts` hang-response fixture deliberately does,
 * proving this path) would otherwise linger forever once `cancelSignal` alone has fired; `execa`'s own
 * documented escalation sends a real `SIGKILL` after this many milliseconds if the process has not
 * exited. Kept short (this adapter's own conformance runs are local, fast fixtures, never a real
 * multi-second external tool) rather than defaulting to execa's own longer built-in delay. */
const FORCE_KILL_AFTER_MS = 2_000;

/** A plain object satisfying `AsyncIterable<string>` for zero lines, with no process involved at all —
 * the already-aborted short-circuit below needs an empty stream, not a generator with no real `await`
 * (which this project's own `@typescript-eslint/require-await` rule would flag). */
function emptyLines(): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve({ value: undefined, done: true }) };
    },
  };
}

export function spawnGenericBinary(options: SpawnGenericBinaryOptions): SpawnedGenericBinary {
  // A gauntlet critic against `@forge/adapter-claude-code`'s own identically-shaped `spawn.ts` found
  // that passing an *already-aborted* signal straight through to execa's own `cancelSignal` hangs
  // indefinitely rather than failing fast — short-circuited here the same way, before `execa` is ever
  // invoked, rather than passed through and hoped to behave reasonably.
  if (options.abortSignal.aborted) {
    return {
      lines: emptyLines(),
      exitCode: Promise.resolve(-1),
      wasAborted: Promise.resolve(true),
      stop: () => {
        // Nothing to stop -- no process was ever spawned.
      },
    };
  }

  const subprocess = execa(options.binary, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    extendEnv: false,
    reject: false,
    lines: true,
    cancelSignal: options.abortSignal,
    forceKillAfterDelay: FORCE_KILL_AFTER_MS,
    ...(options.input === undefined ? {} : { input: options.input }),
  });

  let stopped = false;
  options.abortSignal.addEventListener('abort', () => {
    stopped = true;
  });

  const exitCode = subprocess.then((result) => result.exitCode ?? -1);
  const wasAborted = exitCode.then(() => stopped);

  async function* lines(): AsyncGenerator<string> {
    for await (const line of subprocess) {
      yield typeof line === 'string' ? line : String(line);
    }
  }

  return {
    lines: { [Symbol.asyncIterator]: lines },
    exitCode,
    wasAborted,
    stop: () => {
      stopped = true;
      subprocess.kill('SIGTERM');
    },
  };
}
