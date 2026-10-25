/**
 * `applyNormalizeRulesToLibraryValueBounded` — runs {@link applyNormalizeRulesToLibraryValue} inside
 * a worker thread this module can forcibly terminate once a wall-clock budget elapses, the
 * structural (`library` surface) counterpart to `normalize-budget.ts`'s own
 * `applyNormalizeRulesToTextBounded`, built the IDENTICAL way, reusing the identical
 * `DEFAULT_NORMALIZE_BUDGET_MS`, `execArgvForWorker`, and dev-source/published-dist `WORKER_URL`
 * distinction (`Q340`'s own fix — this module's worker needs the identical lazy, extension-gated
 * treatment: an eager top-level call would crash the published CLI on Node 20 for every command,
 * exactly as it did for the text-surface worker before that fix), for the reason
 * `normalize-library-worker-protocol.ts`'s own file header already gives in full: a critic proved
 * live that `redact-json-pointers`' own regex, run synchronously on `library`'s normalisation path
 * with no bound at all, hangs on a flat-adjacent-group pattern `CFG-511`'s own lint cannot catch
 * (`isPathologicalReplacePattern` only flags NESTED quantifiers) — exponential blowup measured
 * directly (128ms at input length 8, 11.7s at length 14). This module closes that gap by giving
 * `library` the identical worker-thread bound `process`/`file`/`http` already have, never a second,
 * independently invented mechanism.
 *
 * See `normalize-budget.ts`'s own file header for the full, independently-confirmed account of why
 * a worker thread (not `Promise.race`/`setTimeout`), why `Atomics.wait` plus shared memory (not
 * `postMessage`), and why a worker crash is a typed refusal, never a process crash — every one of
 * those reasons applies identically here, unrelated to whether the payload is `text: string` or
 * `value: unknown`.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 * @see process/SPEC-QUESTIONS.md Q317 Decision 8
 */
import { existsSync } from 'node:fs';
import { deserialize } from 'node:v8';
import { Worker } from 'node:worker_threads';

import { ForgeError } from '@forge/core/errors';

import type { NormalizeRule } from './declaration-types.ts';
import type { NormalizeLibraryOutcome } from './normalize.ts';
import { DEFAULT_NORMALIZE_BUDGET_MS, execArgvForWorker } from './normalize-budget.ts';
import {
  SYNC_CRASHED,
  type NormalizeLibraryWorkerData,
  type NormalizeLibraryWorkerMessage,
} from './normalize-library-worker-protocol.ts';

/** The real worker SOURCE file, run with no build step in dev/test — never shipped: `package.json`'s
 * own `files` lists only `dist` and `bin/preflight.cjs`, so this `.ts` file does not exist at all in
 * a real npm install of this package. Mirrors `normalize-budget.ts`'s own `SRC_WORKER_URL`. */
const SRC_WORKER_URL = new URL('./normalize-library-worker.ts', import.meta.url);

/** The real, PRECOMPILED, plain-JS worker entry `tsup.config.ts`'s own third `entry` produces as a
 * sibling of the published `dist/forge.mjs` and `dist/normalize-worker.mjs` — see
 * `normalize-budget.ts`'s own `DIST_WORKER_URL` doc comment for the full, identical account of why
 * this distinction exists (`Q340`). */
const DIST_WORKER_URL = new URL('./normalize-library-worker.mjs', import.meta.url);

const WORKER_URL = existsSync(DIST_WORKER_URL) ? DIST_WORKER_URL : SRC_WORKER_URL;

/** How many bytes of shared memory are reserved for the worker's own JSON-encoded result, beyond
 * the 8-byte header — the structural counterpart to `normalize-budget.ts`'s own
 * `payloadCapacityBytesFor`, sized off the VALUE's own serialised length (there is no raw `text`
 * length to size against here) with the identical generous-but-bounded `*8 + 65_536` margin, for the
 * identical reason: a `redact-json-pointers` rule whose own `replacement` is far longer than its
 * match, repeated enough times, could still exceed this -- disclosed, not chased further; see that
 * function's own doc comment for the full account of why this is an honest, typed refusal
 * (`status: 'ok', ok: false, kind: 'too-large'`, below), never a crash or a silent truncation. */
