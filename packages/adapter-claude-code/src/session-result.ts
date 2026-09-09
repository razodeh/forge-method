/**
 * `accumulateSessionResult` — wraps a transport's own raw `AsyncIterable<AdapterEvent>` (either
 * `spawnClaudeCli`'s or `runSdkQuery`'s) into the real `AsyncGenerator<AdapterEvent, SessionResult>`
 * shape `makeSessionHandle` needs: every event is re-yielded unchanged (so a real caller consuming
 * `SessionHandle.events` sees the identical stream either transport produces), while this function
 * accumulates enough to build a real final `SessionResult` once the stream ends.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
 */
import { parseControlTokens } from '@forge/adapter-kit/control-tokens';
import type { AdapterEvent, SessionResult } from '@forge/adapter-kit';

import { computeChangedFiles } from './changed-files.ts';

export interface AccumulateSessionResultOptions {
  readonly sessionId: string;
  readonly cwd: string;
  /** Injected, never read ambiently (`21` §21.1's own determinism discipline, applied here the same
   * way `ExecuteStepContext.now` already does elsewhere in this build) -- a plain millisecond clock,
   * not a shared `@forge/core` type, since this package has no boundary-graph edge to `@forge/core`
   * at all. */
  readonly now: () => number;
}

export async function* accumulateSessionResult(
  transportEvents: AsyncIterable<AdapterEvent>,
  options: AccumulateSessionResultOptions,
): AsyncGenerator<AdapterEvent, SessionResult> {
  const startedAt = options.now();
  let finalText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | undefined;
  let toolCallCount = 0;
  let ok = true;
  let error: { readonly code: string; readonly message: string } | undefined;

  for await (const event of transportEvents) {
    yield event;
    switch (event.type) {
      case 'text':
        // Only non-partial (complete) text blocks are accumulated -- a `partial: true` chunk is a
        // strict prefix-in-progress of the same content a later non-partial block (or the final
        // consolidated one) already carries in full; double-counting both would duplicate text in
        // `finalText`.
        if (!event.partial) finalText += event.text;
        break;
      case 'tool.call':
        toolCallCount += 1;
        break;
      case 'usage':
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
        costUsd = event.costUsd;
        break;
      case 'error':
        ok = false;
        error = { code: event.code, message: event.message };
        break;
      // A fresh critic round found the original draft never inspected `session.ended.reason` at
      // all -- an aborted (or transport-internal-error) session that never happened to also emit an
      // explicit `'error'` event (a real path on both transports: `spawn.ts`'s own synthesized
      // `reason: 'error'` on a bare non-zero exit, and `run-query.ts`'s own caught-but-silent
      // `sawError` from an uncaught SDK iterator rejection, neither of which yields a matching
      // `'error'` `AdapterEvent`) reported `ok: true` -- indistinguishable from a real, clean
      // success. `'aborted'`/`'error'` both flip `ok` false here, matching the real precedent
      // `@forge/testkit`'s own `FakePlatformAdapter` already established for the identical case
      // (`startInjectedFailure`'s abort branch, and `runScriptPhases`'s `endedEarly` handling: a
      // resource *limit* stays `ok: true` -- the session did what it was told, within budget -- but
      // an abort does not). `'complete'`/`'limit'` are deliberately left as no-ops: `ok` already
      // defaults `true`, and neither ending contradicts that on its own.
      case 'session.ended':
        if (event.reason === 'aborted' || event.reason === 'error') ok = false;
        break;
      // Every other real `AdapterEvent` member carries nothing this function's own accumulation
      // needs: `session.started` (transport lifecycle only, not this function's job -- the caller's
      // own generator wrapper observes it for its own purposes), `thinking`/`tool.result`/
      // `file.changed`/`control`/`retry` (real events, faithfully re-yielded above like every other
      // event, just not folded into `SessionResult` itself). Listed explicitly, not left to a bare
      // `default`, so this project's own `@typescript-eslint/switch-exhaustiveness-check`
      // (`considerDefaultExhaustiveForUnions: false` is this repo's real, effective default --
      // confirmed directly against the installed rule's own source, not assumed) catches a *new*
      // `AdapterEvent` variant this function forgot to consider, rather than one silently falling
      // into a catch-all that was written for a different reason.
      case 'session.started':
      case 'thinking':
      case 'tool.result':
      case 'file.changed':
      case 'control':
      case 'retry':
        break;
    }
  }

  const changedFiles = await computeChangedFiles(options.cwd);
  const { tokens: controlTokens } = parseControlTokens(finalText);

  return {
    sessionId: options.sessionId,
    ok,
    finalText,
    usage: {
      inputTokens,
      outputTokens,
      // `SessionResult.usage` (`@forge/adapter-kit`, M4, already committed) has no field for a real
      // per-model token/cost breakdown or the SDK's own `modelUsage` -- carried nowhere by this
      // function; a future piece needing it would need to extend that already-committed type.
      ...(costUsd === undefined ? {} : { costUsd }),
      // Real, but empirically-grounded on only two live data points (`SPEC-QUESTIONS.md` Q116): every
      // real `tool.call` this session made implies one real conversational round trip beyond the
      // final response itself -- `toolCallCount + 1` matched the real, live-captured `num_turns` field
      // exactly for both a no-tool-use ("hello", num_turns: 1) and a one-tool-use (write-file,
      // num_turns: 2) real call. Neither transport's own event mapping currently threads the SDK/CLI's
      // own real `num_turns` field through any `AdapterEvent` at all (`AdapterEvent.usage` has no such
      // field, and extending it is a bigger, cross-package change outside this piece's own scope), so
      // this heuristic is the honest best this piece can do without one.
      turns: toolCallCount + 1,
    },
    durationMs: options.now() - startedAt,
    changedFiles: [...changedFiles],
    controlTokens,
    ...(error === undefined ? {} : { error }),
  };
}
