/**
 * `spawnClaudeCli` — the actual `execa`-backed process spawn, feeding each stdout line through
 * `parseCliEventLine`. Real, confirmed `execa@9.6.1` API used directly (not guessed): a subprocess
 * result object is itself directly async-iterable, "iterat[ing] over each output line" (execa's own
 * type declarations, confirmed by reading `node_modules/.pnpm/execa@9.6.1/.../subprocess.d.ts`), and
 * `cancelSignal` is the real option name for `AbortSignal`-driven termination (sends `SIGTERM`).
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q114
 * @see PLAN-M7.md P2
 */
import { execa } from 'execa';
import type { AdapterEvent } from '@forge/adapter-kit';

import { parseCliEventLine } from './parse-event.ts';

/** A plain object satisfying `AsyncIterable<AdapterEvent>` for exactly one event, with no `execa`/
 * process involved at all. Written as an explicit `next()` implementation rather than an
 * `async function*` generator: a generator with a single, unconditional `yield` and no real
 * asynchronous work has no `await` expression of its own, which this project's own
 * `@typescript-eslint/require-await` rule flags -- this shape satisfies the real `AsyncIterable`
 * contract (each `next()` call genuinely returns a `Promise`) without a manufactured `await`. */
function singleEventAsyncIterable(event: AdapterEvent): AsyncIterable<AdapterEvent> {
  let done = false;
  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<AdapterEvent>> {
          if (done) return Promise.resolve({ value: undefined, done: true });
          done = true;
          return Promise.resolve({ value: event, done: false });
        },
      };
    },
  };
}

export interface SpawnClaudeCliOptions {
  readonly cwd: string;
  /** `07` §7.2: "Never pass secrets in `prompt`. Secrets reach the session only via `env` and only
   * when the step's grant includes them." Enforced structurally here, not just by convention: the
   * spawned child sees *only* this exact object -- never this process's own ambient `process.env`
   * (`execa`'s own default `extendEnv: true` would otherwise merge the two, silently leaking whatever
   * this adapter process itself happens to have, including any of *this* process's own real secrets).
   * C13 (no secret leak) is one of `07` §7.6's own five safety-critical conformance tests; this is the
   * one place that guarantee is actually enforced for the CLI transport. The caller is responsible
   * for including `PATH` in this object when the `claude` binary needs to be resolved via `PATH`
   * lookup -- this function never reads `process.env` itself (this project's own R10 lint rule bans
   * ambient `process.env` access in production code; a caller with real config-layer access, P4, is
   * where a real `PATH` value comes from). */
  readonly env: Readonly<Record<string, string>>;
  readonly abortSignal?: AbortSignal | undefined;
}

export interface SpawnedClaudeCli {
  /** Ends with a real, synthesised `session.ended` event once the child process actually exits --
   * `-p` mode never emits an explicit "session ended" JSON line of its own (it simply exits after the
   * `result` line), so this is the one line-consumption loop in this piece with visibility into both
   * "no more lines are coming" and the real exit code needed to pick the right `reason`. */
  readonly events: AsyncIterable<AdapterEvent>;
  stop(): void;
  readonly exitCode: Promise<number>;
}

/**
 * `limits.maxTurns` is deliberately never enforced here. A client-side approximation (count
 * `tool.call`/`text` events and abort once some threshold is crossed) was considered and rejected: the
 * real, observed `-p` output has no line that unambiguously marks "a new turn started" independent of
 * this milestone's own guess at what a turn boundary looks like (a real captured write-file example
 * needed two full assistant/tool_use/tool_result round trips inside what the CLI's own final `result`
 * line reported as `num_turns: 2` — but nothing in the *stream itself*, short of counting `result`
 * lines a `-p` invocation never emits more than one of, cleanly signals that boundary as it happens).
 * Shipping a heuristic that might silently stop a legitimate session early (or fail to stop a runaway
 * one) is worse than an honest, documented gap. `07` §7.3's own "unknown/older versions degrade
 * capabilities rather than crashing" gives the precedent for treating this as a real capability the CLI
 * transport specifically lacks, not a bug to paper over with a guess.
 */
export function spawnClaudeCli(
  args: readonly string[],
  options: SpawnClaudeCliOptions,
): SpawnedClaudeCli {
  // A fresh critic round's own regression test found that passing an *already-aborted* signal
  // straight through to execa's own `cancelSignal` hangs indefinitely (confirmed directly: the real
  // subprocess's own async iterator never completes) rather than failing fast -- a real, genuinely
  // worse-than-useless behaviour for a caller whose signal happens to already be aborted by the time
  // this function is called (a realistic case: a shared controller aborted moments earlier for an
  // unrelated reason). Short-circuited here, before `execa` is ever invoked at all, rather than
  // passed through and hoped to behave reasonably.
  if (options.abortSignal?.aborted === true) {
    return {
      events: singleEventAsyncIterable({ type: 'session.ended', reason: 'aborted' }),
      stop: () => {
        // Nothing to stop -- no process was ever spawned.
      },
      exitCode: Promise.resolve(-1),
    };
  }

  const subprocess = execa('claude', [...args], {
    cwd: options.cwd,
    env: options.env,
    extendEnv: false,
    reject: false,
    lines: true,
    ...(options.abortSignal === undefined ? {} : { cancelSignal: options.abortSignal }),
  });

  // A fresh critic round found the original draft only set this from the exposed `stop()` closure
  // below, missing the equally real, documented `options.abortSignal` path: a caller that cancels
  // purely via the signal it already passed in (never separately calling `.stop()`) still genuinely
  // killed this process, and deserves the identical `'aborted'` reason `stop()` itself produces --
  // not `'error'`, which misreports a caller-intended cancellation as a failure. Safe to listen for
  // the event here (rather than needing another `.aborted` check) since the guard above already
  // handled the *already*-aborted case before this line is ever reached.
  let stopped = false;
  options.abortSignal?.addEventListener('abort', () => {
    stopped = true;
  });
  const exitCode = subprocess.then((result) => result.exitCode ?? -1);

  /** `stopped` (this function's own `stop()` was called, or `options.abortSignal` fired) takes
   * priority over the real exit code for picking `reason`: a process killed via `SIGTERM` after
   * `stop()` typically also reports a non-zero exit, but `'aborted'` is the more accurate, caller-
   * intended reason than `'error'` when this side explicitly requested the stop, matching `07` §7.2's
   * own four-way `session.ended.reason` split (`'complete' | 'aborted' | 'error' | 'limit'` --
   * `'limit'` is never produced here, since this transport enforces no client-side limit of its own,
   * per this function's own top-of-file doc comment on `maxTurns`). */
  async function* events(): AsyncGenerator<AdapterEvent> {
    for await (const line of subprocess) {
      const text = typeof line === 'string' ? line : String(line);
      const event = parseCliEventLine(text);
      if (event !== undefined) yield event;
    }
    const code = await exitCode;
    const reason = stopped ? 'aborted' : code === 0 ? 'complete' : 'error';
    yield { type: 'session.ended', reason };
  }

  return {
    events: { [Symbol.asyncIterator]: events },
    stop: () => {
      stopped = true;
      subprocess.kill('SIGTERM');
    },
    exitCode,
  };
}