function payloadCapacityBytesFor(value: unknown): number {
  const serializedLength = JSON.stringify(value).length;
  return Math.max(1_000_000, serializedLength * 8 + 65_536);
}

/** One normalize-library-budget outcome — the structural counterpart to `normalize-budget.ts`'s own
 * `NormalizeBudgetOutcome`, down to sharing its three top-level `status` values for the identical
 * reasons that type's own doc comment gives. */
export type NormalizeLibraryBudgetOutcome =
  | ({ readonly status: 'ok' } & NormalizeLibraryOutcome)
  | { readonly status: 'timed-out' }
  | { readonly status: 'crashed'; readonly detail: string };

/**
 * Runs `applyNormalizeRulesToLibraryValue(value, rules)` in a worker thread, returning its real
 * result when the worker signals completion within `budgetMs`, a typed `{status: 'crashed'}` if the
 * worker thread dies first, or `{status: 'timed-out'}` once `budgetMs` elapses with no signal at
 * all — in either of the latter two cases the worker is forcibly terminated, never left running.
 * The structural (`library` surface) counterpart to `normalize-budget.ts`'s own
 * `applyNormalizeRulesToTextBounded`; see that function's own doc comment for the full account of
 * its synchronous-from-the-caller's-view contract and its `workerUrl` test seam, both identical here.
 *
 * @throws {ForgeError} `RUN-154` if `normalize-library-worker.ts` itself reports an unexpected
 * internal failure through its own normal (non-crash) result path — unreachable in practice, since
 * `applyNormalizeRulesToLibraryValue`'s own contract is "never throws"; kept as a typed refusal
 * rather than a bare throw regardless (`QUALITY-BAR.md` R2 carries no reachability exception).
 */
export function applyNormalizeRulesToLibraryValueBounded(
  value: unknown,
  rules: readonly NormalizeRule[],
  budgetMs: number = DEFAULT_NORMALIZE_BUDGET_MS,
  workerUrl: URL = WORKER_URL,
): NormalizeLibraryBudgetOutcome {
  const syncBuffer = new SharedArrayBuffer(4);
  const sync = new Int32Array(syncBuffer);
  const resultBuffer = new SharedArrayBuffer(8 + payloadCapacityBytesFor(value));
  const workerData: NormalizeLibraryWorkerData = { value, rules, sync, resultBuffer };
  const worker = new Worker(workerUrl, { execArgv: [...execArgvForWorker(workerUrl)], workerData });
  // See `normalize-budget.ts`'s own identical listener for the full account of why this exists and
  // why it cannot itself be the real signal.
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
        detail: 'the normalize-library worker thread terminated before it could report a result',
      };
    }
    const header = new Int32Array(resultBuffer, 0, 2);
    const payloadLength = header[1];
    if (payloadLength === undefined || payloadLength < 0) {
      // `normalize-library-worker.ts` itself decided the result would not fit `resultBuffer` -- an
      // honest, typed refusal, never a crash (see `payloadCapacityBytesFor`'s own doc comment for
      // exactly when this can happen).
      return { status: 'ok', ok: false, kind: 'too-large' };
    }
    // `node:v8`'s `deserialize`, never `JSON.parse` -- see `NormalizeLibraryWorkerMessage`'s own
    // doc comment for the real, confirmed bug this avoids (JSON silently turns NaN/Infinity into
    // null, which `normalize-library-worker.ts`'s own `serialize` call never does).
    const payloadBytes = new Uint8Array(resultBuffer, 8, payloadLength);
    const message = deserialize(payloadBytes) as NormalizeLibraryWorkerMessage;
    if (!message.ok) {
      // See `normalize-library-worker.ts`'s own doc comment on `NormalizeLibraryWorkerMessage`: only
      // a genuine bug in that file reaches this branch, never an ordinary rule-application failure.
      throw new ForgeError('RUN-154', {
        detail: `normalize-library-worker.ts itself threw: ${message.message}`,
      });
    }
    return { status: 'ok', ...message.outcome };
  } finally {
    void worker.terminate();
  }
}
