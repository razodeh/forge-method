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
 * **A worker crash is a typed refusal, never a process crash.** An EARLIER version of this module
 * attached no listener at all to the worker's own `'error'` event — a real gauntlet-round finding,
 * confirmed two independent ways: a worker that throws before reaching `normalize-worker.ts`'s own
 * `Atomics.store` leaves `sync` at `0` forever, so this module's own `Atomics.wait` blocks for the
 * ENTIRE budget before returning `'timed-out'` (misdiagnosing an instant crash as a slow case, not
 * merely reporting it late), and once that wait finally returns and this function's own call stack
 * unwinds, Node's own default "an unhandled `'error'` event crashes the process" behaviour then
 * crashes the CALLING process too, outside any test harness. `normalize-worker.ts`'s own
 * `process.on('uncaughtException', ...)` handler (registered there, not here — see that file's own
 * header for why only a handler running INSIDE the crashing thread, before the event loop is
 * involved at all, can signal this one promptly) sets `sync` to {@link SYNC_CRASHED} and this
 * function checks for exactly that value the instant its own wait returns, converting the crash into
 * `{status: 'crashed'}` — a realistic trigger, not only a hand-crafted one: this module's own worker
 * is a brand-new OS thread per `normalize` call, so an `EMFILE`/`ENOMEM`-class failure under load in
 * a large parity suite is an ordinary operating condition, not an adversarial one. `worker.on('error',
 * ...)` is ALSO attached here, purely so Node does not fall back to its own default crash behaviour
 * for a failure so early (an import/module-load error in `normalize-worker.ts` itself, say) that the
 * worker's own handler never got to register — confirmed directly that this listener cannot fire in
 * time to change THIS call's own return value (the event loop dependency above applies to it exactly
 * as it did to the `postMessage` approach already rejected), so the REAL signal is always `sync`'s own
 * value; this listener's only job is "do not let Node crash the process over this."
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 * @see process/SPEC-QUESTIONS.md Q298 Decision 1 (the house style this module follows: a worker
 *   thread with a hard terminate is the one generally-sound mitigation `replace-lint.ts` already
 *   named for this exact gap, not a new, cleverer one)
 */
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

import { ForgeError } from '@forge/core/errors';

import { getWorkerTsExecArgv } from '../../../../../scripts/lib/worker-ts-exec-argv.mjs';
import type { NormalizeRule } from './declaration-types.ts';
import type { NormalizeTargetScope, NormalizeTextOutcome } from './normalize.ts';
import {
  SYNC_CRASHED,
  type NormalizeWorkerData,
  type NormalizeWorkerMessage,
} from './normalize-worker-protocol.ts';

/** `13` F-TEST-9's own stated default — not configurable per declaration (the spec text calls it "a
 * single stated wall-clock budget", a fixed, documented number, never a per-case override a
 * declaration could widen to defeat the bound it exists to enforce). Exported ONLY so this module's
 * own test file can assert the production call site really does use it, never a smaller test-only
 * value standing in for it by accident. */
export const DEFAULT_NORMALIZE_BUDGET_MS = 5000;

/** The real worker SOURCE file, run with no build step in dev/test — never shipped: `package.json`'s
 * own `files` lists only `dist` and `bin/preflight.cjs`, so this `.ts` file does not exist at all in
 * a real npm install of this package. */
const SRC_WORKER_URL = new URL('./normalize-worker.ts', import.meta.url);

/** The real, PRECOMPILED, plain-JS worker entry `tsup.config.ts`'s own second `entry` produces as a
 * sibling of the published `dist/forge.mjs` — needs no runtime TypeScript understanding, and
 * therefore no flag, on any Node version. Exists ONLY in a built package (`pnpm build`, or the real
 * npm-published artifact); never in this repository's own unbundled source tree, where
 * `src/commands/parity/` has no `dist/` sibling at all — the same safe, non-throwing
 * `existsSync`-based dev-vs-dist distinction `scripts/bench.mjs`'s own `resolveCliCommand` already
 * establishes for the identical "this file might be running from source or from a real build"
 * question. */
