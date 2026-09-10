/**
 * `runSdkQuery` — wraps the real `query()` call. Real, confirmed `@anthropic-ai/claude-agent-sdk`
 * API used directly (not guessed): `query({prompt, options}): Query` where
 * `Query extends AsyncGenerator<SDKMessage, void>` (so a plain `for await` works directly, mirroring
 * `spawn.ts`'s own execa-subprocess iteration, P2), and `Query.interrupt()` is the SDK's own real
 * abort mechanism -- distinct from the CLI transport's own process-kill (`spawnClaudeCli.stop()`),
 * confirmed against the real `.d.ts`.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see SPEC-QUESTIONS.md Q115
 * @see PLAN-M7.md P3
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query } from '@anthropic-ai/claude-agent-sdk';
import type { AdapterEvent } from '@forge/adapter-kit';

import { mapSdkMessage } from './map-message.ts';

export interface RunSdkQueryOptions {
  readonly abortSignal?: AbortSignal | undefined;
  /** Injectable, defaulting to the real SDK `query` -- this codebase's own established
   * "inject the real dependency, default to the real implementation" convention
   * (`ClaudeCliRunner`, `process.ts`, P1), added specifically so a test can deterministically prove
   * this function's own `try`/`catch` around the query's real async iterator actually works (a fake
   * iterator that rejects mid-stream), rather than needing a live call to exercise that one path. */
  readonly queryFn?: typeof query | undefined;
}

export interface RunningSdkQuery {
  readonly events: AsyncIterable<AdapterEvent>;
  interrupt(): Promise<void>;
}

/** A plain object satisfying `AsyncIterable<AdapterEvent>` for exactly one event -- mirrors
 * `spawn.ts`'s own identically-named, identically-motivated helper (P2): an `async function*` with a
 * single, unconditional `yield` and no real asynchronous work has no `await` expression of its own,
 * which this project's own `@typescript-eslint/require-await` rule flags. Not shared between the two
 * files: each is small enough that a shared module would cost more than it saves, and the two
 * transports are deliberately kept free to diverge in every place that is not the one, real,
 * documented shared dependency (`mapToolGrantToAllowedTools`, `SPEC-QUESTIONS.md` Q115). */
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

export function runSdkQuery(
  prompt: string,
  options: Options,
  runOptions: RunSdkQueryOptions = {},
): RunningSdkQuery {
  // Mirrors `spawn.ts`'s own short-circuit exactly (P2's own critic round found the analogous
  // already-aborted-signal case hangs the real underlying transport rather than failing fast --
  // applied here pre-emptively, on the same reasoning, rather than waiting to rediscover the
  // identical class of bug against this transport too).
  if (runOptions.abortSignal?.aborted === true) {
    return {
      events: singleEventAsyncIterable({ type: 'session.ended', reason: 'aborted' }),
      interrupt: () => Promise.resolve(),
    };
  }

  const abortController = new AbortController();
  let stopped = false;
  runOptions.abortSignal?.addEventListener('abort', () => {
    stopped = true;
    abortController.abort();
  });

  const activeQuery: Query = (runOptions.queryFn ?? query)({
    prompt,
    options: { ...options, abortController },
  });

  let sawError = false;
  // The real, live-installed SDK's own `SDKResultError.subtype` (confirmed against `sdk.d.ts`) names
  // `'error_max_turns'` as its own, dedicated reason a turn stopped early -- distinct from
  // `'error_during_execution'`/the other genuine-failure subtypes `map-message.ts`'s `mapResultError`
  // otherwise collapses uniformly into `AdapterEvent{type:'error'}` (via `code: subtype`, unchanged).
  // A real `FORGE_LIVE=1` run (M7's own live-run checkpoint) found this transport never actually
  // reported `session.ended.reason: 'limit'` at all -- a genuine `limits.maxTurns` cutoff (which the
  // SDK's own native `Options.maxTurns`, `build-options.ts`, does really enforce) was always
  // misreported as a plain `'error'`, indistinguishable from a real execution failure. Tracked here,
  // not in `map-message.ts`: `code` already carries the raw subtype string unmodified, so reading it
  // back here needs no change to the shared, already-tested `AdapterEvent` shape at all.
  let sawMaxTurnsLimit = false;
  /**
   * A fresh critic round found the original draft had no `try`/`catch` around this loop at all --
   * unlike `spawn.ts`'s own execa-subprocess iteration (P2), which can only ever *resolve* (`execa`'s
   * own `reject: false` option, plus `realClaudeCliRunner`'s own "never throws" contract), the real
   * SDK exports a real `AbortError` class and its own bundled runtime can plausibly reject the
   * `activeQuery` iterator itself (on abort, or an internal failure before a `result` message ever
   * arrives) rather than cleanly ending it. An uncaught rejection here would propagate straight out of
   * this whole generator, and `session.ended` -- the one event every consumer is entitled to rely on
   * always arriving eventually, matching `spawnClaudeCli`'s own identical guarantee -- would never be
   * emitted. Caught here and folded into the same reason computation the clean-completion path already
   * uses, rather than left to escape uncaught.
   */
  async function* events(): AsyncGenerator<AdapterEvent> {
    try {
      for await (const message of activeQuery) {
        for (const event of mapSdkMessage(message)) {
          if (event.type === 'error') {
            sawError = true;
            if (event.code === 'error_max_turns') sawMaxTurnsLimit = true;
          }
          yield event;
        }
      }
    } catch {
      sawError = true;
    }
    const reason = stopped
      ? 'aborted'
      : sawMaxTurnsLimit
        ? 'limit'
        : sawError
          ? 'error'
          : 'complete';
    yield { type: 'session.ended', reason };
  }

  return {
    events: { [Symbol.asyncIterator]: events },
    interrupt: async () => {
      stopped = true;
      await activeQuery.interrupt();
    },
  };
}
