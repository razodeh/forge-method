/**
 * `applyNormalizeRulesToTextBounded` — runs {@link applyNormalizeRulesToText} inside a worker thread
 * this module can forcibly terminate once a wall-clock budget elapses (`specs/22` M17 P14, `13`
 * F-TEST-9's normalisation bullet: "run... under a single stated wall-clock budget..., exceeding
 * which makes the case `error`, a typed refusal, never a hang").
 *
 * **Why a worker thread, not a `Promise.race` against `setTimeout`.** `replace-lint.ts`'s own file
 * header already discloses the reason: a synchronous regex match that backtracks catastrophically
 * never yields the event loop back, so a `setTimeout` racing against it never fires either — the
 * only way to bound it is from OUTSIDE the thread running it, by force-terminating that thread.
 * Confirmed directly before this module reached its current form: a worker thread stuck in a true
 * `while (true)` busy-loop (no I/O, no awaited call, nothing to interrupt it) is reliably killed by
 * `Worker.terminate()` from its parent within the stated budget, every time (this module's own test
 * file proves it against a real catastrophic `replace` pattern, not merely a synthetic busy-loop).
 *
 * **Why `Atomics.wait` plus shared memory, never `await`ing a `message` event or reading a
 * `MessagePort`.** `normalize.ts`'s own `applyNormalizeRulesToText` is, and stays, a plain
 * synchronous function with a stable, widely-relied-on signature (`compare.ts`'s `decideCaseVerdict`
 * and every test that calls it directly) — making the whole call chain `async` to accommodate a
 * worker would change that public contract for every existing caller and test. `Atomics.wait` on a
 * `SharedArrayBuffer`-backed `Int32Array` blocks THIS thread, synchronously, without the event loop,
 * until the worker signals completion (`Atomics.notify`) or the budget elapses, so this function can
 * stay synchronous while the actual rule application runs on a genuinely separate, killable thread.
 *
 * An EARLIER version of this module paired that wait with `postMessage`/`receiveMessageOnPort`, and
 * was proven wrong directly (not merely suspected): the posted result was NOT reliably visible to
 * `receiveMessageOnPort` the instant `Atomics.wait` returned, because delivering a `postMessage`
 * across threads goes through Node's own event-loop-driven IPC, which a thread blocked inside a
 * synchronous `Atomics.wait` never runs — so the two can observably race, with the signal arriving
 * before the message. Plain `SharedArrayBuffer` MEMORY has no such dependency (one thread's write is
 * visible to another the instant it synchronises, with nothing else needing to run), so the worker
 * writes its JSON-encoded result directly into {@link NormalizeWorkerData.resultBuffer} and only
 * THEN signals `sync` — ordering that guarantees the bytes are already there the moment this
 * function's own `Atomics.wait` call returns.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 * @see process/SPEC-QUESTIONS.md Q298 Decision 1 (the house style this module follows: a worker
 *   thread with a hard terminate is the one generally-sound mitigation `replace-lint.ts` already
 *   named for this exact gap, not a new, cleverer one)
 */
import { Worker } from 'node:worker_threads';

import type { NormalizeRule } from './declaration-types.ts';
import type { NormalizeTargetScope, NormalizeTextOutcome } from './normalize.ts';
import type { NormalizeWorkerData, NormalizeWorkerMessage } from './normalize-worker.ts';

/** `13` F-TEST-9's own stated default — not configurable per declaration (the spec text calls it "a
 * single stated wall-clock budget", a fixed, documented number, never a per-case override a
 * declaration could widen to defeat the bound it exists to enforce). Exported ONLY so this module's
 * own test file can assert the production call site really does use it, never a smaller test-only
 * value standing in for it by accident. */
export const DEFAULT_NORMALIZE_BUDGET_MS = 5000;

const WORKER_URL = new URL('./normalize-worker.ts', import.meta.url);

/** The worker's own execution flags — `--experimental-strip-types` so a `.ts` worker file loads with
 * no build step, matching this repository's own established pattern for running a `.ts` file as a
 * real `node` subprocess (`package.json`'s `bench`/`verify-success-criteria` scripts) — confirmed
 * directly (not assumed) that a freshly started worker thread accepts this flag via `execArgv`
 * regardless of which flags started the CALLING process, before this module reached its current
 * form. */