const DIST_WORKER_URL = new URL('./normalize-worker.mjs', import.meta.url);

const WORKER_URL = existsSync(DIST_WORKER_URL) ? DIST_WORKER_URL : SRC_WORKER_URL;

/**
 * The real, per-`workerUrl` execution flags a `node:worker_threads.Worker` needs — critically, a
 * precompiled `.mjs`/`.js` worker (the published artifact's own default `DIST_WORKER_URL`, above)
 * needs NONE of this at all, so `getWorkerTsExecArgv()` — which, on Node 20.x, resolves a real,
 * on-disk file this package's own published `files` never ships (`scripts/lib/worker-ts-strip-
 * loader.mjs`) — is called ONLY when `workerUrl` is genuinely a `.ts`-family source file, never
 * unconditionally at module load.
 *
 * `Q340` (`SPEC-QUESTIONS.md`), a real critic finding against the actual built artifact: an EARLIER
 * version of this fix called the equivalent of `getWorkerTsExecArgv()` eagerly, as a top-level
 * constant — since this whole module is bundled into the published `dist/forge.mjs`, and ES module
 * semantics run a module's whole top-level body the instant ANY of its exports are imported, that
 * meant the published CLI crashed with `Cannot find module` on Node 20 for EVERY command, before any
 * dispatch or argument parsing even happened — not merely "this one worker path is broken." This
 * function being both lazy (called only here, at actual `Worker`-creation time) and
 * extension-gated (skipped entirely for the dist build's own default precompiled worker) closes that
 * gap at its real root, not merely by deferring the same crash to a later point.
 */
function execArgvForWorker(workerUrl: URL): readonly string[] {
  const needsTypeStripping = /\.(m?ts|cts)$/.test(workerUrl.pathname);
  // `--no-warnings` stays a separate, always-present argv element regardless: harmless, and
  // unaffected by which (if any) TS mechanism is in play.
  return needsTypeStripping ? [...getWorkerTsExecArgv(), '--no-warnings'] : ['--no-warnings'];
}

/** How many bytes of shared memory are reserved for the worker's own JSON-encoded result, beyond the
 * 8-byte header (`normalize-worker.ts`'s own doc comment has the exact layout) — generous relative to
 * `text`'s own length so an ordinary case (whose rules only ever remove or rearrange content, never
 * invent new bytes from nothing) has ample room, while staying a bounded, predictable allocation
 * rather than one sized to an adversarial worst case no normalize rule set in practice approaches. A
 * `replace` rule whose own replacement text is far longer than its match, repeated enough times, COULD
 * still exceed this — disclosed, not chased further: {@link applyNormalizeRulesToTextBounded} reports
 * that case as its own typed, honest refusal (`status: 'ok', ok: false, kind: 'rule-failed'`, never a
 * crash or a silently truncated result), never a crash. */
function payloadCapacityBytesFor(text: string): number {
  return Math.max(1_000_000, text.length * 8 + 65_536);
}

/** One normalize-budget outcome: the real {@link NormalizeTextOutcome} `applyNormalizeRulesToText`
 * itself would have returned (`status: 'ok'`), a timeout this module decided on the worker's behalf
 * once the budget elapsed with no signal at all (`status: 'timed-out'`), or a worker crash this
 * module detected via {@link SYNC_CRASHED} (`status: 'crashed'`) — kept as its OWN, distinct outcome
 * rather than folded into `'timed-out'`, since "the rules ran too long" and "the thread that was
 * running them died" are different, useful diagnoses for whoever reads the resulting error. */
export type NormalizeBudgetOutcome =
  | ({ readonly status: 'ok' } & NormalizeTextOutcome)
  | { readonly status: 'timed-out' }
  | { readonly status: 'crashed'; readonly detail: string };