const WORKER_EXEC_ARGV = ['--experimental-strip-types', '--no-warnings'];

/** How many bytes of shared memory are reserved for the worker's own JSON-encoded result, beyond the
 * 8-byte header (`normalize-worker.ts`'s own doc comment has the exact layout) — generous relative to
 * `text`'s own length so an ordinary case (whose rules only ever remove or rearrange content, never
 * invent new bytes from nothing) has ample room, while staying a bounded, predictable allocation
 * rather than one sized to an adversarial worst case no normalize rule set in practice approaches. A
 * `replace` rule whose own replacement text is far longer than its match, repeated enough times, COULD
 * still exceed this — disclosed, not chased further: {@link applyNormalizeRulesToTextBounded} reports
 * that case as its own typed, honest refusal (`timedOut: false, ok: false, kind: 'rule-failed'`, never
 * a crash or a silently truncated result), never a crash. */
function payloadCapacityBytesFor(text: string): number {
  return Math.max(1_000_000, text.length * 8 + 65_536);
}

/** One normalize-budget outcome: the real {@link NormalizeTextOutcome} `applyNormalizeRulesToText`
 * itself would have returned, or a timeout this module decided on the worker's behalf once the
 * budget elapsed with no signal at all. */
export type NormalizeBudgetOutcome =
  ({ readonly timedOut: false } & NormalizeTextOutcome) | { readonly timedOut: true };

/**
 * Runs `applyNormalizeRulesToText(text, rules, scope)` in a worker thread, returning its real result
 * when the worker signals completion within `budgetMs`, or `{timedOut: true}` once `budgetMs` elapses
 * with no signal — in which case the worker is forcibly terminated, never left running.
 *
 * Synchronous from its caller's own point of view (see this module's own file header for why): it
 * blocks the calling thread for at most `budgetMs`, plus the small, fixed cost of starting a worker
 * thread (typically single-digit milliseconds), never longer.
 */
export function applyNormalizeRulesToTextBounded(
  text: string,
  rules: readonly NormalizeRule[],
  scope: NormalizeTargetScope,
  budgetMs: number = DEFAULT_NORMALIZE_BUDGET_MS,
): NormalizeBudgetOutcome {
  const syncBuffer = new SharedArrayBuffer(4);
  const sync = new Int32Array(syncBuffer);
  const resultBuffer = new SharedArrayBuffer(8 + payloadCapacityBytesFor(text));
  const workerData: NormalizeWorkerData = { text, rules, scope, sync, resultBuffer };
  const worker = new Worker(WORKER_URL, { execArgv: WORKER_EXEC_ARGV, workerData });
  try {
    const waitResult = Atomics.wait(sync, 0, 0, budgetMs);
    if (waitResult === 'timed-out') {
      return { timedOut: true };
    }
    const header = new Int32Array(resultBuffer, 0, 2);
    const payloadLength = header[1];
    if (payloadLength === undefined || payloadLength < 0) {
      // `normalize-worker.ts` itself decided the result would not fit `resultBuffer` -- reported as
      // an ordinary, typed rule-application failure, never a crash (see `payloadCapacityBytesFor`'s
      // own doc comment for exactly when this can happen).
      return {
        timedOut: false,
        ok: false,
        kind: 'rule-failed',
        failure: {
          rule: 'replace',
          detail:
            'the normalised result is too large to report (the rule set grew the text far beyond ' +
            'its own input, which this harness refuses rather than risk an unbounded allocation)',
        },
      };
    }
    const payloadBytes = new Uint8Array(resultBuffer, 8, payloadLength);
    const message = JSON.parse(new TextDecoder().decode(payloadBytes)) as NormalizeWorkerMessage;
    if (!message.ok) {
      // See `normalize-worker.ts`'s own doc comment on `NormalizeWorkerMessage`: only a genuine bug
      // in that file reaches this branch, never an ordinary rule-application failure.
      throw new Error(`unreachable: normalize-worker.ts itself threw: ${message.message}`);
    }
    return { timedOut: false, ...message.outcome };
  } finally {
    void worker.terminate();
  }
}