/**
 * Runs `applyNormalizeRulesToText(text, rules, scope)` in a worker thread, returning its real result
 * when the worker signals completion within `budgetMs`, a typed `{status: 'crashed'}` if the worker
 * thread dies first, or `{status: 'timed-out'}` once `budgetMs` elapses with no signal at all — in
 * either of the latter two cases the worker is forcibly terminated, never left running.
 *
 * Synchronous from its caller's own point of view (see this module's own file header for why): it
 * blocks the calling thread for at most `budgetMs`, plus the small, fixed cost of starting a worker
 * thread (typically single-digit milliseconds), never longer.
 *
 * @throws {ForgeError} `RUN-154` if `normalize-worker.ts` itself reports an unexpected internal
 * failure through its own normal (non-crash) result path — unreachable in practice, since
 * `applyNormalizeRulesToText`'s own contract is "never throws" and {@link NormalizeTextOutcome}
 * carries every real failure as data; kept as a typed refusal rather than a bare throw regardless,
 * since `QUALITY-BAR.md` R2 carries no reachability exception.
 *
 * `workerUrl` is a test-only seam (defaults to the real worker), the identical "an optional override
 * parameter for the one real dependency a test needs to fake" shape `declaration.ts`'s own
 * `loadParityDeclaration(..., vet: VetCommand = vetStoredCommand)` already uses — `normalize-budget
 * .test.ts`'s own crash-handling tests point it at a small fixture worker that deliberately crashes,
 * rather than mutating this module's real production worker file to prove the same thing.
 */
export function applyNormalizeRulesToTextBounded(
  text: string,
  rules: readonly NormalizeRule[],
  scope: NormalizeTargetScope,
  budgetMs: number = DEFAULT_NORMALIZE_BUDGET_MS,
  workerUrl: URL = WORKER_URL,
): NormalizeBudgetOutcome {
  const syncBuffer = new SharedArrayBuffer(4);
  const sync = new Int32Array(syncBuffer);
  const resultBuffer = new SharedArrayBuffer(8 + payloadCapacityBytesFor(text));
  const workerData: NormalizeWorkerData = { text, rules, scope, sync, resultBuffer };
  const worker = new Worker(workerUrl, { execArgv: [...execArgvForWorker(workerUrl)], workerData });
  // Prevents Node's own default "an unhandled 'error' event crashes the process" behaviour for
  // anything that escapes even `normalize-worker.ts`'s own `process.on('uncaughtException', ...)`
  // handler (a failure before that handler can register at all, such as an import/module-load
  // error) — this listener cannot itself fire in time to change THIS call's own return value (the
  // identical event-loop dependency the `postMessage` approach was already rejected for, above), so
  // it exists ONLY to stop the crash; `sync`'s own value, checked below, is the real, prompt signal.
  worker.on('error', () => {
    // Intentionally empty: see this call's own comment, immediately above.
  });
  try {
    const waitResult = Atomics.wait(sync, 0, 0, budgetMs);
    if (waitResult === 'timed-out') {
      return { status: 'timed-out' };
    }
    if (Atomics.load(sync, 0) === SYNC_CRASHED) {
      return {
        status: 'crashed',
        detail: 'the normalize worker thread terminated before it could report a result',
      };
    }
    const header = new Int32Array(resultBuffer, 0, 2);
    const payloadLength = header[1];
    if (payloadLength === undefined || payloadLength < 0) {
      // `normalize-worker.ts` itself decided the result would not fit `resultBuffer` -- reported as
      // an ordinary, typed rule-application failure, never a crash (see `payloadCapacityBytesFor`'s
      // own doc comment for exactly when this can happen).
      return {
        status: 'ok',
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
      // in that file reaches this branch, never an ordinary rule-application failure -- still a
      // typed `ForgeError`, never a bare throw (`QUALITY-BAR.md` R2 has no reachability exception).
      throw new ForgeError('RUN-154', {
        detail: `normalize-worker.ts itself threw: ${message.message}`,
      });
    }
    return { status: 'ok', ...message.outcome };
  } finally {
    void worker.terminate();
  }
}
